import { z } from 'zod'
import { fail, handle, ok } from '@/lib/api'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const schema = z.object({ endpoint: z.string().min(1) })

/** POST /api/push/unsubscribe — matikan notifikasi untuk perangkat ini. */
export async function POST(request: Request) {
  return handle(async () => {
    const body = schema.safeParse(await request.json().catch(() => null))
    if (!body.success) return fail('Endpoint wajib diisi', 422)

    await prisma.pushSubscription.deleteMany({ where: { endpoint: body.data.endpoint } })
    return ok({ ok: true, subscriptions: await prisma.pushSubscription.count() })
  })
}
