import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AuthError, requireAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'

/** Every API route in this app is dynamic (they all touch the DB / Baileys). */
export const dynamic = 'force-dynamic'

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data as unknown as Record<string, unknown>, init)
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status })
}

/**
 * Wraps a route handler with auth + JSON error handling so the client always
 * receives `{ error: string }` instead of an HTML stack trace.
 *
 * Semua route dilindungi login kecuali yang ditandai `{ public: true }`.
 */
export async function handle(
  fn: () => Promise<Response>,
  options: { public?: boolean } = {},
): Promise<Response> {
  try {
    if (!options.public) await requireAuth()
    return await fn()
  } catch (error) {
    if (error instanceof AuthError) {
      return fail('Sesi login berakhir. Silakan masuk kembali.', 401)
    }
    if (error instanceof ZodError) {
      return fail(
        error.issues
          .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
          .join(', '),
        422,
      )
    }

    const message = error instanceof Error ? error.message : String(error)
    logger.error({ error }, 'api error')

    // Map the most common manager errors to meaningful HTTP codes so the UI can
    // show an actionable toast instead of a generic 500.
    if (/not found/i.test(message)) return fail(message, 404)
    if (/not running|offline|reconnect|no live socket/i.test(message)) return fail(message, 409)
    if (/only your own messages|invalid phone number|already registered|already exists/i.test(message)) {
      return fail(message, 422)
    }
    return fail(message, 500)
  }
}

export function parseBoolean(value: string | null | undefined) {
  if (value === null || value === undefined) return undefined
  return value === 'true' || value === '1'
}
