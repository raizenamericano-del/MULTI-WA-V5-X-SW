import fs from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { BufferJSON, downloadMediaMessage, type proto, type WASocket } from '@whiskeysockets/baileys'
import { DATA_DIR } from './paths'
import { baileysLogger } from '@/lib/logger'

const TTL = 24 * 60 * 60 * 1000
const LIMIT = 100
const MAX_BYTES = 64 * 1024 * 1024
const ROOT = path.join(DATA_DIR, 'statuses')
export interface StatusItem {
  id: string; sender: string; name: string; type: 'image' | 'video' | 'text'
  text: string; timestamp: number; expiresAt: number; mime: string
  thumbnail: string | null
}
interface RecordItem extends StatusItem { raw: proto.IWebMessageInfo }
function directory(session: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(session)) throw new Error('Invalid session')
  return path.join(ROOT, session)
}
function safeId(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Status not found')
  return id
}
export function parseStatus(raw: proto.IWebMessageInfo, now = Date.now()): Omit<RecordItem, 'id'> | null {
  if (raw.key?.remoteJid !== 'status@broadcast' || raw.key.fromMe || !raw.key.id || !raw.key.participant) return null
  const timestamp = Number(raw.messageTimestamp) * 1000
  if (!Number.isFinite(timestamp) || timestamp <= now - TTL || timestamp > now + 60000) return null
  let m = raw.message
  if (m?.ephemeralMessage?.message) m = m.ephemeralMessage.message
  if (!m || m.viewOnceMessage || m.viewOnceMessageV2 || m.viewOnceMessageV2Extension) return null
  const image = m.imageMessage, video = m.videoMessage
  const type = image ? 'image' : video ? 'video' : m.extendedTextMessage || m.conversation ? 'text' : null
  if (!type) return null
  const node = image || video
  const mime = type === 'image' ? 'image/jpeg' : type === 'video' ? 'video/mp4' : 'text/plain'
  // Only browser-safe, known media types; never serve remote HTML/SVG inline.
  if (node?.mimetype && node.mimetype.split(';')[0] !== mime) return null
  return {
    sender: raw.key.participant, name: (raw.pushName || raw.key.participant.split('@')[0]).slice(0, 120),
    type, text: (node?.caption || m.extendedTextMessage?.text || m.conversation || '').slice(0, 10000),
    timestamp, expiresAt: timestamp + TTL, mime,
    thumbnail: node?.jpegThumbnail && node.jpegThumbnail.length <= 100000
      ? `data:image/jpeg;base64,${Buffer.from(node.jpegThumbnail).toString('base64')}` : null,
    raw,
  }
}
type Downloader = (raw: proto.IWebMessageInfo, sock: WASocket) => Promise<Readable>
export class StatusStore {
  constructor(private download: Downloader = (raw, sock) => downloadMediaMessage(raw, 'stream', { options: { timeout: 60000 } }, {
    logger: baileysLogger, reuploadRequest: sock.updateMediaMessage,
  })) {}
  async cleanup() {
    let sessions: string[]
    try { sessions = await fs.readdir(ROOT) } catch { return }
    for (const session of sessions) {
      if (/^[a-zA-Z0-9_-]{1,128}$/.test(session)) await this.serial(session, () => this.records(session))
    }
  }
  private queues = new Map<string, Promise<unknown>>()
  private serial<T>(session: string, fn: () => Promise<T>): Promise<T> {
    const pending = (this.queues.get(session) || Promise.resolve()).catch(() => {}).then(fn)
    this.queues.set(session, pending)
    void pending.finally(() => { if (this.queues.get(session) === pending) this.queues.delete(session) }).catch(() => {})
    return pending
  }
  private async records(session: string): Promise<RecordItem[]> {
    const dir = directory(session)
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    const result: RecordItem[] = []
    for (const file of await fs.readdir(dir)) {
      if (!/^[0-9a-f-]{36}\.json$/.test(file)) continue
      const item = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'), BufferJSON.reviver) as RecordItem
      if (item.expiresAt <= Date.now()) {
        await fs.rm(path.join(dir, file), { force: true })
        await fs.rm(path.join(dir, `${item.id}.bin`), { force: true })
      } else result.push(item)
    }
    return result.sort((a, b) => b.timestamp - a.timestamp)
  }
  async ingest(session: string, raw: proto.IWebMessageInfo) {
    const parsed = parseStatus(raw)
    if (!parsed) return false
    return this.serial(session, async () => {
      const items = await this.records(session)
      if (items.some(i => i.raw.key?.id === raw.key?.id && i.sender === parsed.sender)) return false
      const item: RecordItem = { ...parsed, id: randomUUID() }
      const dir = directory(session)
      const target = path.join(dir, `${item.id}.json`)
      await fs.writeFile(target + '.tmp', JSON.stringify(item, BufferJSON.replacer), { mode: 0o600 })
      await fs.rename(target + '.tmp', target)
      for (const old of items.slice(LIMIT - 1)) {
        await fs.rm(path.join(dir, `${old.id}.json`), { force: true })
        await fs.rm(path.join(dir, `${old.id}.bin`), { force: true })
      }
      return true
    })
  }
  async list(session: string): Promise<StatusItem[]> {
    return this.serial(session, async () => (await this.records(session)).map(({ raw: _, ...item }) => item))
  }
  async clear(session: string) {
    await this.serial(session, () => fs.rm(directory(session), { recursive: true, force: true }))
  }
  async media(session: string, id: string, sock?: WASocket) {
    safeId(id)
    return this.serial(session, async () => {
      const item = (await this.records(session)).find(i => i.id === id)
      if (!item || item.type === 'text') throw new Error('Status not found atau sudah kedaluwarsa')
      const file = path.join(directory(session), `${id}.bin`)
      try { await fs.access(file); return { item, file } } catch {}
      if (!sock) throw new Error('Sesi offline. Hubungkan ulang untuk mengunduh SW.')
      // Stream with a hard cap: no full unbounded buffer or transcoding.
      // Bound stored originals to 256 MiB/session; evict the oldest cached files first.
      const cached: { file: string; size: number; mtime: number }[] = []
      for (const name of await fs.readdir(directory(session))) {
        if (!name.endsWith('.bin')) continue
        const target = path.join(directory(session), name)
        const stat = await fs.stat(target)
        cached.push({ file: target, size: stat.size, mtime: stat.mtimeMs })
      }
      let total = cached.reduce((sum, entry) => sum + entry.size, 0)
      for (const entry of cached.sort((a, b) => a.mtime - b.mtime)) {
        if (total + MAX_BYTES <= 256 * 1024 * 1024) break
        await fs.rm(entry.file, { force: true }); total -= entry.size
      }
      const stream = await this.download(item.raw, sock)
      const temp = file + '.tmp'
      const output = await fs.open(temp, 'w', 0o600)
      const timer = setTimeout(() => stream.destroy(new Error('Unduhan SW timeout')), 60000)
      let size = 0
      try {
        for await (const chunk of stream) {
          size += chunk.length
          if (size > MAX_BYTES) throw new Error('SW melebihi batas 64 MB')
          await output.writeFile(chunk)
        }
        if (!size) throw new Error('Media SW kosong')
        if (item.expiresAt <= Date.now()) throw new Error('Status sudah kedaluwarsa')
        await output.close()
        await fs.rename(temp, file)
      } catch (error) {
        stream.destroy()
        await output.close().catch(() => {})
        await fs.rm(temp, { force: true })
        throw error
      } finally { clearTimeout(timer) }
      return { item, file }
    })
  }
}
const globalStore = globalThis as unknown as { __waStatuses?: StatusStore }
export const statusStore = globalStore.__waStatuses ??= new StatusStore()
const timers = globalThis as unknown as { __waStatusCleanup?: NodeJS.Timeout }
if (!timers.__waStatusCleanup) {
  timers.__waStatusCleanup = setInterval(() => { void statusStore.cleanup().catch(() => {}) }, 60000)
  timers.__waStatusCleanup.unref()
}
