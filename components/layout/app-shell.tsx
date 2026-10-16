'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import useSWR from 'swr'
import {
  BarChart3,
  Bell,
  BellRing,
  Bot,
  Contact,
  Send,
  SmartphoneNfc,
  BookOpen,
  LayoutDashboard,
  LogOut,
  MessagesSquare,
  QrCode,
  Radio,
  Server,
  ShieldAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { APP_NAME, APP_SHORT_NAME, APP_VERSION, DEVELOPER_CREDIT, DEVELOPER_URL } from '@/lib/branding'
import { api } from '@/lib/fetcher'
import { cn } from '@/lib/utils'
import { useNotifications } from '@/hooks/use-notifications'
import { usePush } from '@/hooks/use-push'
import { useSocket } from '@/hooks/use-socket'

const NAV: { href: string; label: string; short?: string; icon: typeof Bell }[] = [
  { href: '/', label: 'Dasbor', short: 'Dasbor', icon: LayoutDashboard },
  { href: '/status', label: 'Status WA', short: 'SW', icon: Radio },
  { href: '/kontak', label: 'Kontak', short: 'Kontak', icon: Contact },
  { href: '/pair', label: 'Pairing', short: 'Pair', icon: QrCode },
  { href: '/otomatis', label: 'Otomatis', short: 'Auto', icon: Bot },
  { href: '/analitik', label: 'Analitik', short: 'Stats', icon: BarChart3 },
  { href: '/notifikasi', label: 'Notifikasi', short: 'Notif', icon: BellRing },
  { href: '/docs', label: 'Panduan', short: 'Panduan', icon: BookOpen },
]

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#25D366] to-[#128C7E] shadow-[0_10px_30px_-10px_rgba(37,211,102,0.9)]">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-[#04150f]" fill="currentColor">
          <path d="M12.04 2C7.58 2 4 5.58 4 10.04c0 1.42.37 2.8 1.07 4.02L4 22l8.13-1.05c1.18.63 2.5.96 3.91.96 4.46 0 8.04-3.58 8.04-8.04C24.08 5.58 20.5 2 16.04 2h-4Z" />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight">{APP_SHORT_NAME}</div>
        <div className="text-[11px] text-muted-foreground">v{APP_VERSION} · {DEVELOPER_CREDIT}</div>
      </div>
    </div>
  )
}

function SocketIndicator({ compact = false }: { compact?: boolean }) {
  const { connected } = useSocket()
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px]',
        connected
          ? 'border-[#25D366]/25 bg-[#25D366]/10 text-[#4ade80]'
          : 'border-amber-400/25 bg-amber-400/10 text-amber-300',
      )}
      title={
        connected
          ? 'Realtime aktif — pesan masuk dalam hitungan detik'
          : 'Websocket terputus. UI memakai sinkronisasi berkala sampai kembali tersambung.'
      }
    >
      <Radio className={cn('h-3.5 w-3.5', connected && 'animate-pulse')} />
      {compact ? null : <span>{connected ? 'Realtime tersambung' : 'Menyambung ulang…'}</span>}
    </div>
  )
}

function NotificationToggles() {
  const { settings, permission, toggleSound, toggleDesktop } = useNotifications()

  return (
    <div className="space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground/80">
        <Bell className="h-3.5 w-3.5" /> Notifikasi
      </div>
      <button
        type="button"
        onClick={() => {
          const enabled = toggleSound()
          toast.success(enabled ? 'Suara notifikasi aktif' : 'Suara notifikasi dimatikan')
        }}
        className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-[11px] text-muted-foreground transition hover:text-foreground"
      >
        <span>Suara pesan masuk</span>
        <span className={cn('rounded-full px-2 py-0.5', settings.sound ? 'bg-[#25D366]/20 text-[#4ade80]' : 'bg-white/[0.06]')}>
          {settings.sound ? 'AKTIF' : 'MATI'}
        </span>
      </button>
      <button
        type="button"
        onClick={async () => {
          if (permission === 'unsupported') {
            toast.error('Browser ini tidak mendukung notifikasi desktop')
            return
          }
          const enabled = await toggleDesktop()
          toast.success(enabled ? 'Notifikasi desktop aktif' : 'Notifikasi desktop dimatikan')
        }}
        className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-[11px] text-muted-foreground transition hover:text-foreground"
      >
        <span className="flex items-center gap-1.5">
          <BellRing className="h-3 w-3" /> Notifikasi desktop
        </span>
        <span className={cn('rounded-full px-2 py-0.5', settings.desktop ? 'bg-[#25D366]/20 text-[#4ade80]' : 'bg-white/[0.06]')}>
          {settings.desktop ? 'AKTIF' : 'MATI'}
        </span>
      </button>
    </div>
  )
}

function PushToggles() {
  const { status, busy, subscriptions, message, enable, disable, sendTest } = usePush()

  const label: Record<string, string> = {
    loading: 'memeriksa…',
    on: 'AKTIF',
    off: 'MATI',
    denied: 'DIBLOKIR',
    unsupported: 'TIDAK DIDUKUNG',
    'ios-install': 'PERLU INSTALL',
    error: 'GAGAL',
  }

  const hint =
    status === 'ios-install'
      ? 'Di iPhone: buka menu Bagikan → “Tambahkan ke Layar Utama”, lalu buka panel dari ikon tersebut dan aktifkan notifikasi.'
      : status === 'denied'
        ? 'Izin notifikasi diblokir. Buka pengaturan situs di browser → Notifikasi → Izinkan, lalu muat ulang.'
        : status === 'unsupported'
          ? 'Browser ini belum mendukung Web Push. Di iPhone gunakan iOS 16.4+ dan pasang panel ke Layar Utama dulu.'
          : status === 'error'
            ? (message ?? 'Terjadi kesalahan saat mendaftarkan notifikasi.')
            : 'Notifikasi tetap masuk walau panel/browser ditutup, lengkap dengan tombol menuju chatnya.'

  const active = status === 'on'

  return (
    <div className="space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground/80">
        <SmartphoneNfc className="h-3.5 w-3.5" /> Notifikasi push (PWA)
      </div>

      <button
        type="button"
        disabled={busy || status === 'loading' || status === 'unsupported' || status === 'ios-install'}
        onClick={async () => {
          if (active) {
            const off = await disable()
            if (off) toast.success('Notifikasi push dimatikan')
            return
          }
          const on = await enable()
          if (on) toast.success('Notifikasi push aktif', { description: 'Kami akan mengabari pesan baru di perangkat ini.' })
          else toast.error(message ?? 'Gagal mengaktifkan notifikasi push')
        }}
        className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-[11px] text-muted-foreground transition hover:text-foreground disabled:opacity-60"
      >
        <span>{active ? 'Matikan di perangkat ini' : 'Aktifkan di perangkat ini'}</span>
        <span className={cn('rounded-full px-2 py-0.5', active ? 'bg-[#25D366]/20 text-[#4ade80]' : 'bg-white/[0.06]')}>
          {label[status] ?? status}
        </span>
      </button>

      <p className="px-1 text-[10px] leading-relaxed text-muted-foreground">{hint}</p>

      <Link
        href="/notifikasi"
        className="block px-1 text-[10px] font-medium text-[#4ade80] hover:underline"
      >
        Panduan &amp; diagnostik lengkap →
      </Link>

      {active && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            try {
              const result = await sendTest()
              if (result.sent > 0) toast.success('Notifikasi percobaan terkirim', { description: `${result.sent} perangkat menerima.` })
              else toast.error('Belum ada perangkat yang terdaftar', { description: 'Aktifkan notifikasi push di perangkat ini dulu.' })
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Gagal mengirim notifikasi percobaan')
            }
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] px-2 py-1.5 text-[11px] text-muted-foreground transition hover:bg-white/[0.05] hover:text-foreground disabled:opacity-60"
        >
          <Send className="h-3 w-3" /> Kirim notifikasi percobaan
          {subscriptions > 0 ? ` (${subscriptions})` : ''}
        </button>
      )}
    </div>
  )
}

function OpenPanelWarning() {
  const { data } = useSWR<{ authEnabled: boolean }>('/api/auth/status')
  const [dismissed, setDismissed] = React.useState(false)

  if (!data || data.authEnabled || dismissed) return null

  return (
    <div className="flex items-start gap-3 border-b border-amber-400/25 bg-amber-400/[0.08] px-4 py-2.5 text-xs text-amber-200">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="flex-1 leading-relaxed">
        <b>Panel ini belum dikunci login.</b> Siapa pun yang tahu alamatnya bisa membaca semua chat.
        Set <code className="font-mono">AUTH_PASSWORD</code> di Railway → Variables, lalu redeploy.{' '}
        <Link href="/docs#keamanan" className="underline underline-offset-2">
          Lihat cara mengaktifkan
        </Link>
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="rounded-lg px-2 py-0.5 text-[11px] hover:bg-amber-400/10"
      >
        Tutup
      </button>
    </div>
  )
}

function AccountBox() {
  const router = useRouter()
  const { data } = useSWR<{ authEnabled: boolean; authenticated: boolean; username: string | null }>(
    '/api/auth/status',
  )
  const [loading, setLoading] = React.useState(false)

  if (!data?.authEnabled) return null

  return (
    <div className="space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[11px]">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Masuk sebagai</span>
        <span className="font-medium">{data.username ?? '-'}</span>
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="w-full"
        loading={loading}
        onClick={async () => {
          setLoading(true)
          try {
            await api.post('/api/auth/logout')
            toast.success('Berhasil keluar')
            router.push('/login')
          } catch {
            toast.error('Gagal keluar')
          } finally {
            setLoading(false)
          }
        }}
      >
        <LogOut /> Keluar
      </Button>
    </div>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isLogin = pathname?.startsWith('/login')
  const isChatRoute = pathname?.startsWith('/chat')

  if (isLogin) return <>{children}</>

  return (
    <div className="flex min-h-dvh w-full">
      {/* Sidebar desktop */}
      <aside className="sticky top-0 hidden h-dvh w-[268px] shrink-0 flex-col justify-between border-r border-white/[0.06] bg-[hsl(200_25%_5%)]/70 px-4 py-6 backdrop-blur-xl md:flex">
        <div className="space-y-6 overflow-y-auto scrollbar-thin">
          <Link href="/" className="block">
            <Logo />
          </Link>

          <nav className="space-y-1">
            {NAV.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all',
                    active
                      ? 'bg-gradient-to-r from-[#25D366]/16 to-transparent text-foreground shadow-[inset_0_0_0_1px_rgba(37,211,102,0.22)]'
                      : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground',
                  )}
                >
                  <item.icon className={cn('h-4 w-4', active ? 'text-[#25D366]' : 'text-muted-foreground')} />
                  {item.label}
                </Link>
              )
            })}
            <Link
              href="/#sessions"
              className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition-all hover:bg-white/[0.04] hover:text-foreground"
            >
              <MessagesSquare className="h-4 w-4" />
              Sesi WhatsApp
            </Link>
          </nav>

          <NotificationToggles />
          <PushToggles />
        </div>

        <div className="space-y-3">
          <SocketIndicator />
          <AccountBox />
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] leading-relaxed text-muted-foreground">
            <div className="mb-1 flex items-center gap-1.5 text-foreground/80">
              <Server className="h-3.5 w-3.5" /> Satu service deploy
            </div>
            Next.js · Baileys · Socket.io · Prisma
            <div className="mt-2 border-t border-white/[0.06] pt-2">
              <div className="truncate font-medium text-foreground/80">{APP_NAME}</div>
              <div>
                v{APP_VERSION} ·{' '}
                {DEVELOPER_URL ? (
                  <a href={DEVELOPER_URL} target="_blank" rel="noreferrer" className="text-[#4ade80] hover:underline">
                    {DEVELOPER_CREDIT}
                  </a>
                ) : (
                  DEVELOPER_CREDIT
                )}
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <OpenPanelWarning />

        {/* Top bar mobile */}
        {!isChatRoute && (
          <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/[0.06] bg-[hsl(200_25%_5%)]/80 px-4 py-3 backdrop-blur-xl md:hidden">
            <Logo />
            <SocketIndicator compact />
          </header>
        )}

        <main className="min-w-0 flex-1">{children}</main>

        {/* Navigasi bawah mobile */}
        {!isChatRoute && (
          <nav className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t border-white/[0.06] bg-[hsl(200_25%_5%)]/95 px-2 py-2 backdrop-blur-xl md:hidden">
            {NAV.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 text-[10px] transition-colors',
                    active ? 'text-[#25D366]' : 'text-muted-foreground',
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  <span className="truncate">{item.short ?? item.label}</span>
                </Link>
              )
            })}
          </nav>
        )}
      </div>
    </div>
  )
}
