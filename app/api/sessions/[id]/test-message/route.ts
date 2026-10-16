import { fail, handle, ok } from '@/lib/api'
import { sessionManager } from '@/lib/baileys/session-manager'

export const dynamic = 'force-dynamic'

/**
 * POST /api/sessions/:id/test-message
 * Sends a message from the linked account to itself ("Message yourself").
 * If it appears in the panel, the socket + database + realtime pipeline are
 * all working — remaining issues can only be on the receiving side.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const session = await sessionManager.getSession(params.id)
    if (!session) return fail('Session not found', 404)
    if (!sessionManager.isLive(params.id)) {
      return fail('Socket is not running — tap Reconnect on the dashboard first', 409)
    }

    const result = await sessionManager.sendTestMessage(params.id)
    return ok({ sent: true, message: result.message, chat: result.chat })
  })
}
