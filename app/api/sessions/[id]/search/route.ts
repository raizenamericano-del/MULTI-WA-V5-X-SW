import { fail, handle, ok } from '@/lib/api'
import { sessionManager } from '@/lib/baileys/session-manager'

export const dynamic = 'force-dynamic'

/** GET /api/sessions/:id/search?q=kata+kunci — cari di seluruh percakapan. */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const session = await sessionManager.getSession(params.id)
    if (!session) return fail('Sesi tidak ditemukan', 404)

    const url = new URL(request.url)
    const query = url.searchParams.get('q') ?? ''
    const limit = Number(url.searchParams.get('limit') ?? 60)
    // ?chatId= membatasi pencarian ke satu percakapan saja.
    const chatId = url.searchParams.get('chatId')
    const results = await sessionManager.searchMessages(params.id, query, limit, chatId)

    return ok({ query, total: results.length, results })
  })
}
