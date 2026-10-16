'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Copy,
  KeyRound,
  Loader2,
  MessageSquare,
  QrCode,
  RefreshCw,
  Smartphone,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { AddSessionDialog } from '@/components/dashboard/add-session-dialog'
import { QrCodeImage } from '@/components/qr-code'
import { SessionStatusBadge } from '@/components/session-status-badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/fetcher'
import type { SessionDTO, SessionStatus } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useSession } from '@/hooks/use-api'
import { useSessionRoom, useSocketEvent } from '@/hooks/use-socket'

export default function PairPage() {
  return (
    <React.Suspense fallback={<PairSkeleton />}>
      <PairPageContent />
    </React.Suspense>
  )
}

function PairSkeleton() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <Card className="h-72 animate-pulse" />
    </div>
  )
}

function PairPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const sessionId = searchParams.get('session') ?? undefined

  const { session, mutate, isLoading } = useSession(sessionId)
  const [code, setCode] = React.useState<string | null>(null)
  const [expiresAt, setExpiresAt] = React.useState<string | null>(null)
  const [qr, setQr] = React.useState<string | null>(null)
  const [generating, setGenerating] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [phoneNumber, setPhoneNumber] = React.useState('')
  const [now, setNow] = React.useState(() => Date.now())

  useSessionRoom(sessionId)

  React.useEffect(() => {
    if (session?.phoneNumber) setPhoneNumber(session.phoneNumber)
  }, [session?.phoneNumber])

  React.useEffect(() => {
    if (session?.pairingCode) setCode(session.pairingCode)
    if (session?.pairingCodeExpiresAt) setExpiresAt(session.pairingCodeExpiresAt)
  }, [session?.pairingCode, session?.pairingCodeExpiresAt])

  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useSocketEvent('session:pairing-code', (payload) => {
    if (payload.sessionId !== sessionId) return
    setCode(payload.code)
    setExpiresAt(payload.expiresAt)
    void mutate()
  })

  useSocketEvent('session:qr', (payload) => {
    if (payload.sessionId !== sessionId) return
    setQr(payload.qr)
  })

  useSocketEvent('session:status', (payload) => {
    if (payload.sessionId !== sessionId) return
    void mutate()
    if (payload.status === 'connected') {
      toast.success('Perangkat berhasil ditautkan! 🎉')
      setCode(null)
      setQr(null)
    }
  })

  async function generateCode() {
    if (!sessionId) return
    setGenerating(true)
    try {
      const result = await api.post<{ pairingCode: string; expiresAt: string }>(
        `/api/sessions/${sessionId}/pairing-code`,
        phoneNumber ? { phoneNumber } : {},
      )
      setCode(result.pairingCode)
      setExpiresAt(result.expiresAt)
      void mutate()
      toast.success('Kode pairing dibuat', {
        description: 'Ketik kodenya di HP dalam waktu 3 menit.',
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal membuat kode pairing')
    } finally {
      setGenerating(false)
    }
  }

  const secondsLeft = expiresAt ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000)) : 0
  const expired = Boolean(code) && secondsLeft === 0
  const status: SessionStatus = (session?.status ?? 'disconnected') as SessionStatus

  /* ------------------------------ no session ----------------------------- */
  if (!sessionId) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-8 md:px-8 md:pb-16">
        <div className="space-y-3 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#25D366]/10">
            <QrCode className="h-6 w-6 text-[#25D366]" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Tautkan nomor WhatsApp</h1>
          <p className="mx-auto max-w-lg text-sm text-muted-foreground">
            Mulai dengan menambahkan nomor yang ingin ditautkan. Kamu akan menerima kode pairing
            yang cukup diketik di HP — tanpa perlu scan kamera.
          </p>
        </div>

        <div className="mt-8 flex justify-center">
          <AddSessionDialog
            trigger={
              <Button size="lg">
                <Smartphone /> Tambah nomor untuk ditautkan
              </Button>
            }
          />
        </div>

        <PairingSteps className="mt-10" />
      </div>
    )
  }

  /* -------------------------------- loading ------------------------------ */
  if (isLoading || !session) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10 md:px-8">
        <Card className="h-72 animate-pulse" />
      </div>
    )
  }

  const connected = status === 'connected'

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-28 pt-8 md:px-8 md:pb-16">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">
            ← Kembali ke dasbor
          </Link>
          <h1 className="mt-2 flex items-center gap-3 text-2xl font-bold tracking-tight">
            {session.name}
            <SessionStatusBadge status={status} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            +{session.phoneNumber}
            {session.pushName ? ` · ${session.pushName}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void mutate()
              toast.success('Status diperbarui')
            }}
          >
            <RefreshCw /> Muat Ulang
          </Button>
          {connected && (
            <Button size="sm" asChild>
              <Link href={`/chat/${session.id}`}>
                <MessageSquare /> Buka chat
              </Link>
            </Button>
          )}
        </div>
      </div>

      {connected ? (
        <Card className="relative overflow-hidden p-8 text-center">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#25D366]/10 via-transparent to-transparent" />
          <div className="relative space-y-3">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#25D366]/15">
              <BadgeCheck className="h-8 w-8 text-[#25D366]" />
            </div>
            <h2 className="text-xl font-semibold">Perangkat ini sudah tertaut</h2>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              Pesan masuk secara realtime. Kamu bisa langsung membalas, mengirim media, dan
              memantau semua aktivitas secara live.
            </p>
            <div className="flex flex-wrap justify-center gap-3 pt-2">
              <Button asChild>
                <Link href={`/chat/${session.id}`}>
                  <MessageSquare /> Buka chat
                </Link>
              </Button>
              <Button variant="secondary" asChild>
                <Link href="/">Kembali ke dasbor</Link>
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          {/* Pairing code card */}
          <Card className="relative overflow-hidden p-6">
            <div className="pointer-events-none absolute -right-14 -top-16 h-48 w-48 rounded-full bg-[#25D366]/12 blur-3xl" />

            <div className="relative space-y-5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <KeyRound className="h-4 w-4 text-[#25D366]" /> Langkah 1 — konfirmasi nomor
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={phoneNumber}
                  inputMode="numeric"
                  placeholder="6281234567890"
                  onChange={(event) => setPhoneNumber(event.target.value.replace(/[^\d+]/g, ''))}
                  disabled={connected}
                />
                <Button onClick={generateCode} loading={generating} className="sm:w-auto">
                  <Sparkles /> {code ? 'Buat Ulang Kode' : 'Minta Kode Pairing'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Format internasional tanpa <code>+</code>. Nomor Indonesia: pakai awalan{' '}
                <span className="font-mono">62…</span>.
              </p>

              <div className="rounded-2xl border border-white/[0.07] bg-black/30 p-6 text-center">
                <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                  Kode pairing kamu
                </div>

                <div className="mt-3 flex items-center justify-center gap-3">
                  {generating && !code ? (
                    <div className="flex h-16 items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin" /> Meminta ke WhatsApp…
                    </div>
                  ) : code ? (
                    <>
                      <span
                        className={cn(
                          'select-all font-mono text-4xl font-bold tracking-[0.35em] text-[#4ade80] md:text-5xl',
                          expired && 'opacity-40 line-through',
                        )}
                      >
                        {code}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Salin kode pairing"
                        onClick={async () => {
                          await navigator.clipboard.writeText(code)
                          setCopied(true)
                          setTimeout(() => setCopied(false), 1800)
                          toast.success('Kode pairing disalin')
                        }}
                      >
                        {copied ? <Check className="text-[#25D366]" /> : <Copy />}
                      </Button>
                    </>
                  ) : (
                    <div className="flex h-16 items-center text-sm text-muted-foreground">
                      Klik “Minta Kode Pairing” untuk mendapatkan kode
                    </div>
                  )}
                </div>

                {code && (
                  <div className="mt-3 text-xs text-muted-foreground">
                    {expired ? (
                      <span className="text-amber-300">
                        Kode kedaluwarsa — klik “Buat Ulang Kode” untuk kode baru.
                      </span>
                    ) : (
                      <>
                        Berlaku selama{' '}
                        <span className="font-mono text-foreground">
                          {Math.floor(secondsLeft / 60)}:
                          {String(secondsLeft % 60).padStart(2, '0')}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>

              {qr && !code && (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/[0.07] bg-black/20 p-5">
                  <div className="text-xs text-muted-foreground">
                    Lebih suka scan? Arahkan WhatsApp ke QR ini
                  </div>
                  <QrCodeImage value={qr} size={190} />
                </div>
              )}
            </div>
          </Card>

          {/* Instructions */}
          <PairingSteps />
        </div>
      )}
    </div>
  )
}

function PairingSteps({ className }: { className?: string }) {
  const steps = [
    'Buka WhatsApp di HP yang ingin ditautkan',
    'Masuk Pengaturan (⋮ di Android) → Perangkat Tertaut',
    'Ketuk “Tautkan perangkat”',
    'Pilih “Tautkan dengan nomor telepon”',
    'Ketik kode pairing yang tampil di panel ini',
    'Tunggu beberapa detik — status di panel otomatis berubah jadi Tersambung',
  ]

  return (
    <Card className={cn('p-6', className)}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <Smartphone className="h-4 w-4 text-[#25D366]" /> Langkah 2 — di HP kamu
      </div>

      <ol className="mt-4 space-y-3">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-3 text-sm text-muted-foreground">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#25D366]/25 bg-[#25D366]/10 text-[11px] font-semibold text-[#4ade80]">
              {index + 1}
            </span>
            <span className="pt-0.5 leading-relaxed">{step}</span>
          </li>
        ))}
      </ol>

      <div className="mt-5 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 text-xs leading-relaxed text-muted-foreground">
        <div className="mb-1 font-medium text-foreground/90">Perlu diketahui</div>
        <ul className="list-disc space-y-1 pl-4">
          <li>Kode pairing berlaku sekitar 3 menit.</li>
          <li>HP tersebut harus terhubung internet.</li>
          <li>Satu nomor bisa ditautkan ke maksimal 4 perangkat.</li>
          <li>
            Sesi tetap online setelah restart bila kamu memasang Railway Volume di{' '}
            <code className="font-mono">/app/data</code>.
          </li>
        </ul>
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <ArrowRight className="h-3.5 w-3.5" /> Bermasalah? Buat ulang kodenya — kode lama langsung
        tidak berlaku.
      </div>
    </Card>
  )
}
