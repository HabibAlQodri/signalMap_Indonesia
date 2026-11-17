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

- `lib/boundries/indonesia-adm*.geojson`: tiga batas administratif geoBoundaries yang dipakai aplikasi (ADM0, ADM1, ADM2). Berkas ini diletakkan di root `lib/boundries` agar folder dataset lain dapat dihapus. Layer batas dimuat sesuai tingkat yang dipilih; geoBoundaries berlisensi CC BY 4.0, dengan atribusi sumber ADM0/ADM1 OpenStreetMap/Wambacher (ODbL 1.0) dan ADM2 BPS/WFP/OCHA (CC BY 3.0 IGO). Berkas untuk ekspor statis disalin otomatis ke `public/boundaries` saat menjalankan dev atau build.
- `lib/ookla`: lokasi berkas sumber Parquet Ookla mobile dan fixed per kuartal jika data tersebut tersedia. Skrip memilih lima tahun mundur dari periode terbaru yang tersedia, membatasi data ke area sekitar Indonesia (bujur 90–145°, lintang -15–15°), lalu mengagregasikannya ke quadkey level 12 dengan bobot jumlah tes.

Tile peta menyimpan jumlah tes/perangkat dan rata-rata latensi, latensi unduh, serta latensi unggah. Titik, ringkasan, dan ekspor sel peta dibatasi ke dalam batas Indonesia; filter minimum tes membantu menyaring tile dengan sampel rendah. Pengguna dapat berganti antara Mobile dan Fixed broadband. Batas administratif tersedia sebagai overlay peta, tetapi belum dipakai untuk spatial join: analisis historis Ookla masih menggunakan kotak koordinat perkiraan. Periode mengikuti arsip lokal Ookla, bukan pengukuran langsung.

## Membangun ulang data turunan

File JSON ringkas yang dipakai dashboard dibuat dari berkas sumber. Skrip membaca setiap Parquet yang diletakkan langsung di `lib/ookla` satu per satu; jangan salin seluruh arsip mentah ke `public`. Pasang Python dan DuckDB, lalu jalankan:

```bash
python -m pip install duckdb
python scripts/prepare-network-data.py
```

Skrip menghasilkan ringkasan periode di `lib/ookla/ookla-periods.json`, analisis historis di `lib/ookla/ookla-analysis.json`, dan satu JSON agregat peta per jenis jaringan/periode di `public/data/ookla`. Data Parquet mentah tidak ikut di-deploy. Untuk membangun ulang seluruh JSON, pulihkan atau letakkan Parquet langsung di `lib/ookla`; jika hanya ingin membuat ulang indeks analisis dan JSON agregat sudah tersedia, jalankan `python scripts/prepare-network-data.py --analysis-only`.
