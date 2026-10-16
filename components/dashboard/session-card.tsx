'use client'

import * as React from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import {
  Activity,
  Bug,
  Eraser,
  Wand2,
  FlaskConical,
  LogOut,
  MessageSquare,
  MoreVertical,
  Pencil,
  Plug,
  PlugZap,
  QrCode,
  Trash2,
  Unplug,
} from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { SessionStatusBadge } from '@/components/session-status-badge'
import { api } from '@/lib/fetcher'
import type { SessionWithStats } from '@/lib/types'
import { cn, formatDateTime } from '@/lib/utils'

interface Props {
  session: SessionWithStats
  onChanged: () => void
  onDeleted: () => void
}

export function SessionCard({ session, onChanged, onDeleted }: Props) {
  const [busy, setBusy] = React.useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [name, setName] = React.useState(session.name)
  const [confirmLogout, setConfirmLogout] = React.useState(false)

  const { data } = useSWR<{ url: string | null }>(
    session.status === 'connected' ? `/api/sessions/${session.id}/avatar` : null,
    { revalidateOnFocus: false, dedupingInterval: 300000 },
  )

  async function run(action: string, fn: () => Promise<unknown>, successMessage: string) {
    setBusy(action)
    try {
      await fn()
      toast.success(successMessage)
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Aksi gagal dijalankan')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="card-hover group relative overflow-hidden p-5">
      <div className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-[#25D366]/10 blur-2xl transition-opacity group-hover:opacity-80" />

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar
            name={session.pushName || session.name}
            src={session.status === 'connected' ? data?.url : null}
            size="md"
            ring={session.status === 'connected'}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-semibold">{session.name}</h3>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              +{session.phoneNumber}
              {session.pushName ? ` · ${session.pushName}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <SessionStatusBadge status={session.status} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="iconSm" aria-label="Aksi sesi">
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Sesi</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
                <Pencil className="h-4 w-4" /> Ganti nama
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  run(
                    'connect',
                    () => api.post(`/api/sessions/${session.id}/connect`),
                    'Menyambungkan ulang sesi…',
                  )
                }
              >
                <PlugZap className="h-4 w-4" /> Sambungkan ulang
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  run(
                    'disconnect',
                    () => api.post(`/api/sessions/${session.id}/disconnect`),
                    'Sesi diputus',
                  )
                }
              >
                <Unplug className="h-4 w-4" /> Putuskan
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() =>
                  run(
                    'test',
                    () => api.post(`/api/sessions/${session.id}/test-message`),
                    'Pesan uji terkirim — cek chat “Pesan ke diri sendiri”',
                  )
                }
              >
                <FlaskConical className="h-4 w-4" /> Kirim pesan uji
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  run(
                    'debug',
                    async () => {
                      const info = (await api.get<Record<string, unknown>>(
                        `/api/sessions/${session.id}/debug`,
                      )) as {
                        socket: { isLive: boolean; wsReadyStateLabel: string }
                        counters: { upsert: number; stored: number; skipped: number } | null
                        storage: { chatCount: number; messageCount: number }
                        recentEvents: Array<{ reason: string; jid?: string }>
                      }
                      toast.info('Diagnostik', {
                        description:
                          `socket: ${info.socket.isLive ? info.socket.wsReadyStateLabel : 'TIDAK JALAN'} · ` +
                          `event: ${info.counters?.upsert ?? 0} (disimpan ${info.counters?.stored ?? 0}, dilewati ${info.counters?.skipped ?? 0}) · ` +
                          `chat: ${info.storage.chatCount} · pesan: ${info.storage.messageCount}`,
                        duration: 12000,
                      })
                      if (info.recentEvents[0]) {
                        toast.info('Event terakhir yang diterima', {
                          description: `${info.recentEvents[0].jid ?? '-'} → ${info.recentEvents[0].reason}`,
                          duration: 12000,
                        })
                      }
                    },
                    'Selesai (lihat notifikasi)',
                  )
                }
              >
                <Bug className="h-4 w-4" /> Jalankan diagnostik
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  run(
                    'prune',
                    async () => {
                      const { result } = await api.post<{ result: { removed: number } }>(
                        `/api/sessions/${session.id}/prune-chats`,
                      )
                      return result.removed === 0
                        ? 'Daftar chat sudah bersih — tidak ada chat kosong.'
                        : `${result.removed} chat kosong dibersihkan. Chat muncul lagi otomatis kalau ada pesan baru.`
                    },
                    'Daftar chat dirapikan',
                  )
                }
              >
                <Eraser className="h-4 w-4" /> Rapikan daftar chat (hapus yang kosong)
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  run(
                    'repair',
                    async () => {
                      const { result } = await api.post<{
                        result: {
                          scanned: number
                          repaired: number
                          unresolved: number
                          failed: number
                          contactsRepaired: number
                        }
                      }>(`/api/sessions/${session.id}/repair-lid`)
                      const message =
                        result.scanned === 0
                          ? 'Tidak ada chat beralamat @lid — semua sudah bernomor.'
                          : `${result.repaired} dari ${result.scanned} chat dikembalikan ke nomor aslinya` +
                            (result.unresolved > 0
                              ? `. ${result.unresolved} masih disembunyikan WhatsApp (nomornya belum dibagikan).`
                              : '.') +
                            (result.failed > 0 ? ` ${result.failed} gagal diproses (lihat log server).` : '') +
                            (result.contactsRepaired > 0
                              ? ` ${result.contactsRepaired} kontak ikut dirapikan.`
                              : '')
                      return message
                    },
                    'Perbaikan selesai',
                  )
                }
              >
                <Wand2 className="h-4 w-4" /> Perbaiki nomor kontak (LID)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-amber-300 focus:text-amber-200"
                onSelect={() => setConfirmLogout(true)}
              >
                <LogOut className="h-4 w-4" /> Keluar / lepas perangkat
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-red-300 focus:text-red-200"
                onSelect={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-4 w-4" /> Hapus sesi
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {session.status === 'connected' && !session.isLive && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2 text-[11px] text-amber-200">
          <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Socket belum jalan di server ini (status tersimpan “connected”). Klik <b>Sambungkan ulang</b> —
            pesan baru belum akan masuk sebelum ini aktif.
          </span>
        </div>
      )}

      {session.lastError && (
        <p className="mt-3 line-clamp-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.07] px-3 py-2 text-[11px] text-amber-200">
          {session.lastError}
        </p>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Stat label="Chat" value={session.stats.chats} />
        <Stat label="Pesan" value={session.stats.messages} />
        <Stat label="Belum dibaca" value={session.stats.unread} highlight={session.stats.unread > 0} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {session.status === 'connected' ? (
          <>
            <Button asChild size="sm" className="flex-1">
              <Link href={`/chat/${session.id}`}>
                <MessageSquare /> Buka chat
              </Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link href={`/pair?session=${session.id}`}>
                <QrCode /> Kode
              </Link>
            </Button>
          </>
        ) : session.status === 'pairing' ? (
          <Button asChild size="sm" className="flex-1">
            <Link href={`/pair?session=${session.id}`}>
              <QrCode /> Lihat kode pairing
            </Link>
          </Button>
        ) : (
          <>
            <Button asChild size="sm" className="flex-1">
              <Link href={`/pair?session=${session.id}`}>
                <QrCode /> Tautkan nomor ini
              </Link>
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === 'connect'}
              onClick={() =>
                run(
                  'connect',
                  () => api.post(`/api/sessions/${session.id}/connect`),
                  'Menyambungkan…',
                )
              }
            >
              <Plug /> Sambungkan ulang
            </Button>
          </>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>Dibuat {formatDateTime(session.createdAt)}</span>
        {session.connectedAt && (
          <span className={cn('flex items-center gap-1 text-[#4ade80]')}>
            <span className="h-1 w-1 rounded-full bg-[#25D366]" />
            online sejak {formatDateTime(session.connectedAt)}
          </span>
        )}
      </div>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Ganti nama sesi</DialogTitle>
            <DialogDescription>Hanya mengubah label di dalam panel ini — nomor di WhatsApp tidak terpengaruh.</DialogDescription>
          </DialogHeader>
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)}>
              Batal
            </Button>
            <Button
              loading={busy === 'rename'}
              onClick={async () => {
                await run(
                  'rename',
                  () => api.patch(`/api/sessions/${session.id}`, { name }),
                  'Nama sesi diubah',
                )
                setRenameOpen(false)
              }}
            >
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Logout confirmation */}
      <ConfirmDialog
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        title="Keluar & lepas perangkat?"
        description="Perangkat akan dilepas dari WhatsApp. Untuk menyambungkan nomor ini lagi kamu perlu kode pairing baru. Riwayat chat tetap tersimpan di panel ini."
        confirmLabel="Keluar"
        busy={busy === 'logout'}
        onConfirm={async () => {
          await run('logout', () => api.post(`/api/sessions/${session.id}/logout`), 'Sesi berhasil dilepas')
          setConfirmLogout(false)
        }}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Hapus sesi ini?"
        description="Semua data sesi ini — chat, pesan, dan media yang tersimpan — akan dihapus dari server. Akun WhatsApp-nya sendiri tidak terpengaruh sampai kamu juga melakukan keluar/lepas perangkat."
        confirmLabel="Hapus semua"
        busy={busy === 'delete'}
        onConfirm={async () => {
          await api
            .delete(`/api/sessions/${session.id}`)
            .then(() => {
              toast.success('Sesi dihapus')
              setConfirmDelete(false)
              onDeleted()
            })
            .catch((error: unknown) =>
              toast.error(error instanceof Error ? error.message : 'Gagal menghapus'),
            )
        }}
      />
    </Card>
  )
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-white/[0.06] bg-white/[0.02] px-2 py-2',
        highlight && 'border-[#25D366]/25 bg-[#25D366]/[0.08]',
      )}
    >
      <div className={cn('text-sm font-semibold tabular-nums', highlight && 'text-[#4ade80]')}>
        {value.toLocaleString()}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  )
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  busy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void | Promise<void>
  busy?: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" loading={busy} onClick={() => void onConfirm()}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
