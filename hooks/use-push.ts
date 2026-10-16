import * as React from 'react'
import { APP_SHORT_NAME } from '@/lib/branding'
import { getDeviceId } from '@/lib/device'

/**
 * Web Push (PWA) dari sisi browser.
 *
 * - mendaftarkan service worker `/sw.js`
 * - minta izin + langganan push (butuh kunci publik VAPID dari server)
 * - melaporkan status supaya UI bisa memberi petunjuk yang tepat
 */
export type PushStatus =
  | 'loading'
  | 'unsupported' // browser tidak mendukung Push API
  | 'ios-install' // iOS: harus "Tambahkan ke Layar Utama" dulu
  | 'denied' // izin diblokir user
  | 'off'
  | 'on'
  | 'error'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

function isIosNeedingInstall() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document)
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  return ios && !standalone
}

function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  )
}

export function usePush() {
  const [status, setStatus] = React.useState<PushStatus>('loading')
  const [busy, setBusy] = React.useState(false)
  const [subscriptions, setSubscriptions] = React.useState(0)
  const [message, setMessage] = React.useState<string | null>(null)

  const registerWorker = React.useCallback(async () => {
    if (!('serviceWorker' in navigator)) return null
    try {
      return await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    } catch {
      return null
    }
  }, [])

  const refresh = React.useCallback(async () => {
    if (!pushSupported()) {
      setStatus(isIosNeedingInstall() ? 'ios-install' : 'unsupported')
      return
    }
    const registration = await navigator.serviceWorker.getRegistration('/')
    const existing = await registration?.pushManager.getSubscription()
    if (existing) setStatus('on')
    else if (Notification.permission === 'denied') setStatus('denied')
    else setStatus('off')
  }, [])

  React.useEffect(() => {
    void (async () => {
      if (isIosNeedingInstall()) {
        setStatus('ios-install')
        return
      }
      if (!pushSupported()) {
        setStatus('unsupported')
        return
      }
      await registerWorker()
      await refresh()
    })()
  }, [registerWorker, refresh])

  // Notifikasi diklik → service worker mengirim pesan ke tab ini.
  React.useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null
      if (data?.type === 'notify-click' && data.url && window.location.pathname !== data.url) {
        window.location.href = data.url
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [])

  const enable = React.useCallback(async () => {
    setBusy(true)
    setMessage(null)
    try {
      if (!pushSupported()) {
        setStatus(isIosNeedingInstall() ? 'ios-install' : 'unsupported')
        return false
      }

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setStatus('denied')
        setMessage('Izin notifikasi ditolak. Aktifkan lewat setelan situs di browser.')
        return false
      }

      const registration = (await navigator.serviceWorker.getRegistration('/')) ?? (await registerWorker())
      if (!registration) {
        setStatus('error')
        setMessage('Service worker gagal didaftarkan (butuh HTTPS atau localhost).')
        return false
      }

      await navigator.serviceWorker.ready

      const keyResponse = await fetch('/api/push/key')
      if (!keyResponse.ok) throw new Error('Kunci push tidak tersedia')
      const { publicKey } = (await keyResponse.json()) as { publicKey: string }

      const applicationServerKey = urlBase64ToUint8Array(publicKey)
      let subscription = await registration.pushManager.getSubscription()

      // Kalau kunci VAPID server berubah (mis. volume dibuat ulang), langganan lama
      // otomatis ditolak layanan push. Buang lalu buat langganan baru.
      const currentKey = subscription?.options?.applicationServerKey
      if (subscription && currentKey) {
        const current = new Uint8Array(currentKey)
        const same =
          current.length === applicationServerKey.length &&
          current.every((byte, index) => byte === applicationServerKey[index])
        if (!same) {
          await subscription.unsubscribe().catch(() => undefined)
          subscription = null
        }
      }

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        })
      }

      const payload = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
      const save = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint: payload.endpoint,
          keys: { p256dh: payload.keys?.p256dh, auth: payload.keys?.auth },
          deviceId: getDeviceId(),
        }),
      })
      if (!save.ok) throw new Error('Server menolak langganan push')

      const info = (await save.json()) as { subscriptions?: number }
      setSubscriptions(info.subscriptions ?? 1)
      setStatus('on')
      setMessage('Notifikasi push aktif di perangkat ini.')
      return true
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'Gagal mengaktifkan notifikasi push')
      return false
    } finally {
      setBusy(false)
    }
  }, [registerWorker])

  const disable = React.useCallback(async () => {
    setBusy(true)
    try {
      const registration = await navigator.serviceWorker.getRegistration('/')
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => undefined)
        await subscription.unsubscribe().catch(() => undefined)
      }
      setStatus('off')
      setMessage('Notifikasi push dimatikan di perangkat ini.')
      return true
    } finally {
      setBusy(false)
    }
  }, [])

  const sendTest = React.useCallback(async () => {
    const response = await fetch('/api/push/test', { method: 'POST' })
    if (!response.ok) throw new Error('Gagal mengirim notifikasi percobaan')
    const result = (await response.json()) as {
      sent: number
      failed: number
      removed: number
      devices: number
      skipped: number
      details: { host: string; ok: boolean; statusCode?: number; error?: string }[]
      hint: string | null
    }
    setSubscriptions((current) => Math.max(0, current - result.removed))
    return result
  }, [])

  return {
    status,
    busy,
    subscriptions,
    message,
    enable,
    disable,
    sendTest,
    refresh,
    appName: APP_SHORT_NAME,
  }
}

