import { z } from 'zod'
import { handle, ok } from '@/lib/api'
import { sessionManager } from '@/lib/baileys/session-manager'

export const dynamic = 'force-dynamic'

/**
 * GET /api/sessions/:id/contacts?q=&limit=
 * Buku kontak hasil sinkronisasi WhatsApp + impor manual.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const url = new URL(request.url)
    const q = url.searchParams.get('q') ?? undefined
    const limit = Number(url.searchParams.get('limit') ?? 400)
    const result = await sessionManager.listContacts(params.id, { q, limit })
    return ok(result)
  })
}

const importSchema = z.object({
  /** Boleh array, boleh satu string berisi nomor dipisah baris/koma/spasi. */
  numbers: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
})

/**
 * POST /api/sessions/:id/contacts — impor nomor (diverifikasi ke WhatsApp).
 * Berguna kalau buku alamat belum sepenuhnya tersinkron.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const body = importSchema.parse(await request.json())
    const numbers = Array.isArray(body.numbers) ? body.numbers : [body.numbers]
    const result = await sessionManager.importContacts(params.id, numbers)
    return ok({ result })
  })
}
