# SinyalNusa | Eksplorasi Kualitas Jaringan

Peta layar penuh untuk eksplorasi performa jaringan mobile dan fixed broadband Ookla di Indonesia dan sekitarnya.

## Menjalankan aplikasi

```bash
npm install
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000).

Basemap vector CARTO Voyager memerlukan `NEXT_PUBLIC_CARTO_KEY`. Salin `.env.example` sebagai `.env.local`, masukkan API key CARTO, lalu jalankan ulang aplikasi. Key ini digunakan oleh browser untuk meminta style/tiles; batasi key pada domain aplikasi dari pengaturan CARTO.

## Deploy ke Cloudflare Pages

Project menggunakan static export Next.js. Atur Cloudflare Pages dengan:

- **Build command:** `npm run build`
- **Build output directory:** `out`
- **Environment variable:** `NEXT_PUBLIC_CARTO_KEY` dengan API key CARTO yang dibatasi ke domain deploy

Jangan gunakan `next start` untuk deployment Cloudflare Pages static.

## Data yang digunakan

- `lib/data_ookla`: sumber Parquet Ookla mobile dan fixed per kuartal. Skrip memilih lima tahun mundur dari periode terbaru yang tersedia; berkas saat ini mencakup 2021-10 sampai 2026-07 (20 kuartal, karena periode 2021-07 tidak tersedia). Data dibatasi ke area sekitar Indonesia (bujur 90–145°, lintang -15–15°), lalu diagregasi ke quadkey level 12 dengan bobot jumlah tes. Peta memuat hanya satu jenis jaringan dan satu periode yang dipilih.

Peta berfokus pada tren performa Ookla mobile/fixed dalam grafik garis atau volume tes dan tabel tahunan/kuartalan. Statistik tren dan ringkasan dapat diekspor sebagai CSV, PNG, JPG, atau PDF; tabel analisis juga dapat diekspor dalam keempat format tersebut. Sel agregat pada peta dapat diekspor sebagai CSV. Filter wilayah analisis memakai kotak koordinat perkiraan (bukan batas administrasi); periode mengikuti arsip lokal Ookla, bukan pengukuran langsung.

## Membangun ulang data turunan

File JSON yang dipakai dashboard dibuat dari berkas sumber di `lib`. Letakkan berkas Ookla bernama `YYYY-MM-DD_performance_mobile_tiles.parquet` dan `YYYY-MM-DD_performance_fixed_tiles.parquet` di `lib/data_ookla`, lalu pasang Python dan DuckDB dan jalankan:

```bash
python -m pip install duckdb
python scripts/prepare-network-data.py
```

Skrip menghasilkan ringkasan periode di `lib/ookla-periods.json`, analisis historis di `lib/ookla-analysis.json`, dan satu JSON agregat peta per jenis jaringan/periode di `public/data/ookla`. Data Parquet mentah tidak ikut di-deploy. Jika Parquet sudah dipindahkan tetapi semua JSON agregat masih tersedia, indeks analisis dapat dibuat ulang dengan `python scripts/prepare-network-data.py --analysis-only`.
