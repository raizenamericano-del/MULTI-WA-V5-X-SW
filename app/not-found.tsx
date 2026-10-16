import Link from 'next/link'
import { Compass } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#25D366]/10">
        <Compass className="h-7 w-7 text-[#25D366]" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight">Halaman tidak ditemukan</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Halaman yang kamu cari tidak ada. Kembali ke dasbor untuk mengelola sesi WhatsApp-mu.
      </p>
      <Link
        href="/"
        className="rounded-xl bg-gradient-to-r from-[#25D366] to-[#128C7E] px-4 py-2 text-sm font-semibold text-[#04150f]"
      >
        Kembali ke dasbor
      </Link>
    </div>
  )
}
