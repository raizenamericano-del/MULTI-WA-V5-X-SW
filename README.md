> **Pembaruan v1.8.0 — Galeri Status WhatsApp (SW)**
>
> Menu baru **Status WA** (`/status`): foto/video/teks, pilih akun, cari caption/kontak, filter, preview dan unduh asli. Fitur lama, login panel, database dan pairing tetap dipertahankan.
> Baca **[PANDUAN-STATUS.md](PANDUAN-STATUS.md)** untuk update Railway, penyimpanan, batas akses SW, dan hasil uji. Tidak perlu volume/database kedua; simpan status di volume data service yang sama.

<div align="center">

# WA Multi-Device Controller

**Panel WhatsApp self-hosted berbahasa Indonesia — tautkan nomor dengan kode pairing, pantau chat realtime, kirim teks / foto / video / dokumen / pesan suara.**

Next.js 14 (App Router) · Baileys · Socket.io · Prisma · Tailwind CSS · Docker

Satu repositori · satu proses Node · **satu service Railway**

Dibuat oleh **Rifky** · versi 1.7.0

</div>

---

## ✨ Fitur

| | |
|---|---|
| 🔐 **Login panel** | Halaman `/login` dengan cookie HttpOnly bertanda tangan HMAC-SHA256, middleware Edge, proteksi semua API, proteksi koneksi Socket.io, dan rate limit 6 percobaan / 5 menit. Cukup set `AUTH_PASSWORD`. |
| 🔗 **Pairing via kode** | Masukkan nomor → dapat kode 8 karakter → ketik di HP. Tanpa scan QR (QR tetap muncul otomatis sebagai alternatif bila tersedia). |
| 🧩 **Multi-sesi** | Kelola beberapa nomor sekaligus. Tiap sesi punya auth state, socket, backoff reconnect, dan statistik sendiri. |
| ⚡ **Realtime penuh** | Pesan masuk **dan** keluar, centang terkirim/dibaca, perubahan status, jumlah belum dibaca, dan urutan daftar chat mengalir lewat Socket.io — tanpa refresh. |
| 👁️ **Sekali lihat (view-once)** | Foto/video “sekali lihat” diunduh **segera** (fast-path) memakai URL terbaru, disimpan, lalu bisa dibuka dengan tombol “Ketuk untuk melihat”. Node media asli disimpan agar bisa diunduh ulang bila WhatsApp baru membagikannya belakangan — lengkap dengan retry bertingkat (4s/12s/35s/90s/180s), tombol **Coba lagi**, dan alasan kegagalan yang jelas. |
| 🧭 **Semua jenis pesan** | Teks, foto, video, GIF, **video bulat (ptv)**, dokumen, pesan suara, stiker, **polling**, **lokasi & lokasi live**, **kartu kontak**, **produk katalog**, **acara**, balasan tombol/list. Tipe yang belum dikenal tetap ditampilkan dengan namanya. |
| ⤴️ **Balas, reaksi, hapus** | Balas dengan kutipan, reaksi emoji cepat (masuk maupun keluar), hapus untuk semua orang / hapus untuk saya dari menu pesan. |
| ✏️ **Edit pesan** | Pesan yang diedit pengirim langsung diperbarui di panel (`editedAt` ditandai), termasuk menyegarkan cuplikan di daftar chat. |
| 🧑‍💼 **Kontak & percakapan** | Daftar chat dengan pencarian, pin, arsip, badge belum dibaca, pemisah tanggal, nama pengirim di grup, presence “sedang menulis”, dan tanda dibaca. |
| 📎 **Media dua arah** | Kirim & terima gambar, video, dokumen, stiker, dan pesan suara (rekaman browser ditranskode ke OGG/Opus dengan ffmpeg). Klik gambar/video untuk lightbox layar penuh. Kirim ulang sebagai **sekali lihat** juga bisa. |
| 📱 **Bisa dipasang (PWA)** | Panel bisa **dipasang di HP/laptop** seperti aplikasi (manifest + service worker + shortcut “Cari pesan”, “Balasan otomatis”, “Analitik”). Tidak perlu Play Store / App Store. |
| 🔔 **Notifikasi push** | **Web Push sungguhan** (VAPID) ke HP walau panel **ditutup total** — yang memegang nomor adalah server, jadi kamu tidak perlu membuka web untuk diberi tahu. Per perangkat: perangkat yang panelnya sedang dilihat tidak dikirimi (biar tidak dobel), perangkat lain tetap berbunyi. Hanya untuk pesan baru (≤2 menit) supaya impor riwayat tidak jadi ribuan notifikasi. |
| 🤖 **Balasan otomatis** | Aturan kata kunci per nomor: **mengandung / sama persis / awalan / regex**, cooldown anti-spam, bisa diaktifkan untuk grup, simpul balasan tersimpan rapi sebagai “Balasan otomatis”, penghitung berapa kali tiap aturan terpakai. |
| 🪝 **Webhook keluar** | Kirim setiap pesan masuk (dan tiap balasan otomatis) ke URL milikmu — **ditandatangani `x-wa-signature` (HMAC-SHA256)** supaya bisa diverifikasi, lengkap dengan filter event, retry otomatis, timeout 8 detik, tombol “Kirim tes”, dan status terakhir. |
| ⤴️ **Teruskan pesan** | Teruskan pesan teks **maupun media** ke chat lain tanpa keluar dari panel — file dibaca ulang dari penyimpanan sendiri dan dikirim dengan tipe yang sama (caption ikut). |
| 📊 **Analitik** | Halaman `/analitik`: grafik batang pesan masuk/keluar per hari (7–90 hari), total sepanjang waktu, chat teratas, statistik per nomor, ukuran media, jumlah sekali lihat, edit, dan aturan aktif. |
| 💾 **Backup JSON** | Unduh seluruh data panel (sesi, chat, pesan, aturan) sebagai satu berkas JSON. Berkas media & kredensial **tidak** ikut demi keamanan. |
| 🧵 **Muat pesan lama** | Riwayat dimuat otomatis saat menggulir ke atas, dan hasil pencarian bisa **melompat** ke pesan tersebut (gulir + sorotan kuning) walau pesannya sudah di luar halaman pertama. |
| 🔔 **Notifikasi & badge** | Suara notifikasi (Web Audio, tanpa berkas aset), notifikasi desktop opsional, dan jumlah pesan belum dibaca di judul tab. |
| 🔄 **Auto reconnect** | Backoff eksponensial saat koneksi putus, reconnect instan setelah pairing (WhatsApp `515`), restore sesi saat boot, deteksi `loggedOut`, plus watchdog yang membangunkan sesi “connected tapi socket mati”. |
| 📇 **Buku kontak** | Semua kontak dari nomor yang ditautkan (nama yang kamu simpan di HP + nama WhatsApp-nya), dikelompokkan per huruf, bisa dicari pakai nama **atau** nomor, dan langsung dibuka jadi chat. Ada juga **impor nomor** (diverifikasi dulu ke WhatsApp, maksimal 50 sekali jalan) dan penggabungan otomatis kontak ber-alamat `@lid`. |
| 🪪 **Sadar LID** | WhatsApp kini memakai alamat anonim `@lid`. Panel menerjemahkannya kembali ke nomor telepon asli (`senderPn` / `participantPn`, event resmi `chats.phoneNumberShare`, sync kontak, plus pemindaian riwayat pesan), lalu **menggabungkan** chat lama yang masih beralamat `@lid` — jadi tidak ada nomor panjang ala `+225…` muncul di daftar chat. |
| 🩺 **Diagnostik bawaan** | `GET /api/sessions/:id/debug` + menu “Jalankan diagnostik” menunjukkan apakah socket hidup, berapa event mentah yang masuk, dan alasan sebuah pesan dilewati. |
| 🎨 **UI gelap modern** | Glassmorphism + gradasi hijau WhatsApp, responsif dari HP sampai desktop, toast, skeleton, dan status loading di semua tempat. Bahasa Indonesia sepenuhnya. Halaman: **Dasbor**, **Kontak**, **Pairing**, **Otomatis** (balasan + webhook), **Analitik**, **Notifikasi**, **Panduan**. |
| 🗄️ **SQLite ⇄ PostgreSQL** | SQLite untuk pengembangan lokal tanpa setup, PostgreSQL di Railway — skema Prisma yang sama, berganti otomatis. |
| 🐳 **Siap deploy** | Dockerfile multi-stage (dengan ffmpeg), konfigurasi Railway, health endpoint, penyimpanan sesi sadar volume. |

---

## 🧱 Teknologi

- **Framework** — Next.js `14.2` App Router + TypeScript (strict)
- **WhatsApp** — [`@whiskeysockets/baileys`](https://github.com/WhiskeySockets/Baileys) `6.7.x`
- **Realtime** — server Socket.io `4` (menempel di HTTP server kustom) + klien Socket.io di browser
- **Database** — Prisma ORM `6` → SQLite (lokal) / PostgreSQL (Railway)
- **UI** — Tailwind CSS `3`, primitif ala shadcn/ui (Radix), `lucide-react`, `sonner`, `swr`, `qrcode`

---

## 🏗️ Arsitektur — kenapa satu service cukup

```
                     ┌──────────────────────────────────────────────┐
  Browser  ⇄  HTTP   │  server.ts  (HTTP server Node kustom)        │
  Browser  ⇄  WS     │   ├─ Next.js App Router  (halaman + API)     │
                     │   ├─ Socket.io  (path /api/socket/io)        │
                     │   └─ SessionManager  ──► socket Baileys ──► WhatsApp
                     │         │                                    │
                     │         └─ Prisma ──► SQLite / PostgreSQL    │
                     │         └─ ./data/auth + ./data/media        │
                     └──────────────────────────────────────────────┘
                              ▲ satu service Railway, satu volume
```

Detail penting:

1. **`server.ts`** membuat HTTP server, menempelkan Next.js, lalu Socket.io — karena server bawaan Next tidak menyediakan upgrade websocket. `npm run dev` dan `npm start` sama-sama menjalankan berkas ini lewat `tsx`.
2. **Singleton tingkat proses disimpan di `globalThis`** (`lib/prisma.ts`, `lib/socket-server.ts`, `lib/baileys/session-manager.ts`). Route handler dibundel Next dalam graf modul berbeda dari `server.ts`, jadi singleton modul biasa akan terduplikasi — `globalThis` memastikan API route dan gateway socket memakai socket Baileys **yang sama**.
3. **Socket Baileys hidup di proses server.** API route hanya *memerintah* manager (`connect`, `pairing-code`, `logout`, `send`) dan membaca database.
4. **Chat yang sedang dibuka dilacak lewat room Socket.io** (`chat:<chatId>`). Kalau sebuah chat sedang tampil, server melewati penghitung belum dibaca dan langsung mengirim tanda dibaca.
5. **Keamanan berlapis**: `middleware.ts` (Edge) menahan halaman sebelum render, `lib/api.ts` memverifikasi cookie pada setiap route handler, dan handshake Socket.io memakai verifikasi cookie yang sama.

---

## 📁 Struktur proyek

```
.
├── app/
│   ├── api/                        # semua route handler (REST)
│   │   ├── auth/                   #   login · logout · status
│   │   ├── chats/[chatId]/         #   info chat, pesan (GET/POST), ekspor
│   │   ├── media/                  #   streaming berkas media (terkunci login)
│   │   ├── messages/[messageId]/   #   reaksi, hapus (semua/saya), unduh ulang media
│   │   ├── sessions/               #   CRUD + pairing-code/connect/disconnect/logout + search
│   │   └── stats/ · health/
│   ├── login/                      # halaman login panel
│   ├── (pages)/
│   │   ├── chat/[sessionId]/       # ruang chat (daftar + percakapan + composer)
│   │   ├── docs/                   # panduan setup & deploy di dalam aplikasi
│   │   └── pair/                   # halaman kode pairing
│   ├── layout.tsx                  # shell: sidebar + navigasi mobile + provider
│   └── page.tsx                    # dasbor
├── components/
│   ├── chat/                       # chat-list, conversation, bubble, composer, player, pencarian
│   ├── dashboard/                  # stats-cards, session-card, add-session-dialog
│   ├── layout/app-shell.tsx        # sidebar, badge realtime, notifikasi, tombol keluar
│   ├── notification-center.tsx     # suara/notifikasi desktop + badge judul tab
│   └── ui/                         # button, card, badge, input, dialog, dropdown, …
├── hooks/                          # use-socket (Socket.io context), use-api (SWR), use-notifications
├── lib/
│   ├── auth.ts                     # cookie HMAC-SHA256, verifikasi, rate limit login
│   ├── branding.ts                 # nama aplikasi, versi, kredit developer
│   ├── baileys/
│   │   ├── session-manager.ts      # socket, pairing, reconnect, kirim/terima, room
│   │   ├── persistence.ts          # parsing pesan + mapper DTO + upsert chat
│   │   ├── auth-state.ts           # helper auth state multi-file
│   │   ├── media.ts                # unduh media → ./data/media
│   │   ├── transcode.ts            # ffmpeg → OGG/Opus untuk pesan suara
│   │   └── paths.ts                # tata letak penyimpanan + penjaga path traversal
│   ├── prisma.ts · socket-server.ts · api.ts · fetcher.ts · types.ts · utils.ts
│   └── logger.ts
├── middleware.ts                   # gerbang Edge: redirect /login + 401 JSON untuk API
├── prisma/schema.prisma
├── scripts/prepare-db.mjs          # tukar sqlite ⇄ postgresql, buat .env
├── scripts/make-zip.mjs            # zip bersih untuk dibagikan
├── server.ts                       # server kustom: Next + Socket.io + Baileys
├── tests/functional.test.ts        # uji fungsional (npm test)
├── Dockerfile · railway.json · nixpacks.toml
└── .env.example
```

---

## 🚀 Menjalankan di lokal

Kebutuhan: **Node.js ≥ 20** (syarat Baileys) dan npm.

```bash
# 1. install (sekaligus membuat .env dari .env.example + generate Prisma client)
npm install

# 2. isi AUTH_PASSWORD di .env supaya panel terkunci login
#    (kalau dikosongkan, panel terbuka untuk siapa pun yang tahu alamatnya)

# 3. siapkan database SQLite
npm run db:push

# 4. jalankan dev server (Next + Socket.io + Baileys dalam satu proses)
npm run dev
```

Buka **http://localhost:3000** → login (bila `AUTH_PASSWORD` diisi) → *Tambah Nomor* → *Minta Kode Pairing* → ketik kode di HP.

> `npm run dev` menjalankan **server kustom** (`tsx watch server.ts`), bukan `next dev`, karena aplikasi butuh Socket.io dan Baileys di proses yang sama. HMR tetap berjalan.

Skrip yang berguna:

| Skrip | Fungsi |
|---|---|
| `npm run dev` | Dev server dengan hot reload (Next + Socket.io + Baileys) |
| `npm run build` | `prisma generate` + `next build` |
| `npm start` | Produksi: `prisma db push` + server kustom (yang dijalankan Railway) |
| `npm run db:push` | Sinkronkan skema Prisma ke database |
| `npm run db:studio` | GUI Prisma Studio |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Uji fungsional (resolusi LID, sekali lihat, reaksi, revoke, balasan) |
| `npm run zip` | Buat ZIP bersih (tanpa node_modules/.next/.env/data) |

Memasang **ffmpeg** di lokal (`apt install ffmpeg`, `brew install ffmpeg`) mengaktifkan pesan suara asli; tanpa ffmpeg rekaman tetap terkirim sebagai berkas audio biasa.

---

## 🔐 Variabel environment

Salin `.env.example` → `.env`. Semua punya nilai default yang masuk akal untuk lokal:

| Variabel | Default | Keterangan |
|---|---|---|
| `DATABASE_URL` | `file:./dev.db` | `file:...` → SQLite, `postgresql://...` → PostgreSQL (provider berganti otomatis) |
| `PORT` | `3000` | Port HTTP (Railway mengisinya otomatis) |
| `HOSTNAME` | `0.0.0.0` | Alamat bind — biarkan `0.0.0.0` untuk container |
| `AUTH_PASSWORD` | *(kosong)* | **Diisi = panel wajib login.** Dikosongkan = panel terbuka (tidak disarankan) |
| `AUTH_USERNAME` | `admin` | Username login |
| `AUTH_SECRET` | turunan password | Kunci tanda tangan cookie (disarankan 32+ karakter acak) |
| `AUTH_SESSION_DAYS` | `7` | Umur sesi login dalam hari (pilihan “ingat saya” = 30 hari) |
| `WA_AUTH_DIR` | `./data/auth` | Berkas kredensial Baileys (satu folder per sesi) |
| `WA_MEDIA_DIR` | `./data/media` | Media hasil unduhan & yang dikirim |
| `WA_MAX_MEDIA_MB` | `64` | Batas ukuran media yang diunduh & disimpan |
| `WA_AUTO_RESTORE` | `true` | Reconnect sesi tersimpan otomatis saat boot |
| `WA_SYNC_FULL_HISTORY` | `false` | Minta riwayat penuh saat menautkan (lebih berat, mengimpor chat lama) |
| `WA_HISTORY_MESSAGE_LIMIT` | `3000` | Batas pesan hasil history sync per sesi |
| `LOG_LEVEL` | `info` | `trace`…`silent` |
| `SOCKET_PATH` | `/api/socket/io` | Path endpoint Socket.io |
| `FFMPEG_PATH` | `ffmpeg` | Path ffmpeg kustom |
| `VAPID_PUBLIC_KEY` | dibuat otomatis | Kunci publik **Web Push**. Kalau dikosongkan, panel membuat pasangan kunci sendiri dan menyimpannya di `data/vapid.json` (bertahan selama volume tetap ada) |
| `VAPID_PRIVATE_KEY` | dibuat otomatis | Kunci privat Web Push (jangan dibagikan) |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | Subjek kontak VAPID (isi email kamu) |
| `NEXT_PUBLIC_APP_NAME` / `NEXT_PUBLIC_DEVELOPER_NAME` / `NEXT_PUBLIC_DEVELOPER_URL` | — | Kustomisasi branding (default: “WA Multi-Device Controller” · “Rifky”) |

`prisma/schema.prisma` ditulis ulang setiap `install`/`build`/`start` oleh `scripts/prepare-db.mjs`: `provider` berganti antara `sqlite` dan `postgresql` mengikuti `DATABASE_URL`, jadi kamu tidak perlu menyuntingnya manual.

---

## 📲 Alur pairing

1. **Dasbor → Tambah Nomor** — masukkan nomor format internasional (`6281234567890`; awalan `0` otomatis menjadi `62` untuk nomor Indonesia, `+`, spasi, dan tanda hubung dibersihkan).
2. **Minta Kode Pairing** — Baileys membuka socket belum terdaftar dan WhatsApp mengembalikan kode 8 karakter (ditampilkan `ABCD-1234`, berlaku ±3 menit, ada hitung mundur dan tombol salin).
3. **Di HP:** WhatsApp → **Perangkat Tertaut → Tautkan perangkat → Tautkan dengan nomor telepon** → ketik kodenya.
4. WhatsApp menutup socket dengan `restartRequired (515)`; panel langsung menyambung ulang dengan kredensial baru → lencana berubah **Tersambung** dan dasbor/chat terupdate realtime.

Kalau WhatsApp malah mengembalikan QR (otomatis tampil di halaman pairing), kamu bisa memindainya — kedua alur berakhir pada sesi yang sama.

---

## 🔔 Mengaktifkan notifikasi push (langkah singkat)

1. Buka panel lewat **HTTPS** (di iPhone: lewat **Safari** → Bagikan → “Tambahkan ke Layar Utama”, lalu buka dari ikon itu).
2. Buka menu **Notifikasi** (di HP: menu bawah “Notif”; di desktop: sidebar) → tekan **“Aktifkan di perangkat ini”** → **Izinkan**. Halaman ini juga memeriksa HTTPS, service worker, izin, dan menampilkan pesan error dari layanan push.
3. Klik **“Kirim notifikasi percobaan”** untuk memastikan sudah masuk.
4. Uji sungguhan: **tutup panel**, lalu kirim WhatsApp dari nomor lain — notifikasi muncul dan membuka chat saat diklik.

Notifikasi hanya dikirim untuk **pesan baru (≤2 menit)** dan **kalau tidak ada tab panel yang sedang terbuka** (biar tidak dobel). Panduan lengkap + solusi tiap status (DIBLOKIR, PERLU INSTALL, dll.): **[`PANDUAN-NOTIFIKASI.md`](./PANDUAN-NOTIFIKASI.md)**.

---

## ☁️ Deploy ke Railway (langkah demi langkah)

Repositori sudah siap: `railway.json` memilih builder **Dockerfile**, dan `npm start` menjalankan `prisma db push` lalu menyalakan satu service.

### 1. Push ke GitHub

```bash
git init
git add .
git commit -m "feat: WA multi-device controller (Next.js + Baileys + Socket.io)"
git branch -M main
git remote add origin https://github.com/<kamu>/<repo>.git
git push -u origin main
```

### 2. Buat project Railway

1. Buka **[railway.app](https://railway.app)** → *New Project* → **Deploy from GitHub repo** → pilih repositori.
2. Railway mendeteksi `Dockerfile` dan mulai build. Biarkan build pertama selesai (boleh gagal — database belum dipasang).

### 3. Tambahkan PostgreSQL

Di kanvas project: **New → Database → Add PostgreSQL**.

### 4. Beri service akses ke database

Buka **service web → Variables → New Variable → Add Reference → `DATABASE_URL`** lalu pilih service Postgres.
(Reference menjaga kredensial tetap sinkron otomatis — jangan tempel manual kecuali kamu memang mau.)

### 5. Tambahkan volume untuk berkas sesi WhatsApp

**Service → Settings → Volumes → New Volume** → mount path **`/app/data`**.

> ⚠️ Tanpa volume ini, berkas kredensial Baileys ikut hilang bersama container dan setiap nomor harus di-pairing ulang tiap redeploy. Riwayat chat & metadata media ada di PostgreSQL dan tetap aman.

### 6. Set kredensial login panel (wajib untuk keamanan)

**Service → Variables → New Variable**:

| Variabel | Contoh | Kenapa |
|---|---|---|
| `AUTH_PASSWORD` | `rahasia-panjang-ku` | Mengaktifkan `/login` dan mengunci panel + API + websocket |
| `AUTH_USERNAME` | `admin` | Username login |
| `AUTH_SECRET` | string acak 32+ karakter | Kunci tanda tangan cookie (opsional tapi disarankan) |

### 7. (Opsional) variabel lain

| Variabel | Nilai | Kenapa |
|---|---|---|
| `WA_AUTO_RESTORE` | `true` | menyambung ulang sesi setelah deploy/restart |
| `WA_MAX_MEDIA_MB` | `64` | batas ukuran media yang diunduh |
| `LOG_LEVEL` | `info` | log lebih tenang; pakai `debug` saat mencari masalah |
| `PORT` | *biarkan kosong* | Railway mengisinya |
| `HOSTNAME` | `0.0.0.0` | sudah diatur di Dockerfile |

### 8. Deploy & buka

- Railway redeploy otomatis setiap `git push`.
- **Settings → Networking → Generate Domain** untuk mendapat URL publik `https://…up.railway.app`. Websocket langsung jalan di domain yang sama.
- Health check: `GET /healthz` (dipakai Railway) dan `GET /api/health` (DB + uptime + versi + status auth).

### 9. Login pertama

Buka domain hasil generate → halaman **login** → masuk → *Tambah Nomor* → *Minta Kode Pairing* → ketik di HP → **Tersambung**.

### Pakai Nixpacks, bukan Docker?

Hapus `railway.json` dan pertahankan `nixpacks.toml` (sudah memuat Node 20, openssl, ffmpeg), atau ubah `build.builder` menjadi `NIXPACKS`.

### Deploy di tempat lain

Host Docker apa pun bisa: `docker build -t wa-controller . && docker run -p 3000:3000 -v $PWD/data:/app/data -e DATABASE_URL=file:/app/data/prod.db wa-controller`.
Di VPS, jalankan `npm ci && npm run build && npm start` di belakang reverse proxy yang meneruskan websocket (nginx butuh `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`).

---

## 🔌 Referensi API

Semua endpoint berformat JSON; error selalu mengembalikan `{ "error": "pesan" }`. Kecuali `/api/health`, **semua endpoint butuh cookie login** saat `AUTH_PASSWORD` diisi (kalau tidak: `401`).

| Method | Endpoint | Keterangan |
|---|---|---|
| `GET` | `/healthz` · `/api/health` | Probe kesehatan (polos / cek DB + versi + status auth) |
| `GET` | `/api/auth/status` | Apakah login diaktifkan & apakah tab ini sudah login |
| `POST` | `/api/auth/login` | `{ username, password, remember? }` → set cookie sesi |
| `POST` | `/api/auth/logout` | Hapus cookie sesi |
| `GET` | `/api/stats` | Ringkasan angka untuk dasbor |
| `GET` `POST` | `/api/sessions` | Daftar sesi + statistik / buat sesi |
| `GET` `PATCH` `DELETE` | `/api/sessions/:id` | Detail / ganti nama / hapus (unlink + bersihkan data) |
| `POST` | `/api/sessions/:id/pairing-code` | Minta kode pairing 8 karakter `{ phoneNumber? }` |
| `POST` | `/api/sessions/:id/connect` | Buka lagi socket dengan kredensial tersimpan |
| `POST` | `/api/sessions/:id/disconnect` | Tutup socket, kredensial tetap disimpan |
| `POST` | `/api/sessions/:id/logout` | Lepas perangkat & hapus auth lokal |
| `GET` | `/api/sessions/:id/search?q=&limit=` | Cari pesan lintas percakapan (min. 2 karakter) |
| `GET` | `/api/sessions/:id/avatar?jid=` | URL foto profil WhatsApp |
| `GET` | `/api/sessions/:id/debug` | Diagnostik: socket hidup, counter, peta lid→pn, sisa chat `@lid`, event mentah terakhir |
| `POST` | `/api/sessions/:id/prune-chats` | Hapus baris chat tanpa pesan (sisa sinkronisasi buku alamat) |
| `POST` | `/api/sessions/:id/repair-lid` | Paksa pencarian nomor asli untuk chat/kontak `@lid` lalu gabungkan ke entri bernomor |
| `GET` | `/api/sessions/:id/contacts?q=&limit=` | Buku kontak (+ pencarian nama/nomor, status punya-chat) |
| `POST` | `/api/sessions/:id/contacts` | Impor nomor: `{ "numbers": "62812…\n62898…" }` — diverifikasi ke WhatsApp |
| `DELETE` | `/api/contacts/:contactId` | Hapus satu kontak dari buku kontak panel |
| `POST` | `/api/sessions/:id/test-message` | Kirim pesan ke akun sendiri (uji end-to-end) |
| `GET` `POST` | `/api/sessions/:id/chats` | Daftar/cari chat / buka chat 1:1 berdasarkan nomor |
| `GET` `PATCH` | `/api/chats/:chatId` | Detail chat / pin · arsip · tandai dibaca |
| `GET` `POST` | `/api/chats/:chatId/messages` | Riwayat berhalaman / kirim (JSON teks atau multipart media) |
| `GET` | `/api/chats/:chatId/export?format=txt\|json` | Ekspor percakapan |
| `GET` | `/api/media?id=<messageId>&download=1` | Streaming media tersimpan (aman dari path traversal, terkunci login) |
| `POST` | `/api/messages/:id/reaction` | Beri reaksi (`{ "emoji": "❤️" }`, string kosong menghapus) |
| `POST` | `/api/messages/:id/download` | Unduh ulang media — jalur perbaikan untuk media sekali lihat & URL kedaluwarsa |
| `DELETE` | `/api/messages/:id?scope=everyone\|me` | Hapus untuk semua orang (revoke) atau sembunyikan dari panel |
| `POST` | `/api/messages/:id/forward` | Teruskan pesan (`{ "chatId": "..." }`) — teks & media, caption ikut |
| `GET` | `/api/chats/:chatId/messages?limit=&before=&around=&search=` | Halaman lama (`before`), lompat ke sekitar pesan (`around`), atau cari **di dalam satu chat** (`search`) |
| `GET` | `/api/push/key` | Kunci publik VAPID + status langganan tab ini |
| `POST` | `/api/push/subscribe` | Simpan langganan Web Push browser |
| `POST` | `/api/push/unsubscribe` | Hapus langganan |
| `POST` | `/api/push/test` | Kirim notifikasi percobaan ke semua langganan |
| `GET` `POST` | `/api/sessions/:id/autoreply` | Daftar / buat aturan balasan otomatis |
| `PATCH` `DELETE` | `/api/autoreply/:ruleId` | Ubah (termasuk aktif/nonaktif) / hapus aturan |
| `GET` `PATCH` | `/api/sessions/:id/webhook` | Baca (secret disamarkan) / simpan konfigurasi webhook |
| `POST` | `/api/sessions/:id/webhook/test` | Kirim payload percobaan ke URL webhook |
| `GET` | `/api/analytics?days=3..90` | Statistik siap tampil untuk halaman Analitik |
| `GET` | `/api/backup?download=1` | Unduh backup JSON seluruh data |

Kirim media (multipart): `file` (wajib), `kind` (`image|video|audio|document`), `caption`, `ptt=true` untuk pesan suara, `viewOnce=true` untuk sekali lihat, `quotedMessageId` untuk balasan.

### Event realtime (Socket.io, path `/api/socket/io`)

**Server → klien:** `session:status`, `session:pairing-code`, `session:qr`, `session:message`, `session:chat`, `session:message-status`, `session:message-updated` (reaksi / revoke / edit / media siap), `session:message-removed`, `session:notify` (ringkasan untuk notifikasi & badge judul tab), `session:created`, `session:deleted`, `sessions:changed`, `server:ready`.

**Klien → server:** `subscribe {sessionId}` / `unsubscribe`, `chat:typing {sessionId, chatId, state}`, `chat:read`, `chat:open` / `chat:close` (untuk penghitung belum dibaca + tanda dibaca otomatis), dan `presence:visibility {state}` (menentukan apakah notifikasi push perlu dikirim).

Kirim media (multipart) juga menerima `location` / `contact` lewat JSON: `{ "location": { "lat": -6.9, "lng": 110.4, "name": "Semarang" } }` atau `{ "contact": { "phone": "6281234567890", "displayName": "Budi" } }`.

---

## 🗃️ Skema database (Prisma)

```
WaSession 1─n Chat 1─n Message
```

- **WaSession** — name, phoneNumber (unik), status (`disconnected|connecting|pairing|connected|error`), pairingCode + kedaluwarsa, pushName, lastError, connectedAt.
- **Chat** — jid (unik per sesi), name, isGroup, unreadCount, lastMessagePreview/At, pinned, archived.
- **AutoReplyRule** — name, matchType (`contains|exact|startsWith|regex`), pattern, reply, enabled, cooldownSeconds, applyToGroups, hits, lastFiredAt.
- **PushSubscription** — langganan Web Push (endpoint, p256dh, auth, userAgent, lastSeenAt).
- **WaSession** (tambahan) — webhookUrl, webhookSecret, webhookEvents, webhookEnabled, lastWebhookAt, lastWebhookStatus.
- **Contact** — jid (unik per sesi), phoneNumber, name (nama di HP), notify (nama WhatsApp-nya), verifiedName, source (`sync|pesan|manual`).
- **Message** — waMessageId, fromMe, senderJid/Name, type (`text|image|video|audio|document|sticker|other`), text, mediaPath/Mime/Name/Size/Duration, **viewOnce**, **mediaNode**, **mediaStatus**, **mediaRetries**, **mediaError**, **extra** (JSON: ptv, gifPlayback, poll, location, contact, produk, acara, rawType), reactions, quoted\*, deletedAt, **editedAt**, status (`pending|sent|delivered|read|failed`), timestamp.

---

## 🛠️ Pemecahan masalah

### “Daftar chat tiba-tiba penuh kontak tanpa pesan” / “kok muncul sendiri?”

Itu **normal** dan bukan fitur misterius: saat kamu menautkan nomor, WhatsApp mengirimkan **buku alamat** dan metadata chat ke setiap perangkat tertaut (sama seperti WhatsApp Web). Versi lama panel mengubah **setiap kontak** menjadi baris chat — makanya daftar tiba-tiba berisi ratusan entri “Belum ada pesan” dengan jam yang sama.

Sejak **v1.7.0**:
- buku alamat **tidak lagi membuat chat kosong** — kontak hidup di halaman **Kontak**, sedangkan daftar chat hanya berisi percakapan nyata;
- nama kontak **tetap ditempelkan** ke chat yang sudah ada (jadi nama dari HP tetap ikut terpakai);
- ada pembersihan otomatis **±8 detik setelah tersambung** dan setiap selesai sinkronisasi riwayat; bisa dipicu manual lewat kartu sesi → **⋮ → “Rapikan daftar chat (hapus yang kosong)”**;
- yang **tidak** dihapus: chat bersemat, diarsipkan, punya pesan, punya jumlah belum dibaca, atau punya cuplikan pesan terakhir. Chat kosong **dibuat ulang otomatis** begitu ada pesan masuk atau saat dibuka dari halaman Kontak.

### “Muncul nomor panjang seperti +225… padahal bukan nomor asing”

Itu **alamat `@lid`** (Linked ID): WhatsApp makin sering menyembunyikan nomor asli di balik alamat anonim yang panjang (bisa berawalan angka apa saja, mis. `225123456789012`). Panel versi lama menampilkan angka itu apa adanya, sehingga terlihat seperti nomor negara lain.

Sejak **v1.5.1**:
- panel **tidak pernah** merender alamat `@lid` sebagai nomor telepon — kalau nomornya belum diketahui, judul chat menjadi `Kontak WhatsApp (…1234)` (4 digit terakhir sebagai pembeda) dan di bawah judul tertulis “Nomor disembunyikan WhatsApp — menunggu tersinkron”;
- panel **berusaha menyelesaikannya otomatis**: dari data pesan (`senderPn` / `participantPn`), event resmi `chats.phoneNumberShare`, sinkronisasi kontak, dan pemindaian riwayat pesan lama — sekitar 8 detik setelah tersambung dan setiap selesai sync riwayat;
- begitu nomor aslinya ditemukan, chat `@lid` tersebut **digabung** ke chat bernomor (riwayat + jumlah belum dibaca tetap utuh), lalu nama/format nomornya kembali normal (`+62 812-3456-7890`).

Kalau masih ada chat yang bertahan sebagai `Kontak WhatsApp (…)`: memang WhatsApp belum membagikan nomornya (biasanya karena kontak tersebut memakai fitur privasi nomor). Pesannya tetap bisa dibaca dan dibalas seperti biasa — balasan otomatis tetap jalan. Untuk memaksa pencarian ulang, jalankan **“Jalankan diagnostik”** dari menu kartu sesi (kolom `pendingLidChats` menunjukkan berapa chat yang masih menunggu).

### “Sesi bilang Tersambung tapi daftar chat kosong”

Diagnosis berurutan (menu sesi **⋮ → Jalankan diagnostik**, atau buka `/api/sessions/<sessionId>/debug`):

1. **Apakah socket benar-benar hidup?** Lihat `socket.isLive` / `wsReadyState`. `CLOSED` atau `isLive: false` sementara lencana hijau berarti socket mati (crash/redeploy). Klik **Sambungkan ulang** — watchdog juga mencoba tiap 60 detik. Kartu sesi menampilkan peringatan merah pada kondisi ini.
2. **Apakah event mentah masuk?** `counters.upsert` menghitung setiap `messages.upsert`. Kalau tetap `0` padahal ada orang mengirim pesan, WhatsApp tidak mengirim ke perangkat ini — pastikan HP online dan perangkat masih ada di *Perangkat Tertaut*.
3. **Kenapa pesan dilewati?** `recentEvents` mencatat setiap event mentah beserta bentuk key dan alasannya (`stored`, `duplicate`, `ignored jid type`, `content not storable`). Cara tercepat melihat apa yang sebenarnya dikirim WhatsApp.
4. **Uji kirim ke diri sendiri** — *⋮ → Kirim pesan uji* menulis pesan lewat jalur penuh (Baileys → database → Socket.io). Kalau muncul, berarti kirim/realtime/DB sehat dan masalahnya di sisi penerimaan.

> Sejak 1.0.1, chat `@lid` (Linked ID) diselesaikan ke nomor teleponnya alih-alih dibuang — itulah penyebab panel kosong pada sebagian akun meski pesan terus masuk. Pasangan lid→pn yang dipelajari tampil di `lidMappings`; chat `@lid` lama otomatis dipindahkan ke chat nomor telepon.

| Gejala | Solusi |
|---|---|
| *“Gagal mendapatkan kode pairing”* | Socket belum siap — tunggu 2 detik lalu klik **Buat Ulang Kode**. Pastikan nomor memakai format internasional tanpa `+`. |
| Panel minta login terus / tidak bisa masuk | Pastikan `AUTH_PASSWORD` di Railway sama dengan yang kamu ketik. Terkena rate limit? Tunggu 10 menit (6 percobaan salah / 5 menit). |
| Lupa password panel | Ubah nilai `AUTH_PASSWORD` di Railway → redeploy. Cookie lama otomatis tidak berlaku. |
| Sesi **Terputus** setelah redeploy | Pasang Volume Railway di `/app/data` dan biarkan `WA_AUTO_RESTORE=true`. |
| Pesan suara datang sebagai berkas | `ffmpeg` tidak ada di server. Dockerfile sudah memasangnya; di VPS jalankan `apt install ffmpeg`. |
| Media “sekali lihat” menampilkan “Menunggu WhatsApp mengirim berkasnya…” | Panel sudah mengunduh segera saat pesan masuk dan mencoba ulang di +4s/+12s/+35s/+90s/+180s. Kalau gagal, gelembung menampilkan alasan (mis. URL kedaluwarsa) dan tombol **Coba lagi**. Media yang dikirim lama biasanya sudah tidak bisa diambil ulang — batasan WhatsApp, bukan bug panel. |
| Balas/reaksi/hapus gagal “Sesi tidak berjalan” | Socket mati (lihat diagnostik). Klik **Sambungkan ulang** di dasbor — HTTP 409 memang dikembalikan agar UI bisa memberi tahu hal itu. |
| Chat lama tidak muncul | Secara default hanya potongan sync terbaru yang diimpor (hemat memori/CPU). Set `WA_SYNC_FULL_HISTORY=true` untuk menarik seluruh riwayat saat penautan berikutnya. |
| `prisma db push` gagal di Railway | `DATABASE_URL` belum terhubung ke service (langkah 4). |
| Build gagal “Environment variable not found: DATABASE_URL” | Sebab sama — reference DB harus ada **sebelum** build berjalan. |
| Pesan berhenti setelah ±30 menit | Cek log untuk `connection closed` + percobaan reconnect; manager mencoba sampai 12 kali dengan backoff, lalu menandai sesi `error`. |
| WhatsApp melepas perangkat | Pakai **Keluar / lepas perangkat** di panel lalu pairing lagi — nomor tetap tertaut sampai kamu melepasnya. |
| Realtime terasa lambat | Periksa indikator “Realtime tersambung” di sidebar. Bila terputus, UI memakai sinkronisasi berkala. Pilih region server (Railway → Settings → Region) yang dekat dengan penggunamu, mis. **Singapore** untuk Indonesia. |

---

## 🔒 Keamanan & privasi

- **Jangan pernah commit `.env`, `data/auth`, atau `data/media`.** `.gitignore` dan `.dockerignore` sudah mengecualikannya, dan `npm run zip` juga menyaringnya.
- **Login panel**: set `AUTH_PASSWORD` (dan idealnya `AUTH_SECRET`) supaya halaman, API, media, dan websocket terkunci. Panel menampilkan peringatan kuning di atas layar selama login belum diaktifkan.
- Cookie `wa_panel_session` bersifat HttpOnly, SameSite=Lax, dan otomatis `Secure` di HTTPS; ditandatangani HMAC-SHA256 dengan masa berlaku (`AUTH_SESSION_DAYS`, “ingat saya” 30 hari).
- Rate limit login: 6 percobaan gagal per 5 menit per IP → blokir 10 menit.
- `data/auth` setara dengan login WhatsApp-mu — perlakukan seperti password dan hanya pasang volume yang kamu kendalikan.
- Media dialirkan dari disk sendiri dengan penjaga path traversal, tipe konten yang benar, dan wajib login.
- Gunakan panel ini hanya untuk nomor milikmu, nomor bisnis, atau perangkat yang pemiliknya sudah memberi izin.

---

## ⚠️ Penafian

Proyek ini **tidak berafiliasi dengan, tidak didukung, dan tidak terhubung dengan WhatsApp Inc.** Proyek memakai pustaka tidak resmi [Baileys](https://github.com/WhiskeySockets/Baileys). Mengotomatiskan WhatsApp dapat melanggar Ketentuan Layanan mereka — gunakan hanya untuk akun sendiri dan tujuan yang sah. **Dilarang mengirim pesan massal, spam, atau pesan tanpa izin.** Kamu bertanggung jawab penuh atas cara pemakaiannya, termasuk kepatuhan pada UU PDP &amp; UU ITE.

---

## 📄 Lisensi

MIT — pakai sesukamu, tanpa jaminan apa pun.

Dibuat oleh **Rifky**.
