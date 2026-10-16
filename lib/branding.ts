/**
 * Branding aplikasi — dipakai server maupun client.
 * Semuanya bisa diubah lewat environment variable tanpa menyentuh kode.
 */
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'WA Multi-Device Controller'
export const APP_SHORT_NAME = 'WA Controller'
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'dev'
export const DEVELOPER_NAME = process.env.NEXT_PUBLIC_DEVELOPER_NAME || 'Rifky'
export const DEVELOPER_URL = process.env.NEXT_PUBLIC_DEVELOPER_URL || ''

export const DEVELOPER_CREDIT = `Dibuat oleh ${DEVELOPER_NAME}`
