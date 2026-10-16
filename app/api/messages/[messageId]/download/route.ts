import { fail, handle, ok } from '@/lib/api'
import { sessionManager } from '@/lib/baileys/session-manager'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * POST /api/messages/:messageId/download
 *
 * (Re)downloads the media of a stored message. Needed for view-once media and
 * for messages whose file WhatsApp only re-shares a few seconds later — the
 * panel stores the raw media node so it can always retry.
 */
export async function POST(_request: Request, { params }: { params: { messageId: string } }) {
  return handle(async () => {
    const message = await prisma.message.findUnique({
      where: { id: params.messageId },
      select: { id: true, sessionId: true, mediaPath: true, mediaNode: true, mediaStatus: true },
    })
    if (!message) return fail('Message not found', 404)

    if (message.mediaPath) {
      return ok({ alreadyDownloaded: true, messageId: message.id })
    }
    if (!message.mediaNode) {
      return fail('This message has no media attached', 422)
    }
    if (!sessionManager.isLive(message.sessionId)) {
      return fail('Session is offline — reconnect it first', 409)
    }

    const updated = await sessionManager.retryMediaDownload(message.sessionId, message.id)
    if (!updated?.mediaPath) {
      return fail('WhatsApp has not shared this media yet — try again in a moment', 425)
    }

    return ok({ downloaded: true, message: updated })
  })
}
