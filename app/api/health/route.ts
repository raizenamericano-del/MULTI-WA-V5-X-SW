import { handle, ok } from '@/lib/api'
import { authEnabled } from '@/lib/auth'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  let database = 'unknown'
  try {
    await prisma.$queryRaw`SELECT 1`
    database = 'up'
  } catch {
    database = 'down'
  }

  return handle(async () => ok({
    status: 'ok',
    service: 'wa-multi-device-controller',
    database,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    node: process.version,
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev',
    authEnabled: authEnabled(),
  }), { public: true })
}
