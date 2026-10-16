# 🔔 Panduan Mengaktifkan Notifikasi Push — WA Multi-Device Controller

## 🧠 Konsep: kenapa notifikasi tetap masuk walau panel ditutup

Kuncinya: **koneksi WhatsApp tidak hidup di HP kamu dan tidak hidup di browser.** Yang memegang nomor
WhatsApp adalah **server** (Railway) — 24 jam sehari, lewat pustaka Baileys. Browser/panel hanya *penampil*.

```
HP kamu                     Server (Railway)                        Kamu
─────────                   ─────────────────                       ────
WhatsApp ──pesan masuk──►   nomor tertaut (Baileys, 24/7) ──► simpan ke database
                                        │
                                        ├──► Socket.io  ──► panel yang SEDANG TERBUKA
                                        │                  (suara + toast + badge unread)
                                        └──► Web Push   ──► HP/desktop kamu
                                                            (notifikasi sistem, walau
                                                             panel/aplikasi DITUTUP)
```

Jadi:

| Kondisi kamu | Notifikasi yang kamu terima |
|---|---|
| Panel dibuka & terlihat | 🔵 Suara + notifikasi dalam panel + badge jumlah belum dibaca (tanpa perlu push) |
| Panel ditutup / HP di tas / aplikasi di-swipe | 🟢 **Notifikasi sistem dari Web Push** — muncul di layar kunci/notifikasi HP |
| Panel ditutup dan HP offline | Pesan tetap **tersimpan di server**; notifikasi menyusul saat HP online lagi |
| Tidak diaktifkan sama sekali | Tidak ada notifikasi, tapi **tidak ada pesan yang hilang** — semua muncul saat panel dibuka |

**Jadi jawabannya: ya.** Begitu diaktifkan sekali, kamu **tidak perlu membuka web** untuk dapat notifikasi.
Yang dibutuhkan hanya: server panel hidup (Railway), HP punya internet, dan langganan push perangkat sudah aktif.

Catatan penting soal "tidak perlu membuka web": push dikirim **per perangkat, bukan per akun**.
Perangkat yang panelnya sedang kamu lihat memang ditahan (biar tidak dobel), tapi **perangkat lain tetap
menerima**. Contoh: panel dibuka di laptop → HP tetap berbunyi saat ada pesan baru. Satu perangkat = satu
langganan, jadi kalau kamu ingin HP **dan** laptop berbunyi, aktifkan di dua-duanya.

Perkiraan kecepatan: normalnya **1–5 detik** setelah pesan masuk ke server (lebih cepat bila region
Railway kamu dekat, mis. Singapore).

---

Notifikasi di panel ini bekerja seperti notifikasi WhatsApp: **pesan masuk muncul di HP kamu walau panel sedang ditutup**. Panduan ini langkah demi langkah. Total waktu ± 2 menit per perangkat.

> Penting: notifikasi push harus diaktifkan **satu kali per perangkat** (HP, tablet, laptop). Kalau kamu pakai 3 perangkat, ulangi Langkah 1–3 di masing-masing.

---

## Sebelum mulai — 3 syarat

| Syarat | Kenapa |
|---|---|
| Panel dibuka lewat **HTTPS** | Browser hanya mengizinkan notifikasi di situs aman. Domain Railway (`https://...up.railway.app`) sudah HTTPS. Di laptop, `http://localhost:3000` juga dianggap aman. |
| Panel **sudah dimuat & kamu sudah login** | Izin notifikasi hanya bisa diminta dari dalam halaman panel. |
| **iPhone: iOS 16.4+ dan harus lewat Safari** | Di iPhone, Web Push hanya jalan kalau panel dipasang ke Layar Utama dulu (Langkah 1B). |

---

## Langkah 1 — Pasang panel sebagai aplikasi (PWA)

Tidak wajib di Android/desktop, **wajib di iPhone**. Dipasang dulu supaya ikonnya muncul seperti aplikasi dan notifikasi bisa dibuka tanpa browser.

### 1A. Android (Chrome / Edge / Samsung Internet)
1. Buka alamat panel di browser.
2. Tap **menu ⋮** kanan atas → pilih **“Tambahkan ke Layar utama”** / **“Instal aplikasi”**.
3. Kalau muncul dialog, tap **Instal** → ikon **WA Controller** muncul di layar utama.
4. Buka panel dari ikon tersebut.

### 1B. iPhone / iPad (Safari — wajib)
1. Buka alamat panel **di Safari** (bukan Chrome/Firefox di iPhone).
2. Tap tombol **Bagikan** (kotak dengan panah ke atas) di bar bawah.
3. Geser daftar → pilih **“Tambahkan ke Layar Utama”** → **Tambah**.
4. **Tutup Safari**, lalu buka panel dari ikon yang baru muncul di layar utama.
5. Baru lanjut ke Langkah 2 (kalau dibuka di dalam Safari, sidebar akan menampilkan status **PERLU INSTALL** dan tombolnya mati).

### 1C. Laptop / desktop (Chrome / Edge)
1. Buka panel → klik **ikon pasang (⊕ / monitor kecil)** di ujung kanan address bar, atau menu ⋮ → **“Instal WA Multi-Device Controller”**.
2. Setuju → aplikasi terbuka di jendela sendiri. (Opsional — bisa juga lanjut pakai tab biasa.)

---

## Langkah 2 — Aktifkan notifikasi di dalam panel

1. Buka halaman **Notifikasi**: menu bawah **“Notif”** (HP) atau menu sidebar **“Notifikasi”** (desktop), atau langsung ke `https://panel-kamu/notifikasi`.
2. Halaman ini menampilkan **pemeriksaan otomatis**: HTTPS, service worker, izin notifikasi, langganan perangkat, plus diagnostik dari server (kunci VAPID, daftar perangkat, 12 percobaan terakhir).
3. Klik tombol **“Aktifkan di perangkat ini”**.
4. Browser akan bertanya *“Izinkan notifikasi?”* → pilih **Izinkan / Allow**.
5. Badge di kanan atas halaman berubah menjadi **AKTIF** (hijau). Kalau belum, baca baris merah di bagian “Pemeriksaan di perangkat ini” — di situ tertulis tepatnya apa yang kurang.

> Kalau statusnya **MATI** terus, pastikan tidak ada mode *Incognito*/penyamaran dan tidak ada pemblokir iklan yang mematikan `sw.js`.

---

## Langkah 3 — Uji sekarang juga

1. Klik tombol **“Kirim notifikasi percobaan”** di halaman Notifikasi.
   Angka “Perangkat terdaftar” di bagian “Sisi server” menunjukkan berapa perangkat yang sudah berlangganan.
2. Notifikasi **“Notifikasi percobaan”** harus muncul di perangkat tersebut.
3. **Sekarang tes sungguhan:** tutup panel (swipe dari daftar aplikasi terakhir), lalu minta seseorang mengirim WhatsApp ke nomor yang tertaut. Notifikasi akan muncul ± seketika, dan **saat diklik langsung membuka chat-nya**.

---

## Arti badge status

| Badge | Artinya | Yang harus dilakukan |
|---|---|---|
| **AKTIF** | Berhasil. Pesan baru akan masuk sebagai notifikasi. | — selesai |
| **MATI** | Belum diaktifkan di perangkat ini. | Klik “Aktifkan di perangkat ini”. |
| **DIBLOKIR** | Kamu pernah memilih “Blokir”. | Chrome/Edge: klik 🔒 di address bar → Notifikasi → Izinkan → muat ulang. Android: Chrome → ⋮ → Setelan → Setelan situs → Notifikasi → izinkan domain panel. iPhone: Setelan → Notifikasi → WA Controller → aktifkan. |
| **PERLU INSTALL** | Ini iPhone/iPad dan panel masih dibuka di browser. | Kerjakan Langkah 1B, lalu buka panel dari ikon Layar Utama. |
| **TIDAK DIDUKUNG** | Browser terlalu tua / bukan HTTPS. | Pakai Chrome/Edge/Safari terbaru lewat alamat HTTPS. |
| **GAGAL** | Ada pesan kesalahan spesifik di bawah tombol. | Baca pesannya; biasanya service worker gagal (tanpa HTTPS) atau kunci push tidak terbaca. |

---

## Kapan notifikasi **sengaja tidak dikirim** (ini normal)

1. **Panel di perangkat itu sedang terlihat.** Kalau kamu sedang menatap panel di HP/laptop tersebut, notifikasinya
   ditahan supaya tidak dobel — toh kamu melihat pesannya langsung. **Perangkat lain tetap menerima** (panel di
   laptop terbuka ≠ HP ikut sepi).
2. **Pesan lama dari riwayat** (lebih dari 2 menit). Saat pairing/restore, WhatsApp mengirim ribuan pesan lama —
   ini tidak akan jadi ribuan notifikasi. Pesan yang datang saat server hidup selalu "baru", jadi selalu dikirim.
3. Pesanmu sendiri (`detik fromMe`) tentu tidak dinotifikasi.

Uji paling jujur: **tutup panel di HP itu** (atau pindah ke aplikasi lain sehingga panel tidak terlihat), lalu
kirim pesan dari nomor lain.

---

## 🛠️ Supaya notifikasi konsisten (hal khusus tiap HP)

Ini trik penting — beberapa merek HP **menahan** notifikasi aplikasi yang dianggap jarang dibuka:

| Merek / sistem | Yang perlu diatur |
|---|---|
| **Xiaomi / Redmi / POCO** | Setelan → Aplikasi → Chrome (atau panel bila dipasang) → **Hemat baterai: Tanpa batasan** + **Autostart: aktif** |
| **Oppo / Realme / Vivo** | Setelan → Baterai → **Matikan optimasi** untuk Chrome/panel; izinkan **auto-launch** |
| **Samsung** | Setelan → Baterai → **Tidurkan aplikasi**: keluarkan Chrome/panel dari daftar |
| **Android lain** | Pastikan Chrome **tidak** "dihentikan paksa" dari daftar aplikasi terakhir (jangan swipe-kill browser) |
| **iPhone / iPad** | iOS **16.4+**, wajib dipasang ke Layar Utama lewat Safari; jangan aktifkan **Mode Fokus/Senyap** untuk aplikasi ini |
| **Desktop (Chrome/Edge)** | Browser harus tetap berjalan (bisa diminimalkan). Kalau browser ditutup total, pengiriman tidak dijamin sampai dibuka lagi |

Tips lain: matikan **mode hemat daya** saat menguji, dan pastikan jam/lokasi HP tidak mengacaukan waktu sistem.

---

## Beberapa perangkat sekaligus

- Setiap perangkat punya langganan sendiri; tombol percobaan menunjukkan jumlahnya, misal **(2)**.
- Untuk mematikan hanya di satu perangkat: buka panel di perangkat itu → **“Matikan di perangkat ini”**.
- Langganan yang sudah mati (aplikasi dihapus, browser di-reset) dibersihkan otomatis oleh server saat pengiriman gagal (404/410).

---

## Soal kunci VAPID (kalau mau permanen)

- Secara default panel membuat kunci push sendiri dan menyimpannya di `data/vapid.json` — sudah cukup.
- Kalau nanti volume Railway dibuat ulang/dipindah, kunci itu bisa hilang dan **semua langganan lama jadi tidak valid** (harus aktifkan ulang).
- Supaya permanen: di Railway → Variables tambahkan
  - `VAPID_PUBLIC_KEY` dan `VAPID_PRIVATE_KEY` (satu pasang, buat sekali lewat `npx web-push generate-vapid-keys`)
  - `VAPID_SUBJECT` = `mailto:emailkamu@gmail.com`

---

## Beda dengan “Notifikasi” di sidebar

Sidebar punya dua bagian yang mirip tapi berbeda:

| Bagian | Kapan berbunyi | Perlu izin browser? |
|---|---|---|
| **Notifikasi** (suara + notifikasi desktop) | Hanya saat panel **sedang terbuka** di perangkat itu | Suara: tidak. Desktop: ya |
| **Notifikasi push (PWA)** | **Walau panel/aplikasi ditutup**, bisa langsung menuju chat saat diklik (per perangkat) | Ya |

Pakai keduanya: yang pertama untuk bunyi saat kamu sedang di depan panel, yang kedua untuk tetap tahu saat panel ditutup.
