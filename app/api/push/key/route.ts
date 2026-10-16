import { handle, ok } from '@/lib/api'
import { countSubscriptions, getVapidKeys } from '@/lib/push'

export const dynamic = 'force-dynamic'

/** GET /api/push/key — kunci publik VAPID + jumlah perangkat yang berlangganan. */
export async function GET() {
  return handle(async () => {
    const keys = await getVapidKeys()
    return ok({ publicKey: keys.publicKey, subscriptions: await countSubscriptions() })
  })
}
