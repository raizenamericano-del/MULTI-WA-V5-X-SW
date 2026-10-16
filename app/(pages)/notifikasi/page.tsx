'use client'

import * as React from 'react'
import useSWR from 'swr'
import {
  AlertTriangle,
  BellRing,
  Check,
  CircleHelp,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { usePush, type PushStatus } from '@/hooks/use-push'
import { cn, formatDateTime } from '@/lib/utils'

interface DeviceInfo {
  id: string
  deviceId: string | null
  host: string
  userAgent: string | null
  createdAt: string
  lastSuccessAt: string | null
  hasError: boolean
  lastError: string | null
}

interface AttemptDetail {
  host: string
  ok: boolean
  statusCode?: number
  error?: string
}

interface Attempt {
  at: string
  source: string
  title: string
  devices: number
  sent: number
  failed: number
  removed: number
  skipped: number
  details: AttemptDetail[]
}

interface Diagnostics {
  vapidSource: 'env' | 'file'
  publicKeyPreview: string
  subscriptionCount: number
  devices: DeviceInfo[]
  recent: Attempt[]
}

interface BrowserReport {
  secure: boolean
  https: boolean
  swSupported: boolean
  swRegistered: boolean
  swState: string | null
  permission: 'default' | 'granted' | 'denied' | 'unsupported'
  subscribed: boolean
  endpointHost: string | null
  standalone: boolean
  platform: 'iphone' | 'android' | 'desktop' | 'unknown'
}

const PERMISSION_LABEL: Record<PushStatus, { text: string; tone: string }> = {
  loading: { text: 'MEMERIKSA…', tone: 'bg-white/[0.08] text-muted-foreground' },
  on: { text: 'AKTIF', tone: 'bg-[#25D366]/20 text-[#4ade80]' },
  off: { text: 'MATI', tone: 'bg-amber-400/15 text-amber-300' },
  denied: { text: 'DIBLOKIR', tone: 'bg-red-500/15 text-red-300' },
  unsupported: { text: 'TIDAK DIDUKUNG', tone: 'bg-red-500/15 text-red-300' },
  'ios-install': { text: 'PERLU INSTALL', tone: 'bg-amber-400/15 text-amber-300' },
  error: { text: 'GAGAL', tone: 'bg-red-500/15 text-red-300' },
}

function useBrowserReport(refreshKey: number) {
  const [report, setReport] = React.useState<BrowserReport | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      if (typeof window === 'undefined') return
      const ua = navigator.userAgent
      const isIphone = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document)
      const isAndroid = /Android/i.test(ua)
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true

      const swSupported = 'serviceWorker' in navigator
      let swRegistered = false
      let swState: string | null = null
      let subscribed = false
      let endpointHost: string | null = null

      if (swSupported) {
        const registration = await navigator.serviceWorker.getRegistration('/')
        swRegistered = Boolean(registration)
        swState = registration?.active?.state ?? registration?.installing?.state ?? registration?.waiting?.state ?? null
        if (registration) {
          const sub = await registration.pushManager.getSubscription().catch(() => null)
          if (sub) {
            subscribed = true
            try {
              endpointHost = new URL(sub.endpoint).hostname
            } catch {
              endpointHost = sub.endpoint.slice(0, 40)
            }
          }
        }
      }

      const permission: BrowserReport['permission'] =
        typeof Notification === 'undefined' ? 'unsupported' : (Notification.permission as BrowserReport['permission'])

      if (cancelled) return
      setReport({
        secure: window.isSecureContext,
        https: window.location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(window.location.hostname),
        swSupported,
        swRegistered,
        swState,
        permission,
        subscribed,
        endpointHost,
        standalone,
        platform: isIphone ? 'iphone' : isAndroid ? 'android' : 'desktop',
      })
    })()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  return report
}

function CheckRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string | null }) {
  return (
    <div className="flex items-start gap-2.5 text-xs">
      <span
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
          ok ? 'bg-[#25D366]/20 text-[#4ade80]' : 'bg-red-500/15 text-red-300',
        )}
      >
        {ok ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
      </span>
      <span className="min-w-0">
        <span className={cn('font-medium', ok ? 'text-foreground/90' : 'text-red-200')}>{label}</span>
        {detail ? <span className="block text-[11px] text-muted-foreground">{detail}</span> : null}
      </span>
    </div>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#25D366]/25 bg-[#25D366]/10 text-[11px] font-semibold text-[#4ade80]">
        {n}
      </span>
      <div className="pt-0.5 leading-relaxed text-muted-foreground">{children}</div>
    </div>
  )
}

export default function NotifikasiPage() {
  const { status, busy, message, enable, disable, sendTest, refresh } = usePush()
  const [refreshKey, setRefreshKey] = React.useState(0)
  const report = useBrowserReport(refreshKey)
  const { data, isLoading, mutate } = useSWR<{ diagnostics: Diagnostics }>('/api/push/status', {
    refreshInterval: 15000,
  })
  const diagnostics = data?.diagnostics

  const badge = PERMISSION_LABEL[status]
  const active = status === 'on'

  async function handleEnable() {
    const ok = await enable()
    if (ok) toast.success('Notifikasi push aktif di perangkat ini', { description: 'Sekarang tekan "Kirim notifikasi percobaan".' })
    else toast.error(message ?? 'Gagal mengaktifkan notifikasi push')
    setRefreshKey((k) => k + 1)
    void refresh()
    void mutate()
  }

  async function handleDisable() {
    const ok = await disable()
    if (ok) toast.success('Notifikasi push dimatikan di perangkat ini')
    setRefreshKey((k) => k + 1)
    void refresh()
    void mutate()
  }

  async function handleTest() {
    try {
      const result = await sendTest()
      void mutate()
      if (result.sent > 0) {
        toast.success('Notifikasi percobaan terkirim 🎉', { description: `${result.sent} perangkat menerima. Cek layar HP/kamu sekarang.` })
      } else if (result.failed > 0) {
        const first = result.details?.find((detail) => !detail.ok)
        toast.error('Gagal mengirim notifikasi', {
          description: first?.error ?? `Layanan push menolak (status ${first?.statusCode ?? 'tidak diketahui'}).`,
        })
      } else {
        toast.error('Belum ada perangkat yang berlangganan', {
          description: 'Tekan "Aktifkan di perangkat ini" lebih dulu di HP ini.',
        })
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal mengirim notifikasi percobaan')
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-6 md:px-8 md:pb-16">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#25D366]/12">
          <BellRing className="h-5 w-5 text-[#25D366]" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">Notifikasi</h1>
          <p className="text-xs text-muted-foreground">
            Aktifkan notifikasi push supaya pesan baru tetap masuk walau panel ditutup.
          </p>
        </div>
        <span className={cn('ml-auto rounded-full px-3 py-1 text-[11px] font-semibold', badge.tone)}>{badge.text}</span>
      </div>

      {/* Langkah utama */}
      <Card className="mt-5 p-4 md:p-5">
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={handleEnable}
            loading={busy}
            disabled={busy || status === 'loading'}
            className="flex-1 sm:flex-none"
          >
            <Sparkles /> {active ? 'Sudah aktif — aktifkan ulang' : 'Aktifkan di perangkat ini'}
          </Button>
          <Button variant="secondary" onClick={handleTest} disabled={busy || !diagnostics || diagnostics.subscriptionCount === 0}>
            <Send /> Kirim notifikasi percobaan
          </Button>
          <Button variant="ghost" size="icon" title="Periksa ulang" onClick={() => { setRefreshKey((k) => k + 1); void refresh(); void mutate() }}>
            <RefreshCw className={cn(isLoading && 'animate-spin')} />
          </Button>
        </div>

        {active ? (
          <Button variant="ghost" size="sm" className="mt-2 text-muted-foreground" onClick={handleDisable} disabled={busy}>
            Matikan di perangkat ini
          </Button>
        ) : null}

        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          {status === 'ios-install'
            ? 'iPhone/iPad: notifikasi hanya bisa aktif setelah panel dipasang ke Layar Utama lewat Safari (lihat langkah 1 di bawah).'
            : status === 'denied'
              ? 'Izin notifikasi diblokir. Buka pengaturan situs di browser → Notifikasi → Izinkan, lalu muat ulang halaman ini.'
              : status === 'unsupported'
                ? 'Browser ini belum mendukung Web Push. Pakai Chrome/Edge/Safari terbaru lewat alamat HTTPS.'
                : status === 'error'
                  ? (message ?? 'Terjadi kesalahan saat mendaftarkan notifikasi.')
                  : 'Setelah aktif, tekan "Kirim notifikasi percobaan" — notifikasi harus muncul di layar perangkat ini.'}
        </p>
      </Card>

      {/* Pemeriksaan langsung */}
      <Card className="mt-4 p-4 md:p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-[#25D366]" /> Pemeriksaan di perangkat ini
        </h2>
        {!report ? (
          <div className="mt-3 space-y-2">
            {[0, 1, 2, 3, 4].map((key) => (
              <Skeleton key={key} className="h-8 w-full" />
            ))}
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <CheckRow
              ok={report.https}
              label={report.https ? 'Alamat panel aman (HTTPS)' : 'Panel dibuka lewat HTTP biasa'}
              detail={report.https ? window.location.host : 'Notifikasi wajib HTTPS. Pakai domain Railway, bukan IP.'}
            />
            <CheckRow
              ok={report.swSupported && report.swRegistered}
              label={report.swRegistered ? 'Service worker terpasang' : 'Service worker belum terdaftar'}
              detail={report.swRegistered ? `status: ${report.swState ?? 'aktif'}` : 'Muat ulang halaman; kalau tetap gagal, cek alamat HTTPS.'}
            />
            <CheckRow
              ok={report.permission === 'granted'}
              label={
                report.permission === 'granted'
                  ? 'Izin notifikasi diberikan'
                  : report.permission === 'denied'
                    ? 'Izin notifikasi diblokir'
                    : 'Izin notifikasi belum diminta'
              }
              detail={
                report.permission === 'denied'
                  ? 'Menu browser → Setelan situs → Notifikasi → Izinkan, lalu muat ulang.'
                  : 'Tekan tombol "Aktifkan di perangkat ini" di atas.'
              }
            />
            <CheckRow
              ok={report.subscribed}
              label={report.subscribed ? 'Perangkat ini sudah berlangganan' : 'Perangkat ini belum berlangganan'}
              detail={report.endpointHost ? `tujuan: ${report.endpointHost}` : 'Belum ada endpoint push di browser ini.'}
            />
            <CheckRow
              ok={report.platform !== 'iphone' || report.standalone}
              label={report.platform === 'iphone' ? 'Mode aplikasi (Layar Utama)' : 'Jenis perangkat didukung'}
              detail={
                report.platform === 'iphone'
                  ? report.standalone
                    ? 'Dibuka dari ikon Layar Utama — benar.'
                    : 'Masih di dalam Safari. Pasang dulu: Bagikan → Tambahkan ke Layar Utama.'
                  : report.platform === 'android'
                    ? 'Android terdeteksi — dukungan push penuh.'
                    : 'Desktop terdeteksi.'
              }
            />
          </div>
        )}
      </Card>

      {/* Petunjuk perangkat */}
      <Card className="mt-4 p-4 md:p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Smartphone className="h-4 w-4 text-[#25D366]" /> Langkah perangkat
          {report ? (
            <span className="ml-auto rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground">
              terdeteksi: {report.platform === 'iphone' ? 'iPhone/iPad' : report.platform === 'android' ? 'Android' : 'Desktop'}
            </span>
          ) : null}
        </h2>
        <div className="mt-3 space-y-3">
          {report?.platform === 'iphone' ? (
            <>
              <Step n={1}>
                Buka panel ini <b className="text-foreground">di Safari</b> → tombol <b className="text-foreground">Bagikan</b> →{' '}
                <b className="text-foreground">Tambahkan ke Layar Utama</b> → <b className="text-foreground">Tambah</b>.
              </Step>
              <Step n={2}>Tutup Safari, buka panel dari <b className="text-foreground">ikon di Layar Utama</b>, lalu kembali ke halaman Notifikasi ini.</Step>
              <Step n={3}>Tekan <b className="text-foreground">Aktifkan di perangkat ini</b> → pilih <b className="text-foreground">Izinkan</b>.</Step>
              <Step n={4}>Tekan <b className="text-foreground">Kirim notifikasi percobaan</b>.</Step>
            </>
          ) : report?.platform === 'android' ? (
            <>
              <Step n={1}>Opsional tapi disarankan: menu <b className="text-foreground">⋮</b> di Chrome → <b className="text-foreground">Tambahkan ke Layar utama</b>.</Step>
              <Step n={2}>Di halaman ini tekan <b className="text-foreground">Aktifkan di perangkat ini</b> → <b className="text-foreground">Izinkan</b> saat browser bertanya.</Step>
              <Step n={3}>Tekan <b className="text-foreground">Kirim notifikasi percobaan</b> — notifikasi harus muncul.</Step>
              <Step n={4}>
                Kalau tidak muncul: cek <b className="text-foreground">Setelan Android → Notifikasi → Chrome</b> tidak dimatikan, dan mode
                <b className="text-foreground"> Jangan Ganggu (DND)</b> tidak aktif.
              </Step>
            </>
          ) : (
            <>
              <Step n={1}>Tekan <b className="text-foreground">Aktifkan di perangkat ini</b> → <b className="text-foreground">Izinkan</b>.</Step>
              <Step n={2}>Tekan <b className="text-foreground">Kirim notifikasi percobaan</b>.</Step>
              <Step n={3}>
                Kalau tidak muncul: cek <b className="text-foreground">Setelan sistem → Notifikasi → Browser</b> dan mode
                <b className="text-foreground"> Jangan Ganggu / Fokus</b>.
              </Step>
              <Step n={4}>Uji sungguhan: tutup tab panel, lalu kirim WhatsApp dari nomor lain.</Step>
            </>
          )}
        </div>
      </Card>

      {/* Server */}
      <Card className="mt-4 p-4 md:p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <BellRing className="h-4 w-4 text-[#25D366]" /> Sisi server
        </h2>
        {isLoading && !diagnostics ? (
          <Skeleton className="mt-3 h-24 w-full" />
        ) : !diagnostics ? (
          <p className="mt-3 text-xs text-muted-foreground">Tidak bisa membaca status server.</p>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Kunci VAPID</div>
                <div className="mt-1 text-sm font-semibold">{diagnostics.publicKeyPreview}</div>
                <div className="text-[10px] text-muted-foreground">
                  {diagnostics.vapidSource === 'env' ? 'dari environment (permanen)' : 'dibuat otomatis di data/vapid.json'}
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Perangkat terdaftar</div>
                <div className="mt-1 text-sm font-semibold">{diagnostics.subscriptionCount}</div>
                <div className="text-[10px] text-muted-foreground">satu perangkat = satu langganan</div>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Percobaan terakhir</div>
                <div className="mt-1 text-sm font-semibold">
                  {diagnostics.recent[0]
                    ? `${diagnostics.recent[0].sent} terkirim / ${diagnostics.recent[0].failed} gagal`
                    : 'belum ada'}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {diagnostics.recent[0] ? formatDateTime(diagnostics.recent[0].at) : 'tekan tombol percobaan'}
                </div>
              </div>
            </div>

            {diagnostics.devices.length > 0 ? (
              <div className="space-y-2">
                <div className="text-[11px] font-medium text-foreground/80">Perangkat</div>
                {diagnostics.devices.map((device, index) => (
                  <div key={device.id} className="rounded-xl border border-white/[0.06] p-3 text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        #{index + 1} · {device.host}
                        {device.deviceId ? ` · ${device.deviceId.slice(0, 8)}…` : ''}
                      </span>
                      {device.hasError ? (
                        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] text-red-300">pernah gagal</span>
                      ) : device.lastSuccessAt ? (
                        <span className="rounded-full bg-[#25D366]/15 px-2 py-0.5 text-[10px] text-[#4ade80]">ok</span>
                      ) : (
                        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground">belum diuji</span>
                      )}
                    </div>
                    <div className="mt-1 truncate text-muted-foreground">{device.userAgent ?? 'perangkat tanpa info'}</div>
                    <div className="text-muted-foreground">
                      terdaftar {formatDateTime(device.createdAt)}
                      {device.lastSuccessAt ? ` · sukses terakhir ${formatDateTime(device.lastSuccessAt)}` : ''}
                    </div>
                    {device.lastError ? (
                      <div className="mt-1 rounded-lg bg-red-500/10 p-2 text-red-200">pesan error: {device.lastError}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {diagnostics.recent.length > 0 ? (
              <div className="space-y-2">
                <div className="text-[11px] font-medium text-foreground/80">Riwayat percobaan (12 terakhir)</div>
                <div className="max-h-56 space-y-1.5 overflow-y-auto scrollbar-thin">
                  {diagnostics.recent.map((attempt) => (
                    <div key={`${attempt.at}-${attempt.title}`} className="rounded-lg border border-white/[0.06] px-3 py-2 text-[11px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground">{formatDateTime(attempt.at)}</span>
                        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px]">{attempt.source}</span>
                        <span className="min-w-0 flex-1 truncate">{attempt.title}</span>
                        <span className={cn('font-semibold', attempt.sent > 0 ? 'text-[#4ade80]' : attempt.devices === 0 ? 'text-amber-300' : 'text-red-300')}>
                          {attempt.devices === 0
                            ? 'tanpa perangkat'
                            : `${attempt.sent}✓ / ${attempt.failed}✗${attempt.skipped ? ` / ${attempt.skipped} dilewati` : ''}`}
                        </span>
                      </div>
                      {attempt.details.filter((detail) => !detail.ok).map((detail) => (
                        <div key={detail.host} className="mt-1 text-red-200">
                          {detail.host}: {detail.error ?? 'ditolak'} {detail.statusCode ? `(HTTP ${detail.statusCode})` : ''}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      {/* Kenapa belum muncul */}
      <Card className="mt-4 p-4 md:p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CircleHelp className="h-4 w-4 text-[#25D366]" /> Sudah ditekan tapi tidak ada notifikasi?
        </h2>
        <ul className="mt-3 space-y-2.5 text-xs leading-relaxed text-muted-foreground">
          <li className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
            <span>
              <b className="text-foreground">Panel sedang dibuka di perangkat ini</b> — kalau tab panel perangkat ini
              terlihat, push ke perangkat ini ditahan supaya notifikasi tidak dobel (sudah ada suara + toast di halaman).
              Perangkat <b className="text-foreground">lain</b> tetap menerima notifikasi. Tutup panel, lalu kirim pesan uji.
            </span>
          </li>
          <li className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
            <span>
              <b className="text-foreground">Pesannya lama (lebih dari 2 menit)</b> — pesan hasil impor riwayat saat pairing
              memang tidak dinotifikasi supaya tidak muncul ribuan sekaligus.
            </span>
          </li>
          <li className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
            <span>
              <b className="text-foreground">Status layanan push menolak</b> — lihat “Sisi server → riwayat percobaan” di atas.
              Kode <span className="font-mono">410</span> artinya langganan lama; tekan Aktifkan ulang di perangkat ini.
            </span>
          </li>
          <li className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
            <span>
              <b className="text-foreground">Mode hemat baterai / DND / notifikasi sistem dimatikan</b> untuk browser atau
              aplikasi panel. Cek setelan notifikasi sistem di HP.
            </span>
          </li>
        </ul>
        <div className="mt-4 rounded-xl border border-[#25D366]/20 bg-[#25D366]/[0.06] p-3 text-[11px] leading-relaxed">
          <b className="text-foreground">Uji paling jujur:</b> tutup panel sepenuhnya → kirim WhatsApp dari nomor lain ke nomor
          yang tertaut → notifikasi muncul dalam beberapa detik → klik notifikasi → panel terbuka langsung di chat tersebut.
        </div>
      </Card>

      <p className="mt-4 text-center text-[10px] text-muted-foreground">
        Catatan: halaman ini juga bisa dibuka langsung di <span className="font-mono">/notifikasi</span>. Pengaturan di sini
        berlaku per perangkat — ulangi di setiap HP/laptop yang ingin menerima notifikasi.
      </p>
    </div>
  )
}
