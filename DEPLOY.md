# 🚀 Piccolo Corner — Panduan Deploy (Gratis, 45 Menit)

Platform: **Supabase** (database gratis) + **Vercel** (hosting gratis)
Tidak perlu kartu kredit. Tidak perlu server sendiri.

---

## LANGKAH 1 — Buat Database di Supabase (15 menit)

1. Buka https://supabase.com → klik **Start your project**
2. Daftar/login dengan akun GitHub atau email
3. Klik **New project** → isi:
   - Project name: `piccolo-corner`
   - Database password: buat password kuat (simpan!)
   - Region: **Southeast Asia (Singapore)**
4. Tunggu ~2 menit sampai project siap
5. Buka menu **SQL Editor** (ikon database di sidebar kiri)
6. Klik **New query**
7. Copy-paste semua SQL dari file `src/lib/supabase.js`
   (bagian di dalam blok komentar `/* ... */`)
8. Klik **Run** → tunggu sampai muncul "Success"
9. Buka **Settings → API** → catat dua nilai:
   - `Project URL` → ini adalah `VITE_SUPABASE_URL`
   - `anon public` key → ini adalah `VITE_SUPABASE_ANON_KEY`
10. (Opsional) Buka **Storage** → buat bucket baru bernama `documents`
    → set ke **Public** agar dokumen sakit bisa diakses

---

## LANGKAH 2 — Upload Kode ke GitHub (10 menit)

1. Buka https://github.com → login / daftar
2. Klik **New repository** → nama: `piccolo-corner-attendance`
   → pilih **Private** → klik **Create repository**
3. Download/install **GitHub Desktop** (https://desktop.github.com)
   atau gunakan terminal:

```bash
cd piccolo-corner
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/USERNAME/piccolo-corner-attendance.git
git push -u origin main
```

---

## LANGKAH 3 — Deploy ke Vercel (10 menit)

1. Buka https://vercel.com → login dengan akun GitHub
2. Klik **Add New Project** → pilih repo `piccolo-corner-attendance`
3. Di bagian **Environment Variables**, tambahkan:
   - `VITE_SUPABASE_URL` = URL dari Supabase (langkah 1.9)
   - `VITE_SUPABASE_ANON_KEY` = anon key dari Supabase (langkah 1.9)
4. Klik **Deploy** → tunggu ~3 menit
5. Selesai! Vercel akan memberi URL seperti:
   `https://piccolo-corner-attendance.vercel.app`

---

## LANGKAH 4 — Test & Onboarding Karyawan (10 menit)

### Login sebagai Owner:
- Buka URL dari Vercel
- HP: `08000000000`
- PIN: `000000`
- Anda akan masuk ke Owner Dashboard

### Ubah PIN Owner:
- Di Owner Dashboard → tab **Pengaturan**
- Atur koordinat GPS cafe Anda (bisa cek di Google Maps)

### Tambah karyawan:
- Tab **Karyawan** → **+ Tambah**
- Isi nama, jabatan, nomor HP, PIN, dan hak cuti

### Bagikan ke karyawan:
Kirim pesan WhatsApp ke karyawan:
```
Halo! Mulai besok absensi Piccolo Corner pakai sistem baru.

Buka link ini di HP: [URL Vercel Anda]
Nomor HP: [nomor HP karyawan]
PIN: [PIN yang Anda set]

Simpan sebagai shortcut:
- Android: Chrome → menu ⋮ → "Add to Home screen"
- iPhone: Safari → tombol Share → "Add to Home Screen"
```

---

## AKSES

| Siapa | URL | Login |
|-------|-----|-------|
| Karyawan | URL/absen | Nomor HP + PIN |
| Owner | URL/owner | Nomor HP + PIN (is_owner=true) |

---

## BIAYA BULANAN

| Layanan | Biaya |
|---------|-------|
| Supabase (Free tier) | Gratis — 500MB DB, 1GB storage |
| Vercel (Hobby tier) | Gratis — unlimited deployments |
| Domain | Gratis (pakai URL Vercel) |
| **Total** | **Rp 0 / bulan** |

Supabase Free tier cukup untuk cafe dengan hingga ~50 karyawan
dan 2 tahun data absensi.

---

## PERTANYAAN UMUM

**Q: Apakah data aman?**
A: Ya. Supabase menggunakan enkripsi AES-256, server di Singapore.

**Q: Bagaimana jika internet mati di cafe?**
A: GPS dan facial recognition butuh internet. Tapi karyawan bisa
   catat Sakit/Cuti/CTB secara offline dan sync saat online kembali
   (fitur ini bisa ditambahkan di versi berikutnya).

**Q: Bisa upgrade ke native app nanti?**
A: Ya, database dan semua data tetap sama. Cukup tambah
   React Native app yang connect ke Supabase yang sama.

**Q: Bagaimana update koordinat GPS cafe?**
A: Owner Dashboard → Pengaturan → ubah cafe_lat dan cafe_lng.
   Koordinat bisa dicek di Google Maps (klik kanan → "What's here?").
