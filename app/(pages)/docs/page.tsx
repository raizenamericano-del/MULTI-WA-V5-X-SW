import Link from 'next/link'
import {
  BarChart3,
  BellRing,
  BookOpen,
  BookUser,
  Bot,
  CloudUpload,
  Database,
  HardDrive,
  KeyRound,
  MessageSquare,
  Phone,
  Rocket,
  ShieldCheck,
  Sparkles,
  Terminal,
  TriangleAlert,
  Webhook,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { APP_VERSION, DEVELOPER_CREDIT, DEVELOPER_NAME } from '@/lib/branding'

export const metadata = {
  title: 'Panduan — WA Multi-Device Controller',
}

const localSteps = [
  'npm install',
  'cp .env.example .env   (Windows: copy .env.example .env)',
  'Isi AUTH_PASSWORD di dalam .env supaya panel terkunci password',
  'npm run db:push',
  'npm run dev',
  'Buka http://localhost:3000 → Tambah Nomor → Minta Kode Pairing',
]

const railwaySteps = [
  {
    title: '1. Push proyek ke GitHub',
    body: 'git init && git add . && git commit -m "feat: WA multi-device controller" && git push',
  },
  {
    title: '2. Buat project Railway',
    body: 'railway.app → New Project → Deploy from GitHub repo → pilih repositori kamu.',
  },
  {
    title: '3. Tambahkan PostgreSQL',
    body: 'Di project: New → Database → Add PostgreSQL. Railway membuat DATABASE_URL otomatis.',
  },
  {
    title: '4. Hubungkan database ke service',
    body: 'Service → Variables → New Variable → Add Reference → DATABASE_URL (dari service Postgres).',
  },
  {
    title: '5. Pasang Volume untuk menyimpan sesi',
    body: 'Service → Settings → Volumes → New Volume dengan mount path /app/data, agar sesi Baileys dan media tetap ada setelah redeploy.',
  },
  {
    title: '6. Set AUTH_PASSWORD (penting!)',
    body: 'Service → Variables → tambahkan AUTH_PASSWORD=password-kuat dan (opsional) AUTH_USERNAME=admin. Setelah redeploy, panel meminta login.',
  },
  {
    title: '7. Deploy',
    body: 'Railway menjalankan Dockerfile: prisma db push lalu satu service (HTTP + websocket + Baileys) aktif.',
  },
  {
    title: '8. Buka aplikasi, login, lalu tautkan nomor',
    body: 'Buka domain Railway → halaman /login → masuk → Tambah Nomor → salin kode pairing ke HP (WhatsApp → Perangkat Tertaut).',
  },
]

const envVars = [
  { name: 'DATABASE_URL', desc: 'SQLite (lokal) atau PostgreSQL (Railway).' },
  { name: 'AUTH_PASSWORD', desc: 'Mengaktifkan halaman login & mengunci panel/API/websocket.' },
  { name: 'AUTH_USERNAME', desc: 'Username login (default: admin).' },
  { name: 'AUTH_SECRET', desc: 'Kunci tanda tangan cookie (opsional, disarankan 32+ karakter acak).' },
  { name: 'AUTH_SESSION_DAYS', desc: 'Umur sesi login dalam hari (default 7; “ingat saya” 30).' },
  { name: 'WA_AUTO_RESTORE', desc: 'Restore + reconnect semua sesi otomatis saat server menyala (default true).' },
  { name: 'WA_SYNC_FULL_HISTORY', desc: 'Minta riwayat penuh saat pairing (default false = lebih hemat).' },
  { name: 'WA_HISTORY_MESSAGE_LIMIT', desc: 'Batas pesan hasil sync per sesi (default 3000).' },
  { name: 'WA_MAX_MEDIA_MB', desc: 'Batas ukuran media yang diunduh & disimpan (default 64 MB).' },
  { name: 'WA_AUTH_DIR / WA_MEDIA_DIR', desc: 'Lokasi file sesi & media (di Railway: ./data/…).' },
  { name: 'LOG_LEVEL', desc: 'trace | debug | info | warn | error | silent.' },
  { name: 'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY', desc: 'Web Push. Kosongkan = dibuat otomatis & disimpan di data/vapid.json.' },
  { name: 'VAPID_SUBJECT', desc: 'Kontak VAPID untuk notifikasi push (default mailto:admin@example.com).' },
]

const features = [
  { icon: KeyRound, title: 'Login panel + sesi aman', body: 'Halaman /login dengan cookie ber-tanda tangan HMAC-SHA256, middleware Edge, proteksi API + websocket, rate limit 6 percobaan / 5 menit.' },
  { icon: Sparkles, title: 'Pesan sekali lihat tersimpan', body: 'Foto/video “sekali lihat” diunduh segera setelah pesan masuk (fast-path), lalu dirender dengan tombol “ketuk untuk melihat”. Ada retry bertingkat & alasan kegagalan bila WhatsApp belum membagikan berkasnya.' },
  { icon: MessageSquare, title: 'Semua jenis pesan', body: 'Teks, foto, video, GIF, video bulat (ptv), dokumen, pesan suara, stiker, polling, lokasi & lokasi live, kartu kontak, produk katalog, acara, balasan tombol/list.' },
  { icon: Phone, title: 'Kirim lengkap', body: 'Kirim teks, foto, video, dokumen, pesan suara (rekam langsung dari browser), balas/quote, reaksi, kirim ulang sebagai sekali lihat.' },
  { icon: HardDrive, title: 'Multi-nomor + auto reconnect', body: 'Beberapa nomor sekaligus, masing-masing punya auth state sendiri, status realtime, auto reconnect, dan tombol logout/unlink kapan saja.' },
  { icon: ShieldCheck, title: 'Cari & ekspor', body: 'Pencarian pesan lintas percakapan (Ctrl+K), lompat langsung ke pesan hasil pencarian, plus ekspor percakapan ke TXT atau JSON.' },
  { icon: BellRing, title: 'Pasang seperti aplikasi (PWA)', body: 'Tambahkan panel ke layar utama HP atau pasang di desktop. Aktifkan notifikasi push supaya pesan baru tetap masuk walau panel ditutup.' },
  { icon: Bot, title: 'Balasan otomatis', body: 'Aturan kata kunci per nomor: mengandung / sama persis / awalan / regex, lengkap dengan cooldown anti-spam dan penghitung pemakaian.' },
  { icon: Webhook, title: 'Webhook keluar ber-HMAC', body: 'Teruskan setiap pesan masuk ke alur otomasi milikmu. Payload ditandatangani x-wa-signature (HMAC-SHA256), ada retry dan tombol kirim tes.' },
  { icon: BookUser, title: 'Buku kontak', body: 'Semua kontak dari nomor yang ditautkan: nama di HP + nama WhatsApp-nya, dikelompokkan per huruf, bisa dicari pakai nama atau nomor, dan langsung dibuka jadi chat. Kontak yang belum tersinkron bisa ditambahkan manual (diverifikasi ke WhatsApp dulu).' },
  { icon: BarChart3, title: 'Analitik & backup', body: 'Grafik pesan per hari, chat teratas, statistik per nomor, dan unduh seluruh data panel sebagai satu berkas JSON.' },
]

export default function DocsPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-28 pt-8 md:px-8 md:pb-16">
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#25D366]/25 bg-[#25D366]/10 px-3 py-1 text-[11px] text-[#4ade80]">
          <Rocket className="h-3 w-3" /> Satu service, tanpa worker tambahan · v{APP_VERSION}
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          Panduan <span className="gradient-text">Lokal &amp; Railway</span>
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Panel ini dibangun sebagai satu proses Next.js: API, websocket, dan koneksi Baileys berjalan di
          service yang sama. Login panel sudah termasuk — cukup set <code className="font-mono">AUTH_PASSWORD</code>.
        </p>
      </div>

      {/* Fitur */}
      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        {features.map((feature) => (
          <Card key={feature.title} className="card-hover p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#25D366]/10">
              <feature.icon className="h-5 w-5 text-[#25D366]" />
            </div>
            <h3 className="mt-3 font-semibold">{feature.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{feature.body}</p>
          </Card>
        ))}
      </section>

      {/* Lokal */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Terminal className="h-4 w-4 text-[#25D366]" /> Jalankan di komputer sendiri
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="space-y-2">
            {localSteps.map((step, index) => (
              <li key={step} className="flex gap-3 text-sm">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#25D366]/25 bg-[#25D366]/10 text-[11px] font-semibold text-[#4ade80]">
                  {index + 1}
                </span>
                <code className="mt-0.5 rounded-lg bg-black/30 px-2 py-1 font-mono text-xs">{step}</code>
              </li>
            ))}
          </ol>
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 text-xs leading-relaxed text-muted-foreground">
            <div className="mb-1 font-medium text-foreground/90">Catatan</div>
            <ul className="list-disc space-y-1 pl-4">
              <li>Butuh Node.js 20 atau lebih baru.</li>
              <li>Data lokal tersimpan di <code className="font-mono">prisma/dev.db</code> dan folder <code className="font-mono">data/</code>.</li>
              <li>Perintah lain: <code className="font-mono">npm test</code> (uji fungsional), <code className="font-mono">npm run build</code>, <code className="font-mono">npm run db:studio</code>.</li>
              <li>Untuk mencoba panel tanpa WhatsApp, tambahkan sesi demo lalu jalankan diagnostik dari kartu sesi.</li>
              <li>Notifikasi push hanya bisa aktif di HTTPS (Railway). Di <code className="font-mono">localhost</code> browser tetap mengizinkan karena dianggap aman.</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Railway */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CloudUpload className="h-4 w-4 text-[#25D366]" /> Deploy ke Railway (langkah demi langkah)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {railwaySteps.map((step) => (
            <div key={step.title} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="text-sm font-medium">{step.title}</div>
              <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{step.body}</p>
            </div>
          ))}

          <div className="flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] p-4 text-xs leading-relaxed text-amber-200">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-medium">Wajib: Volume di /app/data</div>
              Tanpa volume, sesi WhatsApp hilang setiap redeploy dan kamu harus pairing ulang. Volume
              inilah yang menyimpan kredensial Baileys serta media hasil unduhan.
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 text-xs leading-relaxed text-muted-foreground">
            <Database className="mt-0.5 h-4 w-4 shrink-0 text-[#25D366]" />
            <div>
              <div className="font-medium text-foreground/90">Soal database</div>
              SQLite cocok untuk uji lokal. Untuk produksi di Railway, gunakan PostgreSQL dari plugin
              Railway agar data tidak hilang saat container dibuat ulang.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Keamanan */}
      <Card className="mt-6 scroll-mt-6" id="keamanan">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-[#25D366]" /> Mengaktifkan login panel
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed text-muted-foreground">
          <p>
            Panel ini membaca seluruh chat nomor yang ditautkan, jadi <b className="text-foreground">jangan
            pernah dibiarkan terbuka</b> di internet. Cukup set satu variabel:
          </p>
          <ol className="space-y-2">
            {[
              'Railway → service kamu → tab Variables',
              'New Variable → AUTH_PASSWORD = password panjang & unik',
              '(opsional) AUTH_USERNAME = admin',
              '(disarankan) AUTH_SECRET = string acak 32+ karakter',
              'Redeploy — panel langsung meminta login di /login',
            ].map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#25D366]/25 bg-[#25D366]/10 text-[11px] font-semibold text-[#4ade80]">
                  {index + 1}
                </span>
                <span className="pt-0.5 text-xs">{step}</span>
              </li>
            ))}
          </ol>
          <ul className="list-disc space-y-1 pl-4 text-xs">
            <li>Cookie sesi <code className="font-mono">wa_panel_session</code> bersifat HttpOnly, ditandatangani HMAC-SHA256, dan otomatis Secure di HTTPS.</li>
            <li>Middleware melindungi semua halaman, API mengembalikan 401, dan koneksi Socket.io ditolak sebelum login.</li>
            <li>Percobaan login dibatasi 6 kali per 5 menit per IP, lalu diblokir 10 menit.</li>
            <li>Tombol <b>Keluar</b> di sidebar menghapus cookie sesi dan mengembalikanmu ke halaman login.</li>
            <li>Meski begitu, tetap jangan sebarkan alamat panel ke orang yang tidak kamu percaya.</li>
          </ul>
        </CardContent>
      </Card>

      {/* PWA + push */}
      <Card className="mt-6 scroll-mt-6" id="pwa">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BellRing className="h-4 w-4 text-[#25D366]" /> Pasang sebagai aplikasi + notifikasi push
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed text-muted-foreground">
          <p>
            Panel ini sudah ber-PWA: bisa dipasang di layar utama HP atau desktop, dan mengirim
            notifikasi push sungguhan (VAPID) walau aplikasinya sedang ditutup.
          </p>
          <ol className="space-y-2">
            {[
              'Android/Chrome: buka panel → menu ⋮ browser → “Tambahkan ke Layar utama” / “Instal aplikasi”.',
              'iPhone: harus lewat Safari → tombol Bagikan → “Tambahkan ke Layar Utama”, lalu buka panel dari ikon tersebut.',
              'Desktop: ikon pasang di address bar (Chrome/Edge) atau menu browser.',
              'Di dalam panel: sidebar → bagian Notifikasi & PWA → Aktifkan notifikasi push → izinkan saat diminta.',
              'Tekan “Kirim notifikasi percobaan” untuk memastikan notifikasi benar-benar sampai.',
            ].map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#25D366]/25 bg-[#25D366]/10 text-[11px] font-semibold text-[#4ade80]">
                  {index + 1}
                </span>
                <span className="pt-0.5 text-xs">{step}</span>
              </li>
            ))}
          </ol>
          <ul className="list-disc space-y-1 pl-4 text-xs">
            <li>Push hanya dikirim untuk pesan baru (maksimal 2 menit) dan otomatis berhenti kalau salah satu tab panel sedang dibuka.</li>
            <li>Kunci VAPID dibuat otomatis dan disimpan di <code className="font-mono">data/vapid.json</code>. Kalau kamu isi <code className="font-mono">VAPID_PUBLIC_KEY</code> + <code className="font-mono">VAPID_PRIVATE_KEY</code>, langganan lama tetap valid walau volume dibuat ulang.</li>
            <li>Langganan yang sudah mati (404/410 dari layanan push) dibersihkan otomatis.</li>
            <li>Semua notifikasi bisa dimatikan kapan saja dari sidebar.</li>
          </ul>
        </CardContent>
      </Card>

      {/* Variabel environment */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HardDrive className="h-4 w-4 text-[#25D366]" /> Variabel environment
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-xl border border-white/[0.06]">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.03] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Variabel</th>
                  <th className="px-3 py-2 font-medium">Keterangan</th>
                </tr>
              </thead>
              <tbody>
                {envVars.map((item) => (
                  <tr key={item.name} className="border-t border-white/[0.06]">
                    <td className="px-3 py-2 font-mono text-[11px] text-[#4ade80]">{item.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{item.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Pemakaian */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4 text-[#25D366]" /> Cara pakai sehari-hari
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <ul className="list-disc space-y-1.5 pl-4 text-xs">
            <li><b className="text-foreground">Tambah nomor</b> → masukkan nomor format internasional (contoh 62812…).</li>
            <li><b className="text-foreground">Tautkan</b> → klik “Minta Kode Pairing”, lalu di HP: WhatsApp → Perangkat Tertaut → Tautkan dengan nomor telepon → ketik kode.</li>
            <li><b className="text-foreground">Balas chat</b> → buka kartu sesi → “Buka chat” → pilih percakapan (di layar lebar chat terbaru otomatis terbuka).</li>
            <li><b className="text-foreground">Cari pesan</b> → tombol “Cari” atau Ctrl/Cmd + K di halaman chat.</li>
            <li><b className="text-foreground">Ekspor</b> → ikon ⋮ pada header percakapan → Ekspor ke TXT/JSON.</li>
            <li><b className="text-foreground">Notifikasi</b> → aktifkan suara/notifikasi desktop di sidebar; jumlah pesan belum dibaca muncul di judul tab.</li>
            <li><b className="text-foreground">Teruskan pesan</b> → tahan/arahkan ke pesan → ⋮ → Teruskan → pilih chat tujuan (media ikut).</li>
            <li><b className="text-foreground">Kirim lokasi / kontak</b> → ikon ⋮ di kolom tulis pesan.</li>
            <li><b className="text-foreground">Balasan otomatis</b> → halaman <b>Otomatis</b> → New Rule, atau pakai salah satu contoh siap pakai.</li>
            <li><b className="text-foreground">Webhook</b> → halaman <b>Otomatis</b> → kartu Webhook → isi URL + secret → Aktifkan → Kirim tes.</li>
            <li><b className="text-foreground">Analitik &amp; backup</b> → halaman <b>Analitik</b>; tombol unduh backup ada di atas halaman.</li>
            <li><b className="text-foreground">Pasang aplikasi</b> → sidebar → Notifikasi &amp; PWA → Pasang aplikasi / Aktifkan notifikasi push.</li>
            <li><b className="text-foreground">Lepas nomor</b> → kartu sesi → ⋮ → Keluar / lepas perangkat (bisa ditautkan lagi kapan saja).</li>
          </ul>
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 text-xs leading-relaxed">
            <div className="mb-1 font-medium text-foreground/90">Kalau media “sekali lihat” belum muncul</div>
            Panel mengunduh berkasnya segera setelah pesan masuk. Bila WhatsApp belum membagikan berkas,
            bubble menampilkan alasan (misalnya URL kedaluwarsa) dan tombol <b>Coba lagi</b>. Pesan yang
            dikirim berbulan-bulan lalu biasanya sudah tidak bisa diambil ulang — itu batasan WhatsApp,
            bukan bug panel: berkas hanya tersedia selama perangkat pengirim masih menyimpannya.
          </div>
        </CardContent>
      </Card>

      {/* Tanggung jawab */}
      <div className="mt-6 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 text-xs leading-relaxed text-muted-foreground">
        <div className="mb-1 font-medium text-foreground/90">Penggunaan yang bertanggung jawab</div>
        Panel ini untuk nomor milikmu sendiri, nomor bisnis, atau perangkat yang pemiliknya sudah
        memberi izin. Jangan memakainya untuk memata-matai orang lain, mengirim pesan massal, atau
        aktivitas yang melanggar Ketentuan Layanan WhatsApp dan hukum yang berlaku (UU PDP &amp; UU ITE).
        Bukan produk resmi WhatsApp Inc.
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        v{APP_VERSION} · {DEVELOPER_CREDIT} ·{' '}
        <Link href="/" className="hover:text-foreground">
          Kembali ke dasbor
        </Link>
        {DEVELOPER_NAME ? '' : null}
      </p>
    </div>
  )
}
