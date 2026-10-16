import { z } from 'zod'
import { fail, handle, ok } from '@/lib/api'
import { sessionManager } from '@/lib/baileys/session-manager'

export const dynamic = 'force-dynamic'

const schema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  matchType: z.enum(['contains', 'exact', 'startsWith', 'regex']).optional(),
  pattern: z.string().trim().min(1).max(300).optional(),
  reply: z.string().trim().min(1).max(4000).optional(),
  enabled: z.boolean().optional(),
  applyToGroups: z.boolean().optional(),
  cooldownSeconds: z.number().int().min(0).max(86400).optional(),
})

/** PATCH /api/autoreply/:ruleId — ubah / aktifkan / matikan aturan. */
export async function PATCH(request: Request, { params }: { params: { ruleId: string } }) {
  return handle(async () => {
    const body = schema.safeParse(await request.json().catch(() => null))
    if (!body.success) return fail('Data aturan tidak valid', 422)

    try {
      const rule = await sessionManager.updateAutoReply(params.ruleId, body.data)
      return ok({ rule })
    } catch {
      return fail('Aturan tidak ditemukan', 404)
    }
  })
}

/** DELETE /api/autoreply/:ruleId */
export async function DELETE(_request: Request, { params }: { params: { ruleId: string } }) {
  return handle(async () => {
    try {
      await sessionManager.deleteAutoReply(params.ruleId)
      return ok({ ok: true })
    } catch {
      return fail('Aturan tidak ditemukan', 404)
    }
  })
}
