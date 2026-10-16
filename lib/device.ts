/**
 * Identitas perangkat untuk notifikasi push.
 *
 * Browser tidak punya ID perangkat yang bisa dibaca server, jadi kita membuat
 * satu ID acak, menyimpannya di localStorage, lalu mengirimkannya baik saat
 * mendaftar langganan push maupun saat melaporkan "panel sedang dilihat".
 * Dengan begitu server tahu perangkat mana yang perlu dinotifikasi.
 *
 * (Dibuat di sisi klien saja — file ini tidak pernah dijalankan di server.)
 */

const KEY = 'wa-controller-device-id'

export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server'

  try {
    const existing = window.localStorage.getItem(KEY)
    if (existing) return existing

    const generated =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

    window.localStorage.setItem(KEY, generated)
    return generated
  } catch {
    // Mode privat/penyimpanan diblokir → tetap beri ID sementara per tab.
    return 'anon'
  }
}

export function getDeviceLabel(): string {
  const deviceId = getDeviceId()
  return deviceId === 'anon' || deviceId === 'server' ? deviceId : `${deviceId.slice(0, 8)}…`
}
