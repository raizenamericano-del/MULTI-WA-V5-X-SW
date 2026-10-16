import { BufferJSON, getContentType, type proto } from '@whiskeysockets/baileys'
import prisma from '@/lib/prisma'
import type {
  ChatDTO,
  MessageDTO,
  MessageStatus,
  MessageType,
  SessionDTO,
} from '@/lib/types'
import { isGroupJid } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* DTO mappers                                                         */
/* ------------------------------------------------------------------ */

type SessionRecord = {
  id: string
  name: string
  phoneNumber: string
  status: string
  pairingCode: string | null
  pairingCodeExpiresAt: Date | null
  pushName: string | null
  lastError: string | null
  connectedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export function toSessionDTO(
  session: SessionRecord,
  isLive = false,
): SessionDTO {
  return {
    id: session.id,
    name: session.name,
    phoneNumber: session.phoneNumber,
    status: session.status as SessionDTO['status'],
    pairingCode: session.pairingCode,
    pairingCodeExpiresAt: session.pairingCodeExpiresAt?.toISOString() ?? null,
    pushName: session.pushName,
    lastError: session.lastError,
    connectedAt: session.connectedAt?.toISOString() ?? null,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    isLive,
  }
}

type ChatRecord = {
  id: string
  sessionId: string
  jid: string
  name: string | null
  isGroup: boolean
  unreadCount: number
  lastMessagePreview: string | null
  lastMessageAt: Date
  pinned: boolean
  archived: boolean
}

export function toChatDTO(chat: ChatRecord): ChatDTO {
  return {
    id: chat.id,
    sessionId: chat.sessionId,
    jid: chat.jid,
    name: chat.name,
    isGroup: chat.isGroup,
    unreadCount: chat.unreadCount,
    lastMessagePreview: chat.lastMessagePreview,
    lastMessageAt: chat.lastMessageAt.toISOString(),
    pinned: chat.pinned,
    archived: chat.archived,
  }
}

type MessageRecord = {
  id: string
  sessionId: string
  chatId: string
  waMessageId: string | null
  fromMe: boolean
  senderJid: string | null
  senderName: string | null
  type: string
  text: string | null
  mediaPath: string | null
  mediaMime: string | null
  mediaName: string | null
  mediaSize: number | null
  mediaDuration: number | null
  status: string
  timestamp: Date
  createdAt: Date
  viewOnce: boolean
  mediaStatus: string | null
  mediaRetries: number
  mediaError: string | null
  deletedAt: Date | null
  editedAt: Date | null
  extra: string | null
  reactions: string | null
  quotedId: string | null
  quotedText: string | null
  quotedType: string | null
  quotedFromMe: boolean | null
}

export function toMessageDTO(message: MessageRecord): MessageDTO {
  return {
    id: message.id,
    sessionId: message.sessionId,
    chatId: message.chatId,
    waMessageId: message.waMessageId,
    fromMe: message.fromMe,
    senderJid: message.senderJid,
    senderName: message.senderName,
    type: message.type as MessageType,
    text: message.text,
    mediaPath: message.mediaPath,
    mediaMime: message.mediaMime,
    mediaName: message.mediaName,
    mediaSize: message.mediaSize,
    mediaDuration: message.mediaDuration,
    status: message.status as MessageStatus,
    timestamp: message.timestamp.toISOString(),
    createdAt: message.createdAt.toISOString(),
    viewOnce: message.viewOnce,
    mediaStatus: message.mediaStatus,
    mediaRetries: message.mediaRetries,
    mediaError: message.mediaError,
    deletedAt: message.deletedAt?.toISOString() ?? null,
    editedAt: message.editedAt?.toISOString() ?? null,
    extra: (() => {
      try {
        return message.extra ? (JSON.parse(message.extra) as Record<string, unknown>) : null
      } catch {
        return null
      }
    })(),
    reactions: (() => {
      try {
        return JSON.parse(message.reactions ?? '{}') as Record<string, string>
      } catch {
        return {}
      }
    })(),
    quoted:
      message.quotedId && message.quotedText !== undefined
        ? {
            id: message.quotedId,
            text: message.quotedText ?? '',
            type: (message.quotedType ?? 'text') as MessageType,
            fromMe: Boolean(message.quotedFromMe),
          }
        : null,
  }
}

/* ------------------------------------------------------------------ */
/* Chats                                                               */
/* ------------------------------------------------------------------ */

export async function ensureChat(
  sessionId: string,
  jid: string,
  options: { name?: string | null; isGroup?: boolean } = {},
) {
  const isGroup = options.isGroup ?? isGroupJid(jid)
  const existing = await prisma.chat.findUnique({
    where: { sessionId_jid: { sessionId, jid } },
  })

  if (existing) {
    if (options.name && options.name !== existing.name) {
      const updated = await prisma.chat.update({
        where: { id: existing.id },
        data: { name: options.name },
      })
      return { chat: updated, created: false }
    }
    return { chat: existing, created: false }
  }

  const chat = await prisma.chat.create({
    data: {
      sessionId,
      jid,
      // Penting: JANGAN memakai `jid.split('@')[0]` sebagai nama. Untuk chat
      // `@lid` (alamat anonim WhatsApp) angka itu panjang dan menyesatkan
      // (mis. "225123456789012") sehingga tampil seperti nomor asing.
      // Nama dibiarkan kosong; UI akan memakai nomor telepon asli atau label
      // ramah sampai nama/ kontak aslinya tersinkron.
      name: options.name ?? null,
      isGroup,
    },
  })

  return { chat, created: true }
}

/** Preview text shown in the chat list (WhatsApp-style summary). */
export function previewFor(type: MessageType, text: string | null | undefined) {
  const prefix: Partial<Record<MessageType, string>> = {
    image: '📷 Photo',
    video: '🎥 Video',
    audio: '🎙️ Voice note',
    document: '📄 Document',
    sticker: '🩹 Sticker',
  }
  if (type === 'text') return text ?? ''
  if (text) return `${prefix[type] ?? ''} · ${text}`.trim()
  return prefix[type] ?? '📎 Attachment'
}

/**
 * Ambil nomor telepon dari vCard WhatsApp.
 *
 * Urutan prioritas: parameter `waid=` (nomor asli yang dipakai WhatsApp),
 * lalu `TEL` apa pun. Nomor dinormalkan ke `+<digit>` supaya bisa diklik.
 */
export function extractVcardPhone(vcard: string | null | undefined): string | null {
  if (!vcard) return null

  const waid = vcard.match(/waid=([+\d]+)/i)?.[1]
  const tel = vcard.match(/TEL[^:\r\n]*:([+\d][\d\s()-]*)/i)?.[1]
  const raw = waid ?? tel
  if (!raw) return null

  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  return `+${digits}`
}

/** Sama seperti extractVcardPhone, tapi untuk daftar vCard (contactsArrayMessage). */
export function extractContactsArrayPhones(vcards: Array<string | null | undefined>) {
  return vcards.map((vcard) => extractVcardPhone(vcard)).filter((phone): phone is string => Boolean(phone))
}

/* ------------------------------------------------------------------ */
/* Message parsing (Baileys -> our model)                              */
/* ------------------------------------------------------------------ */

export interface QuotedInfo {
  id: string
  text: string
  type: MessageType
  fromMe: boolean
  participantJid?: string | null
}

/** Optional render details stored as JSON on the message row. */
export interface MessageExtra {
  gifPlayback?: boolean
  /** video note (lingkaran / bulat) */
  ptv?: boolean
  location?: { lat: number; lng: number; name?: string | null; mapsUrl: string }
  poll?: { name: string; options: string[]; selectableCount: number | null }
  contact?: { displayName?: string | null; phone?: string | null }
  event?: { name?: string | null; startTime?: number | null }
  product?: { title?: string | null; description?: string | null }
  /** WhatsApp type we received, handy for unsupported content. */
  rawType?: string
}

export interface ParsedMessage {
  waMessageId: string
  fromMe: boolean
  /** Chat JID to store under — always the phone-number form when resolvable. */
  chatJid: string
  /** The JID exactly as WhatsApp sent it (may be a `@lid` address). */
  rawRemoteJid: string
  senderJid: string | null
  senderName: string | null
  /** LID form of the peer/author when WhatsApp sent one (for lid↔pn mapping). */
  lidJid: string | null
  type: MessageType
  text: string | null
  mediaMime: string | null
  mediaName: string | null
  mediaSize: number | null
  mediaDuration: number | null
  needsDownload: boolean
  viewOnce: boolean
  /** Raw (unwrapped) media node, serialised for later re-download. */
  mediaNode: string | null
  quoted: QuotedInfo | null
  extra: MessageExtra | null
  timestamp: Date
}

/** lid -> pn lookup handed in by the session manager (learned from traffic). */
export type LidResolver = (lidJid: string) => string | null | undefined

export interface MessageKeyLike {
  remoteJid?: string | null
  fromMe?: boolean | null
  id?: string | null
  participant?: string | null
  senderPn?: string | null
  senderLid?: string | null
  participantPn?: string | null
  participantLid?: string | null
}

/**
 * Works out which chat + sender a raw key belongs to.
 *
 * Handles the three shapes WhatsApp currently sends:
 *   1. classic 1:1          remoteJid = 62812xxx@s.whatsapp.net
 *   2. LID 1:1              remoteJid = 123456@lid, senderPn = 62812xxx@s.whatsapp.net
 *   3. group                remoteJid = ...@g.us, participant/participantPn
 */
/** Accepts `62812...`, `62812@s.whatsapp.net` or `62812:3@s.whatsapp.net`. */
export function normalizePn(value?: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.endsWith('@lid')) return null
  const user = trimmed.split('@')[0].split(':')[0].replace(/\D/g, '')
  if (!user) return null
  return `${user}@s.whatsapp.net`
}

export function resolveMessageJids(
  key: MessageKeyLike,
  resolveLid?: LidResolver,
): { chatJid: string; rawRemoteJid: string; senderJid: string | null; lidJid: string | null } | null {
  const rawRemoteJid = key.remoteJid
  if (!rawRemoteJid || !key.id) return null
  if (isIgnoredJid(rawRemoteJid)) return null

  const isGroup = rawRemoteJid.endsWith('@g.us')
  const peerPn = key.senderPn ?? key.participantPn ?? null
  const peerLid = key.senderLid ?? key.participantLid ?? null

  if (isGroup) {
    const authorRaw = key.participant ?? null
    const authorPn = key.participantPn ?? (authorRaw && !isLidJid(authorRaw) ? authorRaw : null)
    const authorLid = key.participantLid ?? (authorRaw && isLidJid(authorRaw) ? authorRaw : null)
    const lidJid = authorLid && isLidJid(authorLid) ? authorLid : null

    const senderJid =
      normalizePn(authorPn) ??
      (lidJid ? normalizePn(resolveLid?.(lidJid)) : null) ??
      normalizePn(authorRaw) ??
      authorRaw

    return { chatJid: rawRemoteJid, rawRemoteJid, senderJid, lidJid }
  }

  // 1:1 chat — resolve a LID address back to the phone number when possible.
  let chatJid = rawRemoteJid
  let lidJid: string | null = null

  if (isLidJid(rawRemoteJid)) {
    lidJid = rawRemoteJid
    chatJid = normalizePn(peerPn) ?? normalizePn(resolveLid?.(rawRemoteJid)) ?? rawRemoteJid
  } else if (peerLid && isLidJid(peerLid)) {
    lidJid = peerLid
  }

  const senderJid = key.fromMe ? null : chatJid

  return { chatJid, rawRemoteJid, senderJid, lidJid }
}

/** Unwraps ephemeral / view-once / device-sent / caption wrappers. */
export function unwrapMessage(
  message: proto.IMessage | null | undefined,
): { content: proto.IMessage | null; viewOnce: boolean } {
  let current = message ?? null
  let viewOnce = false
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message
      continue
    }
    if (current.viewOnceMessage?.message) {
      viewOnce = true
      current = current.viewOnceMessage.message
      continue
    }
    if (current.viewOnceMessageV2?.message) {
      viewOnce = true
      current = current.viewOnceMessageV2.message
      continue
    }
    if (current.viewOnceMessageV2Extension?.message) {
      viewOnce = true
      current = current.viewOnceMessageV2Extension.message
      continue
    }
    if (current.documentWithCaptionMessage?.message) {
      current = current.documentWithCaptionMessage.message
      continue
    }
    if (current.deviceSentMessage?.message) {
      current = current.deviceSentMessage.message
      continue
    }
    if (current.editedMessage?.message) {
      current = current.editedMessage.message
      continue
    }
    break
  }
  return { content: current, viewOnce }
}

export function isLidJid(jid?: string | null) {
  return Boolean(jid && jid.endsWith('@lid'))
}

/**
 * JIDs we truly never want to store.
 *
 * IMPORTANT: `@lid` (Linked ID) JIDs must NOT be dropped — WhatsApp now serves
 * most 1:1 chats through LID addresses, so dropping them makes the whole panel
 * look empty. They are resolved to their phone-number JID (`@s.whatsapp.net`)
 * via `key.senderPn` / `key.participantPn` / the learned lid→pn map instead.
 */
export function isIgnoredJid(jid?: string | null) {
  if (!jid) return true
  return (
    jid === 'status@broadcast' ||
    jid.endsWith('@broadcast') ||
    jid.endsWith('@newsletter') ||
    jid.endsWith('@bot')
  )
}

/** 12345@lid -> 12345 */
export function lidUser(jid: string) {
  return jid.split('@')[0].split(':')[0]
}

type Long = { toString(): string; toNumber?: () => number; low?: number; high?: number }

/** Tolerates number | Long | bigint | string coming from protobuf decoding. */
function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return Number(value)
  const candidate = value as Long
  if (typeof candidate.toNumber === 'function') {
    const num = candidate.toNumber()
    return Number.isFinite(num) ? num : null
  }
  const num = Number(candidate.toString())
  return Number.isFinite(num) ? num : null
}

function secondsToNumber(value: number | Long | null | undefined): number | null {
  const num = toNumberOrNull(value)
  return num === null ? null : Math.round(num)
}

/**
 * messageTimestamp can be a plain number (live socket) or a protobuf Long
 * (history sync / app state). Never let it become an Invalid Date, otherwise
 * the insert fails and the message silently disappears.
 */
function safeTimestamp(value: unknown): Date {
  const seconds = toNumberOrNull(value)
  if (!seconds) return new Date()
  const ms = seconds > 1e12 ? seconds : seconds * 1000
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

/** Turns a raw Baileys message into our own serialisable model. */
export function parseWaMessage(
  raw: proto.IWebMessageInfo,
  resolveLid?: LidResolver,
): ParsedMessage | null {
  const key = raw.key
  if (!key) return null

  const resolved = resolveMessageJids(key as MessageKeyLike, resolveLid)
  if (!resolved) return null

  const fromMe = Boolean(key.fromMe)
  const { content, viewOnce } = unwrapMessage(raw.message)

  const base: Omit<
    ParsedMessage,
    'type' | 'text' | 'needsDownload' | 'viewOnce' | 'mediaNode' | 'quoted' | 'extra'
  > = {
    waMessageId: key.id as string,
    fromMe,
    chatJid: resolved.chatJid,
    rawRemoteJid: resolved.rawRemoteJid,
    senderJid: resolved.senderJid,
    senderName: raw.pushName ?? null,
    lidJid: resolved.lidJid,
    mediaMime: null,
    mediaName: null,
    mediaSize: null,
    mediaDuration: null,
    timestamp: safeTimestamp(raw.messageTimestamp),
  }

  if (!content) return null

  const contentType = getContentType(content)
  if (!contentType) return null

  const quoted = quotedPreview(content)

  const withMeta = (parsed: {
    type: ParsedMessage['type']
    text?: string | null
    mediaMime?: string | null
    mediaName?: string | null
    mediaSize?: number | null
    mediaDuration?: number | null
    extra?: MessageExtra | null
  }): ParsedMessage => ({
    ...base,
    type: parsed.type,
    extra: parsed.extra ?? null,
    text: parsed.text ?? null,
    mediaMime: parsed.mediaMime ?? null,
    mediaName: parsed.mediaName ?? null,
    mediaSize: parsed.mediaSize ?? null,
    mediaDuration: parsed.mediaDuration ?? null,
    // Any media type (including view-once photos/videos) can and should be fetched.
    needsDownload: parsed.type !== 'text' && parsed.type !== 'other' && parsed.type !== 'document'
      ? true
      : parsed.type === 'document',
    viewOnce,
    mediaNode: serializeMediaNode(content),
    quoted,
  })

  switch (contentType) {
    case 'conversation':
      return withMeta({ type: 'text', text: content.conversation ?? '' })

    case 'extendedTextMessage':
      return withMeta({
        type: 'text',
        text: content.extendedTextMessage?.text ?? '',
      })

    case 'imageMessage':
      return withMeta({
        type: 'image',
        text: content.imageMessage?.caption ?? null,
        mediaMime: content.imageMessage?.mimetype ?? 'image/jpeg',
        mediaSize: content.imageMessage?.fileLength ? Number(content.imageMessage.fileLength.toString()) : null,
      })

    case 'videoMessage':
      return withMeta({
        type: 'video',
        text: content.videoMessage?.caption ?? null,
        mediaMime: content.videoMessage?.mimetype ?? 'video/mp4',
        mediaSize: content.videoMessage?.fileLength ? Number(content.videoMessage.fileLength.toString()) : null,
        mediaDuration: secondsToNumber(content.videoMessage?.seconds),
        extra: content.videoMessage?.gifPlayback
          ? { gifPlayback: true, rawType: 'videoMessage(gif)' }
          : null,
      })

    case 'audioMessage':
      return withMeta({
        type: 'audio',
        text: null,
        mediaMime: content.audioMessage?.mimetype ?? 'audio/ogg',
        mediaSize: content.audioMessage?.fileLength ? Number(content.audioMessage.fileLength.toString()) : null,
        mediaDuration: secondsToNumber(content.audioMessage?.seconds),
      })

    case 'documentMessage':
      return withMeta({
        type: 'document',
        text: content.documentMessage?.caption ?? null,
        mediaMime: content.documentMessage?.mimetype ?? 'application/octet-stream',
        mediaName: content.documentMessage?.fileName ?? null,
        mediaSize: content.documentMessage?.fileLength ? Number(content.documentMessage.fileLength.toString()) : null,
      })

    case 'stickerMessage':
      return withMeta({
        type: 'sticker',
        text: null,
        mediaMime: content.stickerMessage?.mimetype ?? 'image/webp',
      })

    // "video note" — lingkaran kecil seperti voice note tapi video
    case 'ptvMessage':
      return withMeta({
        type: 'video',
        text: content.ptvMessage?.caption ?? null,
        mediaMime: content.ptvMessage?.mimetype ?? 'video/mp4',
        mediaDuration: secondsToNumber(content.ptvMessage?.seconds),
        extra: { ptv: true, rawType: 'ptvMessage' },
      })

    case 'pollCreationMessage':
    case 'pollCreationMessageV2':
    case 'pollCreationMessageV3': {
      const poll = (content as Record<string, unknown>)[contentType] as
        | { name?: string; options?: Array<{ optionName?: string }>; selectableOptionsCount?: number }
        | undefined
      const options = (poll?.options ?? []).map((option) => option?.optionName ?? '').filter(Boolean)
      const name = poll?.name ?? 'Polling'
      return withMeta({
        type: 'other',
        text: [
          `📊 ${name}`,
          ...options.map((option, index) => `   ${index + 1}. ${option}`),
        ].join('\n'),
        extra: {
          poll: { name, options, selectableCount: poll?.selectableOptionsCount ?? null },
          rawType: contentType,
        },
      })
    }

    case 'eventMessage': {
      const event = content.eventMessage
      return withMeta({
        type: 'other',
        text: `📅 ${event?.name ?? 'Acara'}${event?.description ? ` — ${event.description}` : ''}`,
        extra: {
          event: {
            name: event?.name ?? null,
            startTime: toNumberOrNull(event?.startTime),
          },
          rawType: 'eventMessage',
        },
      })
    }

    case 'productMessage': {
      const product = content.productMessage?.product
      return withMeta({
        type: 'other',
        text: `🛍️ ${product?.title ?? 'Produk'}${product?.description ? ` — ${product.description}` : ''}`,
        extra: {
          product: { title: product?.title ?? null, description: product?.description ?? null },
          rawType: 'productMessage',
        },
      })
    }

    case 'contactsArrayMessage': {
      const contacts = content.contactsArrayMessage?.contacts ?? []
      const names = contacts.map((contact) => contact.displayName ?? 'Tanpa nama').join(', ')
      return withMeta({
        type: 'other',
        text: `👥 ${contacts.length} kontak: ${names}`,
        extra: { contact: { displayName: names }, rawType: 'contactsArrayMessage' },
      })
    }

    case 'locationMessage': {
      const loc = content.locationMessage
      const lat = loc?.degreesLatitude ?? null
      const lng = loc?.degreesLongitude ?? null
      const mapsUrl = lat !== null && lng !== null ? `https://maps.google.com/?q=${lat},${lng}` : ''
      return withMeta({
        type: 'other',
        text: `📍 ${loc?.name || loc?.address || 'Lokasi'}${lat !== null ? ` (${lat.toFixed(4)}, ${lng?.toFixed(4)})` : ''}`,
        extra:
          lat !== null && lng !== null
            ? { location: { lat, lng, name: loc?.name ?? loc?.address ?? null, mapsUrl }, rawType: 'locationMessage' }
            : { rawType: 'locationMessage' },
      })
    }

    case 'liveLocationMessage': {
      const loc = content.liveLocationMessage
      const lat = loc?.degreesLatitude ?? null
      const lng = loc?.degreesLongitude ?? null
      return withMeta({
        type: 'other',
        text: `📍 Lokasi live${lat !== null ? ` (${lat.toFixed(4)}, ${lng?.toFixed(4)})` : ''}`,
        extra:
          lat !== null && lng !== null
            ? { location: { lat, lng, name: 'Lokasi live', mapsUrl: `https://maps.google.com/?q=${lat},${lng}` }, rawType: 'liveLocationMessage' }
            : { rawType: 'liveLocationMessage' },
      })
    }

    case 'contactMessage': {
      const contact = content.contactMessage
      const phone = extractVcardPhone(contact?.vcard ?? null)
      return withMeta({
        type: 'other',
        text: `👤 Kontak: ${contact?.displayName ?? 'tanpa nama'}${phone ? ` (${phone})` : ''}`,
        extra: { contact: { displayName: contact?.displayName ?? null, phone }, rawType: 'contactMessage' },
      })
    }

    case 'buttonsResponseMessage':
      return withMeta({
        type: 'text',
        text: content.buttonsResponseMessage?.selectedDisplayText ?? '[button reply]',
      })

    case 'listResponseMessage':
      return withMeta({
        type: 'text',
        text: content.listResponseMessage?.title ?? '[list reply]',
      })

    case 'templateButtonReplyMessage':
      return withMeta({
        type: 'text',
        text: content.templateButtonReplyMessage?.selectedDisplayText ?? '[template reply]',
      })

    case 'protocolMessage':
    case 'reactionMessage':
    case 'senderKeyDistributionMessage':
    case 'messageContextInfo':
      return null

    default:
      return withMeta({
        type: 'other',
        text: `[${contentType}]`,
        extra: { rawType: contentType },
      })
  }
}

/* ------------------------------------------------------------------ */
/* Interactions: quotes, reactions, revokes                            */
/* ------------------------------------------------------------------ */

/** Short human preview of a quoted message (used in contextInfo + our UI). */
export function quotedPreview(node: proto.IMessage | null | undefined): QuotedInfo | null {
  const { content } = unwrapMessage(node)
  if (!content) return null

  const ctx = content.extendedTextMessage?.contextInfo ?? content.imageMessage?.contextInfo ?? null
  const stanzaId = ctx?.stanzaId
  if (!stanzaId) return null

  const quotedContent = ctx?.quotedMessage ?? null
  const quotedType = quotedContent ? getContentType(quotedContent) : null
  const type = (quotedType?.replace('Message', '') ?? 'text') as MessageType
  const map: Record<string, MessageType> = {
    conversation: 'text',
    extendedText: 'text',
    image: 'image',
    video: 'video',
    audio: 'audio',
    document: 'document',
    sticker: 'sticker',
  }
  const normalized = map[type] ?? 'other'

  const text =
    quotedContent?.conversation ??
    quotedContent?.extendedTextMessage?.text ??
    quotedContent?.imageMessage?.caption ??
    quotedContent?.videoMessage?.caption ??
    quotedContent?.documentMessage?.caption ??
    previewFor(normalized, null)

  return {
    id: stanzaId,
    text: (text ?? '').slice(0, 300),
    type: normalized,
    fromMe: Boolean(ctx?.participant && ctx.participant === ctx.remoteJid),
    participantJid: ctx?.participant ?? null,
  }
}

export interface ReactionInfo {
  targetWaMessageId: string
  emoji: string
  senderJid: string | null
  chatJid: string
}

/** Extracts a reaction (emoji empty string = reaction removed). */
export function parseReaction(raw: proto.IWebMessageInfo): ReactionInfo | null {
  const reaction = raw.message?.reactionMessage
  const targetId = reaction?.key?.id
  if (!reaction || !targetId) return null
  const remoteJid = raw.key?.remoteJid
  if (!remoteJid || isIgnoredJid(remoteJid)) return null

  return {
    targetWaMessageId: targetId,
    emoji: (reaction.text ?? '').toString(),
    senderJid: raw.key?.participant ?? raw.key?.remoteJid ?? null,
    chatJid: remoteJid,
  }
}

/** "delete for everyone" revoke: protocolMessage type REVOKE (0). */
export function parseRevoke(raw: proto.IWebMessageInfo): { targetWaMessageId: string; chatJid: string } | null {
  const protocol = raw.message?.protocolMessage
  const type = protocol?.type
  const targetId = protocol?.key?.id
  if (!protocol || !targetId) return null
  // proto.Message.ProtocolMessage.Type.REVOKE === 0
  if (Number(type ?? -1) !== 0) return null
  const remoteJid = raw.key?.remoteJid
  if (!remoteJid || isIgnoredJid(remoteJid)) return null
  return { targetWaMessageId: targetId, chatJid: remoteJid }
}

/**
 * WhatsApp delivers edits through `messages.update`:
 *   { key: { id: <original id> }, update: { message: { editedMessage: { message: <new content> } } } }
 * Returns the new text/content so we can update the stored row instead of
 * creating a duplicate message.
 */
export function parseEditedMessage(update: unknown): proto.IMessage | null {
  const message = (update as { message?: { editedMessage?: { message?: proto.IMessage } } })?.message
  const content = message?.editedMessage?.message
  return content ?? null
}

/** Serialise the unwrapped media node so it can be downloaded later. */
export function serializeMediaNode(node: proto.IMessage | null | undefined): string | null {
  const { content } = unwrapMessage(node)
  if (!content) return null
  const contentType = getContentType(content)
  if (!contentType || !contentType.endsWith('Message')) return null
  const media = (content as Record<string, unknown>)[contentType]
  if (!media || typeof media !== 'object') return null
  try {
    return JSON.stringify({ [contentType]: media }, BufferJSON.replacer)
  } catch {
    return null
  }
}

/** Rebuild a WAMessage stub from a stored media node for re-downloading. */
export function rebuildMediaMessage(
  serializedNode: string,
  key: { id: string; remoteJid: string; fromMe: boolean },
): proto.IWebMessageInfo | null {
  try {
    const message = JSON.parse(serializedNode, BufferJSON.reviver) as proto.IMessage
    return {
      key: { id: key.id, remoteJid: key.remoteJid, fromMe: key.fromMe },
      message,
    }
  } catch {
    return null
  }
}

export function waStatusToDb(status?: number | string | null): MessageStatus | null {
  const value = typeof status === 'string' ? Number(status) : status
  switch (value) {
    case 1:
      return 'pending'
    case 2:
      return 'sent'
    case 3:
      return 'delivered'
    case 4:
    case 5:
      return 'read'
    default:
      return null
  }
}
