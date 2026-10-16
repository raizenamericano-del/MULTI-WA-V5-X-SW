import { NextResponse } from 'next/server'
import { SESSION_COOKIE, authEnabled, authUsername, verifySessionToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/status — publik.
 * Dipakai UI untuk tahu apakah panel memakai login dan apakah kita sudah masuk.
 */
export async function GET(request: Request) {
  const token = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.split('=')
    .slice(1)
    .join('=')

  const payload = await verifySessionToken(token ? decodeURIComponent(token) : null)

  return NextResponse.json({
    authEnabled: authEnabled(),
    authenticated: Boolean(payload),
    username: authEnabled() ? authUsername() : null,
  })
}
