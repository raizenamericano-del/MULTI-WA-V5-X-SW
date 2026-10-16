/**
 * Functional test suite — `npm test`
 *
 * Boots the real Socket.io gateway, seeds a session with a fake Baileys socket
 * and drives the session manager end to end. Covers:
 *   - LID (@lid) chats being resolved to phone numbers instead of dropped
 *   - view-once media: parsing, media-node persistence, retry flow
 *   - reactions (incoming + outgoing), revokes (delete for everyone)
 *   - quoted replies and "delete for me"
 *   - new message types: polling, video bulat (ptv), lokasi, kontak, produk, acara
 *   - edits (messages.update), pencarian pesan, ekspor percakapan
 *   - autentikasi panel: token HMAC, verifikasi, rate limit login, middleware Edge
 *   - otomasi: balasan otomatis + webhook keluar ber-HMAC terverifikasi
 *   - teruskan pesan (teks & media), halaman pesan lama, pencarian per chat
 *   - web push: kunci VAPID, pengiriman kosong, presence tab terlihat
 *   - nama chat aman (alamat @lid tidak dirender sebagai nomor asing) + perbaikan LID
 *   - buku kontak: sinkronisasi WhatsApp, pencarian, impor manual, penggabungan LID
 *   - daftar chat bersih: buku alamat tidak membuat chat kosong + prune aman
 *   - the Socket.io events the UI depends on
 *
 * It uses its own SQLite/Postgres database from DATABASE_URL and cleans up.
 */
import { createServer } from 'node:http'
import { Server as IOServer } from 'socket.io'
import { io as ioClient } from 'socket.io-client'
import { registerSocketGateway, SOCKET_PATH } from '@/lib/socket-server'
import { sessionManager } from '@/lib/baileys/session-manager'
import { parseWaMessage, parseEditedMessage, serializeMediaNode, rebuildMediaMessage, parseReaction, parseRevoke, quotedPreview } from '@/lib/baileys/persistence'
import prisma from '@/lib/prisma'

const PORT = 3997
let pass = 0, fail = 0
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label} ${detail !== undefined ? JSON.stringify(detail) : ''}`) }
}

const httpServer = createServer()
const io = new IOServer(httpServer, { path: SOCKET_PATH })
await registerSocketGateway(io)
await new Promise<void>((r) => httpServer.listen(PORT, r))

const session = await prisma.waSession.create({
  data: { name: 'Features Test', phoneNumber: '628' + String(Date.now()).slice(-9), status: 'connected' },
})

const sendToWa: unknown[] = []
const live = {
  sessionId: session.id,
  sock: {
    user: { id: '6281234567890:1@s.whatsapp.net', name: 'gw' },
    groupMetadata: async () => ({ subject: 'Grup' }),
    updateMediaMessage: async () => null,
    sendMessage: async (_jid: string, content: unknown) => {
      sendToWa.push(content)
      return { key: { id: `OUT${sendToWa.length}`, remoteJid: 'x@s.whatsapp.net', fromMe: true } }
    },
    // Verifikasi nomor (halaman Kontak -> "Tambah nomor"). Nomor yang berakhiran
    // 0000 sengaja dianggap tidak terdaftar di WhatsApp supaya jalur gagal teruji.
    onWhatsApp: async (...jids: string[]) =>
      jids.map((value) => {
        const number = value.replace(/\D/g, '')
        return {
          jid: `${number}@s.whatsapp.net`,
          exists: !number.endsWith('0000'),
          lid: null,
        }
      }),
  },
  qr: null, reconnectAttempts: 0, reconnectTimer: null, manualDisconnect: false,
  pairingRequested: false, startedAt: Date.now(),
  lidToPn: new Map(), contactNames: new Map(), debugLog: [],
  counters: { upsert: 0, stored: 0, skipped: 0, historyMessages: 0, reactions: 0, revoked: 0, edited: 0, mediaRetried: 0, mediaRecovered: 0 },
} as never
;(sessionManager as unknown as { sessions: Map<string, unknown> }).sessions.set(session.id, live)

const socket = ioClient(`http://localhost:${PORT}`, { path: SOCKET_PATH, transports: ['websocket'] })
const events: string[] = []
socket.on('session:message-updated', (p: { message: { id: string; reactions: Record<string,string>; deletedAt: string | null; mediaStatus: string | null } }) =>
  events.push(`updated:${p.message.id}:${JSON.stringify(p.message.reactions)}:del=${p.message.deletedAt ? 'y' : 'n'}:media=${p.message.mediaStatus}`))
socket.on('session:message-removed', () => events.push('removed'))
socket.on('session:message', (p: { message: { id: string } }) => events.push(`new:${p.message.id}`))
socket.emit('subscribe', { sessionId: session.id })
await new Promise((r) => socket.on('server:ready', r))
await new Promise((r) => setTimeout(r, 250))

const manager = sessionManager as unknown as {
  handleIncomingMessage: (l: unknown, r: unknown) => Promise<void>
  handleReaction: (l: unknown, r: unknown) => Promise<void>
  handleRevoke: (l: unknown, r: unknown) => Promise<void>
  retryMediaDownload: (s: string, m?: string, w?: string) => Promise<unknown>
  sendReaction: (s: string, m: string, e: string) => Promise<unknown>
  deleteMessage: (s: string, m: string, scope: 'me' | 'everyone') => Promise<unknown>
}
const now = () => Math.floor(Date.now() / 1000)
const mk = (o: Record<string, unknown>) => ({ pushName: 'Kontak', messageTimestamp: now(), ...o } as never)

console.log('\n=== 1. VIEW ONCE: parsing + media node + status ===')
const voImage = mk({
  key: { remoteJid: '6281111111111@s.whatsapp.net', fromMe: false, id: 'VO1' },
  message: {
    viewOnceMessageV2: {
      message: {
        imageMessage: {
          url: 'https://mmg.whatsapp.net/d/fake.enc', directPath: '/v/t62/f.enc',
          mediaKey: Buffer.alloc(32, 7), fileEncSha256: Buffer.alloc(32, 3), fileSha256: Buffer.alloc(32, 4),
          mimetype: 'image/jpeg', fileLength: '2048', caption: 'rahasia', viewOnce: true, mediaKeyTimestamp: '1700000000',
        },
      },
    },
  },
})
const parsed = parseWaMessage(voImage)
check('viewOnce terdeteksi', parsed?.viewOnce === true)
check('tipe = image', parsed?.type === 'image')
check('caption terbaca', parsed?.text === 'rahasia')
check('mediaNode tersimpan (untuk retry)', Boolean(parsed?.mediaNode) && parsed!.mediaNode!.includes('imageMessage'))
const rebuilt = rebuildMediaMessage(parsed!.mediaNode!, { id: 'VO1', remoteJid: '6281111111111@s.whatsapp.net', fromMe: false })
check('mediaNode bisa di-rebuild jadi WAMessage', Boolean(rebuilt?.message?.imageMessage))
check('mediaKey round-trip utuh (Buffer)', Buffer.isBuffer((rebuilt!.message!.imageMessage as { mediaKey: unknown }).mediaKey))

await manager.handleIncomingMessage(live, voImage)
const voRow = await prisma.message.findFirst({ where: { sessionId: session.id, waMessageId: 'VO1' } })
check('baris tersimpan dengan viewOnce=true', voRow?.viewOnce === true)
check('mediaStatus = pending (WhatsApp belum bagi media)', voRow?.mediaStatus === 'pending', voRow?.mediaStatus)
check('mediaRetries mulai dari 0', voRow?.mediaRetries === 0)
const voChat = await prisma.chat.findUnique({ where: { id: voRow!.chatId } })
check('preview chat menandai view once', Boolean(voChat?.lastMessagePreview?.startsWith('👁️')), voChat?.lastMessagePreview)

console.log('\n=== 2. MEDIA RETRY (dipicu messages.media-update) ===')
await manager.retryMediaDownload(session.id, undefined, 'VO1')
const afterRetry = await prisma.message.findUnique({ where: { id: voRow!.id } })
check('percobaan retry tercatat', (afterRetry?.mediaRetries ?? 0) >= 1, afterRetry?.mediaRetries)
const counters = (live as { counters: Record<string, number> }).counters
check('counter mediaRetried naik', counters.mediaRetried >= 1)
check('event message-updated dikirim ke browser', events.some((e) => e.startsWith(`updated:${voRow!.id}`)), events.slice(-3))

console.log('\n=== 3. REACTION ===')
await manager.handleIncomingMessage(live, mk({
  key: { remoteJid: '6281111111111@s.whatsapp.net', fromMe: false, id: 'R1' },
  message: { conversation: 'pesan untuk direaksi' },
}))
const target = await prisma.message.findFirst({ where: { sessionId: session.id, waMessageId: 'R1' } })
const reactionRaw = mk({
  key: { remoteJid: '6281111111111@s.whatsapp.net', fromMe: false, id: 'RX1', participant: '6281111111111@s.whatsapp.net' },
  message: { reactionMessage: { text: '🔥', key: { id: 'R1', remoteJid: '6281111111111@s.whatsapp.net', fromMe: false } } },
})
const parsedReaction = parseReaction(reactionRaw as never)
check('reactionMessage diparse', parsedReaction?.emoji === '🔥' && parsedReaction?.targetWaMessageId === 'R1')
await manager.handleReaction(live, parsedReaction)
const reacted = await prisma.message.findUnique({ where: { id: target!.id } })
check('reaction tersimpan di baris target', JSON.parse(reacted?.reactions ?? '{}')['6281111111111@s.whatsapp.net'] === '🔥', reacted?.reactions)
check('reaction TIDAK dibuat jadi pesan baru', (await prisma.message.count({ where: { sessionId: session.id, waMessageId: 'RX1' } })) === 0)
check('counter reactions naik', counters.reactions === 1)

console.log('\n=== 4. SEND REACTION (keluar) ===')
await manager.sendReaction(session.id, target!.id, '👍')
check('baileys menerima payload react', JSON.stringify(sendToWa.at(-1)).includes('"react"'))
check('reaction kita tersimpan', Object.values(JSON.parse((await prisma.message.findUnique({ where: { id: target!.id } }))?.reactions ?? '{}')).includes('👍'))

console.log('\n=== 5. REVOKE (delete for everyone dari lawan) ===')
const revokeRaw = mk({
  key: { remoteJid: '6281111111111@s.whatsapp.net', fromMe: false, id: 'RV1' },
  message: { protocolMessage: { type: 0, key: { id: 'R1', remoteJid: '6281111111111@s.whatsapp.net', fromMe: false } } },
})
const parsedRevoke = parseRevoke(revokeRaw as never)
check('protocolMessage REVOKE diparse', parsedRevoke?.targetWaMessageId === 'R1')
await manager.handleRevoke(live, parsedRevoke)
const revoked = await prisma.message.findUnique({ where: { id: target!.id } })
check('deletedAt terisi', Boolean(revoked?.deletedAt))
check('teks dikosongkan', revoked?.text === null)
check('bukan dibuat sebagai pesan baru', (await prisma.message.count({ where: { sessionId: session.id, waMessageId: 'RV1' } })) === 0)
check('counter revoked naik', counters.revoked === 1)

console.log('\n=== 6. QUOTED / REPLY ===')
const asked = mk({
  key: { remoteJid: '6281111111111@s.whatsapp.net', fromMe: false, id: 'Q1' },
  message: { extendedTextMessage: { text: 'Balasan saya', contextInfo: { stanzaId: 'VO1', participant: '6281111111111@s.whatsapp.net', quotedMessage: { conversation: 'rahasia' } } } },
})
const parsedQuote = parseWaMessage(asked as never)
check('quoted terdeteksi', parsedQuote?.quoted?.id === 'VO1')
check('preview quoted = teks aslinya', parsedQuote?.quoted?.text === 'rahasia')
check('quoted fromMe=false (dari lawan)', parsedQuote?.quoted?.fromMe === false)
check('quotedPreview() jalan langsung', quotedPreview({ extendedTextMessage: { text: 'x', contextInfo: { stanzaId: 'Z', quotedMessage: { imageMessage: { caption: 'foto lama' } } } } })?.type === 'image')

console.log('\n=== 7. DELETE FOR ME (hapus lokal) ===')
const toDeleteRow = await prisma.message.findFirst({ where: { sessionId: session.id, waMessageId: 'Q1' } })
    ?? await prisma.message.findFirst({ where: { sessionId: session.id, waMessageId: 'R1' } })
await manager.handleIncomingMessage(live, asked)
const qRow = await prisma.message.findFirst({ where: { sessionId: session.id, waMessageId: 'Q1' } })
await manager.deleteMessage(session.id, qRow!.id, 'me')
check('baris benar-benar terhapus dari DB', (await prisma.message.findUnique({ where: { id: qRow!.id } })) === null)
check('event message-removed dikirim', events.includes('removed'))
void toDeleteRow

console.log('\n=== 8. DEBUG ENDPOINT: counter lengkap ===')
const debug = await sessionManager.getDebugInfo(session.id)
check('counters reaksi/revoke/media ada', debug?.counters?.reactions === 1 && debug?.counters?.revoked === 1 && (debug?.counters?.mediaRetried ?? 0) >= 1, debug?.counters)

console.log('\n=== 9. JENIS PESAN LAIN: polling, ptv, lokasi, kontak, produk, acara ===')
const poll = parseWaMessage(mk({
  key: { remoteJid: '6281111111111@s.whatsapp.net', fromMe: false, id: 'PL1' },
  message: { pollCreationMessage: { name: 'Makan apa?', options: [{ optionName: 'Bakso' }, { optionName: 'Sate' }], selectableOptionsCount: 1 } },
}))
check('polling diparse jadi teks + opsi', Boolean(poll?.text?.includes('📊 Makan apa?') && poll?.text?.includes('Bakso')))
check('extra.poll tersimpan', poll?.extra?.poll?.options?.length === 2 && poll?.extra?.poll?.name === 'Makan apa?', poll?.extra?.poll)

const ptv = parseWaMessage(mk({
  key: { remoteJid: '6281111111111@s.whatsapp.net', fromMe: false, id: 'PTV1' },
  message: { ptvMessage: { mimetype: 'video/mp4', seconds: 7, fileLength: 1234 } },
}))
check('video bulat (ptv) jadi type video', ptv?.type === 'video' && ptv?.extra?.ptv === true, ptv?.extra)
check('video bulat butuh diunduh', ptv?.needsDownload === true && Boolean(ptv?.mediaNode))

const loc = parseWaMessage(mk({
  key: { remoteJid: '6281111111111@s.whatsapp.net', fromMe: false, id: 'LOC1' },
  message: { locationMessage: { degreesLatitude: -6.9932, degreesLongitude: 110.4203, name: 'Semarang' } },
}))
check('lokasi punya mapsUrl', Boolean(loc?.extra?.location?.mapsUrl?.includes('maps.google.com')), loc?.extra?.location)
check('teks lokasi berisi nama tempat', Boolean(loc?.text?.includes('Semarang')))

const contact = parseWaMessage(mk({
  key: { remoteJid: '6281111111111@s.whatsapp.net', fromMe: false, id: 'CT1' },
  message: { contactMessage: { displayName: 'Budi', vcard: 'BEGIN:VCARD\nFN:Budi\nTEL;type=CELL;waid=6282222222222:+62 822-2222-222\nEND:VCARD' } },
}))
check('kontak: nomor diambil dari vcard (waid diprioritaskan)', contact?.extra?.contact?.phone === '+6282222222222', contact?.extra?.contact)
check('teks kontak menampilkan nama', Boolean(contact?.text?.includes('Budi')))

const product = parseWaMessage(mk({
  key: { remoteJid: '6281111111111@s.whatsapp.net', fromMe: false, id: 'PR1' },
  message: { productMessage: { product: { title: 'Kaos Polos', description: 'Bahan katun' } } },
}))
check('produk katalog diparse', product?.extra?.product?.title === 'Kaos Polos')

const event = parseWaMessage(mk({
  key: { remoteJid: '6281111111111@s.whatsapp.net', fromMe: false, id: 'EV1' },
  message: { eventMessage: { name: 'Rapat RT', description: 'Bawa kursi', startTime: 1770000000 } },
}))
check('acara diparse', event?.extra?.event?.name === 'Rapat RT', event?.text)

const unknown = parseWaMessage(mk({
  key: { remoteJid: '6281111111111@s.whatsapp.net', fromMe: false, id: 'UN1' },
  message: { someFutureMessage: { foo: 'bar' } } as never,
}))
check('tipe tak dikenal menyimpan rawType', unknown?.extra?.rawType === 'someFutureMessage', unknown?.extra)

// Pesan ini juga dipakai untuk menguji fitur edit & pencarian di bawah.
await manager.handleIncomingMessage(live, mk({
  key: { remoteJid: '6281111111111@s.whatsapp.net', fromMe: false, id: 'ED1' },
  message: { conversation: 'Harga naik jadi 25 ribu' },
}))

console.log('\n=== 10. EDIT PESAN (messages.update -> editedAt) ===')
const editUpdate = { key: { id: 'ED1', remoteJid: '6281111111111@s.whatsapp.net', fromMe: false }, message: { editedMessage: { message: { conversation: 'Harga naik jadi 30 ribu' } } } }
const editedContent = parseEditedMessage(editUpdate)
check('editedMessage diekstrak dari messages.update', editedContent?.conversation === 'Harga naik jadi 30 ribu', editedContent)
await (manager as unknown as { handleEdit: (l: unknown, id: string, c: unknown) => Promise<void> }).handleEdit(live, 'ED1', editedContent)
const editedRow = await prisma.message.findFirst({ where: { sessionId: session.id, waMessageId: 'ED1' } })
check('teks pesan diperbarui', editedRow?.text === 'Harga naik jadi 30 ribu', editedRow?.text)
check('editedAt terisi', Boolean(editedRow?.editedAt))
check('counter edited naik', counters.edited === 1, counters.edited)

console.log('\n=== 11. PENCARIAN PESAN ===')
const hits = await sessionManager.searchMessages(session.id, '30 ribu')
check('pencarian menemukan pesan (teks terbaru)', hits.length === 1 && hits[0].message.waMessageId === 'ED1', hits.length)
check('pencarian mengembalikan chat terkait', Boolean(hits[0]?.chat?.id), hits[0]?.chat?.id)
check('kueri terlalu pendek diabaikan', (await sessionManager.searchMessages(session.id, 'a')).length === 0)

console.log('\n=== 12. EKSPOR PERCAKAPAN ===')
const exported = await sessionManager.exportChat(hits[0].chat.id)
check('ekspor memuat data chat + sesi', Boolean(exported?.chat?.id && exported?.session?.phoneNumber), exported?.session)
check('ekspor memuat pesan berurutan', (exported?.messages.length ?? 0) >= 1 && Boolean(exported?.messages[0]?.timestamp))
check('pesan hasil edit ikut terekspor', exported?.messages.some((m) => m.text === 'Harga naik jadi 30 ribu') === true)

console.log('\n=== 13. AUTENTIKASI PANEL (lib/auth) ===')
const auth = await import('@/lib/auth')
const prevPassword = process.env.AUTH_PASSWORD
process.env.AUTH_PASSWORD = 'rahasia-test-123'
process.env.AUTH_USERNAME = 'admin'
check('authEnabled() mengikuti AUTH_PASSWORD', auth.authEnabled() === true)
check('password benar diterima', auth.checkCredentials('admin', 'rahasia-test-123') === true)
check('password salah ditolak', auth.checkCredentials('admin', 'salah') === false)
const token = await auth.createSessionToken(60)
const payload = await auth.verifySessionToken(token)
check('token sesi bisa diverifikasi', payload?.sub === 'admin', payload)
check('token yang diubah ditolak', (await auth.verifySessionToken(`${token}x`)) === null)
check('cookie header dibaca', auth.tokenFromCookieHeader(`a=1; ${auth.SESSION_COOKIE}=${token}`) === token, auth.SESSION_COOKIE)
auth.clearLoginAttempts('1.2.3.4')
for (let i = 0; i < 6; i++) auth.registerFailedLogin('1.2.3.4')
check('rate limit memblokir setelah 6 kali gagal', auth.loginRateLimit('1.2.3.4').allowed === false && auth.loginRateLimit('1.2.3.4').retryInSeconds > 60, auth.loginRateLimit('1.2.3.4'))
auth.clearLoginAttempts('1.2.3.4')
check('rate limit bisa direset setelah login sukses', auth.loginRateLimit('1.2.3.4').allowed === true)
process.env.AUTH_PASSWORD = prevPassword
if (prevPassword === undefined) delete process.env.AUTH_PASSWORD

console.log('\n=== 14. MIDDLEWARE GERBANG LOGIN (Edge) ===')
{
  const { NextRequest } = await import('next/server')
  const { middleware } = await import('@/middleware')
  const prev = process.env.AUTH_PASSWORD

  const call = (path: string, cookie?: string) => {
    const req = new NextRequest(new URL(`http://localhost:3000${path}`), {
      headers: cookie ? { cookie } : {},
    })
    return middleware(req)
  }

  // Login nonaktif → semua lolos.
  delete process.env.AUTH_PASSWORD
  const openPage = await call('/')
  check('tanpa AUTH_PASSWORD halaman lolos', openPage.headers.get('x-middleware-next') === '1', [...openPage.headers])

  process.env.AUTH_PASSWORD = 'rahasia-test-123'
  process.env.AUTH_USERNAME = 'admin'

  const blockedPage = await call('/chat/abc')
  check('halaman tanpa login diredirect ke /login', blockedPage.status === 307 && (blockedPage.headers.get('location') ?? '').includes('/login?next=%2Fchat%2Fabc'), blockedPage.headers.get('location'))

  const blockedApi = await call('/api/sessions')
  check('API tanpa login dapat 401 JSON', blockedApi.status === 401 && (await blockedApi.json()).error.length > 0)

  const publicLogin = await call('/login')
  check('/login tetap bisa diakses', publicLogin.headers.get('x-middleware-next') === '1')

  const publicHealth = await call('/api/health')
  check('/api/health tetap terbuka', publicHealth.headers.get('x-middleware-next') === '1')

  const goodToken = await auth.createSessionToken(60)
  const allowed = await call('/chat/abc', `${auth.SESSION_COOKIE}=${goodToken}`)
  check('cookie sah membuka halaman', allowed.headers.get('x-middleware-next') === '1', allowed.status)

  const badCookie = await call('/chat/abc', `${auth.SESSION_COOKIE}=ngawur`)
  check('cookie palsu tetap diblokir', badCookie.status === 307)

  if (prev === undefined) delete process.env.AUTH_PASSWORD
  else process.env.AUTH_PASSWORD = prev
}

console.log('\n=== 15. OTOMASI: balasan otomatis + webhook ===')
{
  const http = await import('node:http')
  const crypto = await import('node:crypto')

  // Reseptor webhook lokal
  const received: { headers: Record<string, string | string[] | undefined>; body: string }[] = []
  const receiver = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      received.push({ headers: req.headers, body })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    })
  })
  await new Promise<void>((resolve) => receiver.listen(3998, resolve))

  await sessionManager.updateWebhookConfig(session.id, {
    enabled: true,
    url: 'http://127.0.0.1:3998/hook',
    secret: 'rahasia-webhook',
    events: ['message', 'autoreply'],
  })
  const config = await sessionManager.getWebhookConfig(session.id)
  check('konfigurasi webhook tersimpan', config?.enabled === true && config?.hasSecret === true, config)

  const testResult = await sessionManager.testWebhook(session.id)
  check('webhook percobaan terkirim', testResult.ok === true && testResult.status === 200, testResult)
  check('penerima menerima 1 permintaan', received.length === 1, received.length)

  const signature = received[0]?.headers['x-wa-signature'] as string | undefined
  const expected = `sha256=${crypto.createHmac('sha256', 'rahasia-webhook').update(received[0]?.body ?? '').digest('hex')}`
  check('tanda tangan HMAC cocok', signature === expected, signature)
  check('header event terisi', received[0]?.headers['x-wa-event'] === 'message')

  // Aturan balasan otomatis
  const rule = await sessionManager.createAutoReply(session.id, {
    name: 'Tanya harga',
    matchType: 'contains',
    pattern: 'harga',
    reply: 'Daftar harga: kaos 100rb, jaket 250rb.',
    cooldownSeconds: 0,
  })
  check('aturan dibuat', Boolean(rule.id) && rule.hits === 0)
  check('regex tidak valid ditolak', await (async () => {
    try {
      await sessionManager.createAutoReply(session.id, { name: 'X', matchType: 'regex', pattern: '([', reply: 'y' })
      return false
    } catch {
      return true
    }
  })())

  const before = sendToWa.length
  await manager.handleIncomingMessage(live, mk({
    key: { remoteJid: '6281111111111@s.whatsapp.net', fromMe: false, id: 'AR1' },
    message: { conversation: 'Halo, minta info harga dong' },
  }))
  await new Promise((resolve) => setTimeout(resolve, 600))

  const replied = (sendToWa.slice(before) as { text?: string }[]).find((content) => content?.text?.includes('Daftar harga'))
  check('balasan otomatis terkirim ke WhatsApp', Boolean(replied), sendToWa.slice(before))
  const firedRule = await prisma.autoReplyRule.findUnique({ where: { id: rule.id } })
  check('hits aturan bertambah', firedRule?.hits === 1, firedRule?.hits)
  check('balasan tersimpan sebagai pesan keluar', (await prisma.message.count({
    where: { sessionId: session.id, fromMe: true, text: { contains: 'Daftar harga' } },
  })) === 1)
  check('webhook menerima event pesan masuk + balasan', received.some((item) => item.body.includes('"event":"message"')) && received.some((item) => item.body.includes('"event":"autoreply"')), received.length)

  const rules = await sessionManager.listAutoReplies(session.id)
  check('daftar aturan mengembalikan 1 aturan', rules.length === 1)
  await sessionManager.updateAutoReply(rule.id, { enabled: false })
  check('aturan bisa dimatikan', (await prisma.autoReplyRule.findUnique({ where: { id: rule.id } }))?.enabled === false)
  await sessionManager.deleteAutoReply(rule.id)
  check('aturan bisa dihapus', (await prisma.autoReplyRule.count({ where: { sessionId: session.id } })) === 0)

  await sessionManager.updateWebhookConfig(session.id, { enabled: false })
  await new Promise<void>((resolve) => receiver.close(() => resolve()))
}

console.log('\n=== 16. TERUSKAN PESAN (forward) ===')
{
  const fsMod = await import('node:fs/promises')
  const pathMod = await import('node:path')
  const { MEDIA_ROOT, ensureDir, sessionMediaDir } = await import('@/lib/baileys/paths')

  const dir = await ensureDir(sessionMediaDir(session.id))
  const relative = pathMod.relative(MEDIA_ROOT, pathMod.join(dir, 'fwd-source.png'))
  await fsMod.writeFile(pathMod.join(dir, 'fwd-source.png'), Buffer.from('89504e470d0a1a0a', 'hex'))

  const sourceChat = await prisma.chat.findFirst({ where: { sessionId: session.id } })
  const sourceMessage = await prisma.message.create({
    data: {
      sessionId: session.id,
      chatId: sourceChat!.id,
      waMessageId: 'FWD-SRC',
      fromMe: false,
      type: 'image',
      text: 'Foto bukti transfer',
      mediaPath: relative,
      mediaMime: 'image/png',
      mediaSize: 8,
      status: 'sent',
      timestamp: new Date(),
      mediaStatus: 'ready',
    },
  })

  const targetChat = await prisma.chat.create({
    data: { sessionId: session.id, jid: '6289999999999@s.whatsapp.net', name: 'Chat Tujuan' },
  })

  const beforeForward = sendToWa.length
  const forwarded = await sessionManager.forwardMessage(session.id, sourceMessage.id, targetChat.id)
  check('pesan diteruskan ke chat tujuan', forwarded.chat.id === targetChat.id && forwarded.targetChatName === 'Chat Tujuan', forwarded.targetChatName)
  check('baileys menerima gambar + caption', (() => {
    const payload = sendToWa.at(-1) as { image?: unknown; caption?: string }
    return Boolean(payload?.image) && payload?.caption === 'Foto bukti transfer'
  })(), sendToWa.at(-1))
  check('ada tambahan pesan keluar di chat tujuan', sendToWa.length === beforeForward + 1)
  check('salinan media disimpan ulang', (await prisma.message.count({ where: { chatId: targetChat.id, mediaPath: { not: null } } })) === 1)

  const noMediaText = await prisma.message.create({
    data: {
      sessionId: session.id, chatId: sourceChat!.id, waMessageId: 'FWD-TXT', fromMe: false,
      type: 'text', text: 'Catatan penting', status: 'sent', timestamp: new Date(),
    },
  })
  const forwardedText = await sessionManager.forwardMessage(session.id, noMediaText.id, targetChat.id)
  check('pesan teks diteruskan sebagai teks', forwardedText.message.text === 'Catatan penting', forwardedText.message.text)

  await prisma.chat.delete({ where: { id: targetChat.id } })
}

console.log('\n=== 17. WEB PUSH + PRESENCE ===')
{
  const push = await import('@/lib/push')
  const presence = await import('@/lib/presence')

  const keys = await push.getVapidKeys()
  check('kunci VAPID tersedia', typeof keys.publicKey === 'string' && keys.publicKey.length > 60, keys.publicKey.slice(0, 12))
  const again = await push.getVapidKeys()
  check('kunci VAPID stabil antar pemanggilan', again.publicKey === keys.publicKey)

  const emptySend = await push.sendPushToAll({ title: 'x', body: 'y' }, { source: 'tes' })
  check('kirim tanpa pelanggan tidak error', emptySend.sent === 0 && emptySend.failed === 0, emptySend)
  check('laporan perangkat kosong', emptySend.devices === 0 && emptySend.details.length === 0, emptySend)
  check('jumlah langganan = 0', (await push.countSubscriptions()) === 0)

  const diag = await push.getPushDiagnostics()
  check('diagnostik: kunci VAPID terinci', typeof diag.publicKeyPreview === 'string' && diag.publicKeyPreview.includes('…'), diag.publicKeyPreview)
  check('diagnostik: sumber kunci terbaca', diag.vapidSource === 'env' || diag.vapidSource === 'file', diag.vapidSource)
  check(
    'diagnostik: percobaan tercatat (termasuk pesan masuk)',
    diag.recent.length >= 1 && diag.recent[0].devices === 0 && diag.recent[0].source === 'tes',
    diag.recent.map((item) => item.source).join(','),
  )
  check('diagnostik: daftar perangkat kosong', diag.subscriptionCount === 0 && diag.devices.length === 0)

  presence.registerClient('sock-1', 'perangkat-A')
  check('klien baru dihitung tersembunyi', presence.visibleClientCount() === 0)
  presence.setVisibility('sock-1', 'visible', 'perangkat-A')
  check('tab terlihat membuat count = 1', presence.visibleClientCount() === 1)
  check('deviceId yang terlihat terdeteksi', presence.visibleDeviceIds().has('perangkat-A'))
  presence.setVisibility('sock-1', 'hidden')
  check('tab disembunyikan membuat count = 0 lagi', presence.visibleClientCount() === 0)
  check('deviceId hilang dari daftar terlihat', !presence.visibleDeviceIds().has('perangkat-A'))
  const withFake = presence.connectedClientCount()
  presence.removeClient('sock-1')
  check('klien terputus dibersihkan', presence.connectedClientCount() === withFake - 1, presence.connectedClientCount())

  // Notifikasi per perangkat: perangkat yang panelnya dibuka TIDAK dikirimi push,
  // sementara perangkat lain (mis. HP saat panel dibuka di laptop) tetap dikirimi.
  await prisma.pushSubscription.create({
    data: {
      endpoint: 'https://push.example.test/laptop',
      p256dh: 'kunci-palsu',
      auth: 'auth-palsu',
      deviceId: 'perangkat-A',
    },
  })
  presence.registerClient('sock-A', 'perangkat-A')
  presence.setVisibility('sock-A', 'visible', 'perangkat-A')
  const skippedSend = await push.sendPushToAll({ title: 'panel terbuka', body: 'x' }, { source: 'uji-panel-terbuka' })
  check(
    'perangkat dengan panel terbuka dilewati',
    skippedSend.skipped === 1 && skippedSend.sent === 0 && skippedSend.failed === 0,
    skippedSend,
  )
  presence.removeClient('sock-A')
  await prisma.pushSubscription.deleteMany({ where: { deviceId: 'perangkat-A' } })
  check('langganan uji dibersihkan', (await prisma.pushSubscription.count()) === 0)
}

console.log('\n=== 18. PESAN LAMA & PENCARIAN DALAM CHAT ===')
{
  const chatId = (await prisma.chat.findFirst({ where: { sessionId: session.id } }))!.id
  const base = Date.now() - 1000 * 60 * 60

  for (let index = 0; index < 12; index += 1) {
    await prisma.message.create({
      data: {
        sessionId: session.id,
        chatId,
        waMessageId: `PAGE-${index}`,
        fromMe: false,
        type: 'text',
        text: index === 6 ? 'pesan unik tengah' : `pesan ke-${index}`,
        status: 'sent',
        timestamp: new Date(base + index * 60_000),
      },
    })
  }

  const firstPage = await sessionManager.listMessages(session.id, chatId, { limit: 10 })
  check('halaman pertama berisi 10 pesan terbaru', firstPage.length === 10, firstPage.length)

  const older = await sessionManager.listMessages(session.id, chatId, {
    limit: 10,
    before: firstPage[0].timestamp,
  })
  check('halaman lama memuat pesan sebelum halaman pertama', older.length >= 3 && new Date(older[older.length - 1].timestamp) < new Date(firstPage[0].timestamp), older.length)

  const aroundRow = await prisma.message.findFirst({ where: { chatId, waMessageId: 'PAGE-6' } })
  const around = await sessionManager.listMessages(session.id, chatId, { limit: 10, around: aroundRow!.id })
  check('mode around memuat pesan acuan', around.some((message) => message.waMessageId === 'PAGE-6'), around.length)
  check('mode around memuat pesan sebelum & sesudah', around.some((m) => m.waMessageId === 'PAGE-5') && around.some((m) => m.waMessageId === 'PAGE-7'))

  const scoped = await sessionManager.searchMessages(session.id, 'pesan unik tengah', 20, chatId)
  check('pencarian dalam satu chat menemukan pesan', scoped.length === 1 && scoped[0].message.waMessageId === 'PAGE-6', scoped.length)

  const otherChat = await prisma.chat.create({
    data: { sessionId: session.id, jid: '6287777777777@s.whatsapp.net', name: 'Chat Lain' },
  })
  const emptyScoped = await sessionManager.searchMessages(session.id, 'pesan unik tengah', 20, otherChat.id)
  check('filter chat lain tidak mengembalikan hasil', emptyScoped.length === 0)
  check('pencarian tanpa filter tetap menemukan', (await sessionManager.searchMessages(session.id, 'pesan unik tengah')).length === 1)
  await prisma.chat.delete({ where: { id: otherChat.id } })
}

console.log('\n=== 19. NAMA CHAT & PERBAIKAN ALAMAT @lid ===')
{
  const { chatDisplayName, chatSubtitle, isPlaceholderChatName, isLidAddress } = await import('@/lib/utils')
  const { ensureChat } = await import('@/lib/baileys/persistence')

  // 1) Nama angka hasil salinan JID tidak boleh tampil sebagai nomor asing.
  const lidJid = '225123456789012345@lid'
  check('alamat @lid dikenali', isLidAddress(lidJid) && !isLidAddress('628123@s.whatsapp.net'))
  check('nama salinan JID dikenali sebagai placeholder', isPlaceholderChatName('225123456789012345', lidJid))
  check('nama asli berupa angka tetap dihormati', !isPlaceholderChatName('2026', '1234567890@g.us'))
  check('nama teks biasa bukan placeholder', !isPlaceholderChatName('Rifky', lidJid))

  const lidLabel = chatDisplayName({ name: '225123456789012345', jid: lidJid })
  check('chat @lid tanpa nama tampil sebagai label ramah', lidLabel.startsWith('Kontak WhatsApp'), lidLabel)
  check('label @lid tidak menyerupai nomor negara', !lidLabel.startsWith('+225'), lidLabel)
  check('nama asli tetap dipakai', chatDisplayName({ name: 'Budi', jid: lidJid }) === 'Budi')
  check('chat biasa memakai nomor terformat', chatDisplayName({ name: null, jid: '6281234567890@s.whatsapp.net' }) === '+62 812-3456-7890', chatDisplayName({ name: null, jid: '6281234567890@s.whatsapp.net' }))
  check('subjudul @lid menjelaskan', chatSubtitle({ jid: lidJid }).includes('disembunyikan'), chatSubtitle({ jid: lidJid }))
  check('subjudul grup', chatSubtitle({ jid: '123@g.us', isGroup: true }) === 'Grup')

  // 2) ensureChat tidak lagi mengarang nama dari JID
  const { chat: fresh } = await ensureChat(session.id, '628111222333@s.whatsapp.net', {})
  check('chat baru tanpa nama dibiarkan kosong', fresh.name === null, fresh.name)

  // 3) Perbaikan otomatis: chat @lid digabung ke chat bernomor
  const lidChat = await prisma.chat.create({
    data: {
      sessionId: session.id,
      jid: '999888777666555@lid',
      name: '999888777666555',
      lastMessagePreview: 'halo',
      lastMessageAt: new Date(),
    },
  })
  await prisma.message.create({
    data: {
      sessionId: session.id, chatId: lidChat.id, waMessageId: 'LID-1', fromMe: false,
      senderJid: '6281299998888@s.whatsapp.net', senderName: 'Sari', type: 'text',
      text: 'halo dari lid', status: 'delivered', timestamp: new Date(),
    },
  })
  await prisma.message.create({
    data: {
      sessionId: session.id, chatId: lidChat.id, waMessageId: 'LID-2', fromMe: true,
      type: 'text', text: 'balasan saya', status: 'sent', timestamp: new Date(),
    },
  })

  const repair = await sessionManager.repairLidChats(session.id, new Map())
  check('perbaikan menemukan 1 chat @lid', repair.scanned === 1 && repair.repaired === 1, repair)
  check('chat @lid sudah tidak ada', (await prisma.chat.count({ where: { sessionId: session.id, jid: '999888777666555@lid' } })) === 0)
  const merged = await prisma.chat.findUnique({ where: { sessionId_jid: { sessionId: session.id, jid: '6281299998888@s.whatsapp.net' } } })
  check('chat bernomor terbentuk dengan riwayat utuh', Boolean(merged) && (await prisma.message.count({ where: { chatId: merged!.id } })) === 2, merged?.jid)
  check('nama salinan JID tidak diwariskan', merged?.name === null, merged?.name)
  check('jumlah belum dibaca ikut terbawa', merged?.unreadCount === 0, merged?.unreadCount)

  // 4) Perbaikan lewat peta lid→pn yang sudah dipelajari
  const lidChat2 = await prisma.chat.create({
    data: { sessionId: session.id, jid: '111122223333444@lid', name: '111122223333444' },
  })
  const repair2 = await sessionManager.repairLidChats(
    session.id,
    new Map([['111122223333444', '628771112223']]),
  )
  check('perbaikan memakai peta lid→pn', repair2.repaired >= 1, repair2)
  check('chat dari peta ikut digabung', (await prisma.chat.count({ where: { sessionId: session.id, jid: '628771112223@s.whatsapp.net' } })) === 1)
  check('chat tanpa data tetap dilaporkan belum selesai', (await sessionManager.repairLidChats(session.id, new Map())).repaired === 0)
  await prisma.chat.delete({ where: { id: lidChat2.id } }).catch(() => undefined)
}

console.log('\n=== 20. BUKU KONTAK (sinkronisasi + impor manual) ===')
{
  const { isLidAddress } = await import('@/lib/utils')

  // 1) Kontak kiriman WhatsApp (contacts.upsert) tersimpan lengkap.
  const stored = await sessionManager.syncContacts(session.id, [
    { id: '628111000111@s.whatsapp.net', name: 'Andi Wijaya', notify: 'Andi' },
    { id: '628222000222@s.whatsapp.net', name: 'Bunga Lestari', notify: 'Bunga' },
    { id: '999888777666@lid', name: 'Cantika (LID)' },
    { id: 'status@broadcast', name: 'jangan disimpan' },
  ])
  check('kontak dari WhatsApp disimpan', stored.stored === 3, stored)
  check('status@broadcast diabaikan', (await prisma.contact.count({ where: { sessionId: session.id, jid: 'status@broadcast' } })) === 0)

  const list = await sessionManager.listContacts(session.id)
  check(
    'daftar kontak memuat kiriman WhatsApp',
    list.contacts.some((item) => item.jid.startsWith('628111')) &&
      list.contacts.some((item) => item.jid.startsWith('628222')) &&
      list.contacts.some((item) => isLidAddress(item.jid)),
    list.shown,
  )
  const andi = list.contacts.find((item) => item.jid.startsWith('628111'))
  check('nama dari HP jadi nama tampilan', andi?.displayName === 'Andi Wijaya', andi?.displayName)
  check('nomor telepon kontak tersimpan', andi?.phoneNumber === '628111000111', andi?.phoneNumber)
  await sessionManager.syncContacts(session.id, [{ id: '777666555444@lid' }])
  const lidOnly = (await sessionManager.listContacts(session.id)).contacts.find((item) => item.jid === '777666555444@lid')
  check(
    'kontak @lid tanpa nama tampil ramah (bukan nomor asing)',
    Boolean(lidOnly) && lidOnly!.displayName.startsWith('Kontak WhatsApp') && !lidOnly!.displayName.startsWith('+'),
    lidOnly?.displayName,
  )
  check('belum ada chat untuk kontak baru', andi?.hasChat === false && andi?.chatId === null)

  // 2) Pencarian: nama dan nomor sama-sama bisa.
  const byName = await sessionManager.listContacts(session.id, { q: 'bunga' })
  check('cari pakai nama (huruf kecil) menemukan', byName.contacts.length === 1 && byName.contacts[0].displayName === 'Bunga Lestari', byName.shown)
  const byNumber = await sessionManager.listContacts(session.id, { q: '628222' })
  check('cari pakai nomor menemukan', byNumber.contacts.length === 1 && byNumber.contacts[0].phoneNumber === '628222000222')
  check('kata kunci ngawur tidak menemukan apa pun', (await sessionManager.listContacts(session.id, { q: 'zzz-tidak-ada' })).contacts.length === 0)

  // 3) Kontak yang pernah berkirim pesan otomatis tercatat.
  await manager.handleIncomingMessage(live, mk({
    key: { remoteJid: '628333000333@s.whatsapp.net', fromMe: false, id: 'KONTAK-1' },
    message: { conversation: 'halo, saya Dedi' },
    pushName: 'Dedi Kurniawan',
  }))
  await new Promise((resolve) => setTimeout(resolve, 250))
  const dedi = await prisma.contact.findFirst({ where: { sessionId: session.id, jid: '628333000333@s.whatsapp.net' } })
  check('pengirim pesan masuk jadi kontak', dedi?.name === 'Dedi Kurniawan' && dedi?.source === 'pesan', dedi?.name)
  const listAfter = await sessionManager.listContacts(session.id)
  const dediRow = listAfter.contacts.find((item) => item.jid.startsWith('628333'))
  check('kontak yang punya chat ditandai', dediRow?.hasChat === true && Boolean(dediRow?.chatId), dediRow)

  // 4) Impor manual: diverifikasi dulu ke WhatsApp.
  const imported = await sessionManager.importContacts(session.id, [
    '0812-3456-7890',
    '628990001111',
    '628990000',
    '628990001111',
    '0000',
  ])
  check('duplikat & nomor tak valid disaring', imported.checked === 3, imported.checked)
  check('nomor aktif ditambahkan', imported.added === 2, imported.added)
  check('nomor tidak terdaftar dilaporkan', imported.missing.includes('628990000'), imported.missing)
  const manualRow = await prisma.contact.findFirst({ where: { sessionId: session.id, jid: '6281234567890@s.whatsapp.net' } })
  check('nomor 0-awalan dinormalkan ke 62', manualRow?.phoneNumber === '6281234567890' && manualRow?.source === 'manual', manualRow?.phoneNumber)
  check('impor tanpa nomor valid ditolak', await (async () => {
    try {
      await sessionManager.importContacts(session.id, ['abc', '  '])
      return false
    } catch {
      return true
    }
  })())

  // 5) Hapus kontak dari panel.
  const toDelete = await prisma.contact.findFirst({ where: { sessionId: session.id, jid: '628222000222@s.whatsapp.net' } })
  await sessionManager.deleteContact(toDelete!.id)
  check('kontak bisa dihapus', (await prisma.contact.count({ where: { sessionId: session.id, jid: '628222000222@s.whatsapp.net' } })) === 0)
  check('hapus kontak tak dikenal ditolak', await (async () => {
    try {
      await sessionManager.deleteContact('tidak-ada')
      return false
    } catch {
      return true
    }
  })())

  // 6) Perbaikan @lid juga merapikan baris kontak.
  await prisma.contact.update({
    where: { sessionId_jid: { sessionId: session.id, jid: '999888777666@lid' } },
    data: { name: 'Cantika' },
  })
  const repairResult = await sessionManager.repairLidChats(
    session.id,
    new Map([
      ['999888777666', '628444000444'],
      ['777666555444', '628555000555'],
    ]),
  )
  check('kontak @lid tanpa chat ikut dirapikan', repairResult.contactsRepaired >= 1, repairResult.contactsRepaired)
  const migrated = await prisma.contact.findFirst({ where: { sessionId: session.id, jid: '628444000444@s.whatsapp.net' } })
  check('kontak @lid digabung ke nomor telepon', migrated?.phoneNumber === '628444000444' && migrated?.name === 'Cantika', migrated?.phoneNumber)
  check('baris kontak @lid sudah hilang', (await prisma.contact.count({ where: { sessionId: session.id, jid: { endsWith: '@lid' } } })) === 0)

  await prisma.contact.deleteMany({ where: { sessionId: session.id } })
}

console.log('\n=== 21. DAFTAR CHAT BERSIH (buku alamat tidak bikin chat kosong) ===')
{
  const before = await prisma.chat.count({ where: { sessionId: session.id } })

  // 1) Sinkronisasi kontak TIDAK boleh membuat baris chat baru...
  await sessionManager.syncContacts(session.id, [
    { id: '628777111222@s.whatsapp.net', name: 'Kontak Tanpa Pesan' },
    { id: '628777333444@s.whatsapp.net', name: 'Kontak Lain' },
  ])
  const afterSync = await prisma.chat.count({ where: { sessionId: session.id } })
  check('kontak baru tidak membuat chat kosong', afterSync === before, { before, afterSync })
  check('kontak tetap tersimpan di buku kontak', (await prisma.contact.count({ where: { sessionId: session.id, jid: { startsWith: '628777' } } })) === 2)

  // 2) Nama kontak tetap menempel ke chat yang SUDAH ada.
  const liveChat = await prisma.chat.create({
    data: {
      sessionId: session.id, jid: '628777555666@s.whatsapp.net', name: null,
      lastMessagePreview: 'halo', lastMessageAt: new Date(),
    },
  })
  await prisma.message.create({
    data: {
      sessionId: session.id, chatId: liveChat.id, waMessageId: 'PRUNE-1', fromMe: false,
      senderJid: '628777555666@s.whatsapp.net', type: 'text', text: 'halo', status: 'delivered',
      timestamp: new Date(),
    },
  })
  await sessionManager.syncContacts(session.id, [{ id: '628777555666@s.whatsapp.net', name: 'Nama Baru Dari HP' }])
  check(
    'nama kontak menempel ke chat yang sudah ada',
    (await prisma.chat.findUnique({ where: { id: liveChat.id } }))?.name === 'Nama Baru Dari HP',
  )

  // 3) Chat kosong dibersihkan, yang berisi/penting dipertahankan.
  const emptyChat = await prisma.chat.create({
    data: { sessionId: session.id, jid: '628888000111@s.whatsapp.net', name: 'Sisa sync' },
  })
  const pinnedChat = await prisma.chat.create({
    data: { sessionId: session.id, jid: '628888000222@s.whatsapp.net', name: 'Disematkan', pinned: true },
  })
  const unreadChat = await prisma.chat.create({
    data: { sessionId: session.id, jid: '628888000333@s.whatsapp.net', name: 'Ada unread', unreadCount: 3 },
  })
  const previewChat = await prisma.chat.create({
    data: {
      sessionId: session.id, jid: '628888000444@s.whatsapp.net', name: 'Ada cuplikan',
      lastMessagePreview: 'pesan terakhir',
    },
  })

  const pruned = await sessionManager.pruneEmptyChats(session.id)
  check('chat kosong dihapus', (await prisma.chat.count({ where: { id: emptyChat.id } })) === 0, pruned.removed)
  check('chat kosong lain & yang berisi tetap ada', (await prisma.chat.count({ where: { id: { in: [liveChat.id, pinnedChat.id, unreadChat.id, previewChat.id] } } })) === 4)
  check('chat bersemat tidak dihapus', (await prisma.chat.count({ where: { id: pinnedChat.id } })) === 1)
  check('chat dengan unread tidak dihapus', (await prisma.chat.count({ where: { id: unreadChat.id } })) === 1)
  check('chat dengan cuplikan pesan tidak dihapus', (await prisma.chat.count({ where: { id: previewChat.id } })) === 1)
  check('chat berisi pesan tidak dihapus', (await prisma.chat.count({ where: { id: liveChat.id } })) === 1)
  check('aman dijalankan berkali-kali', (await sessionManager.pruneEmptyChats(session.id)).removed === 0)

  // 4) Chat kosong dibuat ulang otomatis begitu ada pesan baru.
  await manager.handleIncomingMessage(live, mk({
    key: { remoteJid: '628888000111@s.whatsapp.net', fromMe: false, id: 'PRUNE-NEW' },
    message: { conversation: 'pesan menyusul' },
  }))
  await new Promise((resolve) => setTimeout(resolve, 250))
  const revived = await prisma.chat.findUnique({ where: { sessionId_jid: { sessionId: session.id, jid: '628888000111@s.whatsapp.net' } } })
  check('chat dibentuk ulang saat ada pesan', Boolean(revived) && (await prisma.message.count({ where: { chatId: revived!.id } })) === 1)

  await prisma.contact.deleteMany({ where: { sessionId: session.id } })
  await prisma.chat.deleteMany({ where: { sessionId: session.id, jid: { startsWith: '628888' } } })
}

socket.close()
await prisma.waSession.delete({ where: { id: session.id } })
await prisma.$disconnect()
httpServer.close()
console.log(`\nHASIL: ${pass} lulus, ${fail} gagal\n`)
process.exit(fail === 0 ? 0 : 1)
