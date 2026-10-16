'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import {
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  Smartphone,
  Sparkles,
  User,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { APP_NAME, APP_VERSION, DEVELOPER_CREDIT, DEVELOPER_URL } from '@/lib/branding'
import { api } from '@/lib/fetcher'
import { cn } from '@/lib/utils'

interface AuthStatus {
  authEnabled: boolean
  authenticated: boolean
  username: string | null
}

export default function LoginPage() {
  return (
    <React.Suspense fallback={<LoginSkeleton />}>
      <LoginContent />
    </React.Suspense>
  )
}

function LoginSkeleton() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-[#25D366]" />
    </div>
  )
}

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get('next') || '/'

  const { data: status, isLoading } = useSWR<AuthStatus>('/api/auth/status')

  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [remember, setRemember] = React.useState(true)
  const [showPassword, setShowPassword] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (status?.username) setUsername(status.username)
  }, [status?.username])

  // Sudah login? langsung masuk.
  React.useEffect(() => {
    if (status?.authenticated && status.authEnabled) router.replace(nextPath)
  }, [status, router, nextPath])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await api.post('/api/auth/login', { username, password, remember })
      toast.success('Berhasil masuk', { description: 'Selamat datang kembali 👋' })
      router.replace(nextPath)
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal masuk'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Panel branding */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-white/[0.06] p-10 lg:flex">
        <div className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-[#25D366]/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 right-0 h-72 w-72 rounded-full bg-[#128C7E]/20 blur-3xl" />

        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#25D366] to-[#128C7E] shadow-[0_10px_30px_-10px_rgba(37,211,102,0.9)]">
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-[#04150f]" fill="currentColor">
                <path d="M12.04 2C7.58 2 4 5.58 4 10.04c0 1.42.37 2.8 1.07 4.02L4 22l8.13-1.05c1.18.63 2.5.96 3.91.96 4.46 0 8.04-3.58 8.04-8.04C24.08 5.58 20.5 2 16.04 2h-4Z" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">{APP_NAME}</div>
              <div className="text-[11px] text-muted-foreground">Versi {APP_VERSION}</div>
            </div>
          </div>

          <h1 className="mt-12 max-w-md text-3xl font-bold leading-tight tracking-tight">
            Panel <span className="gradient-text">WhatsApp Multi-Device</span> milikmu sendiri
          </h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
            Hubungkan nomor dengan kode pairing, pantau percakapan realtime, kirim teks, foto, video,
            dokumen dan pesan suara — semua dari satu panel yang kamu kendalikan.
          </p>

          <ul className="mt-8 space-y-3 text-sm">
            {[
              { icon: Smartphone, text: 'Multi-nomor dalam satu panel' },
              { icon: Sparkles, text: 'Realtime: pesan, reaksi, edit, sekali lihat' },
              { icon: ShieldCheck, text: 'Login terkunci password + cookie aman' },
            ].map((item) => (
              <li key={item.text} className="flex items-center gap-3 text-muted-foreground">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#25D366]/10">
                  <item.icon className="h-4 w-4 text-[#25D366]" />
                </span>
                {item.text}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative text-xs text-muted-foreground">
          {DEVELOPER_URL ? (
            <a href={DEVELOPER_URL} target="_blank" rel="noreferrer" className="hover:text-foreground">
              {DEVELOPER_CREDIT}
            </a>
          ) : (
            DEVELOPER_CREDIT
          )}
        </div>
      </div>

      {/* Panel form */}
      <div className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center lg:hidden">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#25D366] to-[#128C7E]">
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-[#04150f]" fill="currentColor">
                <path d="M12.04 2C7.58 2 4 5.58 4 10.04c0 1.42.37 2.8 1.07 4.02L4 22l8.13-1.05c1.18.63 2.5.96 3.91.96 4.46 0 8.04-3.58 8.04-8.04C24.08 5.58 20.5 2 16.04 2h-4Z" />
              </svg>
            </div>
            <h1 className="mt-4 text-lg font-semibold">{APP_NAME}</h1>
            <p className="text-xs text-muted-foreground">Versi {APP_VERSION}</p>
          </div>

          <div className="glass rounded-2xl p-6">
            <div className="mb-6 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-[#25D366]" />
              <h2 className="text-base font-semibold">Masuk ke panel</h2>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-[#25D366]" />
              </div>
            ) : status && !status.authEnabled ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.08] p-4 text-xs leading-relaxed text-amber-200">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold">
                    <Lock className="h-3.5 w-3.5" /> Login belum diaktifkan
                  </div>
                  Panel ini masih terbuka. Supaya orang lain tidak bisa membaca chat-mu, set{' '}
                  <code className="font-mono">AUTH_PASSWORD</code> pada environment variables
                  (Railway → Variables) lalu redeploy.
                </div>
                <Button className="w-full" onClick={() => router.replace('/')}>
                  Buka panel <ArrowRight />
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="username" className="text-xs font-medium text-muted-foreground">
                    Username
                  </label>
                  <div className="relative">
                    <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="username"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="admin"
                      autoComplete="username"
                      className="pl-10"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="password" className="text-xs font-medium text-muted-foreground">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      className="pl-10 pr-10"
                      autoFocus
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground"
                      aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                    className="h-3.5 w-3.5 rounded border-white/20 bg-white/5 accent-[#25D366]"
                  />
                  Ingat saya selama 30 hari
                </label>

                {error && (
                  <div className="rounded-xl border border-red-500/25 bg-red-500/[0.08] px-3 py-2 text-xs text-red-300">
                    {error}
                  </div>
                )}

                <Button type="submit" className="w-full" loading={loading}>
                  Masuk <ArrowRight className={cn(loading && 'hidden')} />
                </Button>
              </form>
            )}
          </div>

          <p className="mt-6 text-center text-[11px] text-muted-foreground">
            {DEVELOPER_CREDIT} · v{APP_VERSION}
          </p>
        </div>
      </div>
    </div>
  )
}
