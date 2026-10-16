/** Isolated fixtures: no real account, socket or external network. */
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { proto, WASocket } from '@whiskeysockets/baileys'
const root = await mkdtemp(path.join(tmpdir(), 'multi-wa-status-'))
process.env.WA_DATA_DIR = root
const { StatusStore, parseStatus } = await import('../lib/baileys/status-store')
const now = Math.floor(Date.now() / 1000)
const raw = (id = 'REAL-EVENT-SHAPE'): proto.IWebMessageInfo => ({
  key: { remoteJid: 'status@broadcast', participant: '628123@s.whatsapp.net', id },
  messageTimestamp: now, pushName: 'Fixture contact',
  message: { imageMessage: { mimetype: 'image/jpeg', caption: 'Test caption', jpegThumbnail: Buffer.from('fixture') } },
})
let pass = 0
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  await fn(); pass++; console.log(`PASS ${name}`)
}
const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xd9])
let downloads = 0
const store = new StatusStore(async () => { downloads++; return Readable.from([bytes]) })
const sock = {} as WASocket
try {
  await test('parse photo, caption and thumbnail', () => {
    const item = parseStatus(raw())!; assert.equal(item.type, 'image'); assert.equal(item.text, 'Test caption'); assert.ok(item.thumbnail)
  })
  await test('ignore chat messages, own status, missing sender, expired and future events', () => {
    for (const msg of [
      { ...raw(), key: { ...raw().key, remoteJid: '628@s.whatsapp.net' } },
      { ...raw(), key: { ...raw().key, fromMe: true } },
      { ...raw(), key: { ...raw().key, participant: null } },
      { ...raw(), messageTimestamp: now - 86401 }, { ...raw(), messageTimestamp: now + 120 },
    ]) assert.equal(parseStatus(msg), null)
  })
  await test('exclude all view-once wrappers', () => {
    for (const wrapper of ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension']) {
      assert.equal(parseStatus({ ...raw(), message: { [wrapper]: { message: raw().message } } }), null)
    }
  })
  await test('video and text statuses are parsed without fake media', () => {
    assert.equal(parseStatus({ ...raw(), message: { videoMessage: { mimetype: 'video/mp4' } } })?.type, 'video')
    assert.equal(parseStatus({ ...raw(), message: { extendedTextMessage: { text: 'Hello' } } })?.text, 'Hello')
    assert.equal(parseStatus({ ...raw(), message: { imageMessage: { mimetype: 'image/svg+xml' } } }), null)
  })
  await test('duplicate events are idempotent; raw keys never exposed by list', async () => {
    await Promise.all([store.ingest('accountA', raw()), store.ingest('accountA', raw())])
    const list = await store.list('accountA'); assert.equal(list.length, 1); assert.equal('raw' in list[0], false)
  })
  await test('accounts isolated; invalid paths rejected', async () => {
    assert.equal((await store.list('accountB')).length, 0)
    await assert.rejects(store.list('../secret'))
    await assert.rejects(store.media('accountA', '../secret', sock))
  })
  await test('download preserves exact original bytes and cache avoids re-download', async () => {
    const [item] = await store.list('accountA')
    const result = await store.media('accountA', item.id, sock)
    assert.deepEqual(await readFile(result.file), bytes)
    await store.media('accountA', item.id, sock); assert.equal(downloads, 1)
    await assert.rejects(store.media('accountB', item.id, sock))
  })
  await test('filesystem persistence across store restart', async () => {
    assert.equal((await new StatusStore().list('accountA')).length, 1)
  })
  await test('offline uncached status fails; cached file remains available offline', async () => {
    await store.ingest('offline', raw())
    const [item] = await store.list('offline'); await assert.rejects(store.media('offline', item.id), /offline/)
    const [cached] = await store.list('accountA'); assert.ok((await store.media('accountA', cached.id)).file)
  })
  await test('network stream errors leave no partial media', async () => {
    const broken = new StatusStore(async () => Readable.from((async function* () { yield bytes; throw new Error('network fixture failure') })()))
    const [item] = await broken.list('offline')
    await assert.rejects(broken.media('offline', item.id, sock), /network fixture/)
    assert.equal((await readdir(path.join(root, 'statuses/offline'))).some(f => f.endsWith('.tmp') || f.endsWith('.bin')), false)
  })
  await test('64 MiB limit enforced while streaming', async () => {
    const oversized = new StatusStore(async () => Readable.from((async function* () { for (let i=0; i<65; i++) yield Buffer.alloc(1024*1024) })()))
    const [item] = await oversized.list('offline'); await assert.rejects(oversized.media('offline', item.id, sock), /64 MB/)
  })
  await test('expired metadata and media purged', async () => {
    const [item] = await store.list('accountA')
    const file = path.join(root, 'statuses/accountA', `${item.id}.json`)
    const record = JSON.parse(await readFile(file, 'utf8')); record.expiresAt = Date.now()-1
    await writeFile(file, JSON.stringify(record)); await store.cleanup()
    assert.equal((await readdir(path.dirname(file))).length, 0)
  })
  await test('maximum 100 records per account', async () => {
    for (let i=0; i<103; i++) await store.ingest('bounded', raw(`status-${i}`))
    assert.equal((await store.list('bounded')).length, 100)
  })
  await test('clear removes all status credentials and cached media', async () => {
    await store.clear('bounded'); assert.equal((await store.list('bounded')).length, 0)
  })
  console.log(`${pass} status tests passed. Live WhatsApp not tested.`)
} finally { await rm(root, { recursive: true, force: true }) }
