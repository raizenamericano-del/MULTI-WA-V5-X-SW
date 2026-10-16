import { handle, ok } from '@/lib/api'
import { getPushDiagnostics } from '@/lib/push'

export const dynamic = 'force-dynamic'

/** GET /api/push/status — diagnostik notifikasi: kunci VAPID, perangkat, percobaan terakhir. */
export async function GET() {
  return handle(async () => {
    const diagnostics = await getPushDiagnostics()
    return ok({ diagnostics })
  })
}
