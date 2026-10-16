'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import {
  BookUser,
  Check,
  Contact,
  Copy,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  Search,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/avatar'
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
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useSessions } from '@/hooks/use-api'
import { api } from '@/lib/fetcher'
import { isLidAddress } from '@/lib/utils'
import type { ContactDTO } from '@/lib/types'

interface ContactsResponse {
  contacts: ContactDTO[]
  total: number
  shown: number
}

interface ImportResponse {
  result: {
    checked: number
    added: number
    missing: string[]
    results: { input: string; exists: boolean; jid?: string }[]
  }
}

const SOURCE_LABEL: Record<string, string> = {
  sync: 'Dari HP',
  pesan: 'Dari pesan',
  manual: 'Ditambah manual',
}

export default function KontakPage() {
  const router = useRouter()
  const { sessions, isLoading: sessionsLoading } = useSessions()
  const [sessionId, setSessionId] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')
  const [importOpen, setImportOpen] = React.useState(false)
  const [importText, setImportText] = React.useState('')
  const [importing, setImporting] = React.useState(false)
  const [openingChat, setOpeningChat] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!sessionId && sessions.length > 0) setSessionId(sessions[0].id)
  }, [sessions, sessionId])

  // Debounce supaya mengetik tidak menembak API tiap huruf.
  const [debounced, setDebounced] = React.useState('')
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])

  const key = sessionId
    ? `/api/sessions/${sessionId}/contacts${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}`
    : null
  const { data, isLoading, mutate } = useSWR<ContactsResponse>(key)

  const session = sessions.find((item) => item.id === sessionId)
  const contacts = data?.contacts ?? []
  const total = data?.total ?? 0

  async function openChat(contact: ContactDTO) {
    if (!sessionId) return
    try {
      setOpeningChat(contact.id)

      // Sudah punya percakapan? Langsung buka.
      if (contact.chatId) {
        router.push(`/chat/${sessionId}?chat=${contact.chatId}`)
        return
      }

      // Alamat @lid yang nomornya belum terungkap tidak bisa dibuka paksa.
      if (!contact.phoneNumber) {
        toast.error('Nomor kontak ini masih disembunyikan WhatsApp', {
          description: 'Menunggu WhatsApp membagikan nomornya — coba lagi setelah kontak ini mengirim pesan.',
        })
        return
      }

      const { chat } = await api.post<{ chat: { id: string } }>(`/api/sessions/${sessionId}/chats`, {
        phoneNumber: contact.phoneNumber,
      })
      void mutate()
      router.push(`/chat/${sessionId}?chat=${chat.id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Tidak bisa membuka chat kontak ini')
    } finally {
      setOpeningChat(null)
    }
  }

  async function copyNumber(contact: ContactDTO) {
    const value = contact.phoneNumber ? `+${contact.phoneNumber}` : contact.displayName
    try {
      await navigator.clipboard.writeText(value)
      toast.success('Disalin', { description: value })
    } catch {
      toast.error('Gagal menyalin — salin manual dari daftar')
    }
  }

  async function removeContact(contact: ContactDTO) {
    try {
      setDeleting(contact.id)
      await api.delete(`/api/contacts/${contact.id}`)
      toast.success('Kontak dihapus dari panel', { description: 'Tidak menghapus apa pun di HP kamu.' })
      void mutate()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal menghapus kontak')
    } finally {
      setDeleting(null)
    }
  }

  async function runImport() {
    if (!sessionId || !importText.trim()) return
    try {
      setImporting(true)
      const { result } = await api.post<ImportResponse>(`/api/sessions/${sessionId}/contacts`, {
        numbers: importText,
      })
      if (result.added > 0) {
        toast.success(`${result.added} kontak ditambahkan`, {
          description:
            result.missing.length > 0
              ? `${result.missing.length} nomor tidak terdaftar di WhatsApp.`
              : 'Semua nomor valid dan aktif di WhatsApp.',
        })
      } else {
        toast.error('Tidak ada nomor yang cocok', {
          description: 'Pastikan format internasional tanpa tanda +, mis. 6281234567890.',
        })
      }
      setImportOpen(false)
      setImportText('')
      void mutate()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal mengimpor nomor')
    } finally {
      setImporting(false)
    }
  }

  // Dikelompokkan per huruf awal nama supaya mudah dipindai seperti buku telepon.
  const grouped = React.useMemo(() => {
    const map = new Map<string, ContactDTO[]>()
    for (const contact of contacts) {
      const first = contact.displayName.trim().charAt(0).toUpperCase()
      const letter = /[A-Z]/.test(first) ? first : '#'
      const list = map.get(letter) ?? []
      list.push(contact)
      map.set(letter, list)
    }
    return [...map.entries()].sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)))
  }, [contacts])

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-28 pt-6 md:px-8 md:pb-12 md:pt-10">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#25D366]/25 bg-[#25D366]/10 px-3 py-1 text-[11px] text-[#4ade80]">
          <BookUser className="h-3 w-3" /> Buku kontak
        </div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          Kontak dari <span className="gradient-text">nomor yang ditautkan</span>
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Semua kontak yang WhatsApp kirimkan ke panel — lengkap dengan nama yang kamu simpan di HP.
          Klik <b className="text-foreground">Chat</b> untuk langsung membuka percakapan, atau tambahkan
          nomor yang belum muncul.
        </p>
      </div>

      {/* Pilih sesi */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {sessionsLoading && sessions.length === 0 && <Skeleton className="h-9 w-56" />}
        {sessions.map((item) => (
          <Button
            key={item.id}
            variant={sessionId === item.id ? 'subtle' : 'secondary'}
            size="sm"
            onClick={() => setSessionId(item.id)}
          >
            {item.name}
            {item.status === 'connected' ? ' · online' : ''}
          </Button>
        ))}
        {!sessionsLoading && sessions.length === 0 && (
          <p className="text-xs text-muted-foreground">Belum ada sesi. Tautkan nomor dulu di halaman Dasbor.</p>
        )}
      </div>

      {sessionId && (
        <>
          <Card className="mt-5 p-4 md:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Cari nama atau nomor…"
                  className="h-10 pl-9"
                />
              </div>
              <Button onClick={() => setImportOpen(true)} disabled={session?.status !== 'connected'}>
                <UserPlus /> Tambah nomor
              </Button>
              <Button variant="ghost" size="icon" title="Muat ulang" onClick={() => void mutate()}>
                <RefreshCw className={isLoading ? 'animate-spin' : undefined} />
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>
                <b className="text-foreground">{total}</b> kontak tersimpan
                {debounced ? ` · menampilkan ${contacts.length} hasil untuk “${debounced}”` : ''}
              </span>
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-[#25D366]" /> Dari HP (sinkron WhatsApp)
              </span>
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-400" /> Dari pesan masuk
              </span>
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Ditambah manual
              </span>
            </div>

            {session?.status !== 'connected' && (
              <p className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2 text-[11px] text-amber-200">
                Sesi ini sedang tidak tersambung. Kontak yang sudah tersimpan tetap bisa dilihat, tapi menambah
                nomor baru butuh koneksi aktif.
              </p>
            )}
          </Card>

          {isLoading && contacts.length === 0 ? (
            <div className="mt-4 space-y-2">
              {[0, 1, 2, 3, 4, 5].map((key) => (
                <Skeleton key={key} className="h-16 w-full" />
              ))}
            </div>
          ) : contacts.length === 0 ? (
            <Card className="mt-4 flex flex-col items-center gap-3 p-8 text-center">
              <Contact className="h-7 w-7 text-muted-foreground/60" />
              <div className="text-sm font-medium">
                {debounced ? 'Tidak ada kontak yang cocok' : 'Buku kontak masih kosong'}
              </div>
              <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                {debounced
                  ? 'Coba kata kunci lain, atau cari memakai nomor (mis. 62812).'
                  : 'WhatsApp mengirim buku alamat ke perangkat tertaut saat pairing dan saat ada perubahan. Kalau daftar ini masih kosong, tekan “Tambah nomor” untuk memasukkan nomor penting secara manual — atau tunggu pesan masuk (pengirim otomatis dicatat).'}
              </p>
            </Card>
          ) : (
            <div className="mt-4 space-y-4">
              {grouped.map(([letter, items]) => (
                <div key={letter}>
                  <div className="sticky top-0 z-10 -mx-1 mb-1 bg-background/80 px-1 py-1 text-[11px] font-semibold text-[#4ade80] backdrop-blur">
                    {letter}
                    <span className="ml-2 font-normal text-muted-foreground">{items.length}</span>
                  </div>
                  <Card className="divide-y divide-white/[0.04] overflow-hidden">
                    {items.map((contact) => (
                      <div key={contact.id} className="flex items-center gap-3 p-3">
                        <Avatar name={contact.displayName} size="md" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{contact.displayName}</span>
                            <span
                              className={
                                contact.source === 'manual'
                                  ? 'shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] text-amber-300'
                                  : contact.source === 'pesan'
                                    ? 'shrink-0 rounded-full bg-sky-400/15 px-2 py-0.5 text-[10px] text-sky-300'
                                    : 'shrink-0 rounded-full bg-[#25D366]/15 px-2 py-0.5 text-[10px] text-[#4ade80]'
                              }
                            >
                              {SOURCE_LABEL[contact.source] ?? contact.source}
                            </span>
                            {contact.hasChat && (
                              <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground">
                                sudah ada chat
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {contact.phoneNumber
                              ? `+${contact.phoneNumber}`
                              : isLidAddress(contact.jid)
                                ? 'Nomor disembunyikan WhatsApp'
                                : contact.jid}
                            {contact.verifiedName && contact.verifiedName !== contact.displayName
                              ? ` · bisnis: ${contact.verifiedName}`
                              : ''}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void openChat(contact)}
                            disabled={openingChat === contact.id}
                          >
                            {openingChat === contact.id ? <Loader2 className="animate-spin" /> : <MessageSquarePlus />}
                            Chat
                          </Button>
                          <Button
                            variant="ghost"
                            size="iconSm"
                            title="Salin nomor"
                            onClick={() => void copyNumber(contact)}
                          >
                            <Copy />
                          </Button>
                          <Button
                            variant="ghost"
                            size="iconSm"
                            title="Hapus dari panel"
                            onClick={() => void removeContact(contact)}
                            disabled={deleting === contact.id}
                          >
                            {deleting === contact.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </Card>
                </div>
              ))}
            </div>
          )}

          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            Catatan: WhatsApp hanya membagikan kontak yang tersinkron ke perangkat tertaut — kontak yang
            menyembunyikan nomornya akan tampil sebagai “Kontak WhatsApp (…)”. Kontak yang pernah mengirim pesan
            otomatis tercatat, dan nomornya akan terisi begitu WhatsApp membagikannya.
          </p>
        </>
      )}

      {/* Dialog impor nomor */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tambah nomor ke buku kontak</DialogTitle>
            <DialogDescription>
              Tempel beberapa nomor sekaligus (pisahkan dengan baris baru, koma, atau spasi). Format
              internasional tanpa tanda + — awalan 0 otomatis jadi 62. Setiap nomor diverifikasi ke WhatsApp
              dulu, maksimal 50 nomor sekali jalan.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            rows={5}
            placeholder={'6281234567890\n6289876543210, 08123456789'}
            className="font-mono text-xs"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>
              <X /> Batal
            </Button>
            <Button onClick={() => void runImport()} loading={importing} disabled={!importText.trim()}>
              <Check /> Periksa &amp; tambahkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
