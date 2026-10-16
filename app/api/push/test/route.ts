import { handle, ok } from '@/lib/api'
import { getPushDiagnostics, sendPushToAll } from '@/lib/push'
import { APP_SHORT_NAME } from '@/lib/branding'

export const dynamic = 'force-dynamic'

/** POST /api/push/test — kirim notifikasi percobaan ke semua perangkat terdaftar. */
export async function POST() {
  return handle(async () => {
    const result = await sendPushToAll(
      {
        title: APP_SHORT_NAME,
        body: 'Notifikasi percobaan berhasil 🎉 Panel siap mengabari pesan baru.',
        url: '/',
        tag: 'wa-controller-test',
      },
      { source: 'tes' },
    )

    const diagnostics = await getPushDiagnostics()
    return ok({
      ...result,
      hint:
        result.devices === 0
          ? 'Belum ada perangkat yang berlangganan. Di halaman ini tekan "Aktifkan di perangkat ini" dulu.'
          : result.sent === 0
            ? 'Server mencoba mengirim tapi layanan push menolak. Lihat kolom pesan di bawah.'
            : null,
      diagnostics,
    })
  })
}
