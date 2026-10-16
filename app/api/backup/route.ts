import { handle } from '@/lib/api'
import prisma from '@/lib/prisma'
import { APP_VERSION } from '@/lib/branding'

export const dynamic = 'force-dynamic'

/**
 * GET /api/backup?download=1
 *
 * Unduh seluruh data panel sebagai satu berkas JSON: sesi, chat, pesan
 * (metadata + lokasi berkas media), aturan balasan otomatis, dan jumlah
 * langganan notifikasi.
 *
 * Catatan: berkas media dan folder `data/auth` TIDAK ikut di dalam JSON ini —
 * keduanya berada di volume `/app/data` (lihat README bagian Backup).
 */
export async function GET(request: Request) {
  return handle(async () => {
    const [sessions, chats, messages, rules] = await Promise.all([
      prisma.waSession.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          name: true,
          phoneNumber: true,
          status: true,
          pushName: true,
          connectedAt: true,
          createdAt: true,
          webhookEnabled: true,
          webhookUrl: true,
          webhookEvents: true,
        },
      }),
      prisma.chat.findMany({ orderBy: { lastMessageAt: 'desc' } }),
      prisma.message.findMany({
        orderBy: { timestamp: 'asc' },
        select: {
          id: true,
          sessionId: true,
          chatId: true,
          waMessageId: true,
          fromMe: true,
          senderJid: true,
          senderName: true,
          type: true,
          text: true,
          mediaPath: true,
          mediaMime: true,
          mediaName: true,
          mediaSize: true,
          mediaDuration: true,
          status: true,
          timestamp: true,
          viewOnce: true,
          deletedAt: true,
          editedAt: true,
          extra: true,
          reactions: true,
        },
      }),
      prisma.autoReplyRule
        .findMany({ orderBy: { createdAt: 'asc' } })
        .catch(() => [] as unknown[]),
    ])

    const payload = {
      app: 'wa-multi-device-controller',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      counts: {
        sessions: sessions.length,
        chats: chats.length,
        messages: messages.length,
        rules: rules.length,
      },
      sessions,
      chats,
      messages,
      rules,
    }

    const download = new URL(request.url).searchParams.get('download') === '1'
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

    return new Response(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        ...(download
          ? { 'content-disposition': `attachment; filename="backup-wa-controller-${stamp}.json"` }
          : {}),
        'cache-control': 'no-store',
      },
    })
  })
}
