import { fail, handle, ok } from '@/lib/api'
import { sessionManager } from '@/lib/baileys/session-manager'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/messages/:messageId?scope=everyone|me
 * everyone -> revoke on WhatsApp ("Delete for everyone")
 * me       -> remove it from this panel only
 */
export async function DELETE(request: Request, { params }: { params: { messageId: string } }) {
  return handle(async () => {
    const message = await prisma.message.findUnique({
      where: { id: params.messageId },
      select: { id: true, sessionId: true },
    })
    if (!message) return fail('Message not found', 404)

    const scope = new URL(request.url).searchParams.get('scope') === 'me' ? 'me' : 'everyone'
    const result = await sessionManager.deleteMessage(message.sessionId, message.id, scope)
    return ok(result)
  })
}
