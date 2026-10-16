'use client'

import * as React from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  DatabaseZap,
  Download,
  Edit3,
  Eye,
  HardDrive,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatBytes, formatDateTime } from '@/lib/utils'

interface Analytics {
  range: { days: number; from: string; to: string }
  totals: {
    messagesInRange: number
    messagesAllTime: number
    incoming: number
    outgoing: number
    chats: number
    sessions: number
    mediaFiles: number
    mediaBytes: number
    viewOnce: number
    edited: number
    deleted: number
    rules: number
    subscriptions: number
  }
  perDay: { date: string; incoming: number; outgoing: number }[]
  topChats: { chatId: string; name: string; count: number; isGroup: boolean; sessionName: string }[]
  perSession: { sessionId: string; name: string; phoneNumber: string; status: string; count: number }[]
}

const RANGES = [
  { days: 7, label: '7 hari' },
  { days: 14, label: '14 hari' },
  { days: 30, label: '30 hari' },
  { days: 90, label: '90 hari' },
]

function dayLabel(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
}

export default function AnalyticsPage() {
  const [days, setDays] = React.useState(14)
  const { data, isLoading, mutate } = useSWR<{ data?: Analytics } & Analytics>(`/api/analytics?days=${days}`, {
    refreshInterval: 60000,
  })

  const stats = (data?.totals ? data : data?.data) as Analytics | undefined
  const peak = Math.max(1, ...(stats?.perDay ?? []).map((day) => day.incoming + day.outgoing))

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 md:px-8 md:pb-12 md:pt-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#25D366]/25 bg-[#25D366]/10 px-3 py-1 text-[11px] text-[#4ade80]">
            <Activity className="h-3 w-3" /> Statistik panel
          </div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            Analitik <span className="gradient-text">aktivitas</span>
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Jumlah pesan masuk/keluar per hari, percakapan teraktif, dan pemakaian penyimpanan —
            semuanya dihitung dari database panel ini sendiri.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map((range) => (
            <Button
              key={range.days}
              variant={days === range.days ? 'subtle' : 'secondary'}
              size="sm"
              onClick={() => setDays(range.days)}
            >
              {range.label}
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => void mutate()}>
            <RefreshCw /> Muat ulang
          </Button>
        </div>
      </div>

      {/* Kartu angka */}
      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            key: 'total',
            label: 'Pesan (seluruh waktu)',
            value: stats?.totals.messagesAllTime,
            icon: MessageSquareText,
            tint: 'from-[#25D366]/25',
          },
          {
            key: 'range',
            label: `Pesan ${days} hari terakhir`,
            value: stats?.totals.messagesInRange,
            icon: Activity,
            tint: 'from-sky-400/25',
          },
          {
            key: 'in',
            label: 'Masuk',
            value: stats?.totals.incoming,
            icon: ArrowDownLeft,
            tint: 'from-emerald-400/25',
          },
          {
            key: 'out',
            label: 'Keluar',
            value: stats?.totals.outgoing,
            icon: ArrowUpRight,
            tint: 'from-violet-400/25',
          },
          {
            key: 'media',
            label: 'Berkas media',
            value: stats?.totals.mediaFiles,
            icon: HardDrive,
            tint: 'from-amber-400/25',
          },
          {
            key: 'size',
            label: 'Ukuran media',
            value: stats ? formatBytes(stats.totals.mediaBytes) : undefined,
            icon: DatabaseZap,
            tint: 'from-orange-400/25',
          },
          {
            key: 'once',
            label: 'Sekali lihat',
            value: stats?.totals.viewOnce,
            icon: Eye,
            tint: 'from-pink-400/25',
          },
          {
            key: 'edit',
            label: 'Diedit / dihapus',
            value: stats ? `${stats.totals.edited} / ${stats.totals.deleted}` : undefined,
            icon: Edit3,
            tint: 'from-teal-400/25',
          },
        ].map((item) => (
          <Card key={item.key} className="card-hover relative overflow-hidden p-4">
            <div
              className={cn(
                'pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-gradient-to-br to-transparent blur-xl',
                item.tint,
              )}
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {item.label}
              </span>
              <item.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-3 text-2xl font-semibold tabular-nums">
              {item.value === undefined ? (
                <Skeleton className="h-7 w-16" />
              ) : typeof item.value === 'number' ? (
                item.value.toLocaleString('id-ID')
              ) : (
                item.value
              )}
            </div>
          </Card>
        ))}
      </section>

      {/* Grafik per hari */}
      <Card className="mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Pesan per hari</h2>
            <p className="text-[11px] text-muted-foreground">
              Hijau = pesan masuk, biru = pesan keluar (termasuk yang kamu kirim dari panel).
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-[#25D366]" /> masuk
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-sky-400" /> keluar
            </span>
          </div>
        </div>

        {isLoading && !stats ? (
          <Skeleton className="mt-6 h-48 w-full" />
        ) : (
          <div className="scrollbar-thin mt-6 flex items-end gap-1.5 overflow-x-auto pb-2">
            {stats?.perDay.map((day) => {
              const total = day.incoming + day.outgoing
              return (
                <div key={day.date} className="group flex min-w-[26px] flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] font-medium tabular-nums text-muted-foreground opacity-0 transition group-hover:opacity-100">
                    {total}
                  </span>
                  <div
                    className="flex w-full flex-col justify-end overflow-hidden rounded-md bg-white/[0.04]"
                    style={{ height: `${Math.max(6, (total / peak) * 160)}px` }}
                    title={`${day.date} · masuk ${day.incoming} · keluar ${day.outgoing}`}
                  >
                    <div
                      className="w-full bg-sky-400/80"
                      style={{ height: `${total === 0 ? 0 : (day.outgoing / total) * 100}%` }}
                    />
                    <div className="w-full flex-1 bg-[#25D366]/85" />
                  </div>
                  <span className="whitespace-nowrap text-[9px] text-muted-foreground">
                    {dayLabel(day.date)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* Chat teraktif */}
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4 text-[#25D366]" /> Percakapan teraktif
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">Berdasarkan pesan dalam rentang ini.</p>

          <div className="mt-4 space-y-2">
            {isLoading && !stats && <Skeleton className="h-40 w-full" />}
            {stats && stats.topChats.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Belum ada aktivitas pada rentang ini.
              </p>
            )}
            {stats?.topChats.map((chat) => (
              <div key={chat.chatId} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">
                    {chat.isGroup ? '👥 ' : ''}
                    {chat.name}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {chat.sessionName}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-[#4ade80]">
                  {chat.count.toLocaleString('id-ID')}
                </span>
              </div>
            ))}
          </div>
        </Card>

        {/* Per sesi + backup */}
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-[#25D366]" /> Per nomor + cadangan data
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {stats?.totals.sessions ?? 0} sesi · {stats?.totals.chats ?? 0} chat ·{' '}
            {stats?.totals.subscriptions ?? 0} perangkat berlangganan notifikasi
          </p>

          <div className="mt-4 space-y-2">
            {stats?.perSession.map((session) => (
              <div
                key={session.sessionId}
                className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{session.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    +{session.phoneNumber} · {session.status}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-[#4ade80]">
                  {session.count.toLocaleString('id-ID')}
                </span>
              </div>
            ))}
            {stats?.perSession.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">Belum ada data pada rentang ini.</p>
            )}
          </div>

          <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 text-[11px] leading-relaxed text-muted-foreground">
            <div className="mb-1 font-medium text-foreground/90">Cadangan data</div>
            Unduh seluruh data panel (sesi, chat, pesan, aturan otomatis) sebagai satu berkas JSON.
            Berkas media & sesi WhatsApp tetap berada di volume <code className="font-mono">/app/data</code>.
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  window.open('/api/backup?download=1', '_blank')
                  toast.success('Mengunduh cadangan JSON…')
                }}
              >
                <Download /> Unduh backup JSON
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <Link href="/docs#keamanan">Cara aman menyimpan backup</Link>
              </Button>
            </div>
          </div>

          {stats && (
            <p className="mt-3 text-[10px] text-muted-foreground">
              Rentang: {formatDateTime(stats.range.from)} → {formatDateTime(stats.range.to)}
            </p>
          )}
          {isLoading && (
            <p className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> menghitung…
            </p>
          )}
        </Card>
      </div>

      <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <Trash2 className="h-3 w-3" /> Data di halaman ini berasal dari database panelmu sendiri — tidak
        dikirim ke mana pun.
      </p>
    </div>
  )
}
