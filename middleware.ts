import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, authEnabled, verifySessionToken } from '@/lib/auth'

/**
 * Gerbang pertama: halaman & API dijaga di sini.
 *
 * Pengecekan tanda tangan token yang sebenarnya dilakukan di:
 *   - lib/api.ts handle()  → semua route handler (runtime Node, env pasti ada)
 *   - lib/socket-server.ts → handshake Socket.io
 * Middleware ini jalan di Edge runtime, jadi ia melakukan pengecekan cepat:
 * kalau ada AUTH_PASSWORD (di-inject saat build) token diverifikasi penuh,
 * kalau tidak cukup memastikan cookie ada lalu diredirect ke /login.
 */

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/logout', '/api/auth/status', '/api/health', '/healthz']

function isPublic(pathname: string) {
  if (PUBLIC_PATHS.includes(pathname)) return true
  if (pathname.startsWith('/_next/')) return true
  if (pathname === '/icon.svg' || pathname === '/manifest.webmanifest' || pathname === '/robots.txt') return true
  if (pathname === '/favicon.ico') return true
  return false
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (!authEnabled()) return NextResponse.next()
  if (isPublic(pathname)) return NextResponse.next()

  const token = request.cookies.get(SESSION_COOKIE)?.value
  const payload = token ? await verifySessionToken(token) : null

  if (payload) return NextResponse.next()

  // Belum login → API dapat 401 (client akan redirect), halaman dapat redirect.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Silakan login terlebih dahulu' }, { status: 401 })
  }

  const loginUrl = new URL('/login', request.url)
  if (pathname !== '/') loginUrl.searchParams.set('next', `${pathname}${search}`)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
