import { fail, handle, ok } from '@/lib/api'
import { sessionManager } from '@/lib/baileys/session-manager'

export const dynamic = 'force-dynamic'

/**
 * GET /api/sessions/:id/debug
 *
 * Troubleshooting endpoint: shows whether the socket is really live, how many
 * raw events arrived, why individual messages were skipped, the learned
 * lid → phone number mappings and the current storage counters.
 *
 * Open it in a browser right after sending a test message from another phone.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const info = await sessionManager.getDebugInfo(params.id)
    if (!info) return fail('Session not found', 404)
    return ok(info)
  })
}
