'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  Activity,
  BookOpen,
  Heart,
  Plus,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { AddSessionDialog } from '@/components/dashboard/add-session-dialog'
import { SessionCard } from '@/components/dashboard/session-card'
import { StatsCards } from '@/components/dashboard/stats-cards'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { refreshLists, useSessions, useStats } from '@/hooks/use-api'
import { useSocketEvent } from '@/hooks/use-socket'
import { APP_VERSION, DEVELOPER_CREDIT, DEVELOPER_URL } from '@/lib/branding'

const FEATURES = [
  {
    icon: QrCode,
    title: 'Pairing lewat kode',
    text: 'Masukkan nomor, dapatkan kode 8 digit, lalu ketik di HP. Tanpa scan QR, tanpa ribet.',
  },
  {
    icon: Zap,
    title: 'Realtime penuh',
    text: 'Pesan masuk dan keluar langsung muncul lewat Socket.io — reaksi, edit, hapus, dan pesan sekali lihat ikut terupdate.',
  },
  {
    icon: ShieldCheck,
    title: 'Login panel terkunci',
    text: 'Panel dilindungi password + cookie ber-tanda tangan HMAC. Sesi WhatsApp-mu tidak bisa dibaca orang lain.',
  },
  {
    icon: Sparkles,
    title: 'Multi-nomor sekaligus',
    text: 'Hubungkan beberapa nomor dalam satu panel, masing-masing dengan status dan auto-reconnect sendiri.',
  },
  {
    icon: Activity,
    title: 'Cari & ekspor chat',
    text: 'Cari pesan di semua percakapan sebuah nomor, lalu ekspor percakapan ke TXT atau JSON.',
  },
  {
    icon: Heart,
    title: 'Kaya jenis pesan',
    text: 'Teks, foto, video, dokumen, pesan suara, video sekali lihat, polling, lokasi, kontak, produk dan lainnya.',
  },
]

const STEPS = [
  'Tambah nomor (format internasional, contoh 62812…)',
  'Klik “Minta Kode Pairing”',
  'Di HP: WhatsApp → Perangkat Tertaut → Tautkan dengan nomor telepon',
  'Ketik kodenya → sesi langsung online',
]

export default function DashboardPage() {
  const { sessions, isLoading, mutate } = useSessions()
  const { stats, mutate: mutateStats } = useStats()

  const refresh = React.useCallback(() => {
    void mutate()
    void mutateStats()
  }, [mutate, mutateStats])

  // Update langsung: status sesi berubah dari tab/halaman lain.
  useSocketEvent('session:status', (payload) => {
    refresh()
    if (payload.status === 'connected') {
      toast.success('WhatsApp tersambung 🎉', { description: payload.phoneNumber ?? undefined })
    }
  })

  useSocketEvent('sessions:changed', () => refresh())
  useSocketEvent('session:deleted', () => refresh())
  useSocketEvent('session:created', () => refresh())

  const connected = sessions.filter((session) => session.status === 'connected').length
  const totalUnread = sessions.reduce((sum, session) => sum + session.stats.unread, 0)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 md:px-8 md:pb-12 md:pt-10">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-white/[0.07] bg-gradient-to-br from-white/[0.05] via-transparent to-transparent p-6 md:p-9">
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-[#25D366]/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-[#128C7E]/15 blur-3xl" />

        <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#25D366]/25 bg-[#25D366]/10 px-3 py-1 text-[11px] font-medium text-[#4ade80]">
                <Activity className="h-3 w-3" /> {connected} dari {sessions.length || 0} sesi online
              </span>
              {totalUnread > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/25 bg-sky-400/10 px-3 py-1 text-[11px] font-medium text-sky-300">
                  {totalUnread} pesan belum dibaca
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-medium text-muted-foreground">
                v{APP_VERSION}
              </span>
            </div>

            <h1 className="text-3xl font-bold leading-tight tracking-tight md:text-4xl">
              Panel WhatsApp <span className="gradient-text">Multi-Device</span>
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground md:text-base">
              Tautkan nomor dengan kode pairing, baca semua percakapan secara realtime, dan kirim teks,
              foto, video, dokumen maupun pesan suara — semuanya dari satu panel mandiri yang berjalan
              dalam satu service.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <AddSessionDialog
                trigger={
                  <Button size="lg">
                    <Plus /> Tambah Nomor
                  </Button>
                }
              />
              <Button variant="secondary" size="lg" asChild>
                <Link href="/pair">
                  <QrCode /> Halaman Pairing
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="lg"
                onClick={() => {
                  refreshLists()
                  refresh()
                  toast.success('Data diperbarui')
                }}
              >
                <RefreshCw /> Muat Ulang
              </Button>
            </div>
          </div>

          <Card className="w-full max-w-xs shrink-0 bg-black/20 p-4 md:w-72">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Cara kerjanya
            </div>
            <ol className="mt-3 space-y-3 text-xs text-muted-foreground">
              {STEPS.map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#25D366]/15 text-[10px] font-semibold text-[#4ade80]">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </section>

      {/* Statistik */}
      <section className="mt-6">
        <StatsCards stats={stats} />
      </section>

      {/* Daftar sesi */}
      <section id="sessions" className="mt-10 scroll-mt-6">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Sesi WhatsApp-mu</h2>
            <p className="text-xs text-muted-foreground">
              Setiap nomor yang ditautkan tinggal di sini lengkap dengan status realtime-nya.
            </p>
          </div>
          <AddSessionDialog
            trigger={
              <Button variant="secondary" size="sm">
                <Plus /> Baru
              </Button>
            }
          />
        </div>

        {isLoading && sessions.length === 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1].map((key) => (
              <Skeleton key={key} className="h-56 w-full" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <Card className="flex flex-col items-center justify-center gap-4 border-dashed py-14 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#25D366]/10">
              <QrCode className="h-6 w-6 text-[#25D366]" />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold">Belum ada sesi</h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                Tambahkan nomor WhatsApp pertamamu dan tautkan dengan kode pairing — kurang dari satu menit.
              </p>
            </div>
            <AddSessionDialog />
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                onChanged={refresh}
                onDeleted={refresh}
              />
            ))}
          </div>
        )}
      </section>

      {/* Fitur */}
      <section className="mt-12">
        <div className="mb-4">
          <h2 className="text-lg font-semibold tracking-tight">Yang bisa kamu lakukan</h2>
          <p className="text-xs text-muted-foreground">
            Panel ini lengkap, bukan sekadar contoh — semua fitur di bawah sudah berjalan.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <Card key={feature.title} className="card-hover p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#25D366]/10">
                <feature.icon className="h-5 w-5 text-[#25D366]" />
              </div>
              <h3 className="mt-4 font-semibold">{feature.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{feature.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <footer className="mt-12 flex flex-col items-center gap-3 border-t border-white/[0.06] pt-6 text-center text-xs text-muted-foreground md:flex-row md:justify-between md:text-left">
        <p>
          Tidak berafiliasi dengan WhatsApp Inc. Gunakan dengan bijak — tanpa pesan massal atau spam.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link href="/docs" className="inline-flex items-center gap-1.5 hover:text-foreground">
            <BookOpen className="h-3.5 w-3.5" /> Panduan lokal + Railway
          </Link>
          <span>
            v{APP_VERSION} ·{' '}
            {DEVELOPER_URL ? (
              <a href={DEVELOPER_URL} target="_blank" rel="noreferrer" className="hover:text-foreground">
                {DEVELOPER_CREDIT}
              </a>
            ) : (
              DEVELOPER_CREDIT
            )}
          </span>
        </div>
      </footer>
    </div>
  )
}
