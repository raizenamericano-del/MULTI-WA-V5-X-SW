import { z } from 'zod'
import { fail, handle, ok } from '@/lib/api'
import { sessionManager } from '@/lib/baileys/session-manager'

export const dynamic = 'force-dynamic'

const schema = z.object({ chatId: z.string().min(1) })

/** POST /api/messages/:messageId/forward — teruskan pesan ke chat lain. */
export async function POST(request: Request, { params }: { params: { messageId: string } }) {
  return handle(async () => {
    const body = schema.safeParse(await request.json().catch(() => null))
    if (!body.success) return fail('Chat tujuan wajib diisi', 422)

    const message = await sessionManager.getMessage(params.messageId)
    if (!message) return fail('Pesan tidak ditemukan', 404)

    const result = await sessionManager.forwardMessage(message.sessionId, message.id, body.data.chatId)
    return ok({ message: result.message, chat: result.chat, targetChatName: result.targetChatName })
  })
}
