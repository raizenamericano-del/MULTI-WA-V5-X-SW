import type { Server as HttpServer } from 'node:http'
import { Server as IOServer, type Socket } from 'socket.io'
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@/lib/types'
import { authEnabled, tokenFromCookieHeader, verifySessionToken } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { registerClient, removeClient, setVisibility } from '@/lib/presence'

export type AppIOServer = IOServer<ClientToServerEvents, ServerToClientEvents>
export type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>

export const SOCKET_PATH = process.env.SOCKET_PATH || '/api/socket/io'

/**
 * The Socket.io server instance is kept on globalThis on purpose.
 *
 * With a custom server (server.ts) + Next.js App Router, the route handlers are
 * bundled by Next into their own module graph. A plain module-scope singleton
 * would therefore be duplicated and the route handlers would talk to a *second*,
 * useless copy of the server. globalThis is shared by every module graph inside
 * the same Node process, so this is the safe place for process-wide singletons.
 */
const globalStore = globalThis as unknown as {
  __waIO?: AppIOServer
  __waNextServer?: HttpServer
}

export function setIO(io: AppIOServer) {
  globalStore.__waIO = io
}

export function getIO(): AppIOServer | null {
  return globalStore.__waIO ?? null
}

export function setHttpServer(server: HttpServer) {
  globalStore.__waNextServer = server
}

export function getHttpServer(): HttpServer | null {
  return globalStore.__waNextServer ?? null
}

/** Emit an event to everybody watching a specific session. */
export function emitToSession<E extends keyof ServerToClientEvents>(
  sessionId: string,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
) {
  getIO()?.to(`session:${sessionId}`).emit(event, ...args)
}

/** Emit an event to every connected dashboard client. */
export function broadcast<E extends keyof ServerToClientEvents>(
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
) {
  getIO()?.emit(event, ...args)
}

/**
 * Wire the Socket.io gateway: room management + client -> server commands
 * (presence / read receipts are forwarded to the matching Baileys session).
 */
export async function registerSocketGateway(io: AppIOServer) {
  setIO(io)

  // Late import: avoids a circular dependency between the gateway and the
  // session manager (the manager itself imports socket helpers).
  const { sessionManager } = await import('@/lib/baileys/session-manager')

  // Socket.io ikut dijaga login: data chat mengalir lewat jalur ini.
  io.use(async (socket, next) => {
    if (!authEnabled()) return next()
    const token = tokenFromCookieHeader(socket.handshake.headers.cookie)
    const payload = await verifySessionToken(token)
    if (!payload) {
      logger.warn({ ip: socket.handshake.address }, 'handshake socket ditolak (belum login)')
      return next(new Error('unauthorized'))
    }
    return next()
  })

  io.on('connection', (socket) => {
    socket.emit('server:ready', { at: new Date().toISOString() })
    socket.join('all')

    // Presence: apakah tab ini sedang dilihat? (dipakai untuk notifikasi push)
    registerClient(socket.id)
    socket.on('presence:visibility', ({ state, deviceId } = { state: 'hidden' }) => {
      setVisibility(socket.id, state === 'visible' ? 'visible' : 'hidden', deviceId ?? null)
    })
    socket.on('disconnect', () => removeClient(socket.id))

    socket.on('subscribe', ({ sessionId } = {}) => {
      if (sessionId) void socket.join(`session:${sessionId}`)
    })

    socket.on('unsubscribe', ({ sessionId } = {}) => {
      if (sessionId) void socket.leave(`session:${sessionId}`)
    })

    socket.on('chat:typing', async ({ sessionId, chatId, state }) => {
      try {
        await sessionManager.sendPresence(sessionId, chatId, state)
      } catch {
        /* best effort */
      }
    })

    socket.on('chat:read', async ({ sessionId, chatId }) => {
      try {
        await sessionManager.markChatRead(sessionId, chatId)
      } catch {
        /* best effort */
      }
    })

    // Clients join a room per open chat. The session manager checks the room
    // occupancy before incrementing unread counters / sending read receipts.
    socket.on('chat:open', ({ chatId } = { chatId: '' }) => {
      if (chatId) void socket.join(`chat:${chatId}`)
    })

    socket.on('chat:close', ({ chatId } = { chatId: '' }) => {
      if (chatId) void socket.leave(`chat:${chatId}`)
    })
  })

  return io
}
