import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 6281234567890 -> 6281234567890@s.whatsapp.net */
export function toJid(phoneNumber: string) {
  const digits = phoneNumber.replace(/\D/g, '')
  return `${digits}@s.whatsapp.net`
}

/** 6281234567890@s.whatsapp.net -> 6281234567890 */
export function jidToNumber(jid: string) {
  return jid.split('@')[0].split(':')[0]
}

/** +62 812-3456-7890 / 0812... -> 6281234567890 */
export function normalizePhoneNumber(input: string, defaultCountryCode = '62') {
  let digits = (input || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('0')) digits = defaultCountryCode + digits.slice(1)
  return digits
}

export function isGroupJid(jid: string) {
  return jid.endsWith('@g.us')
}

export function shortJid(jid: string) {
  return jid.split('@')[0]
}

/**
 * JID `@lid` = alamat anonim WhatsApp (Linked ID), BUKAN nomor telepon.
 * Angka di depannya bisa panjang dan berawalan apa saja (mis. `225…`),
 * jadi jangan pernah dirender sebagai nomor telepon.
 */
export function isLidAddress(jid?: string | null) {
  return Boolean(jid && jid.endsWith('@lid'))
}

/**
 * Nama "placeholder" = angka mentah yang dulu ikut disalin dari JID saat chat
 * belum punya nama asli (mis. `225123456789012` untuk chat `@lid`).
 * Dibandingkan dengan JID-nya supaya nama asli berupa angka (mis. grup bernama
 * "2026") tidak ikut dibuang.
 */
export function isPlaceholderChatName(name: string | null | undefined, jid?: string | null) {
  if (!name || !jid) return false
  const trimmed = name.trim()
  if (!trimmed || !/^[\d\s+().-]+$/.test(trimmed)) return false
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length < 8) return false
  const user = jidToNumber(jid)
  return Boolean(user) && (user.startsWith(digits) || digits.startsWith(user))
}

/**
 * Judul chat yang aman dipakai di UI:
 *   1. nama asli (kontak / pushName / subjek grup),
 *   2. nomor telepon untuk chat biasa yang belum bernama,
 *   3. label ramah untuk alamat `@lid` yang belum terterjemahkan —
 *      bukan `+225 1234-5678-9012` yang menyesatkan.
 */
export function chatDisplayName(input: { name?: string | null; jid: string }) {
  const name = input.name?.trim()
  if (name && !isPlaceholderChatName(name, input.jid)) return name
  if (isLidAddress(input.jid)) {
    const tail = jidToNumber(input.jid).slice(-4)
    return tail ? `Kontak WhatsApp (…${tail})` : 'Kontak WhatsApp'
  }
  return formatPhoneNumber(input.jid)
}

/** Baris kecil di bawah judul chat pada header percakapan. */
export function chatSubtitle(input: { jid: string; isGroup?: boolean | null }) {
  if (input.isGroup) return 'Grup'
  if (isLidAddress(input.jid)) return 'Nomor disembunyikan WhatsApp — menunggu tersinkron'
  return formatPhoneNumber(input.jid)
}

/**
 * Nomor telepon -> format enak dibaca.
 *   6281234567890 -> +62 812-3456-7890
 *   14155552671   -> +1 (415) 555-2671
 * Berguna juga untuk nomor negara lain (kode negara 1–3 digit).
 */
export function formatPhoneNumber(input: string) {
  const digits = jidToNumber(input).replace(/\D/g, '')
  if (!digits) return input

  // Indonesia (kasus paling umum di panel ini: 62 + 8xx…)
  if (digits.startsWith('62') && digits.length >= 10) {
    const rest = digits.slice(2)
    const parts = rest.match(/^(\d{3})(\d{3,4})(\d{3,5})$/)
    if (parts) return `+62 ${parts[1]}-${parts[2]}-${parts[3]}`
    return `+62 ${rest}`
  }

  // Amerika/Kanada
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }

  // Umum: kode negara 1–3 digit, sisanya dikelompokkan
  const match = digits.match(/^(\d{1,3})(\d{3,4})(\d{3,4})(\d*)$/)
  if (!match) return `+${digits}`
  return `+${match[1]} ${match[2]}-${match[3]}${match[4] ? `-${match[4]}` : ''}`
}

export function formatBytes(bytes?: number | null) {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDuration(seconds?: number | null) {
  if (!seconds || seconds <= 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export const LOCALE = 'id-ID'

export function formatTime(date: string | number | Date) {
  const d = new Date(date)
  return d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
}

export function formatDateTime(date: string | number | Date) {
  const d = new Date(date)
  return d.toLocaleString(LOCALE, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** WhatsApp-style relative time: 14:05 / Yesterday / 12/09/2025 */
export function formatChatTimestamp(date: string | number | Date) {
  const d = new Date(date)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) return formatTime(d)

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Kemarin'

  return d.toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function dayLabel(date: string | number | Date) {
  const d = new Date(date)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Hari ini'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Kemarin'
  return d.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function getInitials(name?: string | null, fallback = '?') {
  if (!name) return fallback
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || fallback
}

export function truncate(text: string | null | undefined, max = 60) {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Small emoji palette used by the chat composer. */
export const avatarEmojis = [
  '😀', '😂', '🥲', '😍', '🤩', '😎', '🤔', '🙏', '👍', '👎',
  '🔥', '🎉', '❤️', '💚', '✅', '❌', '⏰', '📌', '💰', '📞',
]
