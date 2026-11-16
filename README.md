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

- `lib/ookla`: lokasi berkas sumber Parquet Ookla mobile dan fixed per kuartal jika data tersebut tersedia. Skrip memilih lima tahun mundur dari periode terbaru yang tersedia, membatasi data ke area sekitar Indonesia (bujur 90–145°, lintang -15–15°), lalu mengagregasikannya ke quadkey level 12 dengan bobot jumlah tes.

Tile peta menyimpan jumlah tes/perangkat dan rata-rata latensi, latensi unduh, serta latensi unggah. Filter minimum tes membantu menyaring tile dengan sampel rendah. Pengguna dapat berganti antara Mobile dan Fixed broadband. Agregasi wilayah analisis masih memakai kotak koordinat perkiraan; batas administratif belum tersedia untuk spatial join. Periode mengikuti arsip lokal Ookla, bukan pengukuran langsung.

## Membangun ulang data turunan

File JSON ringkas yang dipakai dashboard dibuat dari berkas sumber. Skrip membaca setiap Parquet yang diletakkan langsung di `lib/ookla` satu per satu; jangan salin seluruh arsip mentah ke `public`. Pasang Python dan DuckDB, lalu jalankan:

```bash
python -m pip install duckdb
python scripts/prepare-network-data.py
```

Skrip menghasilkan ringkasan periode di `lib/ookla/ookla-periods.json`, analisis historis di `lib/ookla/ookla-analysis.json`, dan satu JSON agregat peta per jenis jaringan/periode di `public/data/ookla`. Data Parquet mentah tidak ikut di-deploy. Untuk membangun ulang seluruh JSON, pulihkan atau letakkan Parquet langsung di `lib/ookla`; jika hanya ingin membuat ulang indeks analisis dan JSON agregat sudah tersedia, jalankan `python scripts/prepare-network-data.py --analysis-only`.
