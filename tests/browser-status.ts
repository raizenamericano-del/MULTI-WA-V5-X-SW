/** Production browser test with explicitly seeded fixtures; never contacts WhatsApp. */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import type { proto } from '@whiskeysockets/baileys'
const root = await mkdtemp(path.join(tmpdir(), 'multi-wa-browser-'))
process.env.WA_DATA_DIR = root
process.env.DATABASE_URL = `file:${root}/test.db`
process.env.AUTH_PASSWORD = 'isolated-fixture-password-not-production'
process.env.AUTH_SECRET = 'isolated-fixture-secret-not-production'
const port = 3108
const origin = `http://127.0.0.1:${port}`
execFileSync('node', ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], { env: process.env, stdio: 'pipe' })
const { default: prisma } = await import('../lib/prisma')
const { statusStore } = await import('../lib/baileys/status-store')
const { createSessionToken, SESSION_COOKIE } = await import('../lib/auth')
const session = await prisma.waSession.create({ data: { name: 'TEST FIXTURES ONLY', phoneNumber: '628000000001', status: 'disconnected' } })
const other = await prisma.waSession.create({ data: { name: 'EMPTY TEST ACCOUNT', phoneNumber: '628000000002', status: 'disconnected' } })
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true })
const page = await context.newPage()
const jpeg = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width=320;c.height=400;const ctx=c.getContext('2d')!;ctx.fillStyle='#128c7e';ctx.fillRect(0,0,320,400);ctx.fillStyle='white';ctx.font='20px sans-serif';ctx.fillText('TEST FIXTURE',60,200);return c.toDataURL('image/jpeg').split(',')[1] }), 'base64')
const video = await readFile('tests/fixtures/status-video.mp4')
for (const type of ['image','video','text']) {
  const message = type === 'image' ? { imageMessage: { mimetype: 'image/jpeg', jpegThumbnail: jpeg, caption: 'Photo fixture' } }
    : type === 'video' ? { videoMessage: { mimetype: 'video/mp4', jpegThumbnail: jpeg, caption: 'Video fixture' } }
    : { extendedTextMessage: { text: 'Text fixture with permission' } }
  await statusStore.ingest(session.id, { key: { remoteJid: 'status@broadcast', participant: '628000000003@s.whatsapp.net', id: `TEST-${type}` }, messageTimestamp: Math.floor(Date.now()/1000), pushName: `Fixture ${type}`, message } as proto.IWebMessageInfo)
}
const items = await statusStore.list(session.id)
for (const item of items) if (item.type !== 'text') await writeFile(path.join(root, 'statuses', session.id, `${item.id}.bin`), item.type === 'image' ? jpeg : video)
const child = spawn('node', ['node_modules/tsx/dist/cli.mjs', 'server.ts'], {
  env: { ...process.env, NODE_ENV: 'production', HOSTNAME: '0.0.0.0', PORT: String(port), WA_AUTO_RESTORE: 'false' }, stdio: ['ignore','pipe','pipe'],
})
let output = ''
child.stdout!.on('data', data => { output += data })
child.stderr!.on('data', data => { output += data })
let passed = 0
const check = (name: string) => { passed++; console.log(`PASS ${name}`) }
const errors: string[] = []
page.on('pageerror', e => errors.push(e.message))
try {
  await new Promise<void>((resolve,reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server timeout: ${output}`)), 60000)
    const ready = (data: Buffer) => { if (data.toString().includes('ready on')) { clearTimeout(timeout); resolve() } }
    child.stdout!.on('data',ready)
    child.on('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${output}`)) })
  })
  const unauthorized = await fetch(`${origin}/api/sessions/${session.id}/statuses`)
  assert.equal(unauthorized.status,401)
  const photo = items.find(i => i.type === 'image')!
  assert.equal((await fetch(`${origin}/api/sessions/${session.id}/statuses/${photo.id}`)).status,401)
  check('list and original files require panel authentication')
  await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(), url: origin, httpOnly: true, sameSite: 'Lax' }])
  const list = await context.request.get(`${origin}/api/sessions/${session.id}/statuses`)
  const listJson = await list.json(); assert.equal(listJson.statuses.length,3); assert.equal('raw' in listJson.statuses[0],false)
  assert.equal((await context.request.get(`${origin}/api/sessions/${other.id}/statuses/${photo.id}`)).status(),404)
  check('authenticated list excludes raw media keys and cross-session file access fails')
  const range = await context.request.get(`${origin}/api/sessions/${session.id}/statuses/${photo.id}`, { headers: { range: 'bytes=0-9' } })
  assert.equal(range.status(),206); assert.deepEqual(await range.body(),jpeg.subarray(0,10))
  assert.equal((await context.request.get(`${origin}/api/sessions/${session.id}/statuses/${photo.id}`, { headers: { range: 'bytes=9999999-' } })).status(),416)
  check('original streaming supports exact ranges and rejects invalid ranges')
  await page.goto(`${origin}/status`)
  await page.getByRole('heading', { name: 'Status WhatsApp', exact: true }).waitFor()
  await page.getByLabel('Pilih akun WhatsApp').selectOption(session.id)
  await page.getByRole('button', { name: 'Lihat foto dari Fixture image' }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true)
  check('390px Android layout, account selector and genuine fixture gallery')
  await page.getByRole('button', { name: 'Foto', exact: true }).click()
  assert.equal(await page.locator('article').count(),1)
  await page.getByRole('button', { name: 'Semua', exact: true }).click()
  await page.getByLabel('Cari status').fill('Photo fixture'); assert.equal(await page.locator('article').count(),1)
  await page.getByLabel('Cari status').fill('')
  check('photo/video/text filters and caption search')
  await page.getByRole('button', { name: 'Lihat foto dari Fixture image' }).click()
  await page.waitForFunction(() => { const img=document.querySelector('[role="dialog"] img') as HTMLImageElement;return img?.complete && img.naturalWidth>0 })
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Unduh asli', exact: true }).click()
  const download = await downloaded
  assert.deepEqual(await readFile((await download.path())!),jpeg)
  await page.keyboard.press('Escape')
  check('photo preview decodes and original download is byte-identical')
  await page.getByRole('button', { name: 'Lihat video dari Fixture video' }).click()
  await page.waitForFunction(() => { const v=document.querySelector('video');return v && v.readyState>=2 && v.videoWidth>0 })
  await page.locator('video').evaluate(async element => { const v=element as HTMLVideoElement; await v.play(); v.currentTime=1 })
  await page.waitForFunction(() => { const v=document.querySelector('video');return v && v.currentTime>=1 })
  await page.keyboard.press('Escape')
  check('real MP4 preview decodes, plays and seeks')
  await page.getByRole('button', { name: 'Lihat teks dari Fixture text' }).click()
  await page.getByRole('dialog').getByText('Text fixture with permission', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByLabel('Pilih akun WhatsApp').selectOption(other.id)
  await page.getByRole('heading', { name: 'Belum ada status yang cocok' }).waitFor()
  await page.getByLabel('Pilih akun WhatsApp').selectOption(session.id)
  await page.getByRole('button', { name: 'Lihat foto dari Fixture image' }).waitFor()
  check('text preview and empty account state are honest')
  await page.setViewportSize({ width: 360, height: 800 })
  await page.waitForTimeout(200)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true)
  await mkdir('docs/status-screenshots', { recursive: true })
  await page.screenshot({ path: 'docs/status-screenshots/android-TEST-FIXTURES.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: 'docs/status-screenshots/desktop-TEST-FIXTURES.png', fullPage: true })
  assert.deepEqual(errors,[])
  check('360px and desktop layouts, no page errors')
  console.log(`${passed} production browser scenarios passed. Fixtures only; no live WhatsApp paired.`)
} finally {
  child.kill('SIGTERM'); await browser.close(); await prisma.$disconnect()
  await new Promise<void>(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit',()=>resolve()) })
  await rm(root,{ recursive:true,force:true })
}
