# Status WhatsApp — v1.8.0

Modifikasi dari `https://github.com/raizenamericano-del/multi-wa-V5`, commit dasar `c590ea5fae64ecdab31f55b8edd2d86fdda69f79`.

## Yang ditambahkan

- Navigasi **Status WA / SW** untuk desktop dan HP, halaman `/status`.
- Pilih satu akun tertaut; status tidak digabung antarakun.
- Galeri status foto/video/teks, thumbnail bila tersedia, nama pengirim, waktu, dan caption.
- Filter jenis dan pencarian nama/alamat pengirim/caption.
- Preview foto, pemutar video native dengan seek (HTTP Range), serta pembaca teks.
- Unduh foto/video **byte asli tanpa transcode**; status teks disimpan sebagai `.txt`.
- Tombol refresh dan polling 15 detik; state kosong/gagal/unduh ditampilkan apa adanya.
- API memakai proteksi login panel yang sudah ada. Raw message, URL remote dan media key tidak dikirim ke browser.
- Data SW tersimpan di filesystem volume, tanpa perubahan skema database.
- Maksimum 100 status aktif dan cache asli 256 MiB per akun; maksimum 64 MiB per file, timeout transfer 60 detik. Cache lama dapat dievikt untuk memberi ruang.
- Status kedaluwarsa 24 jam sejak waktu kirim. Pembersihan berjalan tiap menit dan saat akses; tidak menghapus file yang sudah diunduh ke perangkat pengguna.
- Logout/unlink dan hapus sesi membersihkan metadata/cache status. Disconnect biasa mempertahankan cache yang belum kedaluwarsa.
- Patch kecil Baileys versi terkunci 6.7.24 untuk meneruskan error stream upstream dan menghentikannya saat timeout/limit. Postinstall memverifikasi kecocokan source patch.
- ZIP generator mencakup file sumber baru yang belum di-commit dan mengecualikan runtime privat.
- Kode pairing tidak lagi dicatat oleh log manager.

## Batasan yang penting

Ini **bukan** pembuka SW privat/tersembunyi. Hanya foto/video/teks `status@broadcast` yang benar-benar diterima Baileys melalui event messages.upsert dan belum kedaluwarsa. Status sendiri dan view-once tidak dimasukkan. Akses bergantung pada privasi pengirim, kontak dan protokol WhatsApp.

Tidak ada klaim mengambil semua status lama setelah pairing. **Refresh hanya membaca cache yang diterima**, bukan mengambil seluruh riwayat. Jika kosong, coba bagikan satu SW baru dari kontak yang memberi izin saat sesi terhubung. Nama ditampilkan dari pushName atau alamat pengirim; tidak selalu nomor telepon (WhatsApp dapat memakai LID).

Status yang pengirim hapus lebih awal tidak dijamin langsung hilang dari cache lokal; TTL lokal tetap maksimum 24 jam. Media sumber mungkin sudah tidak bisa diunduh sebelum TTL habis. Ketersediaan/codec asli bergantung WhatsApp dan browser. UI tidak mengklaim file sudah tersimpan ke galeri: setelah fetch berhasil, browser yang menangani unduhan.

Proteksi sama dengan repo asal: satu panel admin dapat mengakses semua sesi panel. Bukan sistem multi-tenant per pengguna. **Isi AUTH_PASSWORD kuat**, jangan mengekspos panel terbuka. Auth dan descriptor SW di disk bersifat privat namun tidak dienkripsi at-rest oleh fitur ini; lindungi volume/backup. Gunakan akun sendiri atau izin eksplisit. Baileys bukan API resmi WhatsApp dan ada risiko perubahan protokol/pembatasan akun.

## Update Railway tanpa menghilangkan sesi

1. Backup database dan seluruh volume terlebih dahulu. **Jangan hapus service, volume, atau folder auth lama.**
2. Ganti source project dengan isi ZIP ini, tetap gunakan Dockerfile dan start command bawaan repo.
3. Pertahankan DATABASE_URL, AUTH_PASSWORD, AUTH_SECRET dan variabel sesi yang sudah berjalan. Fitur SW tidak membutuhkan database atau volume baru dan tidak mengubah schema.
4. Pastikan `WA_DATA_DIR` menunjuk folder pada volume yang **sudah** terpasang. Ini variabel project ini, bukan `DATA_DIR` milik STATUSX.

Contoh **bila mount existing memang `/app/data`** (rekomendasi repo asal):

```env
WA_DATA_DIR=/app/data
WA_AUTH_DIR=/app/data/auth
WA_MEDIA_DIR=/app/data/media
```

SW kemudian berada di `/app/data/statuses`. Bila mount Anda berbeda, gunakan path mount aktual untuk WA_DATA_DIR. Jangan memindahkan WA_AUTH_DIR/WA_MEDIA_DIR yang sudah berisi sesi hanya untuk menyalin contoh. File SW wajib berada di volume supaya tidak hilang saat redeploy.

5. Redeploy; buka menu **Status WA**, pilih akun. Sesi tersimpan tetap memakai mekanisme restore repo asal.
6. Jika status belum masuk, periksa akun benar-benar connected, lalu uji satu SW baru yang dibagikan dengan izin.

## Menjalankan dan menguji lokal

```bash
npm ci
# Sesuaikan .env, DATABASE_URL, dan AUTH_PASSWORD untuk aplikasi sungguhan.
npm run build
npm start
```

Uji baru menggunakan fixture eksplisit, tidak menautkan akun sungguhan:

```bash
npm run typecheck
npm run test:status
npx playwright install --with-deps chromium
npm run build
npm run test:browser:status
```

Tes browser membuat SQLite/direktori sementara, akun fixture disconnected, dan menjalankan custom server produksi pada port 3108. Tidak memasukkan mock ke aplikasi produksi. Tes functional lama memerlukan database **khusus pengujian**, schema sudah dibuat (`npx prisma db push`), dan `AUTH_PASSWORD=''` agar handshake fixture sesuai suite asal. Jangan arahkan tes lama ke database produksi.

## Verifikasi paket ini

Tanggal 16 Oktober 2026, Node 20.20.2:

- `npm ci`: berhasil, termasuk postinstall patch.
- TypeScript type-check: lulus.
- Next.js production build: lulus.
- Suite regression asal: **162 lulus, 0 gagal** (database terisolasi).
- Suite SW baru: **14 lulus**, mencakup expiry, isolasi sesi, penyaringan view-once, deduplikasi, persistensi filesystem, byte media identik, offline, error stream, batas 64 MiB dan 100 status.
- Browser produksi: **9 skenario lulus**, termasuk login 401, file lintas sesi 404, Range 206/416, foto decode, download identik, video MP4 decode/play/seek, pencarian/filter, akun kosong, lebar 360/390/1440; tidak ada page errors.
- Screenshot di `docs/status-screenshots/` memakai **TEST FIXTURES**, bukan status akun sungguhan.

**Belum diuji:** pairing/SW/CDN dari akun WhatsApp asli, deployment/volume Railway aktual, eksekusi Docker image, perangkat Android fisik. **Audit dependency produksi masih melaporkan 5 temuan (4 high, 1 critical), termasuk Next.js 14.2.35 bawaan repo.** Penambahan SW tidak memigrasikan framework/Prisma lintas major. Jangan anggap paket ini sudah di-hardening untuk paparan publik: rencanakan upgrade Next.js/Prisma ke rilis terpatch dan regression test sebelum produksi publik. Autentikasi panel bukan pengganti patch framework. Detail advisory dan cakupan terdampak ada di `docs/verification/npm-audit-production.json`. Log hasil uji tersanitasi tersedia di `docs/verification/`.

## API baru (dilindungi autentikasi panel)

- `GET /api/sessions/:id/statuses` → `{ statuses: [...] }`, tanpa raw descriptor/key.
- `GET /api/sessions/:id/statuses/:statusId` → foto/video asli; Range byte didukung.
- Tambahkan `?download=1` untuk Content-Disposition attachment.

API tidak menerima URL atau path file arbitrer. Status lookup mencocokkan session ID dan UUID lokal. Metadata/cache tidak disajikan sebagai public static files.
