'use client'

import * as React from 'react'
import useSWR from 'swr'
import { Radio, RefreshCw, Download, Search, Loader2, ImageIcon, Video } from 'lucide-react'
import { toast } from 'sonner'
import { useSessions } from '@/hooks/use-api'
import { api } from '@/lib/fetcher'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import type { StatusItem } from '@/lib/baileys/status-store'

export default function StatusPage() {
  const { sessions } = useSessions()
  const [chosen, setChosen] = React.useState('')
  const sessionId = chosen || sessions[0]?.id || ''
  const [query, setQuery] = React.useState('')
  const [filter, setFilter] = React.useState('all')
  const [preview, setPreview] = React.useState<StatusItem | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [retry, setRetry] = React.useState(0)
  const [downloading, setDownloading] = React.useState<string | null>(null)
  const { data, error, isLoading, isValidating, mutate } = useSWR<{ statuses: StatusItem[] }>(
    sessionId ? `/api/sessions/${encodeURIComponent(sessionId)}/statuses` : null,
    api.get, { refreshInterval: 15000, revalidateOnFocus: true, keepPreviousData: false },
  )
  React.useEffect(() => { setPreview(null); setFailed(false) }, [sessionId])
  React.useEffect(() => {
    if (!preview) return
    const timer = setTimeout(() => { setPreview(null); void mutate() }, Math.max(0, preview.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [preview, mutate])
  const mediaUrl = (item: StatusItem) => `/api/sessions/${encodeURIComponent(sessionId)}/statuses/${item.id}`
  const items = (data?.statuses || []).filter(item => item.expiresAt > Date.now() &&
    (filter === 'all' || item.type === filter) && `${item.name} ${item.sender} ${item.text}`.toLowerCase().includes(query.toLowerCase()))
  async function download(item: StatusItem) {
    if (downloading) return
    setDownloading(item.id)
    try {
      if (item.type === 'text') {
        await save(new Blob([item.text], { type: 'text/plain;charset=utf-8' }), `SW-${item.id}.txt`)
      } else {
        const response = await fetch(`${mediaUrl(item)}?download=1`, { cache: 'no-store' })
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          throw new Error(body?.error || 'Gagal mengunduh SW. Coba hubungkan ulang sesi.')
        }
        await save(await response.blob(), `SW-${item.id}.${item.type === 'image' ? 'jpg' : 'mp4'}`)
      }
      toast.success('File siap; unduhan diserahkan ke browser. Periksa folder Download.')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unduhan gagal') }
    finally { setDownloading(null) }
  }
  async function save(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a'); link.href = url; link.download = name
    document.body.appendChild(link); link.click(); link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
  return <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><div className="mb-2 flex items-center gap-2 text-emerald-400"><Radio size={20} /><span className="text-xs uppercase tracking-widest">Momen dari kontakmu</span></div>
        <h1 className="text-3xl font-bold">Status WhatsApp</h1><p className="mt-2 text-sm text-muted-foreground">Lihat SW yang diterima, putar video, dan simpan file asli.</p></div>
      <Button variant="outline" disabled={!sessionId || isValidating} onClick={() => void mutate()}><RefreshCw className={`mr-2 h-4 w-4 ${isValidating ? 'animate-spin' : ''}`} />Refresh</Button>
    </header>
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-muted-foreground">
      Hanya status yang benar-benar dikirim WhatsApp ke perangkat tertaut, sesuai privasi pengirim. Refresh membaca cache, bukan mengambil seluruh riwayat SW. Status kedaluwarsa setelah 24 jam. Simpan hanya dengan izin pemilik.
    </div>
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <select aria-label="Pilih akun WhatsApp" value={sessionId} onChange={e => setChosen(e.target.value)} className="max-w-full rounded-xl border bg-background p-3 text-sm">
        {!sessions.length && <option value="">Belum ada sesi WhatsApp</option>}
        {sessions.map(s => <option key={s.id} value={s.id}>{s.name} · {s.status}</option>)}
      </select>
      <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Cari status" value={query} onChange={e => setQuery(e.target.value)} placeholder="Cari nama, nomor, caption…" className="min-w-0 pl-9" /></div>
    </div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter jenis status">
      {[['all','Semua'],['image','Foto'],['video','Video'],['text','Teks']].map(([value,label]) => <Button key={value} size="sm" variant={filter === value ? 'default' : 'outline'} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</Button>)}
      <span className="self-center px-2 text-xs text-muted-foreground">{items.length} status</span>
    </div>
    {error ? <div role="alert" className="rounded-xl border border-red-500/30 p-6">Gagal memuat status: {error.message}<Button variant="outline" className="ml-3" onClick={() => void mutate()}>Coba lagi</Button></div> : isLoading ? <p role="status">Memuat SW…</p> : !items.length ?
      <div className="rounded-2xl border border-dashed p-12 text-center"><Radio className="mx-auto mb-4 h-10 w-10 text-emerald-400" /><h2 className="font-semibold">Belum ada status yang cocok</h2><p className="mt-2 text-sm text-muted-foreground">Hubungkan akun lewat Pairing, lalu tunggu kontak membagikan SW baru yang bisa diakses akun ini.</p></div> :
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{items.map(item => <article key={item.id} className="overflow-hidden rounded-2xl border bg-card">
        <button className="relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden bg-gradient-to-br from-emerald-950 to-zinc-950 p-3" aria-label={`Lihat ${item.type === 'text' ? 'teks' : item.type === 'video' ? 'video' : 'foto'} dari ${item.name}`} onClick={() => { setPreview(item); setFailed(false); setRetry(0) }}>
          {item.thumbnail ? <img src={item.thumbnail} alt="Thumbnail status" className="absolute inset-0 h-full w-full object-cover" /> : item.type === 'text' ? <p className="line-clamp-6 break-words text-sm text-white">{item.text}</p> : item.type === 'video' ? <Video size={36} /> : <ImageIcon size={36} />}
          <span className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-xs text-white">{item.type === 'video' ? '▶ Video' : item.type === 'image' ? 'Foto' : 'Teks'}</span>
        </button>
        <div className="space-y-2 p-3"><p className="truncate text-sm font-semibold" title={item.sender}>{item.name}</p><p className="text-xs text-muted-foreground">{new Date(item.timestamp).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</p>
          <Button variant="outline" size="sm" className="w-full" disabled={!!downloading} onClick={() => void download(item)}>{downloading === item.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Unduh</Button></div>
      </article>)}</div>}
    <Dialog open={!!preview} onOpenChange={open => { if (!open) setPreview(null) }}><DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>{preview?.name || 'Status'}</DialogTitle><DialogDescription>Preview SW · kualitas asli, tanpa kompresi ulang.</DialogDescription></DialogHeader>
      {preview && <><div className="flex min-h-40 items-center justify-center rounded-xl bg-black">
        {failed ? <div role="alert" className="p-6 text-center text-white"><p>Media belum bisa dimuat. Periksa koneksi sesi atau coba unduh.</p><Button className="mt-3" onClick={() => { setFailed(false); setRetry(r => r + 1) }}>Coba lagi</Button></div> : preview.type === 'image' ? <img key={retry} src={`${mediaUrl(preview)}?retry=${retry}`} alt={`Status ${preview.name}`} className="max-h-[60dvh] max-w-full object-contain" onError={() => setFailed(true)} /> : preview.type === 'video' ? <video key={retry} src={`${mediaUrl(preview)}?retry=${retry}`} controls playsInline preload="metadata" className="max-h-[60dvh] w-full" onError={() => setFailed(true)} /> : <p className="whitespace-pre-wrap break-words p-6 text-white">{preview.text}</p>}
      </div>{preview.type !== 'text' && preview.text && <p className="whitespace-pre-wrap break-words text-sm">{preview.text}</p>}
      <Button disabled={!!downloading} onClick={() => void download(preview)}><Download className="mr-2 h-4 w-4" />{downloading ? 'Menyiapkan file…' : 'Unduh asli'}</Button></>}
    </DialogContent></Dialog>
  </div>
}
