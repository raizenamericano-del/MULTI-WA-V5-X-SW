import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkg = require('./package.json')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Branding & versi ditanam saat build supaya bisa dipakai di server & client.
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME || 'WA Multi-Device Controller',
    NEXT_PUBLIC_DEVELOPER_NAME: process.env.NEXT_PUBLIC_DEVELOPER_NAME || 'Rifky',
    NEXT_PUBLIC_DEVELOPER_URL: process.env.NEXT_PUBLIC_DEVELOPER_URL || '',
  },

  // We run a custom server (server.ts) for Socket.io + Baileys, so Next must
  // not try to bundle the long-lived native/server-only dependencies.
  experimental: {
    serverComponentsExternalPackages: [
      '@whiskeysockets/baileys',
      '@prisma/client',
      'prisma',
      'pino',
      'socket.io',
    ],
  },

  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'pps.whatsapp.net' },
      { protocol: 'https', hostname: 'mmg.whatsapp.net' },
      { protocol: 'https', hostname: 'web.whatsapp.com' },
    ],
  },
}

export default nextConfig
