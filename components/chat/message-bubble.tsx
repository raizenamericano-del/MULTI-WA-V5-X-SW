'use client'

import * as React from 'react'
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  Contact as ContactIcon,
  Copy,
  CornerUpLeft,
  Download,
  Eye,
  FileText,
  Forward,
  Loader2,
  MapPin,
  MoreVertical,
  RefreshCw,
  SmilePlus,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { AudioPlayer } from '@/components/chat/audio-player'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { api } from '@/lib/fetcher'
import type { MessageDTO, MessageStatus } from '@/lib/types'
import { cn, formatBytes, formatDateTime, formatTime } from '@/lib/utils'

const QUICK_REACTIONS = ['❤️', '😂', '👍', '🙏', '🔥', '😮', '😢']

function StatusTicks({ status }: { status: MessageStatus }) {
  if (status === 'failed') return <AlertCircle className="h-3.5 w-3.5 text-red-400" />
  if (status === 'pending') return <Clock className="h-3 w-3 opacity-80" />
  if (status === 'sent') return <Check className="h-3.5 w-3.5 opacity-80" />
  if (status === 'read') return <CheckCheck className="h-3.5 w-3.5 text-[#53bdeb]" />
  return <CheckCheck className="h-3.5 w-3.5 opacity-80" />
}

function typeLabel(message: MessageDTO) {
  switch (message.type) {
    case 'image':
      return '📷 Foto'
    case 'video':
      return '🎥 Video'
    case 'audio':
      return '🎙️ Pesan suara'
    case 'document':
      return message.mediaName ?? '📄 Dokumen'
    case 'sticker':
      return '🩹 Stiker'
    default:
      return '💬 Pesan'
  }
}

interface Props {
  message: MessageDTO
  showSender: boolean
  isGroup: boolean
  /** true bila pesan ini dibuka dari hasil pencarian (disorot sebentar). */
  highlight?: boolean
  onOpenMedia: (message: MessageDTO) => void
  onReply: (message: MessageDTO) => void
  onForward: (message: MessageDTO) => void
  onReact: (message: MessageDTO, emoji: string) => void
  onDeleteLocal: (message: MessageDTO) => void
  onUpdated: () => void
}

export function MessageBubble({
  message,
  showSender,
  isGroup,
  highlight = false,
  onOpenMedia,
  onReply,
  onForward,
  onReact,
  onDeleteLocal,
  onUpdated,
}: Props) {
  const out = message.fromMe
  const mediaUrl = message.mediaPath ? `/api/media?id=${message.id}` : null
  const downloadUrl = mediaUrl ? `${mediaUrl}&download=1` : null

  const [revealed, setRevealed] = React.useState(!message.viewOnce)
  const [busy, setBusy] = React.useState(false)
  const [reactOpen, setReactOpen] = React.useState(false)

  const reactions = Object.values(message.reactions ?? {})
  const isDeleted = Boolean(message.deletedAt)
  const isVideoNote = message.extra?.ptv === true
  const mediaMissing = !mediaUrl && message.type !== 'text' && message.type !== 'other'
  const mediaPending = mediaMissing && !isDeleted

  async function retryDownload() {
    setBusy(true)
    try {
      await api.post(`/api/messages/${message.id}/download`)
      toast.success('Media berhasil diunduh')
      onUpdated()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Media belum tersedia')
    } finally {
      setBusy(false)
    }
  }

  async function deleteForEveryone() {
    setBusy(true)
    try {
      await api.delete(`/api/messages/${message.id}?scope=everyone`)
      toast.success('Pesan dihapus untuk semua orang')
      onUpdated()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal menghapus pesan')
    } finally {
      setBusy(false)
    }
  }

  async function deleteForMe() {
    setBusy(true)
    try {
      await api.delete(`/api/messages/${message.id}?scope=me`)
      toast.success('Pesan dihapus dari panel ini')
      onDeleteLocal(message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal menghapus pesan')
    } finally {
      setBusy(false)
    }
  }

  /* --------------------------------- deleted -------------------------------- */
  if (isDeleted) {
    return (
      <div className={cn('flex w-full', out ? 'justify-end' : 'justify-start')}>
        <div
          className={cn(
            'flex max-w-[85%] items-center gap-2 px-4 py-2.5 text-sm italic opacity-70 sm:max-w-[70%]',
            out ? 'bubble-out' : 'bubble-in',
          )}
        >
          <AlertCircle className="h-3.5 w-3.5" />
          {out ? 'Kamu menghapus pesan ini' : 'Pesan ini telah dihapus'}
          <span className="text-[10px] not-italic opacity-80">{formatTime(message.timestamp)}</span>
        </div>
      </div>
    )
  }

  const hasMediaBlock =
    (message.type === 'image' || message.type === 'sticker' || message.type === 'video') && mediaUrl

  return (
    <div className={cn('group flex w-full', out ? 'justify-end' : 'justify-start')}>
      <div className="flex max-w-[88%] items-end gap-1 sm:max-w-[70%] md:max-w-[65%]">
        {/* hover actions (left side for outgoing) */}
        {out && (
          <BubbleActions
            message={message}
            isGroup={isGroup}
            busy={busy}
            hasText={Boolean(message.text)}
            hasMedia={Boolean(downloadUrl)}
            onReply={onReply}
            onForward={onForward}
            onReact={onReact}
            onReactOpen={() => setReactOpen((v) => !v)}
            onDeleteEveryone={deleteForEveryone}
            onDeleteMe={deleteForMe}
          />
        )}

        <div
          id={`msg-${message.id}`}
          className={cn(
            'relative px-3 py-2 text-sm shadow-sm transition-shadow duration-500',
            out ? 'bubble-out' : 'bubble-in',
            reactOpen && 'ring-1 ring-[#25D366]/40',
            highlight && 'ring-2 ring-amber-400/80 shadow-[0_0_30px_-6px_rgba(251,191,36,0.8)]',
          )}
        >
          {showSender && !out && message.senderName && (
            <div className="mb-1 text-[11px] font-semibold text-[#4ade80]">{message.senderName}</div>
          )}

          {/* quoted / reply context */}
          {message.quoted && (
            <div
              className={cn(
                'mb-1.5 flex flex-col gap-0.5 rounded-lg border-l-2 px-2.5 py-1.5 text-xs',
                out ? 'border-[#25D366] bg-black/20' : 'border-[#4ade80] bg-black/25',
              )}
            >
              <span className="font-medium text-[#4ade80]">
                {message.quoted.fromMe ? 'Kamu' : typeLabel(message)}
              </span>
              <span className="line-clamp-2 opacity-85">{message.quoted.text}</span>
            </div>
          )}

          {/* view-once badge */}
          {message.viewOnce && (
            <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-medium text-[#4ade80]">
              <Eye className="h-3 w-3" /> Sekali lihat
            </div>
          )}

          {/* ------------------------------ MEDIA ------------------------------ */}
          {message.extra?.gifPlayback === true && message.type === 'video' && (
            <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-medium text-[#4ade80]">
              GIF
            </span>
          )}

          {message.extra?.ptv === true && (
            <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-medium text-[#4ade80]">
              ⭕ Video bulat
            </span>
          )}

          {hasMediaBlock && (
            <div className={cn('relative mb-1', isVideoNote && 'mx-auto w-fit')}>
              {message.type === 'video' ? (
                <video
                  src={mediaUrl as string}
                  controls={revealed && !isVideoNote}
                  autoPlay={isVideoNote && revealed}
                  loop={isVideoNote || message.extra?.gifPlayback === true}
                  muted={isVideoNote || message.extra?.gifPlayback === true}
                  playsInline
                  preload="metadata"
                  className={cn(
                    'bg-black/40',
                    isVideoNote
                      ? 'h-60 w-60 rounded-full object-cover'
                      : 'max-h-80 w-full rounded-xl',
                    !revealed && 'blur-2xl',
                  )}
                />
              ) : message.type === 'sticker' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl as string} alt="stiker" className="h-32 w-32 object-contain" loading="lazy" />
              ) : (
                <button type="button" onClick={() => revealed && onOpenMedia(message)} className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={mediaUrl as string}
                    alt={message.text ?? 'image'}
                    className={cn(
                      'max-h-80 w-full rounded-xl object-cover transition-all duration-300',
                      !revealed && 'blur-2xl brightness-[0.6]',
                    )}
                    loading="lazy"
                  />
                </button>
              )}

              {!revealed && (
                <button
                  type="button"
                  onClick={() => setRevealed(true)}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-xl bg-black/25 text-white backdrop-blur-[1px] transition hover:bg-black/35"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50">
                    <Eye className="h-5 w-5" />
                  </span>
                  <span className="text-xs font-medium">Ketuk untuk melihat</span>
                </button>
              )}
            </div>
          )}

          {message.type === 'audio' && mediaUrl && (
            <AudioPlayer src={mediaUrl} duration={message.mediaDuration} out={out} />
          )}

          {message.type === 'document' && (
            <a
              href={downloadUrl ?? '#'}
              target="_blank"
              rel="noreferrer"
              className={cn(
                'mb-1 flex items-center gap-3 rounded-xl p-2 transition',
                out ? 'bg-white/10 hover:bg-white/15' : 'bg-black/25 hover:bg-black/35',
              )}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10">
                <FileText className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">
                  {message.mediaName ?? 'Dokumen'}
                </span>
                <span className="block text-[10px] opacity-70">
                  {formatBytes(message.mediaSize)} · ketuk untuk mengunduh
                </span>
              </span>
              <Download className="h-4 w-4 opacity-70" />
            </a>
          )}

          {/* media still not available from WhatsApp (typical for view-once) */}
          {mediaPending && (
            <div
              className={cn(
                'mb-1 flex items-center gap-2 rounded-xl px-3 py-2 text-xs',
                out ? 'bg-white/10' : 'bg-black/25',
              )}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span className="flex-1">
                {message.mediaError
                  ? `Media belum tersedia — ${message.mediaError}`
                  : message.mediaStatus === 'failed'
                    ? 'Media tidak bisa diambil dari WhatsApp'
                    : 'Menunggu WhatsApp mengirim berkasnya…'}
              </span>
              {message.mediaStatus !== 'failed' && (
                <button
                  type="button"
                  onClick={() => void retryDownload()}
                  disabled={busy}
                  className="rounded-lg bg-black/30 px-2 py-1 text-[10px] font-medium transition hover:bg-black/45 disabled:opacity-50"
                >
                  Coba lagi
                </button>
              )}
            </div>
          )}

          {message.type === 'other' && message.extra ? (
            <ExtraCard message={message} />
          ) : message.text ? (
            <p className="whitespace-pre-wrap break-words leading-relaxed">{message.text}</p>
          ) : null}

          {!message.text && !hasMediaBlock && !mediaPending && message.type !== 'audio' && (
            <p className="text-xs italic opacity-70">[pesan {message.type}]</p>
          )}

          {/* reactions */}
          {reactions.length > 0 && (
            <div className={cn('mt-1.5 flex flex-wrap gap-1', out ? 'justify-end' : 'justify-start')}>
              {reactions.map((emoji, index) => (
                <span
                  key={`${emoji}-${index}`}
                  className="rounded-full border border-white/15 bg-black/35 px-1.5 py-0.5 text-[11px] leading-none"
                >
                  {emoji}
                </span>
              ))}
            </div>
          )}

          {/* quick reaction row */}
          {reactOpen && (
            <div className="absolute -top-11 left-0 z-20 flex items-center gap-1 rounded-full border border-white/[0.08] bg-[hsl(200_24%_7%)] px-2 py-1 shadow-xl">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="rounded-full px-1 text-base transition hover:scale-125"
                  onClick={() => {
                    onReact(message, emoji)
                    setReactOpen(false)
                  }}
                >
                  {emoji}
                </button>
              ))}
              <button
                type="button"
                className="rounded-full p-1 text-muted-foreground hover:text-foreground"
                onClick={() => setReactOpen(false)}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          <div
            className={cn(
              'mt-1 flex items-center justify-end gap-1 text-[10px]',
              out ? 'text-white/70' : 'text-white/50',
            )}
          >
            <span>{formatTime(message.timestamp)}</span>
            {out && <StatusTicks status={message.status} />}
          </div>
        </div>

        {/* hover actions (right side for incoming) */}
        {!out && (
          <BubbleActions
            message={message}
            isGroup={isGroup}
            busy={busy}
            hasText={Boolean(message.text)}
            hasMedia={Boolean(downloadUrl)}
            onReply={onReply}
            onForward={onForward}
            onReact={onReact}
            onReactOpen={() => setReactOpen((v) => !v)}
            onDeleteEveryone={deleteForEveryone}
            onDeleteMe={deleteForMe}
          />
        )}
      </div>
    </div>
  )
}

function BubbleActions({
  message,
  isGroup,
  busy,
  hasText,
  hasMedia,
  onReply,
  onForward,
  onReact,
  onReactOpen,
  onDeleteEveryone,
  onDeleteMe,
}: {
  message: MessageDTO
  isGroup: boolean
  busy: boolean
  hasText: boolean
  hasMedia: boolean
  onReply: (message: MessageDTO) => void
  onForward: (message: MessageDTO) => void
  onReact: (message: MessageDTO, emoji: string) => void
  onReactOpen: () => void
  onDeleteEveryone: () => void
  onDeleteMe: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="iconSm"
          aria-label="Aksi pesan"
          className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 max-md:opacity-60"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={message.fromMe ? 'end' : 'start'} side="top">
        <DropdownMenuItem onSelect={() => onReply(message)}>
          <CornerUpLeft className="h-4 w-4" /> Balas
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onReactOpen()}>
          <SmilePlus className="h-4 w-4" /> Beri reaksi
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onForward(message)}>
          <Forward className="h-4 w-4" /> Teruskan
        </DropdownMenuItem>
        {hasText && (
          <DropdownMenuItem
            onSelect={async () => {
              await navigator.clipboard.writeText(message.text ?? '')
              toast.success('Teks disalin')
            }}
          >
            <Copy className="h-4 w-4" /> Salin teks
          </DropdownMenuItem>
        )}
        {hasMedia && (
          <DropdownMenuItem asChild>
            <a href={`/api/media?id=${message.id}&download=1`} target="_blank" rel="noreferrer">
              <Download className="h-4 w-4" /> Unduh media
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {message.fromMe && (
          <DropdownMenuItem
            className="text-red-300 focus:text-red-200"
            onSelect={() => void onDeleteEveryone()}
            disabled={busy}
          >
            <Trash2 className="h-4 w-4" /> Hapus untuk semua orang
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className="text-red-300 focus:text-red-200"
          onSelect={() => void onDeleteMe()}
          disabled={busy}
        >
          <Trash2 className="h-4 w-4" /> Hapus untuk saya
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Bentuk `extra` yang kita simpan di server untuk pesan non-standar. */
interface BubbleExtra {
  gifPlayback?: boolean
  ptv?: boolean
  location?: { lat: number; lng: number; name?: string | null; mapsUrl: string }
  poll?: { name: string; options: string[]; selectableCount: number | null }
  contact?: { displayName?: string | null; phone?: string | null }
  event?: { name?: string | null; startTime?: number | null }
  product?: { title?: string | null; description?: string | null }
  rawType?: string
}

/**
 * Render untuk pesan yang bukan teks/media biasa: polling, lokasi, kartu kontak,
 * produk katalog, acara, dan tipe WhatsApp lain yang belum kita kenali.
 */
function ExtraCard({ message }: { message: MessageDTO }) {
  const extra = (message.extra ?? {}) as BubbleExtra

  if (extra.poll) {
    return (
      <div className="mb-1 min-w-[210px] space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">📊 Polling</div>
        <div className="font-medium">{extra.poll.name}</div>
        <ul className="space-y-1">
          {extra.poll.options.map((option, index) => (
            <li
              key={`${option}-${index}`}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-xs"
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full border border-white/25 text-[9px]">
                {index + 1}
              </span>
              <span className="truncate">{option}</span>
            </li>
          ))}
        </ul>
        <div className="text-[10px] opacity-70">
          {extra.poll.selectableCount
            ? `Pilih ${extra.poll.selectableCount} opsi · jawaban tidak dipantau panel`
            : 'Jawaban tidak dipantau panel'}
        </div>
      </div>
    )
  }

  if (extra.location) {
    return (
      <div className="mb-1 min-w-[210px] space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MapPin className="h-4 w-4 text-[#4ade80]" /> Lokasi
        </div>
        <div className="text-xs opacity-85">{extra.location.name || 'Lokasi dibagikan'}</div>
        <div className="font-mono text-[10px] opacity-70">
          {extra.location.lat.toFixed(5)}, {extra.location.lng.toFixed(5)}
        </div>
        <a
          href={extra.location.mapsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-black/30 px-2.5 py-1 text-[11px] font-medium transition hover:bg-black/45"
        >
          <MapPin className="h-3 w-3" /> Buka di Google Maps
        </a>
      </div>
    )
  }

  if (extra.contact) {
    const phone = extra.contact.phone?.replace(/[^\d+]/g, '') ?? null
    return (
      <div className="mb-1 min-w-[210px] space-y-1.5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ContactIcon className="h-4 w-4 text-[#4ade80]" /> Kartu kontak
        </div>
        <div className="text-xs">{extra.contact.displayName || 'Tanpa nama'}</div>
        {phone && (
          <a
            href={`https://wa.me/${phone.replace('+', '')}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-lg bg-black/30 px-2.5 py-1 text-[11px] font-mono transition hover:bg-black/45"
          >
            {phone}
          </a>
        )}
      </div>
    )
  }

  if (extra.event || extra.product) {
    return (
      <div className="mb-1 min-w-[210px] space-y-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
          {extra.event ? '📅 Acara' : '🛍️ Produk'}
        </div>
        <div className="text-sm font-medium">
          {extra.event?.name ?? extra.product?.title ?? 'Tanpa judul'}
        </div>
        {extra.event?.startTime ? (
          <div className="text-[11px] opacity-75">
            {formatDateTime(extra.event.startTime < 1e12 ? extra.event.startTime * 1000 : extra.event.startTime)}
          </div>
        ) : null}
        {extra.product?.description && (
          <div className="text-[11px] leading-relaxed opacity-75">{extra.product.description}</div>
        )}
        <div className="text-[10px] opacity-60">
          Pesan {extra.rawType ?? 'khusus WhatsApp'} — hanya ditampilkan, tidak semua bisa dibalas.
        </div>
      </div>
    )
  }

  return (
    <div className="mb-1 min-w-[180px] space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
        💬 Pesan khusus
      </div>
      {message.text && <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>}
      <div className="text-[10px] opacity-60">
        Tipe: {extra.rawType ?? message.type} — belum ada render khusus, isinya tetap ditampilkan.
      </div>
    </div>
  )
}
