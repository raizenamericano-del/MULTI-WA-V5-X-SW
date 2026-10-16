import { handle, ok } from '@/lib/api'
import { sessionManager } from '@/lib/baileys/session-manager'

export const dynamic = 'force-dynamic'

/** POST /api/sessions/:id/webhook/test — kirim event percobaan ke URL webhook. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const result = await sessionManager.testWebhook(params.id)
    return ok({ result })
  })
}
