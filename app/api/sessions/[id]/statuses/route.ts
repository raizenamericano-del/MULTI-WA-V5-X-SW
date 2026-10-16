import { handle, ok, fail } from '@/lib/api'
import { sessionManager } from '@/lib/baileys/session-manager'
import { statusStore } from '@/lib/baileys/status-store'
export const dynamic = 'force-dynamic'
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    if (!await sessionManager.getSession(params.id)) return fail('Session not found', 404)
    return ok({ statuses: await statusStore.list(params.id) }, { headers: { 'cache-control': 'private, no-store' } })
  })
}
