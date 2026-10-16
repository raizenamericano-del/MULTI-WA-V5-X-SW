import { handle, ok } from '@/lib/api'
import { sessionManager } from '@/lib/baileys/session-manager'

export const dynamic = 'force-dynamic'

/** DELETE /api/contacts/:contactId — hapus kontak dari buku kontak panel. */
export async function DELETE(_request: Request, { params }: { params: { contactId: string } }) {
  return handle(async () => {
    const removed = await sessionManager.deleteContact(params.contactId)
    return ok({ ok: true, removed })
  })
}
