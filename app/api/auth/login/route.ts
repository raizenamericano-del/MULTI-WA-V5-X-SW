import { z } from 'zod'
import { NextResponse } from 'next/server'
import { fail } from '@/lib/api'
import {
  authEnabled,
  authUsername,
  checkCredentials,
  clearLoginAttempts,
  createSessionToken,
  loginRateLimit,
  registerFailedLogin,
  sessionCookieOptions,
  sessionMaxAgeSeconds,
} from '@/lib/auth'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const schema = z.object({
  username: z.string().trim().max(60).optional(),
  password: z.string().min(1, 'Password wajib diisi').max(200),
  remember: z.boolean().optional(),
})

/** POST /api/auth/login — publik (tidak dijaga middleware). */
export async function POST(request: Request) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'

  if (!authEnabled()) {
    return fail('Login belum diaktifkan. Set AUTH_PASSWORD pada environment variables.', 409)
  }

  const limit = loginRateLimit(ip)
  if (!limit.allowed) {
    return fail(
      `Terlalu banyak percobaan login. Coba lagi dalam ${Math.ceil(limit.retryInSeconds / 60)} menit.`,
      429,
    )
  }

  let body: z.infer<typeof schema>
  try {
    body = schema.parse(await request.json())
  } catch {
    return fail('Format permintaan tidak valid', 422)
  }

  const ok = checkCredentials(body.username ?? authUsername(), body.password)
  if (!ok) {
    registerFailedLogin(ip)
    logger.warn({ ip }, 'login gagal')
    return fail('Username atau password salah', 401)
  }

  clearLoginAttempts(ip)

  const maxAge = body.remember ? 30 * 86_400 : sessionMaxAgeSeconds()
  const token = await createSessionToken(maxAge)
  const response = NextResponse.json({ ok: true, username: authUsername(), expiresInSeconds: maxAge })
  response.cookies.set({ ...sessionCookieOptions(maxAge), value: token })
  logger.info({ ip }, 'login berhasil')
  return response
}
