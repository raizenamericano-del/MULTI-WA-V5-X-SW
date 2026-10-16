import { handle, ok } from '@/lib/api'
import prisma from '@/lib/prisma'
import { chatDisplayName } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface DayBucket {
  date: string
  incoming: number
  outgoing: number
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

/**
 * GET /api/analytics?days=14
 *
 * Ringkasan aktivitas panel: jumlah pesan per hari, chat teraktif, dan
 * statistik lain. Dihitung dari database (tanpa layanan eksternal).
 */
export async function GET(request: Request) {
  return handle(async () => {
    const url = new URL(request.url)
    const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 14), 3), 90)

    const from = new Date()
    from.setHours(0, 0, 0, 0)
    from.setDate(from.getDate() - (days - 1))

    // Batasi jumlah baris supaya tidak berat pada akun besar.
    const messages = await prisma.message.findMany({
      where: { timestamp: { gte: from } },
      select: {
        timestamp: true,
        fromMe: true,
        viewOnce: true,
        editedAt: true,
        deletedAt: true,
        mediaSize: true,
        mediaPath: true,
        chatId: true,
        sessionId: true,
        type: true,
      },
      orderBy: { timestamp: 'desc' },
      take: 50000,
    })

    const buckets = new Map<string, DayBucket>()
    for (let index = 0; index < days; index += 1) {
      const date = new Date(from)
      date.setDate(from.getDate() + index)
      buckets.set(dayKey(date), { date: dayKey(date), incoming: 0, outgoing: 0 })
    }

    const perChat = new Map<string, number>()
    const perSession = new Map<string, number>()
    let incoming = 0
    let outgoing = 0
    let viewOnce = 0
    let edited = 0
    let deleted = 0
    let mediaBytes = 0
    let mediaFiles = 0

    for (const message of messages) {
      const bucket = buckets.get(dayKey(message.timestamp))
      if (bucket) {
        if (message.fromMe) bucket.outgoing += 1
        else bucket.incoming += 1
      }
      if (message.fromMe) outgoing += 1
      else incoming += 1
      if (message.viewOnce) viewOnce += 1
      if (message.editedAt) edited += 1
      if (message.deletedAt) deleted += 1
      if (message.mediaPath) {
        mediaFiles += 1
        mediaBytes += message.mediaSize ?? 0
      }
      perChat.set(message.chatId, (perChat.get(message.chatId) ?? 0) + 1)
      perSession.set(message.sessionId, (perSession.get(message.sessionId) ?? 0) + 1)
    }

    const [chats, sessions, totals, rules, subscriptions] = await Promise.all([
      prisma.chat.findMany({
        where: { id: { in: [...perChat.keys()].slice(0, 500) } },
        select: { id: true, name: true, jid: true, isGroup: true, sessionId: true },
      }),
      prisma.waSession.findMany({ select: { id: true, name: true, phoneNumber: true, status: true } }),
      prisma.message.count(),
      prisma.autoReplyRule.count().catch(() => 0),
      prisma.pushSubscription.count().catch(() => 0),
    ])

    const chatLookup = new Map(chats.map((chat) => [chat.id, chat]))
    const sessionLookup = new Map(sessions.map((session) => [session.id, session]))

    const topChats = [...perChat.entries()]
      .map(([chatId, count]) => ({
        chatId,
        count,
        name: chatLookup.get(chatId)
          ? chatDisplayName({ name: chatLookup.get(chatId)!.name, jid: chatLookup.get(chatId)!.jid })
          : 'Tidak dikenal',
        isGroup: chatLookup.get(chatId)?.isGroup ?? false,
        sessionName: sessionLookup.get(chatLookup.get(chatId)?.sessionId ?? '')?.name ?? '-',
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    const perSessionList = [...perSession.entries()]
      .map(([sessionId, count]) => ({
        sessionId,
        count,
        name: sessionLookup.get(sessionId)?.name ?? 'Sesi terhapus',
        phoneNumber: sessionLookup.get(sessionId)?.phoneNumber ?? '-',
        status: sessionLookup.get(sessionId)?.status ?? 'unknown',
      }))
      .sort((a, b) => b.count - a.count)

    return ok({
      range: { days, from: from.toISOString(), to: new Date().toISOString() },
      totals: {
        messagesInRange: messages.length,
        messagesAllTime: totals,
        incoming,
        outgoing,
        chats: await prisma.chat.count(),
        sessions: sessions.length,
        mediaFiles,
        mediaBytes,
        viewOnce,
        edited,
        deleted,
        rules,
        subscriptions,
      },
      perDay: [...buckets.values()],
      topChats,
      perSession: perSessionList,
    })
  })
}
