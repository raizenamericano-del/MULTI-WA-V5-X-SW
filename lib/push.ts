import fs from 'node:fs/promises'
import path from 'node:path'
import webpush, { type PushSubscription as WebPushSubscription } from 'web-push'
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { MEDIA_ROOT, ensureDir } from './baileys/paths'
import { visibleDeviceIds } from '@/lib/presence'

/**
 * Web Push (PWA) — notifikasi yang tetap masuk walau panel ditutup.
 *
 * Kunci VAPID:
 *   - dibaca dari env `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` bila ada, atau
 *   - dibuat otomatis sekali lalu disimpan di `data/vapid.json` (ikut volume
 *     Railway) sehingga tidak perlu konfigurasi apa pun.
 *
 * `VAPID_SUBJECT` opsional (default mailto:…), sesuai spesifikasi Web Push.
 */

const VAPID_FILE = path.join(MEDIA_ROOT, '..', 'vapid.json')

export interface VapidKeys {
  publicKey: string
  privateKey: string
  /** true bila dibuat otomatis dan disimpan ke disk. */
  generated: boolean
}

let cached: VapidKeys | null = null

/**
 * Riwayat percobaan kirim + daftar perangkat, dipakai halaman /notifikasi untuk
 * menunjukkan *kenapa* sebuah notifikasi belum sampai.
 * Disimpan di globalThis agar bertahan walau route dibundel terpisah.
 */
export interface PushAttemptDevice {
  host: string
  ok: boolean
  statusCode?: number
  error?: string
}

export interface PushAttempt {
  at: string
  source: string
  title: string
  body: string
  devices: number
  sent: number
  failed: number
  removed: number
  /** Perangkat yang dilewati karena panelnya sedang dibuka (tidak perlu notifikasi). */
  skipped: number
  details: PushAttemptDevice[]
}

interface PushDiagStore {
  attempts: PushAttempt[]
}

const diag: PushDiagStore =
  (globalThis as unknown as { __waPushDiag?: PushDiagStore }).__waPushDiag ??
  ((globalThis as unknown as { __waPushDiag?: PushDiagStore }).__waPushDiag = { attempts: [] })

function recordAttempt(attempt: PushAttempt) {
  diag.attempts.unshift(attempt)
  if (diag.attempts.length > 12) diag.attempts.length = 12
}

function endpointHost(endpoint: string) {
  try {
    return new URL(endpoint).hostname
  } catch {
    return endpoint.slice(0, 40)
  }
}

export async function getVapidKeys(): Promise<VapidKeys> {
  if (cached) return cached

  const envPublic = process.env.VAPID_PUBLIC_KEY?.trim()
  const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim()
  if (envPublic && envPrivate) {
    cached = { publicKey: envPublic, privateKey: envPrivate, generated: false }
    return cached
  }

  try {
    const raw = await fs.readFile(VAPID_FILE, 'utf8')
    const parsed = JSON.parse(raw) as { publicKey?: string; privateKey?: string }
    if (parsed.publicKey && parsed.privateKey) {
      cached = { publicKey: parsed.publicKey, privateKey: parsed.privateKey, generated: true }
      return cached
    }
  } catch {
    /* belum ada — buat baru di bawah */
  }

  const generated = webpush.generateVAPIDKeys()
  cached = { publicKey: generated.publicKey, privateKey: generated.privateKey, generated: true }

  try {
    await ensureDir(path.dirname(VAPID_FILE))
    await fs.writeFile(VAPID_FILE, JSON.stringify(cached, null, 2), { mode: 0o600 })
    logger.info({ file: VAPID_FILE }, 'kunci VAPID dibuat otomatis (web push siap dipakai)')
  } catch (error) {
    logger.warn({ error }, 'gagal menyimpan kunci VAPID — notifikasi push akan berhenti setelah restart')
  }

  return cached
}

function configured() {
  const keys = cached
  if (!keys) return false
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@example.com',
    keys.publicKey,
    keys.privateKey,
  )
  return true
}

export interface PushPayload {
  title: string
  body: string
  /** Dibuka saat notifikasi diklik. */
  url?: string
  tag?: string
  chatId?: string
  sessionId?: string
  /** true = sekali lihat (ikon mata di notifikasi). */
  viewOnce?: boolean
}

export async function countSubscriptions() {
  return prisma.pushSubscription.count()
}

/**
 * Kirim notifikasi ke semua perangkat yang berlangganan.
 * Langganan yang sudah kedaluwarsa (404/410) langsung dibersihkan.
 */
export async function sendPushToAll(
  payload: PushPayload,
  options: { limit?: number; source?: string } = {},
) {
  const source = options.source ?? 'pesan'
  await getVapidKeys()

  const emptyAttempt = () => {
    recordAttempt({
      at: new Date().toISOString(),
      source,
      title: payload.title,
      body: payload.body,
      devices: 0,
      sent: 0,
      failed: 0,
      removed: 0,
      skipped: 0,
      details: [],
    })
    return {
      sent: 0,
      failed: 0,
      removed: 0,
      skipped: 0,
      devices: 0,
      details: [] as PushAttemptDevice[],
    }
  }

  if (!configured()) return emptyAttempt()

  const subscriptions = await prisma.pushSubscription.findMany({
    orderBy: { createdAt: 'desc' },
    take: options.limit ?? 50,
  })
  if (subscriptions.length === 0) return emptyAttempt()

  // Perangkat yang panelnya sedang DILIHAT tidak perlu notifikasi (sudah ada
  // toast + suara di halaman itu) — tapi perangkat LAIN tetap dikirimi.
  const visible = visibleDeviceIds()
  const targets = subscriptions.filter((row) => !row.deviceId || !visible.has(row.deviceId))
  const skipped = subscriptions.length - targets.length

  if (targets.length === 0) {
    recordAttempt({
      at: new Date().toISOString(),
      source,
      title: payload.title,
      body: payload.body,
      devices: subscriptions.length,
      sent: 0,
      failed: 0,
      removed: 0,
      skipped,
      details: [],
    })
    return {
      sent: 0,
      failed: 0,
      removed: 0,
      skipped,
      devices: subscriptions.length,
      details: [] as PushAttemptDevice[],
    }
  }

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? '/',
    tag: payload.tag ?? 'wa-controller',
    chatId: payload.chatId,
    sessionId: payload.sessionId,
    viewOnce: payload.viewOnce ?? false,
  })

  let sent = 0
  let failed = 0
  let removed = 0
  const details: PushAttemptDevice[] = []

  await Promise.all(
    targets.map(async (row) => {
      const target: WebPushSubscription = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      }
      try {
        await webpush.sendNotification(target, body, { TTL: 60 * 60 * 12 })
        sent += 1
        details.push({ host: endpointHost(row.endpoint), ok: true })
        await prisma.pushSubscription
          .update({ where: { id: row.id }, data: { lastSuccessAt: new Date(), lastError: null } })
          .catch(() => undefined)
      } catch (error) {
        failed += 1
        const status = (error as { statusCode?: number }).statusCode
        const message = error instanceof Error ? error.message : String(error)
        details.push({
          host: endpointHost(row.endpoint),
          ok: false,
          statusCode: status,
          error: message.slice(0, 200),
        })

        // 404/410 = langganan tidak berlaku lagi (app di-uninstall, izin dicabut).
        if (status === 404 || status === 410) {
          removed += 1
          await prisma.pushSubscription.delete({ where: { id: row.id } }).catch(() => undefined)
          return
        }

        await prisma.pushSubscription
          .update({ where: { id: row.id }, data: { lastError: message.slice(0, 300) } })
          .catch(() => undefined)
        logger.warn({ status, message }, 'gagal mengirim web push')
      }
    }),
  )

  recordAttempt({
    at: new Date().toISOString(),
    source,
    title: payload.title,
    body: payload.body,
    devices: subscriptions.length,
    sent,
    failed,
    removed,
    skipped,
    details,
  })

  return { sent, failed, removed, skipped, devices: subscriptions.length, details }
}

/** Ringkasan untuk halaman /notifikasi: kunci, perangkat, dan 12 percobaan terakhir. */
export async function getPushDiagnostics() {
  const keys = await getVapidKeys()
  const rows = await prisma.pushSubscription.findMany({ orderBy: { createdAt: 'desc' }, take: 20 })
  return {
    vapidSource: process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY ? 'env' : 'file',
    publicKeyPreview: `${keys.publicKey.slice(0, 10)}…${keys.publicKey.slice(-6)}`,
    subscriptionCount: rows.length,
    devices: rows.map((row) => ({
      id: row.id,
      deviceId: row.deviceId,
      host: endpointHost(row.endpoint),
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
      lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
      hasError: Boolean(row.lastError),
      lastError: row.lastError,
    })),
    recent: diag.attempts,
  }
}
