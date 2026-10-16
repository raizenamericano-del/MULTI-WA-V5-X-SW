'use client'

import useSWR, { mutate as globalMutate } from 'swr'
import { useSocket } from '@/hooks/use-socket'
import type { ChatDTO, MessageDTO, SessionDTO, SessionWithStats, StatsDTO } from '@/lib/types'

/**
 * When the websocket is down (proxy blocking it, tab resumed, server restart)
 * the UI still needs to stay fresh — so we fall back to polling. Realtime is
 * the fast path, polling is the safety net.
 */
function usePollingFallback(activeSeconds = 10) {
  const { connected, socket } = useSocket()
  const hasSocket = Boolean(socket)
  return hasSocket && !connected ? activeSeconds * 1000 : 0
}

export function useSessions() {
  const { data, error, isLoading, mutate } = useSWR<{ sessions: SessionWithStats[] }>(
    '/api/sessions',
    { refreshInterval: 15000 },
  )
  return {
    sessions: data?.sessions ?? [],
    error,
    isLoading,
    mutate,
  }
}

export function useSession(sessionId?: string) {
  const { data, error, isLoading, mutate } = useSWR<{ session: SessionDTO }>(
    sessionId ? `/api/sessions/${sessionId}` : null,
  )
  return { session: data?.session ?? null, error, isLoading, mutate }
}

export function useStats() {
  const { data, mutate } = useSWR<{ stats: StatsDTO }>('/api/stats', { refreshInterval: 20000 })
  return { stats: data?.stats ?? null, mutate }
}

export function useChats(sessionId?: string, search?: string) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  const key = sessionId ? `/api/sessions/${sessionId}/chats?${params.toString()}` : null
  const refreshInterval = usePollingFallback(8)

  const { data, error, isLoading, mutate } = useSWR<{ chats: ChatDTO[] }>(key, { refreshInterval })
  return { chats: data?.chats ?? [], error, isLoading, mutate }
}

export interface MessagesPage {
  messages: MessageDTO[]
  chat: ChatDTO
  hasMore?: boolean
}

export function useMessages(chatId?: string, limit = 60, around?: string) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (around) params.set('around', around)
  const key = chatId ? `/api/chats/${chatId}/messages?${params.toString()}` : null
  const refreshInterval = usePollingFallback(6)
  const { data, error, isLoading, mutate } = useSWR<MessagesPage>(key, { refreshInterval })
  return {
    messages: data?.messages ?? [],
    chat: data?.chat ?? null,
    hasMore: data?.hasMore ?? false,
    error,
    isLoading,
    mutate,
  }
}

/** Invalidate everything that shows session/chat counters. */
export function refreshLists() {
  void globalMutate('/api/sessions')
  void globalMutate('/api/stats')
}
