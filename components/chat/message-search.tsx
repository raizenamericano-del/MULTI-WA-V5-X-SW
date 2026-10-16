'use client'

import * as React from 'react'
import { Loader2, MessageSquare, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/fetcher'
import type { ChatDTO, MessageDTO } from '@/lib/types'
import { chatDisplayName, cn, formatDateTime } from '@/lib/utils'

interface SearchHit {
  message: MessageDTO
  chat: ChatDTO
}

/**
 * Pencarian pesan di seluruh percakapan sebuah nomor.
 * Menghubungi GET /api/sessions/:id/search?q=…
 */
export function MessageSearch({
  sessionId,
  chatId,
  chatName,
  onOpenChat,
}: {
  sessionId: string
  /** Bila diisi, sediakan opsi "hanya chat ini". */
  chatId?: string | null
  chatName?: string | null
  onOpenChat: (chatId: string, messageId: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [onlyThisChat, setOnlyThisChat] = React.useState(false)
  const [hits, setHits] = React.useState<SearchHit[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [searched, setSearched] = React.useState(false)

  // Pintasan keyboard: Ctrl/Cmd + K
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  React.useEffect(() => {
    setOnlyThisChat(false)
  }, [chatId])

  React.useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setHits([])
      setSearched(false)
      setError(null)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const scoped = onlyThisChat && chatId ? `&chatId=${encodeURIComponent(chatId)}` : ''
        const result = await api.get<{ results: SearchHit[] }>(
          `/api/sessions/${sessionId}/search?q=${encodeURIComponent(trimmed)}&limit=40${scoped}`,
        )
        setHits(result.results ?? [])
        setSearched(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Pencarian gagal')
      } finally {
        setLoading(false)
      }
    }, 350)

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [query, sessionId, onlyThisChat, chatId])

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} title="Cari pesan (Ctrl+K)">
        <Search /> Cari
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="h-4 w-4 text-[#25D366]" /> Cari pesan
            </DialogTitle>
            <DialogDescription>
              Telusuri isi pesan, nama berkas, pengirim, atau nama percakapan. Minimal 2 karakter.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Contoh: invoice, Budi, laporan…"
              className="pl-9 pr-9"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-muted-foreground hover:bg-white/[0.06]"
                aria-label="Bersihkan"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {chatId && (
            <label className="flex cursor-pointer items-center gap-2 px-0.5 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={onlyThisChat}
                onChange={(event) => setOnlyThisChat(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-white/20 bg-white/5 accent-[#25D366]"
              />
              Hanya cari di chat ini{chatName ? ` (${chatName})` : ''}
            </label>
          )}

          <div className="scrollbar-thin max-h-[55vh] min-h-[120px] space-y-2 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Mencari…
              </div>
            )}

            {!loading && error && (
              <div className="rounded-xl border border-red-500/25 bg-red-500/[0.08] px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            {!loading && !error && searched && hits.length === 0 && (
              <p className="py-8 text-center text-xs text-muted-foreground">
                Tidak ada pesan yang cocok dengan “{query}”.
              </p>
            )}

            {!loading &&
              hits.map((hit) => (
                <button
                  key={hit.message.id}
                  type="button"
                  onClick={() => {
                    onOpenChat(hit.chat.id, hit.message.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-left transition',
                    'hover:border-[#25D366]/30 hover:bg-[#25D366]/[0.06]',
                  )}
                >
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.05]">
                    <MessageSquare className="h-3.5 w-3.5 text-[#4ade80]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium">
                        {chatDisplayName({ name: hit.chat.name, jid: hit.chat.jid })}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {formatDateTime(hit.message.timestamp)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {hit.message.fromMe ? 'Kamu: ' : ''}
                      {hit.message.text || hit.message.mediaName || 'Media'}
                    </span>
                  </span>
                </button>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
