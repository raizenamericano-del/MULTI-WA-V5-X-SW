import { handle, ok } from '@/lib/api'
import { sessionManager } from '@/lib/baileys/session-manager'

export const dynamic = 'force-dynamic'

/**
 * POST /api/sessions/:id/repair-lid
 * Memaksa pencarian nomor telepon asli untuk chat yang masih beralamat `@lid`,
 * lalu menggabungkannya ke chat bernomor. Berguna kalau daftar chat masih
 * menampilkan "Kontak WhatsApp (…1234)".
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const result = await sessionManager.repairLidChats(params.id)
    return ok({ result })
  })
}
