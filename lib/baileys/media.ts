import fs from 'node:fs/promises'
import path from 'node:path'
import {
  downloadMediaMessage,
  type proto,
  type WASocket,
} from '@whiskeysockets/baileys'
import { baileysLogger, logger } from '@/lib/logger'
import { MEDIA_ROOT, ensureDir, guessExtension, sanitizeSegment, sessionMediaDir } from './paths'

const MAX_MEDIA_BYTES = Number(process.env.WA_MAX_MEDIA_MB ?? 64) * 1024 * 1024

export interface StoredMedia {
  mediaPath: string | null
  mediaSize: number | null
  /** Human readable reason when the download did not succeed. */
  error: string | null
}

/**
 * Downloads an incoming media message and stores it under
 * data/media/<sessionId>/<messageId>.<ext>.
 *
 * Returns the path *relative* to MEDIA_ROOT (that is what we persist in the
 * database) plus a diagnostic message when it failed — the panel shows that
 * reason so you always know whether WhatsApp simply has not shared the file.
 */
export async function storeIncomingMedia(
  sessionId: string,
  sock: WASocket,
  rawMessage: proto.IWebMessageInfo,
  mime: string | null | undefined,
  fileName?: string | null,
): Promise<StoredMedia> {
  try {
    const buffer = (await downloadMediaMessage(
      rawMessage,
      'buffer',
      {},
      {
        logger: baileysLogger,
        reuploadRequest: sock.updateMediaMessage,
      },
    )) as Buffer

    if (buffer.length > MAX_MEDIA_BYTES) {
      logger.warn(
        { size: buffer.length, sessionId },
        'media larger than WA_MAX_MEDIA_MB — keeping metadata only',
      )
      return { mediaPath: null, mediaSize: buffer.length, error: 'Media terlalu besar untuk disimpan' }
    }

    if (!buffer.length) {
      return { mediaPath: null, mediaSize: 0, error: 'WhatsApp mengirim file kosong' }
    }

    const dir = await ensureDir(sessionMediaDir(sessionId))
    const id = sanitizeSegment(rawMessage.key?.id || `media-${Date.now()}`)
    const ext = guessExtension(mime, fileName)
    const absolute = path.join(dir, `${id}.${ext}`)

    await fs.writeFile(absolute, buffer)

    return {
      mediaPath: path.relative(MEDIA_ROOT, absolute),
      mediaSize: buffer.length,
      error: null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn({ sessionId, reason: message }, 'gagal mengunduh media')

    // Map the raw Baileys/network errors to something a human understands.
    let friendly = message
    if (/status code 404|410|not found|gone/i.test(message)) {
      friendly = 'Media sudah kedaluwarsa di server WhatsApp (URL tidak berlaku lagi)'
    } else if (/status code 403|forbidden/i.test(message)) {
      friendly = 'WhatsApp menolak akses ke media ini'
    } else if (/fetch|network|ENOTFOUND|ETIMEDOUT|socket hang up/i.test(message)) {
      friendly = 'Koneksi ke server media WhatsApp gagal/timeout'
    } else if (/decrypt|bad decrypt|Invalid/i.test(message)) {
      friendly = 'Gagal mendekripsi media (kunci tidak cocok)'
    } else if (/reupload/i.test(message)) {
      friendly = 'WhatsApp tidak mau mengirim ulang media ini (khas untuk pesan sekali lihat lama)'
    }

    return { mediaPath: null, mediaSize: null, error: friendly }
  }
}
