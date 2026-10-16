import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import { Readable } from 'node:stream'
import { handle } from '@/lib/api'
import { sessionManager } from '@/lib/baileys/session-manager'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function GET(request: Request, { params }: { params: { id: string; statusId: string } }) {
  return handle(async () => {
    const { item, file } = await sessionManager.statusMedia(params.id, params.statusId)
    const { size } = await fs.stat(file)
    let start = 0, end = size - 1
    const range = request.headers.get('range')
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
      if (!match[1]) start = Math.max(0, size - Number(match[2]))
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])) }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
        return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
      }
    }
    const headers: Record<string, string> = {
      'content-type': item.mime, 'content-length': String(end - start + 1),
      'cache-control': 'private, no-store', 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff',
    }
    if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`
    if (new URL(request.url).searchParams.get('download') === '1') {
      headers['content-disposition'] = `attachment; filename="SW-${item.id}.${item.type === 'image' ? 'jpg' : 'mp4'}"`
    }
    const stream = createReadStream(file, { start, end })
    request.signal.addEventListener('abort', () => stream.destroy(), { once: true })
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: range ? 206 : 200, headers })
  })
}
