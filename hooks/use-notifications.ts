'use client'

import * as React from 'react'
import { APP_SHORT_NAME } from '@/lib/branding'

const SETTINGS_KEY = 'wa-controller:notify-settings'

export interface NotifySettings {
  sound: boolean
  desktop: boolean
}

const DEFAULT_SETTINGS: NotifySettings = { sound: false, desktop: false }

function readSettings(): NotifySettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<NotifySettings>) } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** Nada notifikasi singkat ala WhatsApp, dibuat pakai Web Audio (tanpa file asset). */
function playChime() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    const now = ctx.currentTime

    const notes = [
      { freq: 880, start: 0, duration: 0.14 },
      { freq: 1174.7, start: 0.13, duration: 0.22 },
    ]

    for (const note of notes) {
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = note.freq
      gain.gain.setValueAtTime(0.0001, now + note.start)
      gain.gain.exponentialRampToValueAtTime(0.18, now + note.start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.duration)
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start(now + note.start)
      oscillator.stop(now + note.start + note.duration + 0.02)
    }

    setTimeout(() => void ctx.close().catch(() => undefined), 1200)
  } catch {
    /* audio tidak tersedia — abaikan */
  }
}

export interface IncomingNotification {
  title: string
  body: string
  unreadTotal?: number
}

/**
 * Notifikasi & suara untuk pesan masuk, plus badge jumlah unread di judul tab.
 * Semua berbasis localStorage: tidak ada data yang dikirim ke mana pun.
 */
export function useNotifications() {
  const [settings, setSettings] = React.useState<NotifySettings>(DEFAULT_SETTINGS)
  const [permission, setPermission] = React.useState<NotificationPermission | 'unsupported'>('default')
  const baseTitle = React.useRef<string | null>(null)

  React.useEffect(() => {
    setSettings(readSettings())
    if (typeof Notification === 'undefined') setPermission('unsupported')
    else setPermission(Notification.permission)
    baseTitle.current = document.title || APP_SHORT_NAME
  }, [])

  const persist = React.useCallback((next: NotifySettings) => {
    setSettings(next)
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }, [])

  const requestDesktopPermission = React.useCallback(async () => {
    if (typeof Notification === 'undefined') {
      setPermission('unsupported')
      return 'unsupported' as const
    }
    const result = await Notification.requestPermission()
    setPermission(result)
    if (result === 'granted') persist({ ...readSettings(), desktop: true })
    return result
  }, [persist])

  const toggleSound = React.useCallback(() => {
    const next = { ...readSettings(), sound: !readSettings().sound }
    persist(next)
    if (next.sound) playChime() // feedback langsung
    return next.sound
  }, [persist])

  const toggleDesktop = React.useCallback(async () => {
    const current = readSettings()
    if (current.desktop) {
      persist({ ...current, desktop: false })
      return false
    }
    const result = await requestDesktopPermission()
    if (result !== 'granted') {
      persist({ ...current, desktop: false })
      return false
    }
    persist({ ...current, desktop: true })
    return true
  }, [persist, requestDesktopPermission])

  /** Panggil setiap ada pesan masuk. */
  const notify = React.useCallback((info: IncomingNotification) => {
    const current = readSettings()

    if (current.sound) playChime()

    if (
      current.desktop &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted' &&
      document.visibilityState !== 'visible'
    ) {
      try {
        const notification = new Notification(info.title, {
          body: info.body,
          icon: '/icon.svg',
          tag: 'wa-controller',
        })
        notification.onclick = () => {
          window.focus()
          notification.close()
        }
      } catch {
        /* browser bisa menolak tanpa interaksi user */
      }
    }
  }, [])

  /** Tampilkan jumlah unread di judul tab. */
  const setTitleBadge = React.useCallback((unread: number) => {
    if (typeof document === 'undefined') return
    const base = baseTitle.current ?? APP_SHORT_NAME
    document.title = unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${base}` : base
  }, [])

  return { settings, permission, toggleSound, toggleDesktop, notify, setTitleBadge }
}
