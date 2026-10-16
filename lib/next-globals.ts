/**
 * Menyiapkan global yang dibutuhkan Next.js SEBELUM modul Next dimuat.
 *
 * Next `next/dist/server/node-environment.js` biasanya menyuntikkan
 * `AsyncLocalStorage` (dan `WebSocket`) ke `globalThis`. Namun runtime Next yang
 * sudah terkompilasi menangkap `globalThis.AsyncLocalStorage` **saat modul
 * dievaluasi**; bila urutan pemuatan berbeda — yang bisa terjadi pada custom
 * server (`server.ts`) yang dijalankan lewat `tsx` — nilainya masih `undefined`
 * sehingga halaman dinamis & route handler gagal dengan:
 *
 *   "Invariant: AsyncLocalStorage accessed in runtime where it is not available"
 *
 * Modul ini WAJIB diimpor paling atas di `server.ts` (dan aman dipanggil
 * berulang kali — tidak menimpa bila sudah ada).
 */
import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

if (typeof (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage !== 'function') {
  ;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage
}

if (typeof (globalThis as { AsyncResource?: unknown }).AsyncResource !== 'function') {
  ;(globalThis as { AsyncResource?: unknown }).AsyncResource = AsyncResource
}

if (typeof (globalThis as { WebSocket?: unknown }).WebSocket !== 'function') {
  try {
    // Next menyediakan implementasi ws untuk runtime Node.
    const ws = require('next/dist/compiled/ws') as { WebSocket?: unknown }
    if (typeof ws.WebSocket === 'function') {
      Object.defineProperty(globalThis, 'WebSocket', {
        configurable: true,
        get: () => ws.WebSocket,
      })
    }
  } catch {
    /* tidak fatal — hanya dipakai sebagian fitur dev */
  }
}
