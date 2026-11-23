# AGENTS.md

Panduan teknis dan aturan kerja untuk agen coding pada proyek **GOLD_CHART** (XAUUSD & BTCUSD Dukascopy Replay & Live Charting).

## 1. Struktur Proyek & Arsitektur

- `backend/main.py`: Server HTTP FastAPI (`127.0.0.1:8792`) yang mengelola multi-instrumen (`SUPPORTED_SYMBOLS = ["XAUUSD", "BTCUSD"]` melalui dictionary `STORES`), melakukan bootstrap paralel di thread latar belakang saat startup, menyediakan endpoint `/api/symbols`, `/api/meta`, `/api/times`, `/api/candles`, `/api/resolve`, `/api/refresh` (seluruhnya menerima parameter `symbol`, default `XAUUSD`), dan menyajikan file statis dari `frontend/`.
- `backend/store.py`: Penyimpanan SQLite per simbol (`data/xauusd_dukascopy.db` sejak `2023-01-01` dan `data/btcusd_dukascopy.db` sejak `2024-01-01`, mode `WAL`). Menyimpan candle dasar di tabel `m1` dan mengagregasi timeframe `M5`, `M15`, `M30`, `H1`, `H4`, dan `D1` ke tabel `bar`. Menyediakan simulasi penyelesaian posisi (`resolve_positions` dan `hit_bar`) berbasis jalur harga M1.
- `backend/dukascopy.py`: Wrapper Python yang memanggil `scripts/dukascopy_fetch.mjs` melalui Node.js untuk mengambil data historis per kuartal secara paralel (`ThreadPoolExecutor(max_workers=4)`) maupun pembaruan live. Menyimpan konfigurasi spesifikasi instrumen di `SYMBOLS` (`XAUUSD`: `contract=100, digits=3, tickSize=0.001`; `BTCUSD`: `contract=1, digits=2, tickSize=0.1`) dan menjaga volume pecahan kripto agar minimal bernilai `1` saat `vol > 0`.
- `scripts/dukascopy_fetch.mjs`: Skrip ESM Node.js berbasis `dukascopy-node` (`bid` price) yang menerima argumen instrumen (`xauusd` atau `btcusd`). Mengunduh candle M1 dan menambal candle M1 yang sedang berjalan (*forming bar*) dari 1.500 tick bid terbaru (`patchFormingM1`).
- `frontend/index.html` & `frontend/styles.css`: Struktur antarmuka satu halaman (dropdown pemilih simbol `#symbolSelect` untuk `XAUUSD` / `BTCUSD`, multi-pane grid 1, 2H, 2V, 4, toolbar replay, toolrail gambar di kiri, dan panel Jurnal/Indikator di kanan).
- `frontend/js/app.js`: State aplikasi (`state.symbol`, `state.drawingsBySymbol`), fungsi pergantian simbol `switchSymbol()` dengan isolasi gambar/jurnal per simbol dan cache HTF/POI berprefiks `${state.symbol}:${tf}`, sinkronisasi data M1 dan HTF, loop live 5 detik (`softLiveSync`), kontrol replay, form indikator, dan jurnal posisi.
- `frontend/js/chart.js`: Mesin render HTML5 Canvas 2D untuk candle, volume, sumbu harga/waktu, crosshair sinkron, alat gambar interaktif (`trend`, `hline`, `vline`, `rect`, `long`, `short`, `vp`), perhitungan PnL berbasis `this.contract` dinamis, `defaultRisk()` yang skalabel terhadap harga instrumen, serta overlay indikator dan POI.
- `frontend/js/indicators.js`: Implementasi JavaScript dari indikator TradingView Pine Script (Trend Tracer EMA, Trend Cloud EMA/HMA/Supertrend, Reversal Band KAMA, dan Session VWAP beserta pita deviasi).
- `frontend/js/poi.js`: Deteksi zona Point of Interest (POI) berbasis cluster 1 sampai 3 candle lawan arah yang diikuti ekspansi displacement (`>= min ATR` atau close menembus cluster) dan Fair Value Gap (FVG), pelacakan mitigasi wick kumulatif, waktu konfirmasi candle ke-3 (`tValid`), pemfilteran berbasis area layar (*viewport*), serta deteksi sinyal M1 (`detectPoiSignals` untuk `#1` dan `#2★`) dengan buffer SL (`pad`) dan batas risiko (`maxRisk`) yang proporsional terhadap skala harga instrumen (`XAUUSD` maupun `BTCUSD`).
- `frontend/js/profile.js`: Perhitungan Fixed Range Volume Profile (POC, VAH, VAL) dengan pembobotan body dan wick.
- `frontend/js/series.js`: Utilitas zona waktu (`WIB` / `UTC`), pemotongan candle saat replay (`seriesUntil`, `partialFromM1`), perhitungan PnL/R-multiple (`pnlUsd` dengan parameter `contract`), dan manajemen jendela memori M1 (`TimeBook`).

## 2. Aturan Kualitas UI & Kode (Filter Antislop)

1. Setiap perubahan pada tampilan UI, teks, interaksi, atau komentar kode wajib melewati filter `antislop` (lihat skill `antislop` beserta `antislop-ui`, `antislop-human`, `antislop-layoutmobile`, `antislop-copywriting`, dan `antislop-code`).
2. Rasio kontras teks terhadap latar belakang harus memenuhi minimum WCAG AA (4.5:1 untuk teks normal, 3:1 untuk teks besar dan batas komponen interaktif). Gunakan `--up-text` (`#5b8cff`) untuk teks positif di atas latar gelap `#0f0f0f`/`#0e131a`, bukan warna body candle `--up` (`#1848cc`).
3. Jangan menulis karakter em dash di dalam teks UI atau dokumentasi. Gunakan tanda koma, titik, titik dua, atau tanda kurung.
4. Setiap kontrol interaktif di HTML/CSS wajib memiliki perilaku nyata, `cursor: pointer`, label yang dapat diakses (`aria-label` untuk tombol ikon), dan indikator `:focus-visible` untuk navigasi keyboard.
5. Jangan pernah melakukan commit file database lokal (`data/*.db`, `data/*.db-wal`, `data/*.db-shm`), folder `download/`, atau file log (`logs/`) ke repositori Git.

## 3. Aturan Modifikasi Logika Chart & Data

- **Anti-Repaint POI & Replay**: Sebuah POI hanya boleh dinyatakan valid dan ditampilkan setelah candle ke-3 FVG (`after`) benar-benar close (`!after.partial` dan waktu chart mencapai `tValid = after.t + tfSec`). Jangan membocorkan data masa depan (`t > state.cursor`) saat mode replay aktif.
- **Isolasi Multi-Simbol (`XAUUSD` & `BTCUSD`)**:
  - Jangan menggunakan angka *hardcoded* khusus skala harga emas (seperti batas risiko statis `$40` atau contract size statis `100`) tanpa memperhitungkan skala harga instrumen lain seperti `BTCUSD` (`$60.000+`, `contract = 1`).
  - Saat berpindah simbol di `switchSymbol()`, wajib menyimpan `drawings` simbol lama ke `state.drawingsBySymbol`, mengosongkan `book` dan cache HTF/POI/Volume Profile, serta mereset skala harga (`autoScale = true`, `priceView = null`) di seluruh pane.
- **Sinkronisasi Live M1**: Pada `softLiveSync()`, jangan memanggil `book.setTimes()` yang menghapus seluruh cache `book.map`. Gunakan `book.mergeRows()` dan biarkan `syncM1()` mengambil slice terbaru dari `book.slice(firstT, asof)` agar candle yang baru close maupun candle yang sedang berjalan selalu terbarui tanpa perlu refresh halaman.
- **Thread-Safety SQLite**: Setiap pembacaan atau penulisan pada `Store.conn` dan `Store.times` di `backend/store.py` maupun `backend/main.py` yang dapat diakses lintas thread harus dilindungi dengan `with self.lock:` (atau `with db.lock:`).

## 4. Pengujian & Verifikasi

Sebelum menyelesaikan tugas atau melakukan commit, jalankan kedua pengujian berikut dari direktori akar proyek:

```powershell
node tests/series.test.mjs
.\.venv\Scripts\pytest.exe tests/test_store.py
```

Pastikan seluruh unit test JavaScript dan Python lulus tanpa error.
