/**
 * Shared types between the Next.js client, the route handlers and the
 * Baileys/socket layer. Everything here is serialisable JSON.
 */

export type SessionStatus =
  | 'disconnected'
  | 'connecting'
  | 'pairing'
  | 'connected'
  | 'error'

export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'other'

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed'

export interface SessionDTO {
  id: string
  name: string
  phoneNumber: string
  status: SessionStatus
  pairingCode: string | null
  pairingCodeExpiresAt: string | null
  pushName: string | null
  lastError: string | null
  connectedAt: string | null
  createdAt: string
  updatedAt: string
  /** true when the socket for this session is live in the current process */
  isLive: boolean
}

export interface SessionWithStats extends SessionDTO {
  stats: {
    chats: number
    messages: number
    unread: number
  }
}

/** Kontak dari buku alamat nomor yang ditautkan (halaman Kontak). */
export interface ContactDTO {
  id: string
  jid: string
  phoneNumber: string | null
  /** Nama siap tampil: nama HP -> nama WhatsApp -> nomor/label ramah. */
  displayName: string
  notify: string | null
  verifiedName: string | null
  /** sync = dari WhatsApp, pesan = pengirim chat, manual = diimpor di panel. */
  source: string
  hasChat: boolean
  chatId: string | null
  updatedAt: string
}

export interface ChatDTO {
  id: string
  sessionId: string
  jid: string
  name: string | null
  isGroup: boolean
  unreadCount: number
  lastMessagePreview: string | null
  lastMessageAt: string
  pinned: boolean
  archived: boolean
}

export interface QuotedDTO {
  id: string
  text: string
  type: MessageType
  fromMe: boolean
}

export interface MessageDTO {
  id: string
  sessionId: string
  chatId: string
  waMessageId: string | null
  fromMe: boolean
  senderJid: string | null
  senderName: string | null
  type: MessageType
  text: string | null
  mediaPath: string | null
  mediaMime: string | null
  mediaName: string | null
  mediaSize: number | null
  mediaDuration: number | null
  status: MessageStatus
  timestamp: string
  createdAt: string
  /** view-once (foto/video sekali lihat) — the panel keeps the file so it stays readable */
  viewOnce: boolean
  /** ready | pending (waiting for WhatsApp to share it) | failed | null */
  mediaStatus: string | null
  mediaRetries: number
  /** Alasan download media gagal (ditampilkan ke user). */
  mediaError: string | null
  deletedAt: string | null
  editedAt: string | null
  /** Detail render tambahan: gifPlayback, ptv, location, poll, contact… */
  extra: Record<string, unknown> | null
  /** { "<senderJid>": "❤️" } */
  reactions: Record<string, string>
  quoted: QuotedDTO | null
}

export interface StatsDTO {
  sessions: number
  connected: number
  chats: number
  messages: number
  media: number
}

/* ------------------------------------------------------------------------- */
/* Socket.io contracts                                                        */
/* ------------------------------------------------------------------------- */

export interface ServerToClientEvents {
  'session:status': (payload: {
    sessionId: string
    status: SessionStatus
    pushName?: string | null
    phoneNumber?: string
    lastError?: string | null
    connectedAt?: string | null
  }) => void
  'session:pairing-code': (payload: {
    sessionId: string
    code: string
    expiresAt: string | null
  }) => void
  'session:qr': (payload: { sessionId: string; qr: string | null }) => void
  'session:message': (payload: { sessionId: string; message: MessageDTO; chat: ChatDTO }) => void
  'session:chat': (payload: { sessionId: string; chat: ChatDTO }) => void
  'session:message-status': (payload: {
    sessionId: string
    chatId: string
    waMessageId: string
    status: MessageStatus
  }) => void
  /** Ringkasan pesan masuk untuk notifikasi & badge judul tab (semua tab). */
  'session:notify': (payload: {
    sessionId: string
    sessionName: string
    chatId: string
    chatName: string
    fromMe: boolean
    preview: string
    viewOnce?: boolean
  }) => void
  /** Any change to an existing message: reactions, revoke, media finished downloading. */
  'session:message-updated': (payload: { sessionId: string; message: MessageDTO }) => void
  'session:message-removed': (payload: { sessionId: string; messageId: string; chatId: string }) => void
  /** Beberapa chat kosong dibersihkan (daftar chat perlu dimuat ulang). */
  'session:chats-pruned': (payload: { sessionId: string; removed: number; jids: string[] }) => void
  'session:deleted': (payload: { sessionId: string }) => void
  'session:created': (payload: { sessionId: string }) => void
  'sessions:changed': () => void
  'server:ready': (payload: { at: string }) => void
}

export interface ClientToServerEvents {
  /** Laporan dari browser: tab sedang terlihat atau tidak (untuk notifikasi push). */
  'presence:visibility': (payload: { state: 'visible' | 'hidden'; deviceId?: string }) => void

  subscribe: (payload: { sessionId?: string }) => void
  unsubscribe: (payload?: { sessionId?: string }) => void
  'chat:typing': (payload: { sessionId: string; chatId: string; state: 'composing' | 'paused' }) => void
  'chat:read': (payload: { sessionId: string; chatId: string }) => void
  /** A browser tab has a chat on screen — used for auto read receipts. */
  'chat:open': (payload: { chatId: string }) => void
  'chat:close': (payload: { chatId: string }) => void
}
