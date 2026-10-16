import { cookies } from 'next/headers'

/**
 * Autentikasi panel — sengaja tanpa dependency tambahan:
 * HMAC-SHA256 (Web Crypto, jalan di Node maupun Edge) + cookie HttpOnly.
 *
 * Diatur lewat environment variable:
 *   AUTH_PASSWORD  -> kalau diisi, panel WAJIB login. Kalau kosong, panel terbuka
 *                     (UI menampilkan peringatan merah sebagai pengingat).
 *   AUTH_USERNAME  -> default "admin".
 *   AUTH_SECRET    -> opsional; kalau kosong diturunkan dari AUTH_PASSWORD
 *                     (ganti password = semua sesi login otomatis logout).
 *   AUTH_SESSION_DAYS -> masa berlaku sesi, default 7 hari.
 */

export const SESSION_COOKIE = 'wa_panel_session'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class AuthError extends Error {
  constructor(message = 'Sesi login tidak valid atau sudah berakhir') {
    super(message)
    this.name = 'AuthError'
  }
}

/* ------------------------------- helpers ------------------------------- */

function base64UrlEncode(input: Uint8Array | string) {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(input: string) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Perbandingan konstan-waktu supaya tidak bisa ditebak dari timing. */
function safeEqual(a: string, b: string) {
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  if (left.length !== right.length) return false
  let diff = 0
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i]
  return diff === 0
}

function secret() {
  return process.env.AUTH_SECRET || `wa-controller::${process.env.AUTH_PASSWORD ?? 'open-panel'}`
}

async function sign(data: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return base64UrlEncode(new Uint8Array(signature))
}

/* ------------------------------ public API ----------------------------- */

export function authEnabled() {
  return Boolean(process.env.AUTH_PASSWORD)
}

export function authUsername() {
  return process.env.AUTH_USERNAME || 'admin'
}

export function sessionMaxAgeSeconds() {
  const days = Number(process.env.AUTH_SESSION_DAYS ?? 7)
  return Math.max(1, Number.isFinite(days) ? days : 7) * 86_400
}

export function checkCredentials(username: string, password: string) {
  if (!authEnabled()) return true
  const userOk = safeEqual(username.trim(), authUsername())
  const passOk = safeEqual(password, process.env.AUTH_PASSWORD as string)
  // Keduanya dievaluasi (tanpa short-circuit) supaya waktu respons seragam.
  return userOk && passOk
}

export interface SessionPayload {
  sub: string
  iat: number
  exp: number
}

export async function createSessionToken(maxAgeSeconds = sessionMaxAgeSeconds()) {
  const payload: SessionPayload = {
    sub: authUsername(),
    iat: Date.now(),
    exp: Date.now() + maxAgeSeconds * 1000,
  }
  const body = base64UrlEncode(JSON.stringify(payload))
  const signature = await sign(body)
  return `${body}.${signature}`
}

export async function verifySessionToken(token?: string | null): Promise<SessionPayload | null> {
  if (!token) return null
  if (!authEnabled()) return { sub: 'open', iat: Date.now(), exp: Date.now() + 86_400_000 }

  const [body, signature] = token.split('.')
  if (!body || !signature) return null

  const expected = await sign(body)
  if (!safeEqual(signature, expected)) return null

  try {
    const payload = JSON.parse(decoder.decode(base64UrlDecode(body))) as SessionPayload
    if (!payload?.exp || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

/** Ambil token dari header Cookie mentah (dipakai Socket.io handshake). */
export function tokenFromCookieHeader(header?: string | null) {
  if (!header) return null
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='))
  }
  return null
}

export function sessionCookieOptions(maxAge = sessionMaxAgeSeconds()) {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  }
}

/** Dipakai route handler/API: melempar AuthError kalau tidak punya akses. */
export async function requireAuth() {
  if (!authEnabled()) return { sub: 'open', iat: Date.now(), exp: Date.now() + 86_400_000 }
  const token = cookies().get(SESSION_COOKIE)?.value
  const payload = await verifySessionToken(token)
  if (!payload) throw new AuthError()
  return payload
}

/* --------------------------- rate limiting login ------------------------ */

const attempts = new Map<string, { count: number; first: number; blockedUntil: number }>()
const MAX_ATTEMPTS = 6
const WINDOW_MS = 5 * 60_000
const BLOCK_MS = 10 * 60_000

export function loginRateLimit(ip: string) {
  const now = Date.now()
  const entry = attempts.get(ip)

  if (entry?.blockedUntil && entry.blockedUntil > now) {
    return { allowed: false, retryInSeconds: Math.ceil((entry.blockedUntil - now) / 1000) }
  }

  if (!entry || now - entry.first > WINDOW_MS) {
    attempts.set(ip, { count: 0, first: now, blockedUntil: 0 })
    return { allowed: true, retryInSeconds: 0 }
  }

  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntil = now + BLOCK_MS
    return { allowed: false, retryInSeconds: Math.ceil(BLOCK_MS / 1000) }
  }

  return { allowed: true, retryInSeconds: 0 }
}

export function registerFailedLogin(ip: string) {
  const now = Date.now()
  const entry = attempts.get(ip)
  if (!entry || now - entry.first > WINDOW_MS) {
    attempts.set(ip, { count: 1, first: now, blockedUntil: 0 })
    return
  }
  entry.count += 1
  if (entry.count >= MAX_ATTEMPTS) entry.blockedUntil = now + BLOCK_MS
}

export function clearLoginAttempts(ip: string) {
  attempts.delete(ip)
}
