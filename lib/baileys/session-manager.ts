import fs from 'node:fs/promises'
import path from 'node:path'
import {
  Browsers,
  DisconnectReason,
  delay,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  makeWASocket,
  type AnyMessageContent,
  type BaileysEventMap,
  type Chat,
  type Contact,
  type WAMessage,
  type WASocket,
  type proto,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import prisma from '@/lib/prisma'
import { baileysLogger, logger } from '@/lib/logger'
import { sendPushToAll } from '@/lib/push'
import { dispatchWebhook } from '@/lib/webhook'
import {
  broadcast,
  emitToSession,
  getIO,
} from '@/lib/socket-server'
import type { ChatDTO, ContactDTO, MessageDTO, SessionStatus } from '@/lib/types'
import { chatDisplayName, isPlaceholderChatName, jidToNumber, normalizePhoneNumber, toJid } from '@/lib/utils'
import { createAuthState, hasStoredCreds, removeAuthState } from './auth-state'
import { storeIncomingMedia } from './media'
import { MEDIA_ROOT, ensureDir, guessExtension, sessionMediaDir } from './paths'
import {
  ensureChat,
  isIgnoredJid,
  isLidJid,
  parseEditedMessage,
  parseReaction,
  parseRevoke,
  parseWaMessage,
  previewFor,
  rebuildMediaMessage,
  serializeMediaNode,
  toChatDTO,
  toMessageDTO,
  toSessionDTO,
  waStatusToDb,
  type MessageKeyLike,
  type ParsedMessage,
} from './persistence'
import { toOggOpus } from './transcode'
import { statusStore } from './status-store'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** One line of forensic data about a raw event, exposed by /api/sessions/:id/debug. */
export interface DebugEntry {
  at: string
  event: string
  jid?: string
  keyShape?: string
  type?: string
  fromMe?: boolean
  stored: boolean
  reason: string
}

interface LiveSession {
  sessionId: string
  sock: WASocket
  qr: string | null
  reconnectAttempts: number
  reconnectTimer: NodeJS.Timeout | null
  manualDisconnect: boolean
  pairingRequested: boolean
  startedAt: number
  /** Set when a newer socket replaced this one — its events must be ignored. */
  stale?: boolean
  /** lid (@lid user) -> phone-number user, learned from traffic + contacts. */
  lidToPn: Map<string, string>
  /** JID -> best known display name (contact name / notify name). */
  contactNames: Map<string, string>
  /** Ring buffer with the last raw events, for troubleshooting. */
  debugLog: DebugEntry[]
  counters: {
    upsert: number
    stored: number
    skipped: number
    historyMessages: number
    reactions: number
    revoked: number
    edited: number
    mediaRetried: number
    mediaRecovered: number
  }
}

export interface OutgoingPayload {
  kind: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'location' | 'contact'
  text?: string | null
  buffer?: Buffer | null
  mimetype?: string | null
  fileName?: string | null
  ptt?: boolean
  caption?: string | null
  /** Our internal Message id — the panel rebuilds the WhatsApp quote from it. */
  quotedMessageId?: string | null
  /** Send the media as view-once (foto/video sekali lihat). */
  viewOnce?: boolean
  /** kind === 'location' */
  location?: { lat: number; lng: number; name?: string | null } | null
  /** kind === 'contact' */
  contact?: { displayName: string; phone: string } | null
}

export interface ForwardResult {
  message: ReturnType<typeof toMessageDTO>
  chat: ReturnType<typeof toChatDTO>
  targetChatName: string | null
}

/** Cocokkan teks pesan dengan aturan balasan otomatis. */
function matchRule(matchType: string, pattern: string, text: string) {
  const haystack = text.toLowerCase()
  const needle = pattern.toLowerCase().trim()
  if (!needle) return false

  switch (matchType) {
    case 'exact':
      return haystack === needle
    case 'startsWith':
      return haystack.startsWith(needle)
    case 'regex':
      try {
        return new RegExp(pattern, 'i').test(text)
      } catch {
        return false
      }
    case 'contains':
    default:
      return haystack.includes(needle)
  }
}

/** vCard minimal yang diterima WhatsApp untuk kartu kontak. */
function buildVcard(displayName: string, phoneNumber: string) {
  const safeName = displayName.replace(/[\r\n;:]/g, ' ').trim() || phoneNumber
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${safeName}`,
    `N:${safeName};;;;`,
    `TEL;type=CELL;type=VOICE;waid=${phoneNumber}:+${phoneNumber}`,
    'END:VCARD',
  ].join('\n')
}

const MAX_RECONNECT_ATTEMPTS = 12

/* ------------------------------------------------------------------ */
/* Session Manager                                                     */
/* ------------------------------------------------------------------ */

const DEBUG_LOG_SIZE = 120
const HISTORY_MESSAGE_LIMIT = Number(process.env.WA_HISTORY_MESSAGE_LIMIT ?? 3000)

class SessionManager {
  private sessions = new Map<string, LiveSession>()
  /** Consecutive watchdog revive attempts per session, to avoid loops. */
  private watchdogAttempts = new Map<string, number>()
  private watchdogTimer: NodeJS.Timeout | null = null
  readonly bootedAt = Date.now()

  /* ----------------------------- helpers ---------------------------- */

  isLive(sessionId: string) {
    return this.sessions.has(sessionId)
  }

  /** Append to the per-session forensic ring buffer. */
  private pushDebug(live: LiveSession, entry: Omit<DebugEntry, 'at'>) {
    live.debugLog.push({ at: new Date().toISOString(), ...entry })
    if (live.debugLog.length > DEBUG_LOG_SIZE) live.debugLog.splice(0, live.debugLog.length - DEBUG_LOG_SIZE)
  }

  /** lid -> pn, learned from message keys, contacts and chat syncs. */
  private rememberLid(live: LiveSession, lidJid?: string | null, pnJid?: string | null) {
    if (!lidJid || !pnJid) return false
    if (!isLidJid(lidJid)) return false
    if (isLidJid(pnJid) || !pnJid.endsWith('@s.whatsapp.net')) return false
    const lidUser = lidJid.split('@')[0].split(':')[0]
    const pnUser = pnJid.split('@')[0].split(':')[0]
    if (live.lidToPn.get(lidUser) === pnUser) return false
    live.lidToPn.set(lidUser, pnUser)
    logger.debug({ sessionId: live.sessionId, lid: lidUser, pn: pnUser }, 'learned lid -> pn mapping')
    return true
  }

  /**
   * Perbaikan chat lama yang masih tersimpan di alamat `@lid` (sebelum pasangan
   * lid→nomor diketahui). Sumber pencarian, berurutan:
   *   1. peta lid→pn yang sudah dipelajari sesi ini,
   *   2. pengirim pesan di chat tersebut yang sudah berupa nomor (`@s.whatsapp.net`).
   * Kalau ketemu, chat digabungkan ke chat bernomor (riwayat tetap utuh).
   * Aman dipanggil berkali-kali.
   */
  async repairLidChats(sessionId: string, lidToPn?: Map<string, string>) {
    const map = lidToPn ?? this.sessions.get(sessionId)?.lidToPn ?? new Map<string, string>()

    const lidChats = await prisma.chat.findMany({
      where: { sessionId, jid: { endsWith: '@lid' } },
      select: { id: true, jid: true },
      take: 200,
    })
    let repaired = 0
    let unresolved = 0
    let failed = 0

    for (const chat of lidChats) {
      const lidUser = chat.jid.split('@')[0].split(':')[0]
      let pnUser = map.get(lidUser) ?? null

      if (!pnUser) {
        // Pesan lama di chat ini mungkin sudah menyimpan pengirim bernomor.
        const sender = await prisma.message.findFirst({
          where: {
            chatId: chat.id,
            fromMe: false,
            senderJid: { endsWith: '@s.whatsapp.net' },
          },
          select: { senderJid: true },
          orderBy: { timestamp: 'desc' },
        })
        pnUser = sender?.senderJid ? jidToNumber(sender.senderJid) : null
        if (pnUser) map.set(lidUser, pnUser)
      }

      if (!pnUser) {
        unresolved += 1
        continue
      }

      try {
        await this.migrateLidContact(sessionId, chat.jid, `${pnUser}@s.whatsapp.net`).catch(() => false)
        const moved = await this.migrateLidChat(sessionId, chat.jid, `${pnUser}@s.whatsapp.net`)
        if (moved) repaired += 1
        else failed += 1
      } catch (error) {
        // Baris data lama yang tidak terbaca (mis. tanggal rusak) tidak boleh
        // menggagalkan seluruh proses — catat supaya kelihatan di log & hasil API.
        failed += 1
        logger.warn({ error, sessionId, jid: chat.jid }, 'gagal memigrasikan chat @lid')
      }
    }

    // Kontak bisa ada tanpa chat (mis. dari buku alamat) — rapikan juga.
    let contactsRepaired = 0
    const lidContacts = await prisma.contact.findMany({
      where: { sessionId, jid: { endsWith: '@lid' } },
      select: { jid: true },
      take: 500,
    })
    for (const contact of lidContacts) {
      const lidUser = contact.jid.split('@')[0].split(':')[0]
      const phoneUser = map.get(lidUser)
      if (!phoneUser) continue
      const moved = await this
        .migrateLidContact(sessionId, contact.jid, `${phoneUser}@s.whatsapp.net`)
        .catch(() => false)
      if (moved) contactsRepaired += 1
    }

    if (repaired > 0 || failed > 0 || contactsRepaired > 0) {
      logger.info(
        { sessionId, repaired, unresolved, failed, contactsRepaired },
        'perbaikan chat @lid selesai',
      )
    }
    return { scanned: lidChats.length, repaired, unresolved, failed, contactsRepaired }
  }

  private resolveLidFrom(live: LiveSession, lidJid: string): string | null {
    const user = lidJid.split('@')[0].split(':')[0]
    const pn = live.lidToPn.get(user)
    return pn ? `${pn}@s.whatsapp.net` : null
  }

  private rememberContactName(live: LiveSession, jid?: string | null, name?: string | null) {
    if (!jid || !name) return
    if (isIgnoredJid(jid)) return
    live.contactNames.set(jid, name)
  }

  private displayNameFor(live: LiveSession, jid: string): string | null {
    return (
      live.contactNames.get(jid) ??
      live.contactNames.get(`${jid.split('@')[0]}@lid`) ??
      null
    )
  }

  /** Human readable shape of a raw message key, for the debug endpoint. */
  private keyShape(keyRaw?: unknown) {
    if (!keyRaw) return 'no-key'
    const key = keyRaw as MessageKeyLike
    const parts = [`remoteJid=${key.remoteJid ?? '-'}`]
    if (key.participant) parts.push(`participant=${key.participant}`)
    if (key.senderPn) parts.push(`senderPn=${key.senderPn}`)
    if (key.participantPn) parts.push(`participantPn=${key.participantPn}`)
    if (key.senderLid) parts.push(`senderLid=${key.senderLid}`)
    if (key.participantLid) parts.push(`participantLid=${key.participantLid}`)
    return parts.join(' | ')
  }

  getLive(sessionId: string): LiveSession | null {
    return this.sessions.get(sessionId) ?? null
  }

  private requireLive(sessionId: string): LiveSession {
    const live = this.sessions.get(sessionId)
    if (!live) {
      throw new Error('Session is not running. Reconnect it from the dashboard first.')
    }
    return live
  }

  private async setStatus(
    sessionId: string,
    status: SessionStatus,
    extra: {
      pairingCode?: string | null
      pairingCodeExpiresAt?: Date | null
      pushName?: string | null
      lastError?: string | null
      connectedAt?: Date | null
    } = {},
  ) {
    const updated = await prisma.waSession.update({
      where: { id: sessionId },
      data: { status, ...extra },
    })

    emitToSession(sessionId, 'session:status', {
      sessionId,
      status,
      pushName: updated.pushName,
      phoneNumber: updated.phoneNumber,
      lastError: updated.lastError,
      connectedAt: updated.connectedAt?.toISOString() ?? null,
    })
    broadcast('sessions:changed')

    return updated
  }

  private clearReconnect(sessionId: string) {
    const live = this.sessions.get(sessionId)
    if (live?.reconnectTimer) {
      clearTimeout(live.reconnectTimer)
      live.reconnectTimer = null
    }
  }

  /* ------------------------------ boot ------------------------------ */

  /** Restores every session that was connected before the process restarted. */
  async boot() {
    if (process.env.WA_AUTO_RESTORE === 'false') {
      logger.info('WA_AUTO_RESTORE=false — skipping session restore')
      return
    }

    const sessions = await prisma.waSession.findMany({
      orderBy: { createdAt: 'asc' },
    })

    logger.info({ count: sessions.length }, 'restoring sessions')

    for (const session of sessions) {
      const hasCreds = await hasStoredCreds(session.id)
      if (!hasCreds) {
        if (session.status === 'connected' || session.status === 'connecting') {
          await prisma.waSession.update({
            where: { id: session.id },
            data: { status: 'disconnected', pairingCode: null },
          })
        }
        continue
      }

      // A stored (registered) session should always come back online.
      if (session.status === 'connected' || session.status === 'connecting') {
        try {
          await this.startSocket(session.id, { fresh: false })
        } catch (error) {
          logger.error({ error, sessionId: session.id }, 'failed to restore session')
          await this.setStatus(session.id, 'error', {
            lastError: error instanceof Error ? error.message : String(error),
          })
        }
      } else if (session.status === 'pairing') {
        await prisma.waSession.update({
          where: { id: session.id },
          data: { status: 'disconnected', pairingCode: null, pairingCodeExpiresAt: null },
        })
      }
    }
  }

  /* --------------------------- create/CRUD -------------------------- */

  async listSessions() {
    const sessions = await prisma.waSession.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { chats: true, messages: true } },
      },
    })

    const unread = await prisma.chat.groupBy({
      by: ['sessionId'],
      _sum: { unreadCount: true },
    })
    const unreadMap = new Map(unread.map((u) => [u.sessionId, u._sum.unreadCount ?? 0]))

    return sessions.map((session) => ({
      ...toSessionDTO(session, this.isLive(session.id)),
      stats: {
        chats: session._count.chats,
        messages: session._count.messages,
        unread: unreadMap.get(session.id) ?? 0,
      },
    }))
  }

  async createSession(input: { name?: string; phoneNumber: string }) {
    const phoneNumber = normalizePhoneNumber(input.phoneNumber)
    if (!phoneNumber || phoneNumber.length < 8) {
      throw new Error('Invalid phone number. Use the international format, e.g. 6281234567890')
    }

    const existing = await prisma.waSession.findUnique({ where: { phoneNumber } })
    if (existing) {
      throw new Error(`Session for +${phoneNumber} already exists`)
    }

    const session = await prisma.waSession.create({
      data: {
        name: input.name?.trim() || `+${phoneNumber}`,
        phoneNumber,
        status: 'disconnected',
      },
    })

    broadcast('sessions:changed')
    emitToSession(session.id, 'session:created', { sessionId: session.id })

    return toSessionDTO(session, false)
  }

  async getSession(sessionId: string) {
    const session = await prisma.waSession.findUnique({ where: { id: sessionId } })
    if (!session) return null
    return toSessionDTO(session, this.isLive(sessionId))
  }

  /** Full delete: unlink, wipe auth files, media and DB rows. */
  async deleteSession(sessionId: string) {
    await this.disconnect(sessionId).catch(() => undefined)
    await statusStore.clear(sessionId)
    await prisma.waSession.delete({ where: { id: sessionId } }).catch(() => undefined)
    await removeAuthState(sessionId).catch(() => undefined)
    await fs.rm(sessionMediaDir(sessionId), { recursive: true, force: true }).catch(() => undefined)

    emitToSession(sessionId, 'session:deleted', { sessionId })
    broadcast('sessions:changed')
  }

  /* ------------------------------ socket ---------------------------- */

  async startSocket(sessionId: string, options: { fresh?: boolean } = {}) {
    this.clearReconnect(sessionId)

    const record = await prisma.waSession.findUnique({ where: { id: sessionId } })
    if (!record) throw new Error('Session not found')

    // Never run two sockets for the same session.
    const previous = this.sessions.get(sessionId)
    if (previous) {
      previous.manualDisconnect = true
      previous.stale = true
      try {
        previous.sock.ev.removeAllListeners('connection.update')
        previous.sock.ws?.close()
        previous.sock.end(undefined)
      } catch {
        /* ignore */
      }
      this.sessions.delete(sessionId)
      await delay(400)
    }

    const { state, saveCreds } = await createAuthState(sessionId)
    const { version } = await fetchLatestBaileysVersion().catch(() => ({
      version: undefined as number[] | undefined,
      isLatest: false,
    }))

    const sock = makeWASocket({
      version: version as [number, number, number] | undefined,
      auth: { creds: state.creds, keys: state.keys },
      logger: baileysLogger.child({ session: sessionId.slice(-6) }) as never,
      printQRInTerminal: false,
      browser: Browsers.appropriate('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: process.env.WA_SYNC_FULL_HISTORY === 'true',
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined,
    })

    const live: LiveSession = {
      sessionId,
      sock,
      qr: null,
      reconnectAttempts: 0,
      reconnectTimer: null,
      manualDisconnect: false,
      pairingRequested: false,
      startedAt: Date.now(),
      lidToPn: new Map(),
      contactNames: new Map(),
      debugLog: [],
      counters: {
        upsert: 0,
        stored: 0,
        skipped: 0,
        historyMessages: 0,
        reactions: 0,
        revoked: 0,
        edited: 0,
        mediaRetried: 0,
        mediaRecovered: 0,
      },
    }
    this.sessions.set(sessionId, live)

    if (state.creds.registered) {
      await this.setStatus(sessionId, 'connecting', { lastError: null })
    }

    sock.ev.on('creds.update', () => {
      void saveCreds()
    })

    sock.ev.on('connection.update', (update) => {
      void this.handleConnectionUpdate(live, update).catch((error) => {
        logger.error({ error, sessionId }, 'connection.update handler failed')
      })
    })

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify' && type !== 'append') return
      void (async () => {
        for (const message of messages) {
          if (!message || live.stale) continue
          if (message.key?.remoteJid === 'status@broadcast') {
            if (live.manualDisconnect) continue
            await statusStore.ingest(sessionId, message).catch(error =>
              logger.warn({ error, sessionId }, 'failed to store status'))
            continue
          }
          // Reactions / revokes are "messages" on the wire but modify an
          // existing row — they must not be stored as new chat messages.
          const reaction = parseReaction(message)
          if (reaction) {
            await this.handleReaction(live, reaction).catch((error) =>
              logger.debug({ error, sessionId }, 'reaction handling failed'),
            )
            continue
          }

          const revoke = parseRevoke(message)
          if (revoke) {
            await this.handleRevoke(live, revoke).catch((error) =>
              logger.debug({ error, sessionId }, 'revoke handling failed'),
            )
            continue
          }

          await this.handleIncomingMessage(live, message).catch((error) => {
            logger.warn({ error, sessionId }, 'failed to persist incoming message')
          })
        }
      })()
    })

    // WhatsApp re-shares media a few seconds after the message itself (typical
    // for view-once photos/videos and for messages that failed to decrypt on
    // first sight) — this is what makes "foto sekali lihat" downloadable.
    sock.ev.on('messages.media-update', (updates) => {
      void (async () => {
        for (const update of updates) {
          const id = update?.key?.id
          if (!id) continue
          if (update.error && !update.media) {
            logger.debug({ sessionId, id }, 'media update reported an error')
            continue
          }
          await this.retryMediaDownload(live.sessionId, undefined, id).catch((error) =>
            logger.debug({ error, sessionId }, 'media re-download failed'),
          )
        }
      })()
    })

    sock.ev.on('messages.update', (updates) => {
      void (async () => {
        for (const update of updates) {
          if (!update?.key?.id) continue

          // WhatsApp delivers message edits here (protocolMessage MESSAGE_EDIT).
          const edited = parseEditedMessage(update.update)
          if (edited) {
            await this.handleEdit(live, update.key.id, edited).catch((error) =>
              logger.debug({ error, sessionId }, 'edit handling failed'),
            )
            continue
          }

          const status = waStatusToDb(update.update?.status as number | undefined)
          if (!status) continue
          await this.applyMessageStatus(live.sessionId, update.key.id, status)
        }
      })()
    })

    // Reactions also arrive on their own event (faster + more reliable than
    // scraping them out of messages.upsert). handleReaction() is idempotent.
    sock.ev.on('messages.reaction', (items) => {
      void (async () => {
        for (const item of items) {
          const targetId = item?.key?.id
          if (!targetId) continue
          await this.handleReaction(live, {
            targetWaMessageId: targetId,
            emoji: (item.reaction?.text ?? '').toString(),
            senderJid:
              item.reaction?.key?.participant ?? item.reaction?.key?.remoteJid ?? null,
          }).catch((error) => logger.debug({ error, sessionId }, 'reaction event failed'))
        }
      })()
    })

    sock.ev.on('message-receipt.update', (receipts) => {
      void (async () => {
        for (const receipt of receipts) {
          const id = receipt.key?.id
          if (!id) continue
          const isRead = Boolean(receipt.receipt?.readTimestamp)
          const isDelivered = Boolean(receipt.receipt?.receiptTimestamp)
          const status = isRead ? 'read' : isDelivered ? 'delivered' : null
          if (status) await this.applyMessageStatus(live.sessionId, id, status)
        }
      })()
    })

    // Contacts: names + lid/pn mapping (this is what makes LID chats readable).
    const handleContacts = (contacts: Partial<Contact>[]) => {
      void (async () => {
        for (const contact of contacts) {
          if (!contact) continue
          const jid = contact.id
          if (!jid) continue
          this.rememberLid(live, contact.lid ?? (isLidJid(jid) ? jid : null), contact.jid ?? (jid.endsWith('@s.whatsapp.net') ? jid : null))

          const name = contact.name || contact.notify || contact.verifiedName || null
          if (isIgnoredJid(jid)) continue
          this.rememberContactName(live, jid, name)
          if (contact.jid) this.rememberContactName(live, contact.jid, name)
          if (!name) continue

          // PENTING: buku alamat TIDAK lagi membuat baris chat kosong.
          // Dulu setiap kontak jadi "chat" tanpa pesan sehingga daftar chat
          // tiba-tiba penuh (mis. 200+ entri "Belum ada pesan") begitu sync
          // selesai. Sekarang nama hanya ditempelkan ke chat yang SUDAH ada
          // (artinya memang ada percakapan), sisanya hidup di halaman Kontak.
          await this.renameExistingChat(live.sessionId, jid, name)
        }


        // Simpan ke buku kontak panel supaya bisa dilihat di halaman Kontak.
        await this
          .syncContacts(live.sessionId, contacts.filter(Boolean) as Partial<Contact>[], 'sync')
          .catch((error) => logger.debug({ error }, 'sync kontak dilewati'))

        broadcast('sessions:changed')
      })().catch((error) => logger.debug({ error }, 'contacts handler failed'))
    }

    sock.ev.on('contacts.upsert', handleContacts)
    sock.ev.on('contacts.update', handleContacts)

    // WhatsApp's own chat list (arrives on connect + on every change).
    // Previously unhandled, which is why the panel stayed empty until a new
    // message was received.
    const handleChatsUpsert = (chats: Partial<Chat>[]) => {
      void (async () => {
        let changed = false
        for (const chat of chats) {
          if (!chat) continue
          const jid = chat.id
          if (!jid || isIgnoredJid(jid)) continue

          const isGroup = jid.endsWith('@g.us')
          const name = chat.name || this.displayNameFor(live, jid)
          const ts = chat.conversationTimestamp
            ? new Date(Number(chat.conversationTimestamp.toString()) * 1000)
            : undefined

          const { chat: stored, created } = await ensureChat(live.sessionId, jid, {
            name: name ?? undefined,
            isGroup,
          })

          if (chat.unreadCount !== undefined || ts || (chat.name && chat.name !== stored.name)) {
            const updated = await prisma.chat.update({
              where: { id: stored.id },
              data: {
                ...(chat.name && chat.name !== stored.name ? { name: chat.name } : {}),
                ...(chat.unreadCount !== undefined ? { unreadCount: chat.unreadCount ?? 0 } : {}),
                ...(ts && !Number.isNaN(ts.getTime()) ? { lastMessageAt: ts } : {}),
                ...(chat.archived !== undefined ? { archived: Boolean(chat.archived) } : {}),
                ...(chat.pinned !== undefined ? { pinned: Boolean(chat.pinned) } : {}),
              },
            })
            changed = true
            emitToSession(live.sessionId, 'session:chat', {
              sessionId: live.sessionId,
              chat: toChatDTO(updated),
            })
          } else if (created) {
            changed = true
          }
        }
        if (changed) broadcast('sessions:changed')
        live.debugLog.push({ at: new Date().toISOString(), event: 'chats.upsert', stored: true, reason: `${chats.length} chat(s) synced` })
      })().catch((error) => logger.debug({ error }, 'chats.upsert handler failed'))
    }

    sock.ev.on('chats.upsert', handleChatsUpsert)
    sock.ev.on('chats.update', (updates) => {
      void (async () => {
        for (const update of updates) {
          if (!update) continue
          const jid = update.id
          if (!jid || isIgnoredJid(jid)) continue
          const existing = await prisma.chat.findUnique({
            where: { sessionId_jid: { sessionId: live.sessionId, jid } },
          })
          if (!existing) continue
          const updated = await prisma.chat.update({
            where: { id: existing.id },
            data: {
              ...(update.unreadCount !== undefined ? { unreadCount: update.unreadCount ?? 0 } : {}),
              ...(update.archived !== undefined ? { archived: Boolean(update.archived) } : {}),
              ...(update.pinned !== undefined ? { pinned: Boolean(update.pinned) } : {}),
            },
          })
          emitToSession(live.sessionId, 'session:chat', {
            sessionId: live.sessionId,
            chat: toChatDTO(updated),
          })
        }
      })().catch(() => undefined)
    })

    // lid <-> phone number mapping broadcast by WhatsApp. Ini sumber paling
    // resmi: begitu WhatsApp memberi tahu pasangan lid→nomor, chat yang masih
    // tersimpan di alamat @lid langsung digabungkan ke chat bernomor.
    sock.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
      const isNew = this.rememberLid(live, lid, jid)
      if (isNew) {
        void this.repairLidChats(sessionId, live.lidToPn).catch((error) =>
          logger.debug({ error, sessionId }, 'perbaikan chat lid dilewati'),
        )
      }
    })

    // History sync: populate chats/contacts (and optionally messages) so the
    // panel is not empty right after linking, even before new traffic arrives.
    sock.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest }) => {
      void (async () => {
        for (const contact of contacts ?? []) {
          if (!contact) continue
          this.rememberLid(live, contact.lid ?? (isLidJid(contact.id) ? contact.id : null), contact.jid ?? null)
          const name = contact.name || contact.notify || contact.verifiedName
          this.rememberContactName(live, contact.id, name ?? null)
          if (contact.jid) this.rememberContactName(live, contact.jid, name ?? null)
        }

        // Buku alamat yang ikut terkirim saat sinkronisasi riwayat.
        if (contacts && contacts.length > 0) {
          await this
            .syncContacts(sessionId, contacts.filter(Boolean) as Partial<Contact>[], 'sync')
            .catch((error) => logger.debug({ error, sessionId }, 'sync kontak riwayat dilewati'))
        }

        for (const chat of chats ?? []) {
          if (!chat) continue
          const jid = chat.id
          if (!jid || isIgnoredJid(jid)) continue
          const name = chat.name || this.displayNameFor(live, jid) || undefined
          const { chat: stored } = await ensureChat(live.sessionId, jid, {
            name,
            isGroup: jid.endsWith('@g.us'),
          })
          const ts = chat.conversationTimestamp
            ? new Date(Number(chat.conversationTimestamp.toString()) * 1000)
            : undefined
          if ((ts && !Number.isNaN(ts.getTime())) || chat.unreadCount !== undefined) {
            await prisma.chat.update({
              where: { id: stored.id },
              data: {
                ...(ts && !Number.isNaN(ts.getTime()) ? { lastMessageAt: ts } : {}),
                ...(chat.unreadCount !== undefined ? { unreadCount: chat.unreadCount ?? 0 } : {}),
              },
            })
          }
        }

        const imported = await this.importHistoryMessages(live, messages ?? [])
        live.counters.historyMessages += imported
        broadcast('sessions:changed')
        logger.info(
          { sessionId, chats: chats?.length ?? 0, contacts: contacts?.length ?? 0, messagesImported: imported, isLatest },
          'history sync processed',
        )
        this.pushDebug(live, {
          event: 'messaging-history.set',
          stored: true,
          reason: `chats=${chats?.length ?? 0} contacts=${contacts?.length ?? 0} messages=${messages?.length ?? 0} imported=${imported}`,
        })
        if (isLatest) {
          await this.repairLidChats(sessionId, live.lidToPn).catch(() => undefined)
          // Beri jeda singkat supaya pesan hasil sync sempat tersimpan dulu.
          setTimeout(() => {
            void this.pruneEmptyChats(sessionId).catch(() => undefined)
          }, 5000)
        }
      })().catch((error) => logger.warn({ error, sessionId }, 'history sync handler failed'))
    })

    return sock
  }

  private async handleConnectionUpdate(
    live: LiveSession,
    update: BaileysEventMap['connection.update'],
  ) {
    const { connection, lastDisconnect, qr } = update
    const { sessionId, sock } = live

    // A newer socket already took over this session: never touch its status
    // from this stale instance (avoids "disconnected" overwriting "connecting").
    if (live.stale) return

    if (qr) {
      live.qr = qr
      emitToSession(sessionId, 'session:qr', { sessionId, qr })
      if (!sock.authState.creds.registered) {
        logger.warn({ sessionId }, 'WhatsApp asked for a QR code — use Pairing Code instead')
      }
    }

    if (connection === 'connecting') {
      if (!sock.authState.creds.registered) {
        await this.setStatus(sessionId, 'connecting', { lastError: null })
      }
      return
    }

    if (connection === 'open') {
      live.reconnectAttempts = 0
      live.qr = null
      const me = sock.user
      logger.info({ sessionId, user: me?.id }, 'session connected')

      const pushName = me?.name || me?.verifiedName || null
      const phoneNumber = me?.id ? normalizePhoneNumber(jidToNumber(me.id)) : undefined

      await prisma.waSession.update({
        where: { id: sessionId },
        data: {
          status: 'connected',
          pairingCode: null,
          pairingCodeExpiresAt: null,
          lastError: null,
          pushName,
          connectedAt: new Date(),
          ...(phoneNumber ? { phoneNumber } : {}),
        },
      })

      emitToSession(sessionId, 'session:status', {
        sessionId,
        status: 'connected',
        pushName,
        lastError: null,
        connectedAt: new Date().toISOString(),
      })
      broadcast('sessions:changed')

      // Setelah sync kontak berjalan beberapa detik: rapikan chat yang masih
      // beralamat @lid, lalu buang chat kosong (hasil sync buku alamat) supaya
      // daftar chat hanya berisi percakapan yang benar-benar ada.
      setTimeout(() => {
        void this.repairLidChats(sessionId, live.lidToPn)
          .then(() => this.pruneEmptyChats(sessionId))
          .catch(() => undefined)
      }, 8000)
      return
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode
      const reason = statusCode ? (DisconnectReason as Record<number, string>)[statusCode] : 'unknown'
      logger.info({ sessionId, statusCode, reason, manual: live.manualDisconnect }, 'connection closed')

      // User pressed "Disconnect" / we are shutting down: do not reconnect.
      if (live.manualDisconnect) {
        this.sessions.delete(sessionId)
        if (sock.authState.creds.registered) {
          await this.setStatus(sessionId, 'disconnected')
        }
        return
      }

      if (statusCode === DisconnectReason.loggedOut) {
        this.sessions.delete(sessionId)
        await removeAuthState(sessionId)
        await this.setStatus(sessionId, 'disconnected', {
          pairingCode: null,
          pairingCodeExpiresAt: null,
          lastError: 'Logged out from WhatsApp (device unlinked)',
          connectedAt: null,
        })
        emitToSession(sessionId, 'session:qr', { sessionId, qr: null })
        return
      }

      // 515 = restart required: WhatsApp expects an immediate reconnect after
      // the pairing code was accepted, this is the normal end of the flow.
      if (statusCode === DisconnectReason.restartRequired) {
        this.sessions.delete(sessionId)
        await delay(800)
        await this.startSocket(sessionId, { fresh: false })
        return
      }

      if (
        statusCode === DisconnectReason.connectionReplaced ||
        statusCode === DisconnectReason.multideviceMismatch
      ) {
        this.sessions.delete(sessionId)
        await this.setStatus(sessionId, 'disconnected', {
          lastError:
            statusCode === DisconnectReason.connectionReplaced
              ? 'Session replaced by another WhatsApp Web/Desktop client'
              : 'Multi-device mismatch — please pair again',
        })
        return
      }

      // Everything else (timeouts, network drops, 428, 500, 503): auto reconnect
      this.sessions.delete(sessionId)
      live.reconnectAttempts += 1

      if (live.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        await this.setStatus(sessionId, 'error', {
          lastError: `Giving up after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts (last: ${reason})`,
        })
        return
      }

      const backoff = Math.min(2000 * live.reconnectAttempts, 30000)
      await this.setStatus(sessionId, 'connecting', {
        lastError: `Reconnecting in ${Math.round(backoff / 1000)}s (${reason})`,
      })

      const timer = setTimeout(() => {
        void this.startSocket(sessionId, { fresh: false })
          .then(() => {
            const next = this.sessions.get(sessionId)
            if (next) next.reconnectAttempts = live.reconnectAttempts
          })
          .catch((error) => {
            logger.error({ error, sessionId }, 'reconnect failed')
          })
      }, backoff)

      live.reconnectTimer = timer
      this.sessions.set(sessionId, live)
    }
  }

  /* ---------------------------- pairing ----------------------------- */

  /** Creates the socket (if needed) and returns a fresh 6-digit pairing code. */
  async requestPairingCode(sessionId: string, phoneNumberOverride?: string) {
    const record = await prisma.waSession.findUnique({ where: { id: sessionId } })
    if (!record) throw new Error('Session not found')

    const phoneNumber = normalizePhoneNumber(phoneNumberOverride || record.phoneNumber)
    if (!phoneNumber || phoneNumber.length < 8) {
      throw new Error('Invalid phone number. Use the international format, e.g. 6281234567890')
    }
    if (phoneNumber !== record.phoneNumber) {
      await prisma.waSession.update({
        where: { id: sessionId },
        data: { phoneNumber, name: record.name === `+${record.phoneNumber}` ? `+${phoneNumber}` : record.name },
      })
    }

    let live = this.sessions.get(sessionId)
    if (!live) {
      await this.startSocket(sessionId, { fresh: true })
      live = this.sessions.get(sessionId) as LiveSession
    }

    const { sock } = live
    if (sock.authState.creds.registered) {
      throw new Error('This session is already registered. Logout first to pair a new device.')
    }
    if (live.pairingRequested) {
      logger.info({ sessionId }, 'pairing code re-requested — reusing existing socket')
    }

    await this.setStatus(sessionId, 'pairing', { lastError: null })

    // Wait until the underlying websocket is actually open before asking for
    // the code, otherwise WhatsApp rejects the request.
    await this.waitForSocketOpen(sock, 15000)

    let lastError: unknown = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const code = await sock.requestPairingCode(phoneNumber)
        live.pairingRequested = true

        const formatted = code?.match(/.{1,4}/g)?.join('-') ?? code
        const expiresAt = new Date(Date.now() + 3 * 60 * 1000)

        await prisma.waSession.update({
          where: { id: sessionId },
          data: { pairingCode: formatted, pairingCodeExpiresAt: expiresAt, status: 'pairing' },
        })

        emitToSession(sessionId, 'session:pairing-code', {
          sessionId,
          code: formatted,
          expiresAt: expiresAt.toISOString(),
        })
        broadcast('sessions:changed')

        logger.info({ sessionId }, 'pairing code issued')
        return { code: formatted, expiresAt: expiresAt.toISOString() }
      } catch (error) {
        lastError = error
        logger.warn({ error, attempt, sessionId }, 'requestPairingCode failed')
        await delay(1500 * attempt)
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError)
    await this.setStatus(sessionId, 'error', { lastError: message })
    throw new Error(`Failed to get pairing code: ${message}`)
  }

  private async waitForSocketOpen(sock: WASocket, timeoutMs: number) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const state = (sock.ws as unknown as { readyState?: number })?.readyState
      if (state === 1) return true
      await delay(300)
    }
    return false
  }

  /* --------------------------- disconnect --------------------------- */

  /** Closes the socket but keeps the credentials (session can reconnect). */
  async disconnect(sessionId: string) {
    this.clearReconnect(sessionId)
    const live = this.sessions.get(sessionId)
    if (live) {
      live.manualDisconnect = true
      try {
        live.sock.ws?.close()
        live.sock.end(undefined)
      } catch {
        /* ignore */
      }
      this.sessions.delete(sessionId)
    }

    const record = await prisma.waSession.findUnique({ where: { id: sessionId } })
    if (record) {
      await this.setStatus(sessionId, 'disconnected', {
        pairingCode: null,
        pairingCodeExpiresAt: null,
        connectedAt: null,
      })
    }
  }

  /** Unlinks the device on WhatsApp's side and wipes local auth files. */
  async logout(sessionId: string) {
    this.clearReconnect(sessionId)
    const live = this.sessions.get(sessionId)

    if (live) {
      live.manualDisconnect = true
      try {
        await live.sock.logout()
      } catch (error) {
        logger.warn({ error, sessionId }, 'logout() call failed — wiping local auth anyway')
      }
      try {
        live.sock.end(undefined)
      } catch {
        /* ignore */
      }
      this.sessions.delete(sessionId)
    }

    await removeAuthState(sessionId)
    await statusStore.clear(sessionId)
    await this.setStatus(sessionId, 'disconnected', {
      pairingCode: null,
      pairingCodeExpiresAt: null,
      connectedAt: null,
      pushName: null,
      lastError: null,
    })
  }

  async statusMedia(sessionId: string, id: string) {
    if (!await this.getSession(sessionId)) throw new Error('Session not found')
    return statusStore.media(sessionId, id, this.sessions.get(sessionId)?.sock)
  }

  /* ----------------------------- chats ------------------------------ */

  async listChats(sessionId: string, options: { search?: string; archived?: boolean } = {}) {
    const chats = await prisma.chat.findMany({
      where: {
        sessionId,
        archived: options.archived ?? false,
        ...(options.search
          ? {
              OR: [
                { name: { contains: options.search } },
                { jid: { contains: options.search } },
                { lastMessagePreview: { contains: options.search } },
              ],
            }
          : {}),
      },
      orderBy: [{ pinned: 'desc' }, { lastMessageAt: 'desc' }],
      take: 200,
    })

    return chats.map(toChatDTO)
  }

  /** Ambil satu pesan (dipakai endpoint reaksi/hapus/teruskan). */
  async getMessage(messageId: string) {
    return prisma.message.findUnique({ where: { id: messageId } })
  }

  async getChat(chatId: string) {
    const chat = await prisma.chat.findUnique({ where: { id: chatId } })
    return chat ? toChatDTO(chat) : null
  }

  /** Opens (or creates) a 1:1 conversation for a phone number. */
  async openChatByNumber(sessionId: string, rawPhoneNumber: string) {
    const phoneNumber = normalizePhoneNumber(rawPhoneNumber)
    if (!phoneNumber) throw new Error('Invalid phone number')

    const live = this.sessions.get(sessionId)
    const jid = toJid(phoneNumber)

    if (live?.sock && live.sock.user) {
      const result = await live.sock.onWhatsApp(jid).catch(() => null)
      const found = result?.find((entry) => entry.exists)
      if (!found) {
        throw new Error(`+${phoneNumber} is not registered on WhatsApp`)
      }
    }

    const { chat } = await ensureChat(sessionId, jid, { name: `+${phoneNumber}` })
    emitToSession(sessionId, 'session:chat', {
      sessionId,
      chat: toChatDTO(chat),
    })
    return toChatDTO(chat)
  }

  async updateChat(chatId: string, data: { pinned?: boolean; archived?: boolean; read?: boolean }) {
    const chat = await prisma.chat.update({
      where: { id: chatId },
      data: {
        ...(data.pinned !== undefined ? { pinned: data.pinned } : {}),
        ...(data.archived !== undefined ? { archived: data.archived } : {}),
        ...(data.read ? { unreadCount: 0 } : {}),
      },
    })
    return toChatDTO(chat)
  }

  /**
   * Riwayat pesan sebuah chat.
   *
   * `before`  → pesan yang lebih lama dari stempel waktu tertentu (infinite scroll)
   * `around`  → muat sekeliling satu pesan (dipakai saat membuka hasil pencarian)
   * `search`  → hanya pesan yang memuat kata kunci
   */
  async listMessages(
    sessionId: string,
    chatId: string,
    options: { limit?: number; before?: string; around?: string; search?: string } = {},
  ) {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
    const search = options.search?.trim()

    if (options.around) {
      const anchor = await prisma.message.findFirst({
        where: {
          chatId,
          OR: [{ id: options.around }, { waMessageId: options.around }],
        },
        select: { timestamp: true },
      })

      if (anchor) {
        const radius = Math.min(Math.max(Math.floor(limit / 2), 10), 60)

        const [older, newer] = await Promise.all([
          prisma.message.findMany({
            where: { sessionId, chatId, timestamp: { lte: anchor.timestamp } },
            orderBy: { timestamp: 'desc' },
            take: radius,
          }),
          prisma.message.findMany({
            where: { sessionId, chatId, timestamp: { gt: anchor.timestamp } },
            orderBy: { timestamp: 'asc' },
            take: radius,
          }),
        ])

        return [...older.reverse(), ...newer].map(toMessageDTO)
      }
    }

    const messages = await prisma.message.findMany({
      where: {
        sessionId,
        chatId,
        ...(options.before ? { timestamp: { lt: new Date(options.before) } } : {}),
        ...(search ? { text: { contains: search } } : {}),
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    })

    return messages.reverse().map(toMessageDTO)
  }

  async markChatRead(sessionId: string, chatId: string) {
    const live = this.sessions.get(sessionId)
    const chat = await prisma.chat.findUnique({ where: { id: chatId } })
    if (!chat) return

    if (live?.sock) {
      const unread = await prisma.message.findMany({
        where: { chatId, fromMe: false, status: { not: 'read' } },
        orderBy: { timestamp: 'desc' },
        take: 100,
      })

      const keys = unread
        .filter((message) => message.waMessageId)
        .map((message) => ({
          remoteJid: chat.jid,
          id: message.waMessageId as string,
          fromMe: false,
          participant: chat.isGroup ? (message.senderJid ?? undefined) : undefined,
        }))

      if (keys.length > 0) {
        try {
          await live.sock.readMessages(keys)
        } catch (error) {
          logger.warn({ error }, 'readMessages failed')
        }
        await prisma.message.updateMany({
          where: { id: { in: unread.map((m) => m.id) } },
          data: { status: 'read' },
        })
      }
    }

    const updated = await prisma.chat.update({
      where: { id: chatId },
      data: { unreadCount: 0 },
    })
    emitToSession(sessionId, 'session:chat', {
      sessionId,
      chat: toChatDTO(updated),
    })
  }

  async sendPresence(sessionId: string, chatId: string, state: 'composing' | 'paused') {
    const live = this.sessions.get(sessionId)
    if (!live) return
    const chat = await prisma.chat.findUnique({ where: { id: chatId } })
    if (!chat) return
    await live.sock.sendPresenceUpdate(state, chat.jid).catch(() => undefined)
  }

  /* ---------------------------- messages ---------------------------- */

  /**
   * Persists an incoming (or self-sent from another device) message and pushes
   * it to every dashboard listening on the session room.
   */
  private async handleIncomingMessage(live: LiveSession, raw: WAMessage) {
    const { sessionId, sock } = live
    const rawJid = raw.key?.remoteJid ?? null
    live.counters.upsert += 1

    const note = (stored: boolean, reason: string, extra: Partial<DebugEntry> = {}) => {
      if (!stored) live.counters.skipped += 1
      this.pushDebug(live, {
        event: 'messages.upsert',
        jid: rawJid ?? undefined,
        keyShape: this.keyShape(raw.key),
        stored,
        reason,
        ...extra,
      })
    }

    if (!rawJid) return note(false, 'no remoteJid in key')
    if (isIgnoredJid(rawJid)) {
      return note(false, `ignored jid type (@${rawJid.split('@')[1] ?? '?'})`)
    }
    if (!raw.message) return note(false, 'no message body (protocol/ack only)')

    const parsed = parseWaMessage(raw, (lid) => this.resolveLidFrom(live, lid))
    if (!parsed) return note(false, 'content not storable (reaction/protocol/unsupported)')

    // Learn the lid -> phone number mapping from this very message.
    this.rememberLid(live, parsed.lidJid, parsed.chatJid.endsWith('@s.whatsapp.net') ? parsed.chatJid : null)

    const existing = await prisma.message.findFirst({
      where: { sessionId, waMessageId: parsed.waMessageId },
      select: { id: true },
    })
    if (existing) {
      return note(true, 'duplicate (already stored)', { type: parsed.type, fromMe: parsed.fromMe })
    }

    await this.persistMessage(sessionId, parsed, raw, sock)
    live.counters.stored += 1
    note(true, parsed.lidJid ? 'stored (lid resolved)' : 'stored', {
      type: parsed.type,
      fromMe: parsed.fromMe,
    })
  }

  private async persistMessage(
    sessionId: string,
    parsed: ParsedMessage,
    raw: WAMessage,
    sock: WASocket,
  ): Promise<{ message: MessageDTO; chat: ChatDTO }> {
    const live = this.sessions.get(sessionId)
    const jid = parsed.chatJid
    const isGroup = jid.endsWith('@g.us')

    // Chat that used to be stored under its @lid address: fold it into the
    // phone-number chat so history is not split in two.
    if (parsed.lidJid && parsed.lidJid !== jid) {
      await this.migrateLidChat(sessionId, parsed.lidJid, jid).catch((error) => {
        logger.debug({ error, sessionId }, 'lid chat migration skipped')
        return false
      })
    }

    // Prefer the saved contact name, then the group subject, then pushName.
    let chatName: string | null =
      (live ? this.displayNameFor(live, jid) : null) ?? (parsed.fromMe ? null : parsed.senderName)

    if (isGroup) {
      const { chat } = await ensureChat(sessionId, jid, { isGroup: true })
      if (!chat.name) {
        try {
          const metadata = await sock.groupMetadata(jid)
          chatName = metadata.subject ?? null
        } catch {
          chatName = null
        }
      } else {
        chatName = chat.name
      }
    } else if (parsed.fromMe) {
      chatName = live ? this.displayNameFor(live, jid) : null
    }

    const { chat } = await ensureChat(sessionId, jid, {
      name: chatName ?? undefined,
      isGroup,
    })

    // Pengirim pesan 1:1 otomatis masuk daftar kontak panel (nama dari pushName
    // WhatsApp), jadi buku kontak ikut terisi walau sinkronisasi belum lengkap.
    if (!parsed.fromMe && !isGroup && parsed.senderJid?.endsWith('@s.whatsapp.net')) {
      void this
        .upsertContact(sessionId, {
          jid: parsed.senderJid,
          name: parsed.senderName,
          source: 'pesan',
        })
        .catch(() => undefined)
    }

    // FAST PATH: the message row is written and broadcast immediately, and the
    // media file is fetched afterwards in the background. This is what makes
    // photos/videos/view-once appear instantly instead of waiting for the
    // download (and it gives the download the freshest possible media URL).
    const mediaNode =
      parsed.mediaNode ?? (raw.message ? serializeMediaNode(raw.message as proto.IMessage) : null)
    const mediaStatus = !parsed.needsDownload ? null : mediaNode ? 'pending' : 'failed'

    const clientHasChatOpen = this.isChatOpen(chat.id)
    const shouldCountUnread = !parsed.fromMe && !clientHasChatOpen

    const message = await prisma.message.create({
      data: {
        sessionId,
        chatId: chat.id,
        waMessageId: parsed.waMessageId,
        fromMe: parsed.fromMe,
        senderJid: parsed.senderJid,
        senderName: parsed.senderName,
        type: parsed.type,
        text: parsed.text,
        mediaPath: null,
        mediaMime: parsed.mediaMime,
        mediaName: parsed.mediaName,
        mediaSize: parsed.mediaSize,
        mediaDuration: parsed.mediaDuration,
        extra: parsed.extra ? JSON.stringify(parsed.extra) : null,
        status: clientHasChatOpen && !parsed.fromMe ? 'read' : parsed.fromMe ? 'sent' : 'delivered',
        timestamp: parsed.timestamp,
        viewOnce: parsed.viewOnce,
        mediaNode,
        mediaStatus,
        quotedId: parsed.quoted?.id ?? null,
        quotedText: parsed.quoted?.text ?? null,
        quotedType: parsed.quoted?.type ?? null,
        quotedFromMe: parsed.quoted?.fromMe ?? null,
      },
    })

    // Kick off the download right away, without blocking the realtime event.
    if (mediaStatus === 'pending') {
      void this.downloadIncomingMedia(sessionId, message.id, raw as unknown as proto.IWebMessageInfo, sock)
    }

    const updatedChat = await prisma.chat.update({
      where: { id: chat.id },
      data: {
        lastMessagePreview: parsed.viewOnce
          ? `👁️ View once · ${previewFor(parsed.type, parsed.text)}`.trim()
          : previewFor(parsed.type, parsed.text),
        lastMessageAt: parsed.timestamp,
        unreadCount: shouldCountUnread ? { increment: 1 } : clientHasChatOpen ? 0 : undefined,
        archived: false,
      },
    })

    const messageDTO = toMessageDTO(message)
    const chatDTO = toChatDTO(updatedChat)

    emitToSession(sessionId, 'session:message', { sessionId, message: messageDTO, chat: chatDTO })
    broadcast('sessions:changed')

    // Ringkasan ringan untuk notifikasi browser / badge judul tab.
    if (!parsed.fromMe) {
      const session = await prisma.waSession.findUnique({
        where: { id: sessionId },
        select: { name: true },
      })
      const previewText = parsed.viewOnce
        ? `👁️ Pesan sekali lihat — ${previewFor(parsed.type, parsed.text)}`
        : previewFor(parsed.type, parsed.text)

      broadcast('session:notify', {
        sessionId,
        sessionName: session?.name ?? 'Sesi WhatsApp',
        chatId: chat.id,
        chatName: chatDisplayName({ name: chatDTO.name, jid: chat.jid }),
        fromMe: false,
        preview: previewText,
        viewOnce: parsed.viewOnce,
      })

      // Web Push (PWA): hanya untuk pesan yang memang baru (bukan hasil impor
      // riwayat). Perangkat yang panelnya sedang dibuka disaring di lib/push.ts,
      // jadi HP tetap dapat notifikasi walau panel terbuka di laptop.
      const isFresh = Date.now() - parsed.timestamp.getTime() < 2 * 60 * 1000
      if (isFresh) {
        void sendPushToAll({
          title: `${chatDisplayName({ name: chatDTO.name, jid: chat.jid })} · ${session?.name ?? 'WhatsApp'}`,
          body: previewText.slice(0, 160) || 'Pesan baru',
          url: `/chat/${sessionId}?chat=${chat.id}`,
          tag: `wa-${chat.id}`,
          chatId: chat.id,
          sessionId,
          viewOnce: parsed.viewOnce,
        }, { source: 'pesan' }).catch(() => undefined)
      }
    }

    // The chat is open in a browser tab: acknowledge the message immediately.
    if (clientHasChatOpen && !parsed.fromMe) {
      void this.markChatRead(sessionId, chat.id).catch(() => undefined)
    }

    // Balasan otomatis + webhook (kalau diaktifkan untuk sesi ini).
    if (!parsed.fromMe) {
      void this.runAutomation(sessionId, chat, parsed, messageDTO, chatDTO).catch((error) =>
        logger.warn({ sessionId, error }, 'otomasi pesan gagal'),
      )
    }

    return { message: messageDTO, chat: chatDTO }
  }

  private isChatOpen(chatId: string) {
    const room = getIO()?.sockets.adapter.rooms.get(`chat:${chatId}`)
    return (room?.size ?? 0) > 0
  }

  /**
   * Tempelkan nama kontak ke chat yang SUDAH ada (tanpa membuat chat baru).
   * Memakai updateMany supaya sinkronisasi ribuan kontak tetap murah.
   */
  private async renameExistingChat(sessionId: string, jid: string, name?: string | null) {
    if (!name) return false

    // Catatan SQL: `name != 'x'` bernilai NULL untuk baris ber-nama NULL, jadi
    // kondisi NULL harus ditulis eksplisit supaya chat tanpa nama ikut terisi.
    const { count } = await prisma.chat.updateMany({
      where: { sessionId, jid, OR: [{ name: null }, { name: { not: name } }] },
      data: { name },
    })
    if (count === 0) return false

    const updated = await prisma.chat.findUnique({ where: { sessionId_jid: { sessionId, jid } } })
    if (updated) emitToSession(sessionId, 'session:chat', { sessionId, chat: toChatDTO(updated) })
    return true
  }

  /**
   * Bersihkan daftar chat dari baris kosong.
   *
   * Banyak chat "tanpa pesan" muncul dari sinkronisasi buku alamat / metadata
   * chat WhatsApp. Semuanya aman dihapus: chat akan dibuat ulang otomatis
   * begitu ada pesan (atau saat dibuka dari halaman Kontak / kotak "Baru").
   *
   * Yang TIDAK dihapus: chat bersemat (pinned), diarsipkan, masih ada pesan,
   * punya jumlah belum dibaca, atau punya cuplikan pesan terakhir.
   */
  async pruneEmptyChats(sessionId: string) {
    const empties = await prisma.chat.findMany({
      where: {
        sessionId,
        pinned: false,
        archived: false,
        unreadCount: 0,
        lastMessagePreview: null,
        messages: { none: {} },
      },
      select: { id: true, jid: true },
      take: 2000,
    })

    if (empties.length === 0) return { removed: 0, jids: [] as string[] }

    await prisma.chat.deleteMany({ where: { id: { in: empties.map((chat) => chat.id) } } })

    const jids = empties.map((chat) => chat.jid)
    logger.info({ sessionId, removed: empties.length }, 'chat kosong dibersihkan')
    emitToSession(sessionId, 'session:chats-pruned', { sessionId, removed: empties.length, jids })
    broadcast('sessions:changed')

    return { removed: empties.length, jids }
  }

  /* ------------------------------- KONTAK -------------------------------- */

  /**
   * Simpan satu kontak. JID diutamakan dalam bentuk nomor telepon
   * (`@s.whatsapp.net`); kalau nomornya belum diketahui, disimpan apa adanya
   * (biasanya `@lid`) dan nanti digabung otomatis begitu nomornya muncul.
   */
  async upsertContact(
    sessionId: string,
    input: {
      jid: string
      name?: string | null
      notify?: string | null
      verifiedName?: string | null
      imgUrl?: string | null
      source?: string
      lid?: string | null
    },
  ) {
    const live = this.sessions.get(sessionId)
    if (input.lid) this.rememberLid(live as LiveSession, input.lid, input.jid)

    const jid =
      input.jid.endsWith('@s.whatsapp.net') || !isLidJid(input.jid)
        ? input.jid
        : ((live ? this.resolveLidFrom(live, input.jid) : null) ?? input.jid)

    if (isIgnoredJid(jid) || jid.endsWith('@g.us')) return null

    const phoneNumber = jid.endsWith('@s.whatsapp.net') ? jidToNumber(jid) : null
    const name = input.name?.trim() || null
    const notify = input.notify?.trim() || null
    const verifiedName = input.verifiedName?.trim() || null

    const update: Record<string, unknown> = {}
    if (phoneNumber) update.phoneNumber = phoneNumber
    if (name) update.name = name
    if (notify) update.notify = notify
    if (verifiedName) update.verifiedName = verifiedName
    if (input.imgUrl && input.imgUrl !== 'changed') update.imgUrl = input.imgUrl

    return prisma.contact.upsert({
      where: { sessionId_jid: { sessionId, jid } },
      create: { sessionId, jid, phoneNumber, name, notify, verifiedName, source: input.source ?? 'sync' },
      update,
    })
  }

  /** Simpan banyak kontak sekaligus (event WhatsApp / history sync). */
  async syncContacts(sessionId: string, contacts: Partial<Contact>[], source = 'sync') {
    let stored = 0
    for (const contact of contacts.slice(0, 5000)) {
      if (!contact?.id) continue
      if (isIgnoredJid(contact.id) || contact.id.endsWith('@g.us')) continue
      const jid = contact.jid ?? contact.id
      try {
        const saved = await this.upsertContact(sessionId, {
          jid,
          lid: contact.lid ?? (isLidJid(contact.id) ? contact.id : null),
          name: contact.name ?? null,
          notify: contact.notify ?? null,
          verifiedName: contact.verifiedName ?? null,
          imgUrl: contact.imgUrl ?? null,
          source,
        })
        stored += 1

        // Nama boleh ditempelkan ke chat yang sudah ada — TAPI jangan membuat
        // chat baru dari buku alamat (itu penyebab daftar chat penuh entri kosong).
        if (saved) {
          await this.renameExistingChat(sessionId, saved.jid, saved.name ?? saved.notify ?? null)
        }
      } catch (error) {
        logger.debug({ error, sessionId, jid }, 'gagal menyimpan kontak')
      }
    }
    if (stored > 0) logger.debug({ sessionId, stored, source }, 'kontak disimpan')
    return { stored }
  }

  /** Daftar kontak untuk halaman Kontak, lengkap dengan status punya-chat. */
  async listContacts(sessionId: string, options: { q?: string; limit?: number } = {}) {
    const q = options.q?.trim()
    const limit = Math.min(Math.max(options.limit ?? 400, 1), 1000)

    const where = {
      sessionId,
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { notify: { contains: q } },
              { verifiedName: { contains: q } },
              { phoneNumber: { contains: q.replace(/\D/g, '') || q } },
              { jid: { contains: q } },
            ],
          }
        : {}),
    }

    const [rows, total] = await Promise.all([
      prisma.contact.findMany({ where, orderBy: [{ name: 'asc' }, { notify: 'asc' }, { jid: 'asc' }], take: limit }),
      prisma.contact.count({ where: { sessionId } }),
    ])

    const jids = rows.map((row) => row.jid)
    const chats = jids.length
      ? await prisma.chat.findMany({ where: { sessionId, jid: { in: jids } }, select: { id: true, jid: true } })
      : []
    const chatByJid = new Map(chats.map((chat) => [chat.jid, chat.id]))

    const contacts: ContactDTO[] = rows.map((row) => ({
      id: row.id,
      jid: row.jid,
      phoneNumber: row.phoneNumber,
      displayName: chatDisplayName({ name: row.name ?? row.notify ?? row.verifiedName, jid: row.jid }),
      notify: row.notify,
      verifiedName: row.verifiedName,
      source: row.source,
      hasChat: chatByJid.has(row.jid),
      chatId: chatByJid.get(row.jid) ?? null,
      updatedAt: row.updatedAt.toISOString(),
    }))

    return { contacts, total, shown: contacts.length }
  }

  /**
   * Impor/impor-ulang nomor dari panel: diverifikasi dulu ke WhatsApp
   * (`onWhatsApp`) supaya kontak palsu tidak masuk daftar.
   */
  async importContacts(sessionId: string, rawNumbers: string[]) {
    const live = this.requireLive(sessionId)
    const numbers = Array.from(
      new Set(
        rawNumbers
          .flatMap((value) => String(value).split(/[\s,;]+/))
          .map((value) => normalizePhoneNumber(value))
          .filter((value) => value.length >= 8 && value.length <= 15),
      ),
    ).slice(0, 50)

    if (numbers.length === 0) throw new Error('Tidak ada nomor valid yang bisa dibaca')

    const results: { input: string; exists: boolean; jid?: string; lid?: string | null }[] = []

    for (let index = 0; index < numbers.length; index += 20) {
      const chunk = numbers.slice(index, index + 20)
      const found = (await live.sock.onWhatsApp(...chunk)) ?? []

      // Tipe balikan onWhatsApp() masih `unknown` di Baileys, jadi disaring manual.
      const parsedResults = (found as { jid?: unknown; exists?: unknown; lid?: unknown }[])
        .map((item) => ({
          jid: typeof item.jid === 'string' ? item.jid : null,
          exists: Boolean(item.exists),
          lid: typeof item.lid === 'string' ? item.lid : null,
        }))
        .filter((item): item is { jid: string; exists: boolean; lid: string | null } => Boolean(item.jid))

      for (const number of chunk) {
        const match = parsedResults.find((item) => jidToNumber(item.jid) === number)
        if (!match?.exists) {
          results.push({ input: number, exists: false })
          continue
        }
        if (match.lid) this.rememberLid(live, match.lid, match.jid)
        await this.upsertContact(sessionId, {
          jid: match.jid,
          lid: match.lid,
          source: 'manual',
        })
        results.push({ input: number, exists: true, jid: match.jid, lid: match.lid })
      }
    }

    return {
      checked: results.length,
      added: results.filter((item) => item.exists).length,
      missing: results.filter((item) => !item.exists).map((item) => item.input),
      results,
    }
  }

  /** Hapus satu kontak dari buku kontak panel (tidak menghapus apa pun di HP). */
  async deleteContact(contactId: string) {
    const row = await prisma.contact.findUnique({ where: { id: contactId }, select: { id: true, sessionId: true } })
    if (!row) throw new Error('Kontak tidak ditemukan')
    await prisma.contact.delete({ where: { id: row.id } })
    return row
  }

  /** Gabungkan baris kontak ber-alamat @lid ke baris bernomor telepon. */
  private async migrateLidContact(sessionId: string, lidJid: string, pnJid: string): Promise<boolean> {
    const source = await prisma.contact.findUnique({ where: { sessionId_jid: { sessionId, jid: lidJid } } })
    if (!source) return false

    await prisma.contact.upsert({
      where: { sessionId_jid: { sessionId, jid: pnJid } },
      create: {
        sessionId,
        jid: pnJid,
        phoneNumber: jidToNumber(pnJid),
        name: source.name,
        notify: source.notify,
        verifiedName: source.verifiedName,
        imgUrl: source.imgUrl,
        source: source.source,
      },
      update: {
        phoneNumber: jidToNumber(pnJid),
        name: source.name ?? undefined,
        notify: source.notify ?? undefined,
        verifiedName: source.verifiedName ?? undefined,
      },
    })

    await prisma.contact.delete({ where: { id: source.id } })
    return true
  }

  /**
   * Moves a chat (and its messages) from a `@lid` JID to the resolved phone
   * number JID. Used when older data was stored before the lid was known.
   */
  private async migrateLidChat(sessionId: string, lidJid: string, pnJid: string): Promise<boolean> {
    const source = await prisma.chat.findUnique({
      where: { sessionId_jid: { sessionId, jid: lidJid } },
    })
    if (!source) return false

    const { chat: target } = await ensureChat(sessionId, pnJid, {})

    await prisma.message.updateMany({
      where: { chatId: source.id },
      data: { chatId: target.id, sessionId },
    })

    // Nama hasil salinan JID (mis. "225123456789012") bukan nama asli — jangan
    // diwariskan ke chat hasil gabungan; biar UI memakai nomor telepon aslinya.
    const realName =
      (target.name && !isPlaceholderChatName(target.name, target.jid) ? target.name : null) ??
      (source.name && !isPlaceholderChatName(source.name, source.jid) ? source.name : null)

    const merged = await prisma.chat.update({
      where: { id: target.id },
      data: {
        name: realName,
        unreadCount: target.unreadCount + source.unreadCount,
        lastMessagePreview: source.lastMessagePreview ?? target.lastMessagePreview,
        lastMessageAt: source.lastMessageAt > target.lastMessageAt ? source.lastMessageAt : target.lastMessageAt,
      },
    })

    await prisma.chat.delete({ where: { id: source.id } })

    logger.info({ sessionId, from: lidJid, to: pnJid }, 'migrated @lid chat to phone number chat')
    emitToSession(sessionId, 'session:chat', { sessionId, chat: toChatDTO(merged) })
    broadcast('sessions:changed')
    return true
  }

  /**
   * Imports the messages that arrive with WhatsApp's history sync.
   * No media is downloaded here (kept cheap) and the volume is capped.
   */
  private async importHistoryMessages(live: LiveSession, rawMessages: WAMessage[]) {
    if (rawMessages.length === 0) return 0
    const sessionId = live.sessionId

    const existingIds = new Set(
      (
        await prisma.message.findMany({
          where: { sessionId },
          select: { waMessageId: true },
        })
      )
        .map((row) => row.waMessageId)
        .filter((id): id is string => Boolean(id)),
    )

    const rows: Array<Record<string, unknown>> = []
    const chatTouches = new Map<string, { preview: string; at: Date; unread: number }>()

    for (const raw of rawMessages) {
      if (!raw) continue
      if (rows.length >= HISTORY_MESSAGE_LIMIT) break

      const parsed = parseWaMessage(raw, (lid) => this.resolveLidFrom(live, lid))
      if (!parsed || existingIds.has(parsed.waMessageId)) continue

      this.rememberLid(live, parsed.lidJid, parsed.chatJid.endsWith('@s.whatsapp.net') ? parsed.chatJid : null)

      const { chat } = await ensureChat(sessionId, parsed.chatJid, {
        name: parsed.fromMe ? undefined : (this.displayNameFor(live, parsed.chatJid) ?? parsed.senderName ?? undefined),
        isGroup: parsed.chatJid.endsWith('@g.us'),
      })

      existingIds.add(parsed.waMessageId)
      rows.push({
        sessionId,
        chatId: chat.id,
        waMessageId: parsed.waMessageId,
        fromMe: parsed.fromMe,
        senderJid: parsed.senderJid,
        senderName: parsed.senderName,
        type: parsed.type,
        text: parsed.text,
        mediaMime: parsed.mediaMime,
        mediaName: parsed.mediaName,
        mediaSize: parsed.mediaSize,
        mediaDuration: parsed.mediaDuration,
        status: parsed.fromMe ? 'sent' : 'delivered',
        timestamp: parsed.timestamp,
      })

      const current = chatTouches.get(chat.id)
      if (!current || parsed.timestamp > current.at) {
        chatTouches.set(chat.id, {
          preview: previewFor(parsed.type, parsed.text),
          at: parsed.timestamp,
          unread: current?.unread ?? 0,
        })
      }
    }

    if (rows.length === 0) return 0

    await prisma.message.createMany({ data: rows as never }).catch(async (error) => {
      logger.warn({ error }, 'bulk history insert failed — falling back to row by row')
      for (const row of rows) {
        await prisma.message.create({ data: row as never }).catch(() => undefined)
      }
    })

    for (const [chatId, info] of chatTouches) {
      await prisma.chat
        .update({
          where: { id: chatId },
          data: { lastMessagePreview: info.preview, lastMessageAt: info.at },
        })
        .catch(() => undefined)
    }

    logger.info({ sessionId, imported: rows.length }, 'history messages imported')
    return rows.length
  }

  /** Send a message to the linked account itself — a quick end-to-end self test. */
  async sendTestMessage(sessionId: string) {
    const live = this.requireLive(sessionId)
    const me = live.sock.user?.id
    if (!me) throw new Error('Session is still connecting — try again in a moment')

    const jid = jidNormalizedUser(me)
    const { chat } = await ensureChat(sessionId, jid, { name: 'Message yourself' })
    return this.sendMessage(sessionId, chat.id, {
      kind: 'text',
      text: `✅ Self-test from WA Controller — ${new Date().toLocaleString()}`,
    })
  }

  /** Everything needed to explain "why is my panel empty?" on a live deploy. */
  async getDebugInfo(sessionId: string) {
    const session = await prisma.waSession.findUnique({ where: { id: sessionId } })
    if (!session) return null

    const live = this.sessions.get(sessionId)
    const chats = await prisma.chat.findMany({
      where: { sessionId },
      orderBy: { lastMessageAt: 'desc' },
      take: 10,
      select: { jid: true, name: true, unreadCount: true, lastMessagePreview: true, lastMessageAt: true },
    })

    const [chatCount, messageCount] = await Promise.all([
      prisma.chat.count({ where: { sessionId } }),
      prisma.message.count({ where: { sessionId } }),
    ])

    // Baileys wraps the websocket: use its own readiness accessors.
    const ws = live?.sock.ws as unknown as
      | { isOpen?: boolean; isClosed?: boolean; isConnecting?: boolean; readyState?: number }
      | undefined
    const wsState = !live
      ? 'not-running'
      : ws?.isOpen
        ? 'OPEN'
        : ws?.isConnecting
          ? 'CONNECTING'
          : ws?.isClosed
            ? 'CLOSED'
            : typeof ws?.readyState === 'number'
              ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState] ?? 'unknown'
              : 'unknown'

    return {
      session: {
        id: session.id,
        name: session.name,
        phoneNumber: session.phoneNumber,
        status: session.status,
        pushName: session.pushName,
        connectedAt: session.connectedAt?.toISOString() ?? null,
        lastError: session.lastError,
      },
      socket: {
        isLive: Boolean(live),
        wsReadyState: wsState,
        wsReadyStateLabel: wsState,
        registered: Boolean(live?.sock.authState?.creds?.registered),
        user: live?.sock.user?.id ?? null,
        startedAt: live ? new Date(live.startedAt).toISOString() : null,
        uptimeSeconds: live ? Math.round((Date.now() - live.startedAt) / 1000) : 0,
      },
      counters: live?.counters ?? null,
      lidMappings: live ? Object.fromEntries(live.lidToPn) : {},
      pendingLidChats: await prisma.chat.count({ where: { sessionId, jid: { endsWith: '@lid' } } }),
      contactNames: live ? Object.fromEntries([...live.contactNames].slice(0, 25)) : {},
      storage: { chatCount, messageCount, chats },
      env: {
        nodeEnv: process.env.NODE_ENV,
        autoRestore: process.env.WA_AUTO_RESTORE !== 'false',
        syncFullHistory: process.env.WA_SYNC_FULL_HISTORY === 'true',
        authDir: process.env.WA_AUTH_DIR ?? './data/auth',
        mediaDir: process.env.WA_MEDIA_DIR ?? './data/media',
        logLevel: process.env.LOG_LEVEL ?? 'info',
      },
      recentEvents: live?.debugLog.slice(-40).reverse() ?? [],
      hint:
        chatCount === 0 && live?.counters.upsert === 0
          ? 'No messages reached the socket yet. Ask somebody to send you a message (or use “Send test message”) and watch recentEvents.'
          : undefined,
    }
  }

  /* ---------------------------- watchdog ---------------------------- */

  /**
   * Self-healing: if the database says a session is connected but no socket
   * exists in this process (crash, redeploy, failed restore), try to revive it.
   * This is what prevents the "Connected badge but nothing arrives" trap.
   */
  startWatchdog() {
    if (this.watchdogTimer) return
    this.watchdogTimer = setInterval(() => {
      void (async () => {
        // Grace period right after boot: sessionManager.boot() is still working.
        if (Date.now() - this.bootedAt < 45_000) return

        const sessions = await prisma.waSession.findMany({
          where: { status: { in: ['connected', 'connecting'] } },
        })

        for (const session of sessions) {
          if (this.isLive(session.id)) {
            this.watchdogAttempts.delete(session.id)
            continue
          }
          if (!(await hasStoredCreds(session.id))) continue

          const attempts = (this.watchdogAttempts.get(session.id) ?? 0) + 1
          this.watchdogAttempts.set(session.id, attempts)

          if (attempts > 5) {
            await this.setStatus(session.id, 'error', {
              lastError: 'Socket is not running and could not be revived — tap Reconnect',
            })
            continue
          }

          logger.warn({ sessionId: session.id, attempt: attempts }, 'session marked connected but no live socket — reviving')
          await this.startSocket(session.id, { fresh: false }).catch((error) =>
            logger.warn({ error, sessionId: session.id }, 'watchdog revive failed'),
          )
        }
      })().catch((error) => logger.warn({ error }, 'watchdog tick failed'))
    }, 60_000)

    this.watchdogTimer.unref?.()
    logger.info('session watchdog started (60s interval)')
  }

  /* ------------------- interactions: react / revoke / media ------------------ */

  /** Someone reacted to one of our stored messages (emoji empty = removed). */
  private async handleReaction(live: LiveSession, reaction: { targetWaMessageId: string; emoji: string; senderJid: string | null }) {
    const target = await prisma.message.findFirst({
      where: { sessionId: live.sessionId, waMessageId: reaction.targetWaMessageId },
      select: { id: true, chatId: true, reactions: true },
    })
    if (!target) {
      live.counters.skipped += 1
      this.pushDebug(live, {
        event: 'messages.upsert (reaction)',
        stored: false,
        reason: `target message ${reaction.targetWaMessageId} not in this panel`,
      })
      return
    }

    const map = (() => {
      try {
        return JSON.parse(target.reactions ?? '{}') as Record<string, string>
      } catch {
        return {}
      }
    })()

    const senderKey = reaction.senderJid ?? 'unknown'

    // Idempotent: the same reaction can arrive on both `messages.reaction`
    // and `messages.upsert` — never count or broadcast it twice.
    if ((map[senderKey] ?? '') === reaction.emoji) return

    if (reaction.emoji) map[senderKey] = reaction.emoji
    else delete map[senderKey]

    const updated = await prisma.message.update({
      where: { id: target.id },
      data: { reactions: Object.keys(map).length > 0 ? JSON.stringify(map) : null },
    })

    live.counters.reactions += 1
    this.pushDebug(live, {
      event: 'messages.upsert (reaction)',
      jid: senderKey,
      stored: true,
      reason: reaction.emoji ? `reacted ${reaction.emoji}` : 'reaction removed',
    })

    emitToSession(live.sessionId, 'session:message-updated', {
      sessionId: live.sessionId,
      message: toMessageDTO(updated),
    })
  }

  /** "Delete for everyone": mark the message as revoked, keep our media copy. */
  private async handleRevoke(live: LiveSession, revoke: { targetWaMessageId: string; chatJid: string }) {
    const target = await prisma.message.findFirst({
      where: { sessionId: live.sessionId, waMessageId: revoke.targetWaMessageId },
      select: { id: true, chatId: true },
    })
    if (!target) {
      live.counters.skipped += 1
      this.pushDebug(live, {
        event: 'messages.upsert (revoke)',
        jid: revoke.chatJid,
        stored: false,
        reason: `revoked message ${revoke.targetWaMessageId} not stored`,
      })
      return
    }

    const updated = await prisma.message.update({
      where: { id: target.id },
      data: { deletedAt: new Date(), text: null, mediaPath: null, mediaNode: null, mediaStatus: null, reactions: null },
    })
    const chat = await prisma.chat.findUnique({ where: { id: target.chatId } })

    live.counters.revoked += 1
    this.pushDebug(live, {
      event: 'messages.upsert (revoke)',
      jid: revoke.chatJid,
      stored: true,
      reason: 'message revoked by sender',
    })

    emitToSession(live.sessionId, 'session:message-updated', {
      sessionId: live.sessionId,
      message: toMessageDTO(updated),
    })
    if (chat) {
      emitToSession(live.sessionId, 'session:chat', { sessionId: live.sessionId, chat: toChatDTO(chat) })
    }
  }

  /**
   * Background download for a freshly stored message. Broadcasts
   * `session:message-updated` when the file is ready (or when it failed, with
   * a human readable reason), then schedules retries if needed.
   */
  private async downloadIncomingMedia(
    sessionId: string,
    messageId: string,
    raw: proto.IWebMessageInfo,
    sock: WASocket,
  ) {
    const message = await prisma.message.findUnique({ where: { id: messageId } })
    if (!message || message.mediaPath) return

    const stored = await storeIncomingMedia(sessionId, sock, raw, message.mediaMime, message.mediaName)

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: {
        mediaPath: stored.mediaPath,
        mediaSize: stored.mediaSize ?? message.mediaSize,
        mediaStatus: stored.mediaPath ? 'ready' : 'pending',
        mediaError: stored.error,
        mediaRetries: { increment: 1 },
      },
    })

    const live = this.sessions.get(sessionId)
    if (live && stored.mediaPath) live.counters.mediaRecovered += 1

    emitToSession(sessionId, 'session:message-updated', {
      sessionId,
      message: toMessageDTO(updated),
    })

    if (stored.mediaPath) {
      logger.info(
        { sessionId, messageId, viewOnce: message.viewOnce, attempts: updated.mediaRetries },
        'media tersimpan',
      )
      if (live) {
        this.pushDebug(live, {
          event: 'media.download',
          stored: true,
          reason: `media ok${message.viewOnce ? ' (sekali lihat)' : ''}`,
        })
      }
      return
    }

    // Not available yet — WhatsApp re-shares view-once media after a moment.
    this.scheduleMediaRetry(sessionId, messageId, [4_000, 12_000, 35_000, 90_000, 180_000])
  }

  /** Sender edited a message: update the stored row instead of duplicating it. */
  private async handleEdit(live: LiveSession, targetWaMessageId: string, content: proto.IMessage) {
    const target = await prisma.message.findFirst({
      where: { sessionId: live.sessionId, waMessageId: targetWaMessageId },
      select: { id: true, chatId: true, text: true },
    })
    if (!target) {
      live.counters.skipped += 1
      this.pushDebug(live, {
        event: 'messages.update (edit)',
        stored: false,
        reason: `pesan ${targetWaMessageId} belum ada di panel`,
      })
      return
    }

    const newText =
      content.conversation ??
      content.extendedTextMessage?.text ??
      content.imageMessage?.caption ??
      content.videoMessage?.caption ??
      content.documentMessage?.caption ??
      null

    const updated = await prisma.message.update({
      where: { id: target.id },
      data: {
        ...(newText !== null ? { text: newText } : {}),
        editedAt: new Date(),
      },
    })

    live.counters.edited += 1
    this.pushDebug(live, {
      event: 'messages.update (edit)',
      stored: true,
      reason: 'pesan diedit',
    })

    // Keep the chat list preview in sync when the edited message is the latest.
    const chat = await prisma.chat.findUnique({ where: { id: target.chatId } })
    if (chat && chat.lastMessagePreview !== null) {
      const isLatest = await prisma.message.findFirst({
        where: { chatId: target.chatId },
        orderBy: { timestamp: 'desc' },
        select: { id: true },
      })
      if (isLatest?.id === target.id && newText) {
        await prisma.chat.update({
          where: { id: chat.id },
          data: { lastMessagePreview: newText.slice(0, 200) },
        })
      }
    }

    emitToSession(live.sessionId, 'session:message-updated', {
      sessionId: live.sessionId,
      message: toMessageDTO(updated),
    })
    broadcast('sessions:changed')
  }

  /** Retry schedule for media that WhatsApp had not shared yet. */
  private scheduleMediaRetry(sessionId: string, messageId: string, delays: number[]) {
    delays.forEach((delayMs, index) => {
      const timer = setTimeout(() => {
        void this.retryMediaDownload(sessionId, messageId).catch(() => undefined)
      }, delayMs)
      timer.unref?.()
      void index
    })
  }

  /**
   * (Re)downloads the media of an already stored message.
   * Accepts either our internal message id or the WhatsApp message id — the
   * latter is what the `messages.media-update` event gives us.
   */
  async retryMediaDownload(sessionId: string, messageId?: string, waMessageId?: string) {
    const message = messageId
      ? await prisma.message.findUnique({ where: { id: messageId } })
      : await prisma.message.findFirst({ where: { sessionId, waMessageId } })

    if (!message) return null
    if (message.mediaPath) return message
    if (message.deletedAt) return message
    if (!message.mediaNode) {
      await prisma.message.update({
        where: { id: message.id },
        data: { mediaStatus: 'failed' },
      })
      return null
    }

    const live = this.sessions.get(sessionId)
    const chat = await prisma.chat.findUnique({ where: { id: message.chatId } })
    if (!chat) return null

    const stub = rebuildMediaMessage(message.mediaNode, {
      id: message.waMessageId ?? message.id,
      remoteJid: chat.jid,
      fromMe: message.fromMe,
    })
    if (!stub) return null

    const sock = live?.sock
    if (!sock) return null

    if (live) live.counters.mediaRetried += 1

    const stored = await storeIncomingMedia(
      sessionId,
      sock,
      stub,
      message.mediaMime,
      message.mediaName,
    )

    const updated = await prisma.message.update({
      where: { id: message.id },
      data: {
        mediaPath: stored.mediaPath ?? message.mediaPath,
        mediaSize: stored.mediaSize ?? message.mediaSize,
        mediaStatus: stored.mediaPath ? 'ready' : 'pending',
        mediaError: stored.error,
        mediaRetries: { increment: 1 },
      },
    })

    if (stored.mediaPath) {
      if (live) live.counters.mediaRecovered += 1
      logger.info(
        { sessionId, messageId: message.id, viewOnce: message.viewOnce },
        'media downloaded on retry (view-once media recovered)',
      )
      if (live) {
        this.pushDebug(live, {
          event: 'media.retry',
          stored: true,
          reason: `media recovered${message.viewOnce ? ' (view once)' : ''}`,
        })
      }
    } else if (updated.mediaRetries >= 6) {
      await prisma.message.update({
        where: { id: message.id },
        data: { mediaStatus: 'failed' },
      })
    }

    emitToSession(sessionId, 'session:message-updated', {
      sessionId,
      message: toMessageDTO(updated),
    })
    broadcast('sessions:changed')

    return updated
  }

  /** Send / remove our own emoji reaction on a message. */
  async sendReaction(sessionId: string, messageId: string, emoji: string) {
    const live = this.requireLive(sessionId)
    const message = await prisma.message.findUnique({ where: { id: messageId } })
    if (!message) throw new Error('Message not found')
    if (!message.waMessageId) throw new Error('Message has no WhatsApp id')

    const chat = await prisma.chat.findUnique({ where: { id: message.chatId } })
    if (!chat) throw new Error('Chat not found')

    await live.sock.sendMessage(chat.jid, {
      react: {
        text: emoji,
        key: {
          remoteJid: chat.jid,
          id: message.waMessageId,
          fromMe: message.fromMe,
          participant: chat.isGroup ? (message.senderJid ?? undefined) : undefined,
        },
      },
    })

    const map = (() => {
      try {
        return JSON.parse(message.reactions ?? '{}') as Record<string, string>
      } catch {
        return {}
      }
    })()
    const me = live.sock.user?.id ?? 'me'
    if (emoji) map[me] = emoji
    else delete map[me]

    const updated = await prisma.message.update({
      where: { id: message.id },
      data: { reactions: Object.keys(map).length > 0 ? JSON.stringify(map) : null },
    })

    emitToSession(sessionId, 'session:message-updated', {
      sessionId,
      message: toMessageDTO(updated),
    })

    return updated
  }

  /**
   * scope = 'everyone' -> revoke on WhatsApp for all participants
   * scope = 'me'       -> just hide it from this panel (WhatsApp has no API for
   *                       "delete for me" on companion devices)
   */
  async deleteMessage(sessionId: string, messageId: string, scope: 'me' | 'everyone' = 'everyone') {
    const message = await prisma.message.findUnique({ where: { id: messageId } })
    if (!message) throw new Error('Message not found')

    const chat = await prisma.chat.findUnique({ where: { id: message.chatId } })
    if (!chat) throw new Error('Chat not found')

    if (scope === 'everyone') {
      if (!message.fromMe) {
        throw new Error('Only your own messages can be deleted for everyone (group admins can delete others)')
      }
      if (!message.waMessageId) throw new Error('Message has no WhatsApp id')
      const live = this.requireLive(sessionId)
      await live.sock.sendMessage(chat.jid, {
        delete: {
          remoteJid: chat.jid,
          id: message.waMessageId,
          fromMe: true,
          participant: chat.isGroup ? (live.sock.user?.id ?? undefined) : undefined,
        },
      })

      const updated = await prisma.message.update({
        where: { id: message.id },
        data: { deletedAt: new Date(), text: null, mediaPath: null, mediaNode: null, mediaStatus: null, reactions: null },
      })
      emitToSession(sessionId, 'session:message-updated', {
        sessionId,
        message: toMessageDTO(updated),
      })
      return { deleted: 'everyone' as const, message: toMessageDTO(updated) }
    }

    await prisma.message.delete({ where: { id: message.id } })
    emitToSession(sessionId, 'session:message-removed', { sessionId, messageId, chatId: chat.id })
    return { deleted: 'me' as const }
  }

  async sendMessage(sessionId: string, chatId: string, payload: OutgoingPayload) {
    const live = this.requireLive(sessionId)
    const chat = await prisma.chat.findUnique({ where: { id: chatId } })
    if (!chat) throw new Error('Chat not found')

    const { sock } = live
    const viewOnce = Boolean(payload.viewOnce)

    // --- lokasi & kontak dikirim sebagai pesan khusus (bukan media) ----------
    if (payload.kind === 'location') {
      const location = payload.location
      if (!location) throw new Error('Koordinat lokasi tidak lengkap')
      return this.sendLocation(sessionId, chat.id, location)
    }

    if (payload.kind === 'contact') {
      const contact = payload.contact
      if (!contact?.phone) throw new Error('Nomor kontak tidak lengkap')
      return this.sendContact(sessionId, chat.id, contact.displayName || contact.phone, contact.phone)
    }

    const content: AnyMessageContent =
      payload.kind === 'text'
        ? { text: (payload.text ?? '').toString() }
        : payload.kind === 'image'
          ? { image: payload.buffer as Buffer, caption: payload.caption ?? undefined, mimetype: payload.mimetype ?? undefined, viewOnce }
          : payload.kind === 'video'
            ? { video: payload.buffer as Buffer, caption: payload.caption ?? undefined, mimetype: payload.mimetype ?? undefined, viewOnce }
            : payload.kind === 'audio'
              ? payload.ptt
                ? { audio: payload.buffer as Buffer, ptt: true, mimetype: payload.mimetype ?? 'audio/ogg; codecs=opus' }
                : { audio: payload.buffer as Buffer, ptt: false, mimetype: payload.mimetype ?? 'audio/mp4' }
              : payload.kind === 'sticker'
                ? { sticker: payload.buffer as Buffer }
                : {
                    document: payload.buffer as Buffer,
                    mimetype: payload.mimetype ?? 'application/octet-stream',
                    fileName: payload.fileName ?? 'file',
                    caption: payload.caption ?? undefined,
                  }

    if (payload.kind === 'text' && !payload.text?.trim()) {
      throw new Error('Message text cannot be empty')
    }

    // Quote/reply: rebuild a WAMessage stub from our stored copy of the message
    // (Baileys needs the original message object to embed contextInfo).
    let quoted: WAMessage | undefined
    let quotedRow: { id: string; text: string; type: string; fromMe: boolean } | null = null
    if (payload.quotedMessageId) {
      const original = await prisma.message.findUnique({ where: { id: payload.quotedMessageId } })
      if (original && original.waMessageId) {
        const previewText = original.text?.trim() || previewFor(original.type as never, null)
        quoted = {
          key: {
            id: original.waMessageId,
            remoteJid: chat.jid,
            fromMe: original.fromMe,
            participant: chat.isGroup ? (original.senderJid ?? undefined) : undefined,
          },
          message: { conversation: previewText },
          messageTimestamp: Math.floor(new Date(original.timestamp).getTime() / 1000),
        } as WAMessage
        quotedRow = {
          id: original.waMessageId,
          text: previewText.slice(0, 300),
          type: original.type,
          fromMe: original.fromMe,
        }
      }
    }

    const sent = await sock.sendMessage(chat.jid, content, quoted ? { quoted } : {})
    if (!sent) throw new Error('Baileys failed to send the message')

    // Store our own media so it can be previewed later (WhatsApp will not let us
    // download our own uploads again).
    let mediaPath: string | null = null
    if (payload.kind !== 'text' && payload.buffer) {
      try {
        const dir = await ensureDir(sessionMediaDir(sessionId))
        const ext = guessExtension(payload.mimetype, payload.fileName)
        const absolute = path.join(dir, `out-${sent.key.id}.${ext}`)
        await fs.writeFile(absolute, payload.buffer)
        mediaPath = path.relative(MEDIA_ROOT, absolute)
      } catch (error) {
        logger.warn({ error }, 'failed to store outgoing media copy')
      }
    }

    const text =
      payload.kind === 'text'
        ? (payload.text ?? '').trim()
        : (payload.caption ?? null)

    const message = await prisma.message.create({
      data: {
        sessionId,
        chatId: chat.id,
        waMessageId: sent.key.id ?? null,
        fromMe: true,
        senderJid: sock.user?.id ?? null,
        senderName: sock.user?.name ?? null,
        type: payload.kind,
        text,
        mediaPath,
        mediaMime: payload.kind === 'text' ? null : (payload.mimetype ?? null),
        mediaName: payload.fileName ?? null,
        mediaSize: payload.buffer?.length ?? null,
        status: 'sent',
        timestamp: new Date(),
        viewOnce,
        mediaStatus: payload.kind === 'text' ? null : mediaPath ? 'ready' : 'failed',
        quotedId: quotedRow?.id ?? null,
        quotedText: quotedRow?.text ?? null,
        quotedType: quotedRow?.type ?? null,
        quotedFromMe: quotedRow?.fromMe ?? null,
      },
    })

    const updatedChat = await prisma.chat.update({
      where: { id: chat.id },
      data: {
        lastMessagePreview: viewOnce
          ? `👁️ View once · ${previewFor(payload.kind, text)}`.trim()
          : previewFor(payload.kind, text),
        lastMessageAt: message.timestamp,
      },
    })

    const messageDTO = toMessageDTO(message)
    const chatDTO = toChatDTO(updatedChat)

    emitToSession(sessionId, 'session:message', { sessionId, message: messageDTO, chat: chatDTO })

    return { message: messageDTO, chat: chatDTO }
  }

  /* --------------------------- balasan otomatis --------------------------- */

  private automationCooldown = new Map<string, number>()

  /**
   * Evaluasi aturan balasan otomatis untuk sebuah pesan masuk dan
   * teruskan pesan ke webhook sesi (kalau aktif).
   */
  private async runAutomation(
    sessionId: string,
    chat: { id: string; jid: string; isGroup: boolean },
    parsed: ParsedMessage,
    messageDTO: ReturnType<typeof toMessageDTO>,
    chatDTO: ReturnType<typeof toChatDTO>,
  ) {
    // 1. Webhook keluar — selalu jalan kalau diaktifkan.
    void dispatchWebhook(sessionId, 'message', {
      chat: { id: chatDTO.id, name: chatDTO.name, jid: chat.jid, isGroup: chat.isGroup },
      message: messageDTO,
    }).catch(() => undefined)

    // 2. Balasan otomatis.
    const rules = await prisma.autoReplyRule.findMany({
      where: { sessionId, enabled: true },
      orderBy: { createdAt: 'asc' },
    })
    if (rules.length === 0) return

    const text = (parsed.text ?? '').trim()
    if (!text) return

    for (const rule of rules) {
      if (chat.isGroup && !rule.applyToGroups) continue

      const matched = matchRule(rule.matchType, rule.pattern, text)
      if (!matched) continue

      const cooldownKey = `${rule.id}:${chat.id}`
      const last = this.automationCooldown.get(cooldownKey) ?? 0
      const cooldownMs = Math.max(0, rule.cooldownSeconds) * 1000
      if (Date.now() - last < cooldownMs) return

      this.automationCooldown.set(cooldownKey, Date.now())

      try {
        await this.sendAutoReply(sessionId, chat, rule.reply)
        const updated = await prisma.autoReplyRule.update({
          where: { id: rule.id },
          data: { hits: { increment: 1 }, lastFiredAt: new Date() },
        })
        const live = this.sessions.get(sessionId)
        if (live) {
          this.pushDebug(live, {
            event: 'auto-reply',
            stored: true,
            reason: `aturan "${updated.name}" membalas di ${chat.jid}`,
          })
        }
        void dispatchWebhook(sessionId, 'autoreply', {
          chat: { id: chatDTO.id, name: chatDTO.name, jid: chat.jid },
          rule: { id: updated.id, name: updated.name, reply: updated.reply },
          incoming: messageDTO,
        }).catch(() => undefined)
        broadcast('sessions:changed')
      } catch (error) {
        logger.warn({ sessionId, rule: rule.id, error }, 'gagal mengirim balasan otomatis')
      }
      return // hanya satu aturan pertama yang membalas
    }
  }

  /** Kirim + simpan balasan otomatis sebagai pesan keluar biasa. */
  private async sendAutoReply(
    sessionId: string,
    chat: { id: string; jid: string },
    reply: string,
  ) {
    const live = this.requireLive(sessionId)
    const sent = await live.sock.sendMessage(chat.jid, { text: reply })
    if (!sent) throw new Error('Baileys gagal mengirim balasan otomatis')

    const message = await prisma.message.create({
      data: {
        sessionId,
        chatId: chat.id,
        waMessageId: sent.key.id ?? null,
        fromMe: true,
        senderJid: live.sock.user?.id ?? null,
        senderName: 'Balasan otomatis',
        type: 'text',
        text: reply,
        status: 'sent',
        timestamp: new Date(),
        extra: JSON.stringify({ rawType: 'autoReply' }),
      },
    })

    const updatedChat = await prisma.chat.update({
      where: { id: chat.id },
      data: { lastMessagePreview: reply.slice(0, 180), lastMessageAt: message.timestamp },
    })

    emitToSession(sessionId, 'session:message', {
      sessionId,
      message: toMessageDTO(message),
      chat: toChatDTO(updatedChat),
    })
    return message
  }

  /* ------------------------------ webhook ------------------------------- */

  async getWebhookConfig(sessionId: string) {
    const session = await prisma.waSession.findUnique({
      where: { id: sessionId },
      select: {
        webhookEnabled: true,
        webhookUrl: true,
        webhookSecret: true,
        webhookEvents: true,
        lastWebhookAt: true,
        lastWebhookStatus: true,
      },
    })
    if (!session) return null
    return {
      enabled: session.webhookEnabled,
      url: session.webhookUrl,
      // secret tidak pernah dikirim balik ke browser
      hasSecret: Boolean(session.webhookSecret),
      events: session.webhookEvents?.split(',').map((value) => value.trim()) ?? ['message'],
      lastAt: session.lastWebhookAt?.toISOString() ?? null,
      lastStatus: session.lastWebhookStatus,
    }
  }

  async updateWebhookConfig(
    sessionId: string,
    input: { enabled?: boolean; url?: string | null; secret?: string | null; events?: string[] },
  ) {
    const data: Record<string, unknown> = {}
    if (input.enabled !== undefined) data.webhookEnabled = input.enabled
    if (input.url !== undefined) data.webhookUrl = input.url
    if (input.secret !== undefined) data.webhookSecret = input.secret
    if (input.events !== undefined) data.webhookEvents = input.events.join(',')

    // Mengaktifkan webhook tanpa URL = tidak masuk akal; matikan saja.
    if (input.enabled === true && !input.url) {
      const current = await prisma.waSession.findUnique({
        where: { id: sessionId },
        select: { webhookUrl: true },
      })
      if (!current?.webhookUrl) data.webhookEnabled = false
    }

    await prisma.waSession.update({ where: { id: sessionId }, data })
    return this.getWebhookConfig(sessionId)
  }

  async testWebhook(sessionId: string) {
    return dispatchWebhook(sessionId, 'message', {
      test: true,
      chat: { id: 'test', name: 'Pesan percobaan', jid: '6280000000000@s.whatsapp.net', isGroup: false },
      message: {
        id: 'test',
        fromMe: false,
        type: 'text',
        text: 'Ini pesan percobaan dari panel WA Multi-Device Controller.',
        timestamp: new Date().toISOString(),
      },
    })
  }

  /* -------------------------- aturan balasan ---------------------------- */

  async listAutoReplies(sessionId: string) {
    return prisma.autoReplyRule.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    })
  }

  async createAutoReply(
    sessionId: string,
    input: {
      name: string
      matchType: string
      pattern: string
      reply: string
      enabled?: boolean
      applyToGroups?: boolean
      cooldownSeconds?: number
    },
  ) {
    if (input.matchType === 'regex') {
      try {
        new RegExp(input.pattern)
      } catch {
        throw new Error('Pola regex tidak valid')
      }
    }
    return prisma.autoReplyRule.create({ data: { sessionId, ...input } })
  }

  async updateAutoReply(
    ruleId: string,
    input: Partial<{
      name: string
      matchType: string
      pattern: string
      reply: string
      enabled: boolean
      applyToGroups: boolean
      cooldownSeconds: number
    }>,
  ) {
    if (input.matchType === 'regex' && input.pattern) {
      try {
        new RegExp(input.pattern)
      } catch {
        throw new Error('Pola regex tidak valid')
      }
    }
    return prisma.autoReplyRule.update({ where: { id: ruleId }, data: input })
  }

  async deleteAutoReply(ruleId: string) {
    await prisma.autoReplyRule.delete({ where: { id: ruleId } })
    return { ok: true }
  }

  /** Kirim lokasi (peta) ke sebuah chat. */
  async sendLocation(
    sessionId: string,
    chatId: string,
    location: { lat: number; lng: number; name?: string | null },
  ) {
    const live = this.requireLive(sessionId)
    const chat = await prisma.chat.findUnique({ where: { id: chatId } })
    if (!chat) throw new Error('Chat not found')

    const sent = await live.sock.sendMessage(chat.jid, {
      location: {
        degreesLatitude: location.lat,
        degreesLongitude: location.lng,
        name: location.name ?? undefined,
      },
    })
    if (!sent) throw new Error('Baileys gagal mengirim lokasi')

    const mapsUrl = `https://maps.google.com/?q=${location.lat},${location.lng}`
    const text = `📍 ${location.name || 'Lokasi'} (${location.lat.toFixed(5)}, ${location.lng.toFixed(5)})`
    const extra = JSON.stringify({
      location: { lat: location.lat, lng: location.lng, name: location.name ?? null, mapsUrl },
      rawType: 'locationMessage(outgoing)',
    })

    const message = await prisma.message.create({
      data: {
        sessionId,
        chatId: chat.id,
        waMessageId: sent.key.id ?? null,
        fromMe: true,
        senderJid: live.sock.user?.id ?? null,
        senderName: live.sock.user?.name ?? null,
        type: 'other',
        text,
        status: 'sent',
        timestamp: new Date(),
        extra,
      },
    })

    const updatedChat = await prisma.chat.update({
      where: { id: chat.id },
      data: { lastMessagePreview: text, lastMessageAt: message.timestamp },
    })

    const messageDTO = toMessageDTO(message)
    const chatDTO = toChatDTO(updatedChat)
    emitToSession(sessionId, 'session:message', { sessionId, message: messageDTO, chat: chatDTO })
    return { message: messageDTO, chat: chatDTO }
  }

  /** Kirim kartu kontak (vCard) ke sebuah chat. */
  async sendContact(sessionId: string, chatId: string, displayName: string, phone: string) {
    const live = this.requireLive(sessionId)
    const chat = await prisma.chat.findUnique({ where: { id: chatId } })
    if (!chat) throw new Error('Chat not found')

    const normalized = normalizePhoneNumber(phone)
    const sent = await live.sock.sendMessage(chat.jid, {
      contacts: {
        displayName,
        contacts: [{ displayName, vcard: buildVcard(displayName, normalized) }],
      },
    })
    if (!sent) throw new Error('Baileys gagal mengirim kontak')

    const text = `👤 Kontak: ${displayName} (+${normalized})`
    const extra = JSON.stringify({ contact: { displayName, phone: `+${normalized}` }, rawType: 'contactMessage(outgoing)' })

    const message = await prisma.message.create({
      data: {
        sessionId,
        chatId: chat.id,
        waMessageId: sent.key.id ?? null,
        fromMe: true,
        senderJid: live.sock.user?.id ?? null,
        senderName: live.sock.user?.name ?? null,
        type: 'other',
        text,
        status: 'sent',
        timestamp: new Date(),
        extra,
      },
    })

    const updatedChat = await prisma.chat.update({
      where: { id: chat.id },
      data: { lastMessagePreview: text, lastMessageAt: message.timestamp },
    })

    const messageDTO = toMessageDTO(message)
    const chatDTO = toChatDTO(updatedChat)
    emitToSession(sessionId, 'session:message', { sessionId, message: messageDTO, chat: chatDTO })
    return { message: messageDTO, chat: chatDTO }
  }

  /**
   * Teruskan sebuah pesan ke chat lain.
   *
   * Isi pesan dibangun ulang dari data yang kita simpan (teks + media di disk),
   * jadi tidak bergantung pada WAMessage asli yang sudah tidak tersedia.
   */
  async forwardMessage(sessionId: string, messageId: string, targetChatId: string): Promise<ForwardResult> {
    const original = await prisma.message.findUnique({ where: { id: messageId } })
    if (!original) throw new Error('Pesan tidak ditemukan')
    if (original.deletedAt) throw new Error('Pesan ini sudah dihapus')

    const target = await prisma.chat.findUnique({ where: { id: targetChatId } })
    if (!target || target.sessionId !== sessionId) throw new Error('Chat tujuan tidak ditemukan')

    const live = this.requireLive(sessionId)

    // Media: baca salinan lokal kita (Baileys tidak bisa mengunduh ulang milik sendiri).
    let buffer: Buffer | null = null
    if (original.mediaPath) {
      try {
        buffer = await fs.readFile(path.join(MEDIA_ROOT, original.mediaPath))
      } catch {
        buffer = null
      }
    }

    const kind =
      original.type === 'image' ||
      original.type === 'video' ||
      original.type === 'audio' ||
      original.type === 'document' ||
      original.type === 'sticker'
        ? (original.type as 'image' | 'video' | 'audio' | 'document' | 'sticker')
        : null

    if (kind && buffer) {
      const sent = await live.sock.sendMessage(target.jid, {
        ...(kind === 'image' ? { image: buffer } : {}),
        ...(kind === 'video' ? { video: buffer } : {}),
        ...(kind === 'audio' ? { audio: buffer, ptt: false } : {}),
        ...(kind === 'sticker' ? { sticker: buffer } : {}),
        ...(kind === 'document'
          ? { document: buffer, fileName: original.mediaName ?? 'berkas', mimetype: original.mediaMime ?? undefined }
          : {}),
        ...(kind === 'sticker' ? {} : { caption: original.text ?? undefined }),
      } as AnyMessageContent)

      if (!sent) throw new Error('Baileys gagal meneruskan pesan')

      const dir = await ensureDir(sessionMediaDir(sessionId))
      const ext = guessExtension(original.mediaMime, original.mediaName)
      const absolute = path.join(dir, `fwd-${sent.key.id}.${ext}`)
      await fs.writeFile(absolute, buffer).catch(() => undefined)

      const forwarded = await prisma.message.create({
        data: {
          sessionId,
          chatId: target.id,
          waMessageId: sent.key.id ?? null,
          fromMe: true,
          senderJid: live.sock.user?.id ?? null,
          senderName: live.sock.user?.name ?? null,
          type: kind,
          text: kind === 'sticker' ? null : (original.text ?? null),
          mediaPath: path.relative(MEDIA_ROOT, absolute),
          mediaMime: original.mediaMime,
          mediaName: original.mediaName,
          mediaSize: buffer.length,
          mediaDuration: original.mediaDuration,
          status: 'sent',
          timestamp: new Date(),
          mediaStatus: 'ready',
          extra: original.extra,
        },
      })

      const updatedTarget = await prisma.chat.update({
        where: { id: target.id },
        data: {
          lastMessagePreview: previewFor(kind as never, forwarded.text),
          lastMessageAt: forwarded.timestamp,
        },
      })

      const messageDTO = toMessageDTO(forwarded)
      const chatDTO = toChatDTO(updatedTarget)
      emitToSession(sessionId, 'session:message', { sessionId, message: messageDTO, chat: chatDTO })
      return { message: messageDTO, chat: chatDTO, targetChatName: target.name }
    }

    // Tidak ada media → teruskan sebagai teks (termasuk ringkasan tipe).
    const preview = previewFor(original.type as never, original.text)
    return { ...(await this.sendMessage(sessionId, target.id, { kind: 'text', text: preview })), targetChatName: target.name }
  }
  /** Transcodes a browser recording (webm/opus) into a WhatsApp voice note. */
  async prepareVoiceNote(buffer: Buffer, mimetype: string | null) {
    const isOgg = (mimetype ?? '').includes('ogg') || (mimetype ?? '').includes('opus')
    if (isOgg) {
      return { buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true }
    }

    const converted = await toOggOpus(buffer)
    if (converted) {
      return { buffer: converted, mimetype: 'audio/ogg; codecs=opus', ptt: true }
    }

    // ffmpeg missing: send as a normal audio attachment so the file still
    // arrives instead of silently failing.
    return { buffer, mimetype: mimetype ?? 'audio/webm', ptt: false }
  }

  private async applyMessageStatus(sessionId: string, waMessageId: string, status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed') {
    const message = await prisma.message.findFirst({
      where: { sessionId, waMessageId },
      select: { id: true, chatId: true, status: true },
    })
    if (!message || message.status === status) return
    if (message.status === 'read' && status !== 'read') return

    await prisma.message.update({
      where: { id: message.id },
      data: { status },
    })

    emitToSession(sessionId, 'session:message-status', {
      sessionId,
      chatId: message.chatId,
      waMessageId,
      status,
    })
  }

  /* ------------------------- pencarian & ekspor --------------------- */

  /** Cari teks di seluruh pesan sebuah session (nama chat, teks, nama file). */
  async searchMessages(sessionId: string, query: string, limit = 60, chatId?: string | null) {
    const q = query.trim()
    if (q.length < 2) return []

    const messages = await prisma.message.findMany({
      where: {
        sessionId,
        deletedAt: null,
        ...(chatId ? { chatId } : {}),
        OR: [
          { text: { contains: q } },
          { mediaName: { contains: q } },
          { senderName: { contains: q } },
          { chat: { name: { contains: q } } },
        ],
      },
      orderBy: { timestamp: 'desc' },
      take: Math.min(limit, 200),
      include: {
        chat: { select: { id: true, jid: true, name: true } },
      },
    })

    return messages.map((message) => ({
      message: toMessageDTO(message),
      chat: {
        id: message.chat.id,
        jid: message.chat.jid,
        name: message.chat.name,
      },
    }))
  }

  /** Data untuk ekspor percakapan (dipakai /api/chats/:id/export). */
  async exportChat(chatId: string, limit = 5000) {
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: { session: { select: { name: true, phoneNumber: true } } },
    })
    if (!chat) return null

    const messages = await prisma.message.findMany({
      where: { chatId },
      orderBy: { timestamp: 'asc' },
      take: limit,
    })

    return {
      chat: toChatDTO(chat),
      session: { name: chat.session.name, phoneNumber: chat.session.phoneNumber },
      messages: messages.map(toMessageDTO),
      exportedAt: new Date().toISOString(),
    }
  }

  /* ---------------------------- utilities --------------------------- */

  async profilePicture(sessionId: string, jid: string) {
    const live = this.sessions.get(sessionId)
    if (!live) return null
    try {
      return await live.sock.profilePictureUrl(jid, 'image')
    } catch {
      return null
    }
  }

  async changeProfilePicture(sessionId: string, jid: string) {
    return this.profilePicture(sessionId, jid)
  }

  async checkNumber(sessionId: string, rawPhoneNumber: string) {
    const live = this.requireLive(sessionId)
    const phoneNumber = normalizePhoneNumber(rawPhoneNumber)
    const jid = toJid(phoneNumber)
    const [result] = (await live.sock.onWhatsApp(jid)) ?? []
    return {
      phoneNumber,
      jid,
      exists: Boolean(result?.exists),
    }
  }

  async stats() {
    const [sessions, connected, chats, messages, media] = await Promise.all([
      prisma.waSession.count(),
      prisma.waSession.count({ where: { status: 'connected' } }),
      prisma.chat.count(),
      prisma.message.count(),
      prisma.message.count({ where: { NOT: { mediaPath: null } } }),
    ])
    return { sessions, connected, chats, messages, media }
  }

  /** Graceful shutdown: close every socket without touching the auth files. */
  async shutdown() {
    logger.info({ count: this.sessions.size }, 'closing live sessions')
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer)
      this.watchdogTimer = null
    }
    for (const live of this.sessions.values()) {
      live.manualDisconnect = true
      this.clearReconnect(live.sessionId)
      try {
        live.sock.ws?.close()
        live.sock.end(undefined)
      } catch {
        /* ignore */
      }
    }
    this.sessions.clear()
  }
}

/* ------------------------------------------------------------------ */
/* Singleton (shared between server.ts and the Next.js route handlers)  */
/* ------------------------------------------------------------------ */

const globalStore = globalThis as unknown as { __waSessionManager?: SessionManager }

export const sessionManager: SessionManager = globalStore.__waSessionManager ?? new SessionManager()
globalStore.__waSessionManager = sessionManager

export { SessionManager }
