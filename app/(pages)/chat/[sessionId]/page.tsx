'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSWRConfig } from 'swr'
import { ChevronLeft, Radio, TriangleAlert } from 'lucide-react'
import { ChatList } from '@/components/chat/chat-list'
import { MessageSearch } from '@/components/chat/message-search'
import { Conversation } from '@/components/chat/conversation'
import { SessionStatusBadge } from '@/components/session-status-badge'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/fetcher'
import { useChats, useMessages, useSession } from '@/hooks/use-api'
import { useOpenChat, useSessionRoom, useSocket, useSocketEvent } from '@/hooks/use-socket'
import type { ChatDTO, MessageDTO } from '@/lib/types'
import { cn } from '@/lib/utils'

export default function ChatPage({ params }: { params: { sessionId: string } }) {
  const { sessionId } = params
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeChatId = searchParams.get('chat')
  const focusParam = searchParams.get('focus')
  const { mutate: globalMutate } = useSWRConfig()

  const { session } = useSession(sessionId)
  const { chats, isLoading: chatsLoading, mutate: mutateChats } = useChats(sessionId)
  const { socket } = useSocket()
  const {
    messages,
    chat: activeChat,
    hasMore,
    isLoading: messagesLoading,
    mutate: mutateMessages,
  } = useMessages(activeChatId ?? undefined, 60, focusParam ?? undefined)

  useSessionRoom(sessionId)
  useOpenChat(activeChatId ?? undefined)

  const selectChat = React.useCallback(
    (chatId: string) => {
      const query = new URLSearchParams(searchParams.toString())
      query.set('chat', chatId)
      router.replace(`/chat/${sessionId}?${query.toString()}`, { scroll: false })
    },
    [router, searchParams, sessionId],
  )

  const openSearchHit = React.useCallback(
    (chatId: string, messageId: string) => {
      const query = new URLSearchParams(searchParams.toString())
      query.set('chat', chatId)
      query.set('focus', messageId)
      router.replace(`/chat/${sessionId}?${query.toString()}`, { scroll: false })
    },
    [router, searchParams, sessionId],
  )

  const clearFocus = React.useCallback(() => {
    const query = new URLSearchParams(searchParams.toString())
    query.delete('focus')
    const qs = query.toString()
    router.replace(qs ? `/chat/${sessionId}?${qs}` : `/chat/${sessionId}`, { scroll: false })
  }, [router, searchParams, sessionId])

  const closeChat = React.useCallback(() => {
    const query = new URLSearchParams(searchParams.toString())
    query.delete('chat')
    const qs = query.toString()
    router.replace(qs ? `/chat/${sessionId}?${qs}` : `/chat/${sessionId}`, { scroll: false })
  }, [router, searchParams, sessionId])

  // Pilih otomatis chat terbaru pada layar lebar.
  React.useEffect(() => {
    if (activeChatId || chats.length === 0) return
    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      selectChat(chats[0].id)
    }
  }, [activeChatId, chats, selectChat])

  /* ---------------------------- realtime wiring --------------------------- */

  const chatsKey = React.useMemo(() => `/api/sessions/${sessionId}/chats?`, [sessionId])
  const messagesKey = React.useMemo(() => {
    if (!activeChatId) return null
    const params = new URLSearchParams({ limit: '60' })
    if (focusParam) params.set('around', focusParam)
    return `/api/chats/${activeChatId}/messages?${params.toString()}`
  }, [activeChatId, focusParam])

  /** Ambil 50 pesan sebelum yang paling lama termuat (infinite scroll ke atas). */
  const [hasMoreLocal, setHasMoreLocal] = React.useState(false)
  React.useEffect(() => {
    setHasMoreLocal(hasMore)
  }, [hasMore])

  const loadOlder = React.useCallback(async () => {
    if (!messagesKey || !activeChatId) return
    await globalMutate(
      messagesKey,
      async (current?: { messages: MessageDTO[]; chat: ChatDTO }) => {
        if (!current || current.messages.length === 0) return current
        const oldest = current.messages[0]
        const response = await api.get<{ messages: MessageDTO[]; chat: ChatDTO }>(
          `/api/chats/${activeChatId}/messages?limit=50&before=${encodeURIComponent(oldest.timestamp)}`,
        )
        const known = new Set(current.messages.map((message) => message.id))
        const older = response.messages.filter((message) => !known.has(message.id))
        setHasMoreLocal(response.messages.length >= 50)
        if (older.length === 0) return current
        return { ...current, messages: [...older, ...current.messages] }
      },
      { revalidate: false },
    )
  }, [messagesKey, activeChatId, globalMutate])

  useSocketEvent('session:message', (payload) => {
    if (payload.sessionId !== sessionId) return

    // 1. chat list: reorder + update preview / unread badge
    void globalMutate(
      chatsKey,
      (current?: { chats: ChatDTO[] }) => {
        if (!current) return current
        const others = current.chats.filter((chat) => chat.id !== payload.chat.id)
        return { chats: [payload.chat, ...others] }
      },
      { revalidate: true },
    )

    // 2. open conversation: append the new bubble instantly
    if (messagesKey && payload.message.chatId === activeChatId) {
      void globalMutate(
        messagesKey,
        (current?: { messages: MessageDTO[]; chat: ChatDTO }) => {
          if (!current) return current
          if (current.messages.some((message) => message.id === payload.message.id)) return current
          return { ...current, messages: [...current.messages, payload.message] }
        },
        { revalidate: false },
      )
    }
  })

  useSocketEvent('session:chat', (payload) => {
    if (payload.sessionId !== sessionId) return
    void globalMutate(chatsKey)
  })

  useSocketEvent('session:chats-pruned', () => {
    void mutateChats()
  })

  useSocketEvent('session:message-updated', (payload) => {
    if (payload.sessionId !== sessionId) return
    // Reactions, revokes, and media that WhatsApp only shared later (view-once).
    const key = `/api/chats/${payload.message.chatId}/messages?limit=60`
    void globalMutate(
      key,
      (current?: { messages: MessageDTO[]; chat: ChatDTO }) => {
        if (!current) return current
        const exists = current.messages.some((message) => message.id === payload.message.id)
        return {
          ...current,
          messages: exists
            ? current.messages.map((message) =>
                message.id === payload.message.id ? payload.message : message,
              )
            : [...current.messages, payload.message],
        }
      },
      { revalidate: false },
    )

    // Refresh the media in an open lightbox too.
    void globalMutate(chatsKey)
  })

  useSocketEvent('session:message-removed', (payload) => {
    if (payload.sessionId !== sessionId) return
    const key = `/api/chats/${payload.chatId}/messages?limit=60`
    void globalMutate(
      key,
      (current?: { messages: MessageDTO[]; chat: ChatDTO }) => {
        if (!current) return current
        return { ...current, messages: current.messages.filter((m) => m.id !== payload.messageId) }
      },
      { revalidate: false },
    )
  })

  useSocketEvent('session:message-status', (payload) => {
    if (payload.sessionId !== sessionId) return
    const key = `/api/chats/${payload.chatId}/messages?limit=60`
    void globalMutate(
      key,
      (current?: { messages: MessageDTO[]; chat: ChatDTO }) => {
        if (!current) return current
        return {
          ...current,
          messages: current.messages.map((message) =>
            message.waMessageId === payload.waMessageId
              ? { ...message, status: payload.status }
              : message,
          ),
        }
      },
      { revalidate: false },
    )
  })

  /* -------------------------------- render -------------------------------- */

  const offline = session && session.status !== 'connected'

  return (
    <div className="flex h-dvh min-h-0 flex-col md:flex-row">
      {/* Mobile session strip */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[hsl(200_25%_5%)]/80 px-3 py-2 backdrop-blur md:hidden">
        <Button asChild variant="ghost" size="iconSm">
          <Link href="/" aria-label="Kembali ke dasbor">
            <ChevronLeft />
          </Link>
        </Button>
        <span className="truncate text-sm font-medium">{session?.name ?? 'Sesi'}</span>
        {session && <SessionStatusBadge status={session.status} className="ml-auto" />}
      </div>

      {offline && (
        <div className="flex items-center gap-2 border-b border-amber-400/20 bg-amber-400/[0.08] px-4 py-2 text-xs text-amber-200 md:hidden">
          <TriangleAlert className="h-3.5 w-3.5" />
          Sesi berstatus {session?.status}. Mengirim pesan dinonaktifkan sampai tersambung lagi.
        </div>
      )}

      <div className={cn('flex min-h-0 flex-1', activeChatId ? 'hidden md:flex' : 'flex', 'md:w-[340px] md:flex-none')}>
        <div className="flex h-full w-full min-h-0 flex-col">
          <div className="hidden items-center gap-2 border-b border-white/[0.06] bg-[hsl(200_25%_5%)]/80 px-4 py-3 md:flex">
            <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">
              ← Dasbor
            </Link>
            <span className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
              <Radio className="h-3 w-3 text-[#25D366]" />
              {session?.name ?? 'Sesi'}
            </span>
            <MessageSearch
              sessionId={sessionId}
              chatId={activeChatId}
              chatName={activeChat?.name ?? null}
              onOpenChat={openSearchHit}
            />
          </div>
          <ChatList
            sessionId={sessionId}
            chats={chats}
            isLoading={chatsLoading}
            activeChatId={activeChatId}
            onSelect={selectChat}
            onChanged={() => {
              void mutateChats()
            }}
          />
        </div>
      </div>

      <div className={cn('min-h-0 flex-1', activeChatId ? 'flex' : 'hidden md:flex')}>
        <Conversation
          sessionId={sessionId}
          sessionLabel={session?.name ?? 'sesi'}
          chat={activeChat ?? null}
          messages={messages}
          isLoading={messagesLoading}
          onBack={closeChat}
          onChanged={() => {
            void mutateMessages()
            void mutateChats()
          }}
          onTyping={(state) => {
            if (!activeChatId) return
            socket?.emit('chat:typing', { sessionId, chatId: activeChatId, state })
          }}
          focusMessageId={focusParam}
          hasMore={hasMoreLocal}
          onLoadOlder={loadOlder}
          onFocusHandled={clearFocus}
        />
      </div>
    </div>
  )
}
