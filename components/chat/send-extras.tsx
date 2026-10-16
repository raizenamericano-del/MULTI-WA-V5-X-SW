'use client'

import * as React from 'react'
import { Loader2, MapPin, Navigation, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/fetcher'

/** Kirim lokasi (peta) ke chat yang sedang dibuka. */
export function LocationDialog({
  chatId,
  open,
  onOpenChange,
  onSent,
}: {
  chatId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSent: () => void
}) {
  const [lat, setLat] = React.useState('')
  const [lng, setLng] = React.useState('')
  const [name, setName] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [locating, setLocating] = React.useState(false)

  async function useMyLocation() {
    setLocating(true)
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        }),
      )
      setLat(position.coords.latitude.toFixed(6))
      setLng(position.coords.longitude.toFixed(6))
      toast.success('Lokasi perangkat terisi')
    } catch {
      toast.error('Tidak bisa membaca lokasi perangkat', {
        description: 'Izinkan akses lokasi di browser, atau isi koordinat manual.',
      })
    } finally {
      setLocating(false)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const latitude = Number(lat)
    const longitude = Number(lng)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      toast.error('Koordinat tidak valid')
      return
    }

    setLoading(true)
    try {
      await api.post(`/api/chats/${chatId}/messages`, {
        location: { lat: latitude, lng: longitude, name: name.trim() || undefined },
      })
      toast.success('Lokasi terkirim')
      onOpenChange(false)
      setLat('')
      setLng('')
      setName('')
      onSent()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal mengirim lokasi')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-[#25D366]" /> Kirim lokasi
          </DialogTitle>
          <DialogDescription>
            Kirim titik peta ke percakapan ini. Di HP penerima lokasi bisa langsung dibuka di WhatsApp
            Maps.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            loading={locating}
            onClick={() => void useMyLocation()}
          >
            <Navigation /> Pakai lokasi perangkat saya
          </Button>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label htmlFor="lat" className="text-xs font-medium text-muted-foreground">
                Latitude
              </label>
              <Input
                id="lat"
                value={lat}
                onChange={(event) => setLat(event.target.value.replace(/[^-\d.]/g, ''))}
                placeholder="-6.9932"
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="lng" className="text-xs font-medium text-muted-foreground">
                Longitude
              </label>
              <Input
                id="lng"
                value={lng}
                onChange={(event) => setLng(event.target.value.replace(/[^-\d.]/g, ''))}
                placeholder="110.4203"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="loc-name" className="text-xs font-medium text-muted-foreground">
              Nama tempat <span className="opacity-70">(opsional)</span>
            </label>
            <Input
              id="loc-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Kantor, Semarang"
              maxLength={200}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" loading={loading}>
              Kirim lokasi
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Kirim kartu kontak (nama + nomor) ke chat yang sedang dibuka. */
export function ContactDialog({
  chatId,
  open,
  onOpenChange,
  onSent,
}: {
  chatId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSent: () => void
}) {
  const [displayName, setDisplayName] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [loading, setLoading] = React.useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    try {
      await api.post(`/api/chats/${chatId}/messages`, {
        contact: { displayName: displayName.trim() || undefined, phone: phone.trim() },
      })
      toast.success('Kartu kontak terkirim')
      onOpenChange(false)
      setDisplayName('')
      setPhone('')
      onSent()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal mengirim kontak')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRound className="h-4 w-4 text-[#25D366]" /> Kirim kontak
          </DialogTitle>
          <DialogDescription>
            Kirim kartu kontak (vCard) supaya penerima bisa langsung menyimpannya.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="contact-name" className="text-xs font-medium text-muted-foreground">
              Nama
            </label>
            <Input
              id="contact-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Budi Santoso"
              maxLength={120}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="contact-phone" className="text-xs font-medium text-muted-foreground">
              Nomor WhatsApp
            </label>
            <Input
              id="contact-phone"
              value={phone}
              inputMode="numeric"
              onChange={(event) => setPhone(event.target.value.replace(/[^\d+]/g, ''))}
              placeholder="6281234567890"
              required
              minLength={8}
            />
            <p className="text-[11px] text-muted-foreground">
              Format internasional tanpa <code className="font-mono">+</code>, contoh{' '}
              <span className="font-mono">6281234567890</span>.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" loading={loading} disabled={phone.replace(/\D/g, '').length < 8}>
              Kirim kontak
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Indikator kecil saat dialog sedang memuat data. */
export function Spinner() {
  return <Loader2 className="h-4 w-4 animate-spin" />
}
