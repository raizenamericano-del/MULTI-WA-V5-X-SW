'use client'

import * as React from 'react'
import useSWR from 'swr'
import {
  Archive,
  ArrowLeft,
  CheckCheck,
  Download,
  FileJson,
  FileText,
  Loader2,
  MoreVertical,
  RefreshCw,
  Users,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { MessageBubble } from '@/components/chat/message-bubble'
import { ForwardDialog } from '@/components/chat/forward-dialog'
import { MessageComposer } from '@/components/chat/message-composer'
import { api } from '@/lib/fetcher'
import { useSocket } from '@/hooks/use-socket'
import type { ChatDTO, MessageDTO } from '@/lib/types'
import { chatDisplayName, chatSubtitle, cn, dayLabel } from '@/lib/utils'

interface Props {
  sessionId: string
  sessionLabel: string
  chat: ChatDTO | null
  messages: MessageDTO[]
  isLoading: boolean
  onBack: () => void
  onChanged: () => void
  onTyping: (state: 'composing' | 'paused') => void
  /** Pesan yang dibuka dari hasil pencarian — digulir ke sini dan disorot. */
  focusMessageId?: string | null
  /** Masih ada pesan lama di server? */
  hasMore?: boolean
  /** Ambil halaman pesan sebelumnya (infinite scroll). */
  onLoadOlder?: () => Promise<void>
  /** Buang sorotan setelah dibaca. */
  onFocusHandled?: () => void
}

/** Cuplikan teks yang tampil di bilah balasan composer. */
function replyPreview(message: MessageDTO) {
  if (message.text?.trim()) return message.text
  switch (message.type) {
    case 'image':
      return '📷 Foto'
    case 'video':
      return '🎥 Video'
    case 'audio':
      return '🎙️ Pesan suara'
    case 'document':
      return `📄 ${message.mediaName ?? 'Dokumen'}`
    case 'sticker':
      return '🩹 Stiker'
    default:
      return 'Pesan'
  }
}

export function Conversation({
  sessionId,
  sessionLabel,
  chat,
  messages,
  isLoading,
  onBack,
  onChanged,
  onTyping,
  focusMessageId = null,
  hasMore = false,
  onLoadOlder,
  onFocusHandled,
}: Props) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const bottomRef = React.useRef<HTMLDivElement | null>(null)
  const [lightbox, setLightbox] = React.useState<MessageDTO | null>(null)
  const [sendingRefresh, setSendingRefresh] = React.useState(false)
  const [replyTo, setReplyTo] = React.useState<MessageDTO | null>(null)
  const [loadingOlder, setLoadingOlder] = React.useState(false)
  const [highlightId, setHighlightId] = React.useState<string | null>(null)
  const [forwardTarget, setForwardTarget] = React.useState<MessageDTO | null>(null)
  const keepScrollRef = React.useRef<{ height: number; top: number } | null>(null)
  const skipAutoScrollRef = React.useRef(false)
  const { socket } = useSocket()

  const { data: avatar } = useSWR<{ url: string | null }>(
    chat ? `/api/sessions/${sessionId}/avatar?jid=${encodeURIComponent(chat.jid)}` : null,
    { dedupingInterval: 300000, revalidateOnFocus: false },
  )

  // Gulir otomatis ke pesan terbaru — kecuali saat kita sedang memuat pesan lama
  // atau melompat ke hasil pencarian.
  React.useEffect(() => {
    if (skipAutoScrollRef.current || focusMessageId) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, chat?.id, focusMessageId])

  // Setelah pesan lama ditambahkan, pertahankan posisi baca pengguna.
  React.useLayoutEffect(() => {
    const element = scrollRef.current
    const saved = keepScrollRef.current
    if (!element || !saved) return
    // Pesan lama ditambahkan di atas → geser viewport sebesar tinggi tambahannya
    // supaya pesan yang sedang dibaca tetap di posisi yang sama.
    element.scrollTop = saved.top + (element.scrollHeight - saved.height)
    keepScrollRef.current = null
  }, [messages])

  // Lompat ke pesan hasil pencarian (kalau sudah termuat).
  React.useEffect(() => {
    if (!focusMessageId || !chat) return
    const element = document.getElementById(`msg-${focusMessageId}`)
    if (!element) return
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightId(focusMessageId)
    const timer = setTimeout(() => {
      setHighlightId(null)
      onFocusHandled?.()
    }, 4000)
    return () => clearTimeout(timer)
  }, [focusMessageId, chat, messages, onFocusHandled])

  async function loadOlder() {
    if (!onLoadOlder || loadingOlder) return
    const element = scrollRef.current
    if (element) keepScrollRef.current = { height: element.scrollHeight, top: element.scrollTop }
    skipAutoScrollRef.current = true
    setLoadingOlder(true)
    try {
      await onLoadOlder()
    } finally {
      setLoadingOlder(false)
      // beri kesempatan layout selesai sebelum auto-scroll kembali aktif
      setTimeout(() => {
        skipAutoScrollRef.current = false
      }, 400)
    }
  }

  // A reply belongs to a single chat only.
  React.useEffect(() => {
    setReplyTo(null)
  }, [chat?.id])

  const grouped = React.useMemo(() => {
    const groups: { day: string; items: MessageDTO[] }[] = []
    for (const message of messages) {
      const label = dayLabel(message.timestamp)
      const last = groups[groups.length - 1]
      if (last && last.day === label) last.items.push(message)
      else groups.push({ day: label, items: [message] })
    }
    return groups
  }, [messages])

  if (!chat) {
    return (
      <div className="hidden flex-1 flex-col items-center justify-center gap-3 p-10 text-center md:flex">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.04]">
          <Users className="h-7 w-7 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">Pilih sebuah percakapan</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Pilih chat di sebelah kiri, atau mulai chat baru dengan nomor pilihanmu. Semua pesan yang
          masuk akan langsung muncul di sini.
        </p>
      </div>
    )
  }

  const title = chatDisplayName(chat)

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-white/[0.06] bg-[hsl(200_25%_5%)]/80 px-3 py-2.5 backdrop-blur md:px-4">
        <Button variant="ghost" size="iconSm" className="md:hidden" onClick={onBack} aria-label="Kembali">
          <ArrowLeft />
        </Button>
        <Avatar name={title} src={avatar?.url ?? null} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {chat.isGroup && <Users className="h-3 w-3 text-muted-foreground" />}
            <h2 className="truncate text-sm font-semibold">{title}</h2>
          </div>
          <p className="truncate text-[11px] text-muted-foreground">
            {chatSubtitle(chat)} · via {sessionLabel}
          </p>
        </div>

        <Button
          variant="ghost"
          size="iconSm"
          aria-label="Muat ulang pesan"
          onClick={() => {
            setSendingRefresh(true)
            onChanged()
            setTimeout(() => setSendingRefresh(false), 600)
          }}
        >
          {sendingRefresh ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="iconSm" aria-label="Aksi chat">
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={async () => {
                await api.patch(`/api/chats/${chat.id}`, { read: true }).catch(() => undefined)
                toast.success('Ditandai sudah dibaca')
                onChanged()
              }}
            >
              <CheckCheck className="h-4 w-4" /> Tandai sudah dibaca
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                await api
                  .patch(`/api/chats/${chat.id}`, { pinned: !chat.pinned })
                  .then(() => toast.success(chat.pinned ? 'Pin dilepas' : 'Chat di-pin'))
                  .catch(() => toast.error('Gagal memperbarui chat'))
                onChanged()
              }}
            >
              📌 {chat.pinned ? 'Lepas pin' : 'Pin'} chat
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                window.open(`/api/chats/${chat.id}/export?format=txt`, '_blank')
                toast.success('Mengekspor percakapan ke TXT…')
              }}
            >
              <FileText className="h-4 w-4" /> Ekspor ke TXT
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                window.open(`/api/chats/${chat.id}/export?format=json`, '_blank')
                toast.success('Mengekspor percakapan ke JSON…')
              }}
            >
              <FileJson className="h-4 w-4" /> Ekspor ke JSON
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                await api
                  .patch(`/api/chats/${chat.id}`, { archived: true })
                  .then(() => toast.success('Chat diarsipkan'))
                  .catch(() => toast.error('Gagal mengarsipkan chat'))
                onBack()
                onChanged()
              }}
            >
              <Archive className="h-4 w-4" /> Arsipkan
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="chat-wallpaper scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6">
        {isLoading && messages.length === 0 ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((key) => (
              <Skeleton key={key} className={cn('h-14 w-2/3', key % 2 ? 'ml-auto' : '')} />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-2xl border border-white/[0.06] bg-black/30 px-5 py-4 text-center text-sm text-muted-foreground">
              Belum ada pesan di chat ini.
              <br />
              Sapa duluan 👋
            </div>
          </div>
        ) : (
          <>
            {(hasMore || (onLoadOlder && messages.length > 0)) && (
              <div className="mb-3 flex justify-center">
                <Button
                  variant="secondary"
                  size="sm"
                  loading={loadingOlder}
                  onClick={() => void loadOlder()}
                  className="text-[11px]"
                >
                  {loadingOlder ? 'Memuat pesan lama…' : 'Muat pesan lama'}
                </Button>
              </div>
            )}
          </>
        )}
        {messages.length > 0 &&
          grouped.map((group) => (
            <div key={group.day} className="space-y-2">
              <div className="sticky top-0 z-10 flex justify-center py-2">
                <span className="rounded-full border border-white/[0.06] bg-black/50 px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground backdrop-blur">
                  {group.day}
                </span>
              </div>
              {group.items.map((message, index) => {
                const previous = group.items[index - 1]
                const showSender =
                  chat.isGroup &&
                  !message.fromMe &&
                  (!previous || previous.senderJid !== message.senderJid)
                return (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    showSender={showSender}
                    isGroup={chat.isGroup}
                    highlight={highlightId === message.id}
                    onOpenMedia={setLightbox}
                    onReply={(target) => {
                      setReplyTo(target)
                      document.querySelector('textarea')?.focus()
                    }}
                    onForward={setForwardTarget}
                    onReact={(target, emoji) => {
                      const mine = Object.entries(target.reactions ?? {}).some(([, value]) => value === emoji)
                      socket?.emit('chat:typing', { sessionId, chatId: chat.id, state: 'paused' })
                      void api
                        .post(`/api/messages/${target.id}/reaction`, { emoji: mine ? '' : emoji })
                        .then(() => {
                          toast.success(mine ? 'Reaksi dihapus' : `Memberi reaksi ${emoji}`)
                          onChanged()
                        })
                        .catch((error: unknown) =>
                          toast.error(error instanceof Error ? error.message : 'Gagal memberi reaksi'),
                        )
                    }}
                    onDeleteLocal={() => onChanged()}
                    onUpdated={onChanged}
                  />
                )
              })}
            </div>
          ))}
        <div ref={bottomRef} />
      </div>

      <ForwardDialog
        sessionId={sessionId}
        message={forwardTarget}
        open={Boolean(forwardTarget)}
        onOpenChange={(open) => !open && setForwardTarget(null)}
      />

      <MessageComposer
        sessionId={sessionId}
        chatId={chat.id}
        onSent={onChanged}
        onTyping={onTyping}
        replyTo={
          replyTo
            ? { id: replyTo.id, text: replyPreview(replyTo), fromMe: replyTo.fromMe }
            : null
        }
        onCancelReply={() => setReplyTo(null)}
      />

      {/* Lightbox */}
      <Dialog open={Boolean(lightbox)} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent className="max-w-4xl border-none bg-black/90 p-2">
          <DialogHeader className="sr-only">
            <DialogTitle>Pratinjau media</DialogTitle>
            <DialogDescription>Pratinjau ukuran penuh dari media yang dipilih</DialogDescription>
          </DialogHeader>
          {lightbox && (
            <div className="flex flex-col items-center gap-3">
              {lightbox.type === 'video' ? (
                <video
                  src={`/api/media?id=${lightbox.id}`}
                  controls
                  autoPlay
                  className="max-h-[75vh] w-full rounded-xl"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/media?id=${lightbox.id}`}
                  alt={lightbox.text ?? 'media'}
                  className="max-h-[75vh] w-auto rounded-xl object-contain"
                />
              )}
              {lightbox.text && (
                <p className="max-w-2xl text-center text-sm text-white/80">{lightbox.text}</p>
              )}
              <div className="flex gap-2">
                <Button asChild variant="secondary" size="sm">
                  <a href={`/api/media?id=${lightbox.id}&download=1`} target="_blank" rel="noreferrer">
                    <Download /> Unduh
                  </a>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setLightbox(null)}>
                  <X /> Tutup
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
