'use client'

import * as React from 'react'
import useSWR from 'swr'
import {
  Bot,
  Check,
  Loader2,
  MessageSquareText,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Webhook,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/fetcher'
import { useSessions } from '@/hooks/use-api'
import { cn, formatDateTime } from '@/lib/utils'

interface WebhookConfig {
  enabled: boolean
  url: string | null
  hasSecret: boolean
  events: string[]
  lastAt: string | null
  lastStatus: string | null
}

interface Rule {
  id: string
  name: string
  matchType: 'contains' | 'exact' | 'startsWith' | 'regex'
  pattern: string
  reply: string
  enabled: boolean
  applyToGroups: boolean
  cooldownSeconds: number
  hits: number
  lastFiredAt: string | null
}

const MATCH_LABEL: Record<Rule['matchType'], string> = {
  contains: 'mengandung',
  exact: 'sama persis',
  startsWith: 'diawali',
  regex: 'regex',
}

export default function AutomationPage() {
  const { sessions, isLoading: sessionsLoading } = useSessions()
  const [sessionId, setSessionId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!sessionId && sessions.length > 0) setSessionId(sessions[0].id)
  }, [sessions, sessionId])

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6 md:px-8 md:pb-12 md:pt-10">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#25D366]/25 bg-[#25D366]/10 px-3 py-1 text-[11px] text-[#4ade80]">
          <Bot className="h-3 w-3" /> Otomasi
        </div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          Balasan otomatis &amp; <span className="gradient-text">webhook</span>
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Balas otomatis saat ada kata kunci tertentu (jam kerja, harga, alamat, dll) dan teruskan
          pesan masuk ke sistem lain sebagai JSON — cocok untuk bot, spreadsheet, CRM, atau n8n.
        </p>
      </div>

      {/* Pilih sesi */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {sessionsLoading && sessions.length === 0 && <Skeleton className="h-9 w-56" />}
        {sessions.map((session) => (
          <Button
            key={session.id}
            variant={sessionId === session.id ? 'subtle' : 'secondary'}
            size="sm"
            onClick={() => setSessionId(session.id)}
          >
            {session.name}
            {session.status === 'connected' ? ' · online' : ''}
          </Button>
        ))}
        {!sessionsLoading && sessions.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Belum ada sesi. Tautkan nomor dulu di halaman Dasbor.
          </p>
        )}
      </div>

      {sessionId && (
        <div className="mt-6 space-y-4">
          <WebhookCard sessionId={sessionId} />
          <RulesCard sessionId={sessionId} />
        </div>
      )}
    </div>
  )
}

/* --------------------------------- webhook -------------------------------- */

function WebhookCard({ sessionId }: { sessionId: string }) {
  const { data, isLoading, mutate } = useSWR<{ webhook: WebhookConfig }>(
    `/api/sessions/${sessionId}/webhook`,
  )
  const webhook = data?.webhook

  const [url, setUrl] = React.useState('')
  const [secret, setSecret] = React.useState('')
  const [enabled, setEnabled] = React.useState(false)
  const [events, setEvents] = React.useState<string[]>(['message'])
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)

  React.useEffect(() => {
    if (!webhook) return
    setUrl(webhook.url ?? '')
    setEnabled(webhook.enabled)
    setEvents(webhook.events.length > 0 ? webhook.events : ['message'])
    setSecret('')
  }, [webhook])

  async function save() {
    setSaving(true)
    try {
      await api.patch<{ webhook: WebhookConfig }>(`/api/sessions/${sessionId}/webhook`, {
        enabled,
        url: url.trim() || null,
        events,
        ...(secret.trim() ? { secret: secret.trim() } : {}),
      })
      toast.success('Pengaturan webhook disimpan')
      setSecret('')
      void mutate()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal menyimpan webhook')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Webhook className="h-4 w-4 text-[#25D366]" /> Webhook keluar
          </h2>
          <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-muted-foreground">
            Kami mengirim <code className="font-mono">POST</code> JSON ke URL-mu setiap ada pesan
            masuk. Setiap permintaan ditandatangani{' '}
            <code className="font-mono">x-wa-signature: sha256=…</code> (HMAC dari secret) supaya
            penerima bisa memverifikasi keasliannya.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void mutate()}>
          <RefreshCw /> Muat ulang
        </Button>
      </div>

      {isLoading && !webhook ? (
        <Skeleton className="mt-4 h-40 w-full" />
      ) : (
        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <label htmlFor="webhook-url" className="text-xs font-medium text-muted-foreground">
              URL tujuan
            </label>
            <Input
              id="webhook-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://contoh.com/webhook/whatsapp"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="webhook-secret" className="text-xs font-medium text-muted-foreground">
              Secret penanda tangan {webhook?.hasSecret ? '(sudah diatur)' : '(opsional)'}
            </label>
            <Input
              id="webhook-secret"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder={webhook?.hasSecret ? '•••••••• (biarkan kosong bila tidak diubah)' : 'rahasia-webhook'}
            />
          </div>

          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">Event yang dikirim</span>
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'message', label: 'Pesan masuk' },
                { id: 'autoreply', label: 'Balasan otomatis terkirim' },
              ].map((item) => {
                const active = events.includes(item.id)
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      setEvents((current) =>
                        active ? current.filter((value) => value !== item.id) : [...current, item.id],
                      )
                    }
                    className={cn(
                      'rounded-full border px-3 py-1 text-[11px] transition',
                      active
                        ? 'border-[#25D366]/30 bg-[#25D366]/15 text-[#4ade80]'
                        : 'border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-white/20 bg-white/5 accent-[#25D366]"
            />
            Aktifkan webhook untuk sesi ini
          </label>

          {webhook?.lastAt && (
            <p className="flex items-center gap-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Percobaan terakhir {formatDateTime(webhook.lastAt)} · status: {webhook.lastStatus ?? '-'}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()} loading={saving}>
              <Check /> Simpan
            </Button>
            <Button
              variant="secondary"
              loading={testing}
              onClick={async () => {
                setTesting(true)
                try {
                  const result = await api.post<{ result: { ok: boolean; status: number | null; error: string | null } }>(
                    `/api/sessions/${sessionId}/webhook/test`,
                  )
                  if (result.result.ok) toast.success('Webhook menerima event percobaan', { description: `HTTP ${result.result.status}` })
                  else toast.error('Webhook gagal', { description: result.result.error ?? 'Tidak diketahui' })
                  void mutate()
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : 'Gagal mengirim percobaan')
                } finally {
                  setTesting(false)
                }
              }}
            >
              <Send /> Kirim percobaan
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

/* --------------------------------- aturan --------------------------------- */

function RulesCard({ sessionId }: { sessionId: string }) {
  const { data, isLoading, mutate } = useSWR<{ rules: Rule[] }>(`/api/sessions/${sessionId}/autoreply`)
  const rules = data?.rules ?? []
  const [editing, setEditing] = React.useState<Rule | null>(null)
  const [open, setOpen] = React.useState(false)

  function startNew() {
    setEditing(null)
    setOpen(true)
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Zap className="h-4 w-4 text-[#25D366]" /> Aturan balasan otomatis
          </h2>
          <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-muted-foreground">
            Aturan pertama yang cocok akan membalas satu kali (ada jeda/cooldown supaya tidak
            spam). Hanya berlaku untuk pesan masuk dari orang lain.
          </p>
        </div>
        <Button size="sm" onClick={startNew}>
          <Plus /> Aturan baru
        </Button>
      </div>

      <div className="mt-4 space-y-2">
        {isLoading && rules.length === 0 && <Skeleton className="h-24 w-full" />}

        {!isLoading && rules.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-10 text-center text-xs text-muted-foreground">
            Belum ada aturan. Contoh: bila pesan mengandung “harga”, balas dengan daftar harga.
          </div>
        )}

        {rules.map((rule) => (
          <div
            key={rule.id}
            className="flex flex-wrap items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
          >
            <span
              className={cn(
                'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                rule.enabled ? 'bg-[#25D366]/15 text-[#4ade80]' : 'bg-white/[0.05] text-muted-foreground',
              )}
            >
              {rule.matchType === 'regex' ? <Sparkles className="h-4 w-4" /> : <MessageSquareText className="h-4 w-4" />}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold">{rule.name}</span>
                <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] text-muted-foreground">
                  {MATCH_LABEL[rule.matchType]} “{rule.pattern}”
                </span>
                {rule.applyToGroups && (
                  <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] text-muted-foreground">
                    berlaku di grup
                  </span>
                )}
                {!rule.enabled && (
                  <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] text-amber-300">
                    nonaktif
                  </span>
                )}
              </div>
              <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[11px] text-muted-foreground">
                {rule.reply}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground/80">
                {rule.hits}× membalas
                {rule.lastFiredAt ? ` · terakhir ${formatDateTime(rule.lastFiredAt)}` : ''} · jeda{' '}
                {rule.cooldownSeconds}s
              </p>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  try {
                    await api.patch(`/api/autoreply/${rule.id}`, { enabled: !rule.enabled })
                    toast.success(rule.enabled ? 'Aturan dimatikan' : 'Aturan diaktifkan')
                    void mutate()
                  } catch {
                    toast.error('Gagal mengubah aturan')
                  }
                }}
              >
                {rule.enabled ? 'Matikan' : 'Aktifkan'}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="iconSm" aria-label="Aksi aturan">
                    ⋮
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      setEditing(rule)
                      setOpen(true)
                    }}
                  >
                    Ubah aturan
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-red-300 focus:text-red-200"
                    onSelect={async () => {
                      try {
                        await api.delete(`/api/autoreply/${rule.id}`)
                        toast.success('Aturan dihapus')
                        void mutate()
                      } catch {
                        toast.error('Gagal menghapus aturan')
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" /> Hapus
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}
      </div>

      <RuleDialog
        sessionId={sessionId}
        rule={editing}
        open={open}
        onOpenChange={setOpen}
        onSaved={() => void mutate()}
      />
    </Card>
  )
}

function RuleDialog({
  sessionId,
  rule,
  open,
  onOpenChange,
  onSaved,
}: {
  sessionId: string
  rule: Rule | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [name, setName] = React.useState('')
  const [matchType, setMatchType] = React.useState<Rule['matchType']>('contains')
  const [pattern, setPattern] = React.useState('')
  const [reply, setReply] = React.useState('')
  const [applyToGroups, setApplyToGroups] = React.useState(false)
  const [cooldown, setCooldown] = React.useState(60)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setName(rule?.name ?? '')
    setMatchType(rule?.matchType ?? 'contains')
    setPattern(rule?.pattern ?? '')
    setReply(rule?.reply ?? '')
    setApplyToGroups(rule?.applyToGroups ?? false)
    setCooldown(rule?.cooldownSeconds ?? 60)
  }, [open, rule])

  const examples = [
    { name: 'Tanya harga', matchType: 'contains' as const, pattern: 'harga', reply: 'Halo! Daftar harga bisa dilihat di sini: …' },
    { name: 'Jam operasional', matchType: 'contains' as const, pattern: 'jam buka', reply: 'Kami buka Senin–Sabtu, 08.00–20.00 WIB.' },
    { name: 'Sapaan', matchType: 'startsWith' as const, pattern: 'halo', reply: 'Halo juga! Ada yang bisa dibantu? 🙂' },
  ]

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        matchType,
        pattern: pattern.trim(),
        reply: reply.trim(),
        applyToGroups,
        cooldownSeconds: cooldown,
      }
      if (rule) await api.patch(`/api/autoreply/${rule.id}`, payload)
      else await api.post(`/api/sessions/${sessionId}/autoreply`, payload)
      toast.success(rule ? 'Aturan diperbarui' : 'Aturan dibuat')
      onOpenChange(false)
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal menyimpan aturan')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? 'Ubah aturan' : 'Aturan balasan baru'}</DialogTitle>
          <DialogDescription>
            Pesan masuk dari orang lain yang cocok akan dibalas otomatis dengan teks di bawah.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {!rule && (
            <div className="flex flex-wrap gap-1.5">
              {examples.map((example) => (
                <button
                  key={example.name}
                  type="button"
                  onClick={() => {
                    setName(example.name)
                    setMatchType(example.matchType)
                    setPattern(example.pattern)
                    setReply(example.reply)
                  }}
                  className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] text-muted-foreground transition hover:text-foreground"
                >
                  {example.name}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="rule-name">
              Nama aturan
            </label>
            <Input
              id="rule-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Tanya harga"
              required
              maxLength={80}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="rule-match">
                Jenis cocok
              </label>
              <select
                id="rule-match"
                value={matchType}
                onChange={(event) => setMatchType(event.target.value as Rule['matchType'])}
                className="h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-[#25D366]/40"
              >
                <option value="contains">mengandung</option>
                <option value="exact">sama persis</option>
                <option value="startsWith">diawali</option>
                <option value="regex">regex</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="rule-pattern">
                Kata kunci / pola
              </label>
              <Input
                id="rule-pattern"
                value={pattern}
                onChange={(event) => setPattern(event.target.value)}
                placeholder="harga"
                required
                maxLength={300}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="rule-reply">
              Balasan
            </label>
            <Textarea
              id="rule-reply"
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              placeholder="Halo! Terima kasih sudah menghubungi kami. Daftar harga: …"
              rows={4}
              required
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={applyToGroups}
                onChange={(event) => setApplyToGroups(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-white/20 bg-white/5 accent-[#25D366]"
              />
              Berlaku juga di grup
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Jeda antar balasan
              <Input
                type="number"
                min={0}
                max={86400}
                value={cooldown}
                onChange={(event) => setCooldown(Number(event.target.value))}
                className="h-8 w-20 py-1 text-xs"
              />
              detik
            </label>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" loading={saving}>
              {rule ? 'Simpan perubahan' : 'Buat aturan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
