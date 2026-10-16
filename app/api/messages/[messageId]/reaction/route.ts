import { z } from 'zod'
import { fail, handle, ok } from '@/lib/api'
import { sessionManager } from '@/lib/baileys/session-manager'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const reactSchema = z.object({
  /** Empty string removes your reaction. */
  emoji: z.string().max(16),
})

/**
 * POST /api/messages/:messageId/reaction
 * Body: { "emoji": "❤️" }
 */
export async function POST(request: Request, { params }: { params: { messageId: string } }) {
  return handle(async () => {
    const message = await prisma.message.findUnique({
      where: { id: params.messageId },
      select: { id: true, sessionId: true },
    })
    if (!message) return fail('Message not found', 404)

    const body = reactSchema.parse(await request.json())
    const updated = await sessionManager.sendReaction(message.sessionId, message.id, body.emoji)
    return ok({ message: updated })
  })
}
