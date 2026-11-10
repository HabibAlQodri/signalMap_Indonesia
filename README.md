# SinyalNusa | Eksplorasi Kualitas dan Cakupan Jaringan

Peta layar penuh untuk eksplorasi performa jaringan mobile Ookla, cakupan teknologi per kabupaten/kota, dan alokasi pita frekuensi di Indonesia.

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

- `lib/ookla_indonesia_mobile.parquet`: pengukuran Ookla mobile kuartal 1 2026. Data asli berisi 237.566 sel. Peta memakai sel quadkey level 12 dengan agregasi berbobot jumlah tes; angka ringkasan juga ditimbang menurut jumlah tes.
- `lib/data-coverage-jaringan-telekomunikasi.xlsx`: persentase 2G, 3G, 4G, dan 5G untuk 515 kabupaten/kota. Tahun/periode dan metode pembobotan tidak tercantum di lembar sumber; dashboard menyebut rata-rata sederhana antarwilayah, bukan cakupan berbobot penduduk.
- `lib/data-frekuensi-mobile-broadband-per-2023.xlsx`: pita frekuensi radio, lebar pita, dan pemegang IPFR untuk 2023. Data ini tidak menunjukkan performa aktual operator.

Peta menyediakan pilihan metrik unduh/unggah/latensi, tiga gaya peta dasar, pencarian wilayah, fokus lokasi perangkat, serta panel layer, ringkasan data, daftar cakupan, dan frekuensi. Data cakupan dan frekuensi tidak dipadankan ke sel Ookla karena sumber tidak menyediakan batas geografis maupun pengenal wilayah bersama.

## Membangun ulang data turunan

File JSON yang dipakai dashboard dibuat dari berkas sumber di `lib`. Jika berkas sumber berubah, pasang Python dan DuckDB lalu jalankan:

```bash
python -m pip install duckdb
python scripts/prepare-network-data.py
```

Skrip menghasilkan `lib/coverage-data.json`, `lib/frequency-data.json`, `lib/ookla-summary.json`, dan `public/data/ookla-mobile-tiles.json`.
