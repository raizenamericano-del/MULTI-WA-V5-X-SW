import { z } from 'zod'
import { fail, handle, ok } from '@/lib/api'
import prisma from '@/lib/prisma'
import { getVapidKeys } from '@/lib/push'

export const dynamic = 'force-dynamic'

const schema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  /** Identitas perangkat dari localStorage — dipakai untuk menahan push di perangkat yang panelnya sedang dibuka. */
  deviceId: z.string().max(80).optional(),
})

/** POST /api/push/subscribe — simpan langganan Web Push perangkat ini. */
export async function POST(request: Request) {
  return handle(async () => {
    const body = schema.safeParse(await request.json().catch(() => null))
    if (!body.success) return fail('Data langganan tidak valid', 422)

    await getVapidKeys() // pastikan kunci siap sebelum perangkat memakainya

    const { endpoint, keys, deviceId } = body.data
    const userAgent = request.headers.get('user-agent')?.slice(0, 300) ?? null
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: {
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent,
        deviceId: deviceId ?? null,
      },
      update: {
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent,
        deviceId: deviceId ?? null,
        lastError: null,
      },
    })

    return ok({ ok: true, subscriptions: await prisma.pushSubscription.count() })
  })
}
