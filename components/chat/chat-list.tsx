'use client'

import * as React from 'react'
import { Loader2, MessageSquarePlus, Pin, Search, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/fetcher'
import type { ChatDTO } from '@/lib/types'
import { chatDisplayName, cn, formatChatTimestamp, truncate } from '@/lib/utils'

interface Props {
  sessionId: string
  chats: ChatDTO[]
  isLoading: boolean
  activeChatId: string | null
  onSelect: (chatId: string) => void
  onChanged: () => void
}

export function ChatList({
  sessionId,
  chats,
  isLoading,
  activeChatId,
  onSelect,
  onChanged,
}: Props) {
  const [search, setSearch] = React.useState('')
  const searchRef = React.useRef<HTMLInputElement>(null)
  const [newOpen, setNewOpen] = React.useState(false)
  const [phoneNumber, setPhoneNumber] = React.useState('')
  const [creating, setCreating] = React.useState(false)

  // Pintasan PWA "Cari pesan" membuka /?cari=1 → langsung fokus ke kolom pencarian chat.
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('cari') !== '1') return
    searchRef.current?.focus()
    params.delete('cari')
    const query = params.toString()
    window.history.replaceState(null, '', query ? `/?${query}` : '/')
  }, [])

  const filtered = React.useMemo(() => {
    if (!search.trim()) return chats
    const needle = search.toLowerCase()
    return chats.filter(
      (chat) =>
        (chat.name ?? '').toLowerCase().includes(needle) ||
        chat.jid.toLowerCase().includes(needle) ||
        (chat.lastMessagePreview ?? '').toLowerCase().includes(needle),
    )
  }, [chats, search])

  async function openByNumber() {
    setCreating(true)
    try {
      const { chat } = await api.post<{ chat: ChatDTO }>(`/api/sessions/${sessionId}/chats`, {
        phoneNumber,
      })
      toast.success('Chat siap', { description: chat.name ?? chat.jid })
      setNewOpen(false)
      setPhoneNumber('')
      onChanged()
      onSelect(chat.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Nomor tersebut tidak bisa dibuka')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-white/[0.06] bg-[hsl(200_25%_5%)]/60">
      <div className="space-y-3 border-b border-white/[0.06] p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Percakapan</h2>
          <Button variant="secondary" size="sm" onClick={() => setNewOpen(true)}>
            <MessageSquarePlus /> Baru
          </Button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cari nama atau nomor…"
            className="h-10 pl-9"
          />
        </div>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {isLoading && chats.length === 0 ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2, 3, 4].map((key) => (
              <Skeleton key={key} className="h-16 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <MessageSquarePlus className="h-6 w-6 opacity-60" />
            {chats.length === 0 ? (
              <>
                <span>Belum ada percakapan. Pesan masuk akan langsung muncul di sini.</span>
                <span className="mt-1 max-w-[280px] text-[11px] text-muted-foreground/70">
                  Sudah ada chat di HP tapi di sini kosong? Buka{' '}
                  <b>Dasbor → ⋮ → Jalankan diagnostik</b> untuk memastikan server benar-benar
                  menerima event dari WhatsApp.
                </span>
              </>
            ) : (
              'Tidak ada chat yang cocok dengan pencarian.'
            )}
          </div>
        ) : (
          filtered.map((chat) => {
            const isActive = chat.id === activeChatId
            return (
              <button
                key={chat.id}
                type="button"
                onClick={() => onSelect(chat.id)}
                className={cn(
                  'flex w-full items-center gap-3 border-b border-white/[0.03] px-4 py-3 text-left transition-colors',
                  isActive ? 'bg-[#25D366]/[0.08]' : 'hover:bg-white/[0.03]',
                )}
              >
                <Avatar name={chat.name ?? chat.jid} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                      {chat.pinned && <Pin className="h-3 w-3 text-[#25D366]" />}
                      {chat.isGroup && <Users className="h-3 w-3 text-muted-foreground" />}
                      <span className="truncate">
                        {chatDisplayName(chat)}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {formatChatTimestamp(chat.lastMessageAt)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-muted-foreground">
                      {truncate(chat.lastMessagePreview || 'Belum ada pesan', 42)}
                    </span>
                    {chat.unreadCount > 0 && (
                      <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#25D366] px-1.5 text-[10px] font-semibold text-[#04150f]">
                        {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })
        )}
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mulai chat baru</DialogTitle>
            <DialogDescription>
              Masukkan nomor tujuan dalam format internasional (tanpa <code>+</code>).
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={phoneNumber}
            inputMode="numeric"
            placeholder="6281234567890"
            onChange={(event) => setPhoneNumber(event.target.value.replace(/[^\d+]/g, ''))}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewOpen(false)}>
              Batal
            </Button>
            <Button onClick={openByNumber} loading={creating} disabled={phoneNumber.length < 8}>
              {creating ? <Loader2 className="animate-spin" /> : null} Buka chat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
