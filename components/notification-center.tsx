'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { useSessions } from '@/hooks/use-api'
import { useNotifications } from '@/hooks/use-notifications'
import { useSocketEvent } from '@/hooks/use-socket'

/**
 * Pusat notifikasi global (dipasang di AppShell):
 *   - suara + notifikasi desktop untuk pesan masuk (opsional, dari sidebar)
 *   - badge jumlah pesan belum dibaca di judul tab
 *   - toast singkat kalau panel sedang dibuka di halaman lain
 *
 * Event `session:notify` dikirim server ke semua tab yang sudah login, jadi
 * notifikasi tetap muncul walau tab sedang membuka halaman dasbor.
 */
export function NotificationCenter() {
  const { notify, setTitleBadge } = useNotifications()
  const { sessions } = useSessions()
  const pathname = usePathname()

  const unread = React.useMemo(
    () => sessions.reduce((total, session) => total + (session.stats?.unread ?? 0), 0),
    [sessions],
  )

  React.useEffect(() => {
    setTitleBadge(unread)
  }, [unread, setTitleBadge])

  // Kalau tab ini sedang membuka chat yang bersangkutan, jangan ganggu.
  const [activeChatId, setActiveChatId] = React.useState<string | null>(null)
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setActiveChatId(pathname?.startsWith('/chat') ? params.get('chat') : null)
  }, [pathname])

  useSocketEvent('session:notify', (payload) => {
    if (payload.fromMe) return
    if (payload.chatId === activeChatId) return

    notify({
      title: `${payload.chatName} · ${payload.sessionName}`,
      body: payload.preview || 'Pesan baru',
      unreadTotal: unread,
    })

    if (document.visibilityState === 'visible' && !pathname?.startsWith('/login')) {
      toast.message(payload.chatName, {
        description: payload.preview.slice(0, 120),
        action: {
          label: 'Buka',
          onClick: () => {
            window.location.href = `/chat/${payload.sessionId}?chat=${payload.chatId}`
          },
        },
      })
    }
  })

  return null
}
