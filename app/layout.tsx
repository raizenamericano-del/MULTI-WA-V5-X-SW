import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AppShell } from '@/components/layout/app-shell'
import { Providers } from '@/components/providers'
import { APP_NAME, APP_SHORT_NAME, DEVELOPER_NAME } from '@/lib/branding'

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description:
    'Panel WhatsApp Multi-Device: pairing lewat kode, pantau chat realtime, kirim teks, foto, video, dokumen dan pesan suara. Dibangun dengan Next.js, Baileys, Socket.io dan Prisma.',
  keywords: ['whatsapp', 'baileys', 'multi device', 'panel whatsapp', 'next.js', 'socket.io'],
  authors: [{ name: DEVELOPER_NAME }],
  creator: DEVELOPER_NAME,
  manifest: '/manifest.webmanifest',
  applicationName: APP_NAME,
  appleWebApp: {
    capable: true,
    title: APP_SHORT_NAME,
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: ['/icon-192.png'],
  },
}

export const viewport: Viewport = {
  themeColor: '#0a0f14',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="dark">
      <body className="min-h-dvh">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  )
}
