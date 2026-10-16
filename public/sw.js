/**
 * Service worker WA Multi-Device Controller.
 *
 * 1. Web Push  → notifikasi pesan baru walau panel/browser ditutup.
 * 2. Offline   → aset statis di-cache agar panel tetap terbuka saat sinyal buruk.
 *
 * Tidak pernah meng-cache respons API (data chat selalu segar dari server).
 */

const CACHE = 'wa-controller-v3'
const STATIC_PREFIXES = ['/_next/static/', '/icon', '/apple-touch-icon', '/manifest.webmanifest']
const OFFLINE_HTML = `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Panel sedang offline</title>
<style>
 body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0f14;color:#e9edef;
      font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center;padding:24px}
 .dot{width:52px;height:52px;border-radius:16px;margin:0 auto 16px;
      background:linear-gradient(135deg,#25D366,#128C7E)}
 p{color:#94a3b8;font-size:14px;max-width:320px;line-height:1.6}
</style></head><body><div><div class="dot"></div>
<h2>Koneksi terputus</h2>
<p>Panel butuh internet untuk membaca chat WhatsApp. Coba muat ulang sebentar lagi.</p></div></body></html>`

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['/icon.svg', '/manifest.webmanifest']).catch(() => undefined))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Jangan pernah cache API (data chat harus selalu segar).
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') return

  // Aset statis Next + ikon: cache-first (immutable).
  if (STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone()
              void caches.open(CACHE).then((cache) => cache.put(request, copy))
            }
            return response
          }),
      ),
    )
    return
  }

  // Navigasi halaman: network-first, fallback halaman offline sederhana.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(OFFLINE_HTML, {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }),
      ),
    )
  }
})

/* --------------------------------- Web Push -------------------------------- */

self.addEventListener('push', (event) => {
  let data = {
    title: 'WA Multi-Device Controller',
    body: 'Ada pesan baru',
    url: '/',
    tag: 'wa-controller',
    viewOnce: false,
  }

  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {
    if (event.data) data.body = event.data.text()
  }

  const target = data.url || '/'
  const options = {
    body: data.body,
    tag: data.tag || 'wa-controller',
    renotify: false,
    badge: '/icon-192.png',
    icon: '/icon-192.png',
    data: { url: target, chatId: data.chatId, sessionId: data.sessionId },
  }

  event.waitUntil(self.registration.showNotification(data.title || 'Pesan baru', options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        try {
          const clientUrl = new URL(client.url)
          if (clientUrl.origin === self.location.origin) {
            client.postMessage({ type: 'notify-click', url })
            return client.focus()
          }
        } catch {
          /* lanjut ke klien berikutnya */
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
