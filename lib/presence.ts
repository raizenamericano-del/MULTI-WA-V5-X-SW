/**
 * Melacak apakah ADA browser yang sedang melihat panel (tab aktif) dan di
 * perangkat mana (deviceId).
 *
 * Dipakai untuk memutuskan apakah notifikasi Web Push perlu dikirim:
 *   - perangkat yang panelnya sedang DILIHAT  → tidak dikirim (cukup toast/suara
 *     di halaman itu, supaya notifikasi tidak dobel),
 *   - perangkat lain (mis. HP saat panel dibuka di laptop) → tetap dikirim.
 *
 * State disimpan di `globalThis` karena route handler Next dibundel terpisah
 * dari `server.ts` (lihat penjelasan singleton di README).
 */
type Visibility = 'visible' | 'hidden'

interface ClientState {
  visibility: Visibility
  deviceId: string | null
}

interface PresenceStore {
  clients: Map<string, ClientState>
}

const store: PresenceStore =
  (globalThis as unknown as { __waPresence?: PresenceStore }).__waPresence ??
  ((globalThis as unknown as { __waPresence?: PresenceStore }).__waPresence = {
    clients: new Map(),
  })

export function registerClient(socketId: string, deviceId?: string | null) {
  store.clients.set(socketId, { visibility: 'hidden', deviceId: deviceId ?? null })
}

export function setVisibility(socketId: string, visibility: Visibility, deviceId?: string | null) {
  const current = store.clients.get(socketId)
  store.clients.set(socketId, {
    visibility,
    deviceId: deviceId ?? current?.deviceId ?? null,
  })
}

export function removeClient(socketId: string) {
  store.clients.delete(socketId)
}

/** Jumlah tab yang sedang tampil (visible) di semua perangkat. */
export function visibleClientCount() {
  let count = 0
  for (const value of store.clients.values()) if (value.visibility === 'visible') count += 1
  return count
}

/** deviceId yang panelnya sedang tampil — perangkat ini tidak perlu dikirimi push. */
export function visibleDeviceIds(): Set<string> {
  const ids = new Set<string>()
  for (const value of store.clients.values()) {
    if (value.visibility === 'visible' && value.deviceId) ids.add(value.deviceId)
  }
  return ids
}

export function connectedClientCount() {
  return store.clients.size
}
