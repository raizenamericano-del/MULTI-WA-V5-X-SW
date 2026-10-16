import { handle, ok } from '@/lib/api'
import { sessionManager } from '@/lib/baileys/session-manager'

export const dynamic = 'force-dynamic'

/**
 * POST /api/sessions/:id/prune-chats
 * Hapus baris chat tanpa pesan (sisa sinkronisasi buku alamat / metadata chat).
 * Aman: chat dibuat ulang begitu ada pesan baru atau saat dibuka lagi.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const result = await sessionManager.pruneEmptyChats(params.id)
    return ok({ result })
  })
}
