import crypto from 'node:crypto'
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { APP_VERSION } from '@/lib/branding'

/**
 * Webhook keluar: setiap pesan masuk (dan opsional balasan otomatis) dikirim
 * sebagai JSON POST ke URL pilihanmu — enak untuk disambungkan ke bot,
 * spreadsheet, CRM, atau n8n/Make.
 *
 * Keamanan: setiap permintaan ditandatangani HMAC-SHA256 atas body mentah,
 * dikirim di header `x-wa-signature: sha256=<hex>` (pakai `webhookSecret`).
 */

export type WebhookEvent = 'message' | 'autoreply'

export interface WebhookResult {
  ok: boolean
  status: number | null
  error: string | null
}

async function postOnce(url: string, body: string, secret: string | null, event: WebhookEvent, attempt: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': `wa-controller/${APP_VERSION}`,
    'x-wa-event': event,
    'x-wa-attempt': String(attempt),
  }
  if (secret) {
    headers['x-wa-signature'] = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`
  }

  try {
    const response = await fetch(url, { method: 'POST', headers, body, signal: controller.signal })
    return { ok: response.ok, status: response.status, error: response.ok ? null : `HTTP ${response.status}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, status: null, error: message }
  } finally {
    clearTimeout(timer)
  }
}

/** Kirim event ke webhook sebuah sesi (kalau aktif). Mengembalikan hasilnya. */
export async function dispatchWebhook(
  sessionId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<WebhookResult> {
  const session = await prisma.waSession.findUnique({
    where: { id: sessionId },
    select: { webhookEnabled: true, webhookUrl: true, webhookSecret: true, webhookEvents: true },
  })

  if (!session?.webhookEnabled || !session.webhookUrl) {
    return { ok: false, status: null, error: 'webhook tidak aktif' }
  }

  const events = session.webhookEvents?.split(',').map((value) => value.trim()) ?? ['message']
  if (!events.includes(event)) {
    return { ok: false, status: null, error: `event ${event} tidak diaktifkan` }
  }

  const body = JSON.stringify({
    event,
    at: new Date().toISOString(),
    sessionId,
    ...payload,
  })

  let result = await postOnce(session.webhookUrl, body, session.webhookSecret, event, 1)
  if (!result.ok) {
    // satu kali percobaan ulang singkat (server penerima sering baru bangun)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    result = await postOnce(session.webhookUrl, body, session.webhookSecret, event, 2)
  }

  await prisma.waSession
    .update({
      where: { id: sessionId },
      data: {
        lastWebhookAt: new Date(),
        lastWebhookStatus: result.ok ? `ok ${result.status}` : `gagal: ${result.error ?? 'tidak diketahui'}`,
      },
    })
    .catch(() => undefined)

  if (!result.ok) logger.warn({ sessionId, ...result }, 'webhook gagal dikirim')
  return result
}
