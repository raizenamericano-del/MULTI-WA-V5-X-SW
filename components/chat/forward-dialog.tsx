'use client'

import * as React from 'react'
import useSWR from 'swr'
import { Forward, Loader2, Search, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Avatar } from '@/components/ui/avatar'
import { api } from '@/lib/fetcher'
import type { ChatDTO, MessageDTO } from '@/lib/types'
import { chatDisplayName } from '@/lib/utils'

/**
 * Dialog "Teruskan pesan": pilih percakapan tujuan di sesi yang sama.
 * Media yang sudah tersimpan ikut diteruskan (dibaca ulang dari disk di server).
 */
export function ForwardDialog({
  sessionId,
  message,
  open,
  onOpenChange,
}: {
  sessionId: string
  message: MessageDTO | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [search, setSearch] = React.useState('')
  const [sending, setSending] = React.useState<string | null>(null)

  const { data, isLoading } = useSWR<{ chats: ChatDTO[] }>(
    open ? `/api/sessions/${sessionId}/chats` : null,
  )

  const chats = React.useMemo(() => {
    const list = data?.chats ?? []
    if (!search.trim()) return list.slice(0, 60)
    const needle = search.toLowerCase()
    return list
      .filter(
        (chat) =>
          (chat.name ?? '').toLowerCase().includes(needle) || chat.jid.toLowerCase().includes(needle),
      )
      .slice(0, 60)
  }, [data?.chats, search])

  async function forwardTo(chat: ChatDTO) {
    if (!message) return
    setSending(chat.id)
    try {
      const result = await api.post<{ targetChatName: string | null }>(
        `/api/messages/${message.id}/forward`,
        { chatId: chat.id },
      )
      toast.success('Pesan diteruskan', {
        description: `Terkirim ke ${result.targetChatName ?? chat.name ?? chat.jid.split('@')[0]}`,
      })
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal meneruskan pesan')
    } finally {
      setSending(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Forward className="h-4 w-4 text-[#25D366]" /> Teruskan pesan
          </DialogTitle>
          <DialogDescription>
            Pilih percakapan tujuan. Pesan teks, media, dan stiker yang tersimpan di panel akan
            dikirim ulang ke chat tersebut.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cari nama atau nomor…"
            className="pl-9"
          />
        </div>

        <div className="scrollbar-thin max-h-[50vh] space-y-1.5 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}

          {!isLoading && chats.length === 0 && (
            <p className="py-8 text-center text-xs text-muted-foreground">
              Tidak ada percakapan yang cocok.
            </p>
          )}

          {chats.map((chat) => (
            <button
              key={chat.id}
              type="button"
              disabled={Boolean(sending)}
              onClick={() => void forwardTo(chat)}
              className="flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left transition hover:border-[#25D366]/30 hover:bg-[#25D366]/[0.06] disabled:opacity-60"
            >
              <Avatar name={chat.name ?? chat.jid} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 truncate text-xs font-medium">
                  {chat.isGroup && <Users className="h-3 w-3 text-muted-foreground" />}
                  {chatDisplayName(chat)}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {chat.lastMessagePreview || 'Belum ada pesan'}
                </span>
              </span>
              {sending === chat.id ? (
                <Loader2 className="h-4 w-4 animate-spin text-[#25D366]" />
              ) : (
                <Forward className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
