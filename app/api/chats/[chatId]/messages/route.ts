import { z } from 'zod'
import { fail, handle, ok } from '@/lib/api'
import { sessionManager } from '@/lib/baileys/session-manager'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const MAX_UPLOAD_MB = Number(process.env.WA_MAX_UPLOAD_MB ?? 64)

/** GET /api/chats/:chatId/messages?limit=50&before=<ISO> */
export async function GET(request: Request, { params }: { params: { chatId: string } }) {
  return handle(async () => {
    const chat = await sessionManager.getChat(params.chatId)
    if (!chat) return fail('Chat not found', 404)

    const url = new URL(request.url)
    const limit = Number(url.searchParams.get('limit') ?? 50)
    const before = url.searchParams.get('before') ?? undefined
    const around = url.searchParams.get('around') ?? undefined
    const search = url.searchParams.get('search') ?? undefined

    const messages = await sessionManager.listMessages(chat.sessionId, chat.id, {
      limit,
      before,
      around,
      search,
    })
    return ok({ messages, chat, hasMore: messages.length >= Math.min(limit, 200) })
  })
}

const jsonSchema = z
  .object({
    text: z.string().trim().min(1, 'Pesan tidak boleh kosong').max(60000).optional(),
    /** Our internal id of the message being replied to. */
    quotedMessageId: z.string().optional(),
    /** Kirim lokasi: { lat, lng, name? } */
    location: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        name: z.string().max(200).optional(),
      })
      .optional(),
    /** Kirim kartu kontak: { displayName, phone } */
    contact: z
      .object({
        displayName: z.string().trim().max(120).optional(),
        phone: z.string().trim().min(5).max(30),
      })
      .optional(),
  })
  .refine((value) => Boolean(value.text || value.location || value.contact), {
    message: 'Kirim teks, lokasi, atau kontak',
  })

function kindFromMime(mime: string, requested?: string | null) {
  if (requested && ['image', 'video', 'audio', 'document'].includes(requested)) {
    return requested as 'image' | 'video' | 'audio' | 'document'
  }
  if (mime.startsWith('image/')) return 'image' as const
  if (mime.startsWith('video/')) return 'video' as const
  if (mime.startsWith('audio/')) return 'audio' as const
  return 'document' as const
}

/**
 * POST /api/chats/:chatId/messages
 *
 * Accepts either:
 *   - JSON  { "text": "hello" }                       (plain text message)
 *   - multipart/form-data with fields:
 *       file      (required)  the media
 *       kind      image | video | audio | document    (optional, inferred from mimetype)
 *       caption   string                              (optional)
 *       ptt       "true"                              (optional, voice note)
 */
export async function POST(request: Request, { params }: { params: { chatId: string } }) {
  return handle(async () => {
    const chat = await sessionManager.getChat(params.chatId)
    if (!chat) return fail('Chat not found', 404)

    const contentType = request.headers.get('content-type') ?? ''

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const file = form.get('file')
      if (!(file instanceof File)) {
        return fail('No file uploaded (field name must be "file")', 422)
      }
      if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
        return fail(`File too large. Maximum ${MAX_UPLOAD_MB} MB.`, 413)
      }

      const mime = file.type || 'application/octet-stream'
      const requestedKind = form.get('kind')?.toString() ?? null
      const kind = kindFromMime(mime, requestedKind)
      const caption = form.get('caption')?.toString() ?? null
      const ptt = form.get('ptt')?.toString() === 'true'
      const viewOnce = form.get('viewOnce')?.toString() === 'true'
      const quotedMessageId = form.get('quotedMessageId')?.toString() || null

      let buffer: Buffer = Buffer.from(await file.arrayBuffer())
      let mimetype = mime

      if (kind === 'audio' && ptt) {
        const prepared = await sessionManager.prepareVoiceNote(buffer, mime)
        buffer = prepared.buffer
        mimetype = prepared.mimetype
        const result = await sessionManager.sendMessage(chat.sessionId, chat.id, {
          kind: 'audio',
          buffer,
          mimetype,
          ptt: prepared.ptt,
          fileName: file.name || 'voice-note.ogg',
          quotedMessageId,
        })
        return ok({ message: result.message, chat: result.chat }, { status: 201 })
      }

      const result = await sessionManager.sendMessage(chat.sessionId, chat.id, {
        kind,
        buffer,
        mimetype,
        caption,
        fileName: file.name || undefined,
        ptt: false,
        quotedMessageId,
        // Only photos & videos can be sent as view-once.
        viewOnce: viewOnce && (kind === 'image' || kind === 'video'),
      })

      logger.info({ chatId: chat.id, kind, size: file.size }, 'media message sent')
      return ok({ message: result.message, chat: result.chat }, { status: 201 })
    }

    const body = jsonSchema.parse(await request.json())

    // Lokasi & kontak punya jalur sendiri (bukan media/teks biasa).
    const result = body.location
      ? await sessionManager.sendLocation(chat.sessionId, chat.id, {
          lat: body.location.lat,
          lng: body.location.lng,
          name: body.location.name ?? null,
        })
      : body.contact
        ? await sessionManager.sendContact(
            chat.sessionId,
            chat.id,
            body.contact.displayName?.trim() || body.contact.phone,
            body.contact.phone,
          )
        : await sessionManager.sendMessage(chat.sessionId, chat.id, {
            kind: 'text',
            text: body.text,
            quotedMessageId: body.quotedMessageId ?? null,
          })

    return ok({ message: result.message, chat: result.chat }, { status: 201 })
  })
}
