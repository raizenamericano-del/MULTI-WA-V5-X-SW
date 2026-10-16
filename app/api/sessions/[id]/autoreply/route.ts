import { z } from 'zod'
import { fail, handle, ok } from '@/lib/api'
import { sessionManager } from '@/lib/baileys/session-manager'

export const dynamic = 'force-dynamic'

const schema = z.object({
  name: z.string().trim().min(1, 'Nama aturan wajib diisi').max(80),
  matchType: z.enum(['contains', 'exact', 'startsWith', 'regex']).default('contains'),
  pattern: z.string().trim().min(1, 'Kata kunci wajib diisi').max(300),
  reply: z.string().trim().min(1, 'Isi balasan wajib diisi').max(4000),
  enabled: z.boolean().optional(),
  applyToGroups: z.boolean().optional(),
  cooldownSeconds: z.number().int().min(0).max(86400).optional(),
})

/** GET /api/sessions/:id/autoreply — daftar aturan balasan otomatis. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const session = await sessionManager.getSession(params.id)
    if (!session) return fail('Sesi tidak ditemukan', 404)
    return ok({ rules: await sessionManager.listAutoReplies(params.id) })
  })
}

/** POST /api/sessions/:id/autoreply — buat aturan baru. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const session = await sessionManager.getSession(params.id)
    if (!session) return fail('Sesi tidak ditemukan', 404)

    const body = schema.safeParse(await request.json().catch(() => null))
    if (!body.success) return fail(body.error.issues[0]?.message ?? 'Data aturan tidak valid', 422)

    const rule = await sessionManager.createAutoReply(params.id, body.data)
    return ok({ rule }, { status: 201 })
  })
}
