import { z } from 'zod'
import { fail, handle, ok } from '@/lib/api'
import { sessionManager } from '@/lib/baileys/session-manager'

export const dynamic = 'force-dynamic'

const schema = z.object({
  enabled: z.boolean().optional(),
  url: z.string().url('URL webhook tidak valid').nullable().optional(),
  secret: z.string().max(200).nullable().optional(),
  events: z.array(z.enum(['message', 'autoreply'])).optional(),
})

/** GET /api/sessions/:id/webhook — konfigurasi webhook + status terakhir. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const config = await sessionManager.getWebhookConfig(params.id)
    if (!config) return fail('Sesi tidak ditemukan', 404)
    return ok({ webhook: config })
  })
}

/** PATCH /api/sessions/:id/webhook — ubah konfigurasi webhook. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const body = schema.safeParse(await request.json().catch(() => null))
    if (!body.success) return fail(body.error.issues[0]?.message ?? 'Data webhook tidak valid', 422)

    const config = await sessionManager.updateWebhookConfig(params.id, body.data)
    if (!config) return fail('Sesi tidak ditemukan', 404)
    return ok({ webhook: config })
  })
}
