# GOLD_CHART (XAUUSD & BTCUSD Dukascopy Replay & Live)

Aplikasi web lokal untuk analisis chart **XAUUSD (Emas)** dan **BTCUSD (Bitcoin)** menggunakan data historis dan live feed dari **Dukascopy (bid)**. Dibangun agar trader dapat menggeser chart maupun melakukan *bar replay* jauh ke masa lalu pada timeframe M1 tanpa batas kuota bar, lengkap dengan deteksi multi-timeframe **Point of Interest (POI / OB + FVG)**, sinyal masuk otomatis di M1 (`#1` dan `#2★`), serta simulasi jurnal posisi terpisah untuk masing-masing simbol.

## Fitur Utama

- **Dukungan Multi-Simbol (`XAUUSD` & `BTCUSD`)**:
  - Pemilih simbol instan di bagian header (`XAUUSD` dan `BTCUSD`).
  - Gambar (*drawings*) dan posisi jurnal disimpan secara terpisah per simbol (`drawingsBySymbol`), lengkap dengan spesifikasi kontrak masing-masing (`contract = 100` untuk XAUUSD dan `contract = 1` untuk BTCUSD).
- **Data Historis M1 Penuh & Mode Live**:
  - Mengunduh dan menyimpan data M1 Dukascopy ke database SQLite lokal terpisah (`data/xauusd_dukascopy.db` sejak `2023-01-01` dan `data/btcusd_dukascopy.db` sejak `2024-01-01`).
  - Mengagregasi timeframe `M5`, `M15`, `M30`, `H1`, `H4`, dan `D1` secara otomatis dari data M1.
  - Pembaruan *live* setiap 5 detik, dilengkapi *tick patching* (`patchFormingM1`) untuk membentuk candle M1 menit berjalan beserta penghitung waktu mundur (*countdown*) penutupan candle.
- **Multi-Pane Layout & Sinkronisasi**:
  - Pilihan tata letak `1`, `2│` (dua sejajar), `2─` (dua bertumpuk), dan `4` chart sekaligus.
  - Crosshair tersinkronisasi lintas timeframe dan fitur Magnet OHLC (`Mati`, `Lemah`, `Kuat`).
- **Bar Replay Presisi M1**:
  - Mulai replay dari candle mana pun (`Pilih awal`), loncat ke tanggal dan jam tertentu (`Loncat`), atau melangkah maju/mundur per `M1`, `M5`, `M15`, `M30`, `H1`, `H4`, hingga `D1`.
  - Candle pada timeframe besar (`M5` ke atas) dibentuk secara progresif menit demi menit (`partialFromM1`) tanpa membocorkan harga masa depan.
- **Indikator Built-in & Multi-Timeframe POI**:
  - **POI (OB + FVG)**: Deteksi zona 1 sampai 3 candle lawan arah yang diikuti ekspansi displacement dan Fair Value Gap pada timeframe `M5`, `M15`, `M30`, `H1`, `H4`, dan `D1` (masing-masing dapat diaktifkan/dinonaktifkan).
  - **Garis Konfirmasi Validasi POI (`tValid`)**: Garis vertikal di dalam kotak POI yang menandai batas waktu penutupan candle ke-3 FVG, sehingga memudahkan identifikasi pantulan (*retest*) yang valid saat dilihat dari timeframe kecil (`M1` / `M5`).
  - **Sinyal BUY / SELL M1 (`#1` dan `#2★`)**: Deteksi otomatis pada chart M1 saat harga menyentuh POI bersama Reversal Band (`Tipe 1`), Trend Cloud (`Tipe 2`), atau Strong Engulfing (`Tipe 3`), termasuk peluang re-entry `#2★` apabila percobaan `#1` terkena sweep SL di dalam zona POI. Klik label sinyal pada chart untuk langsung memasang posisi 2R.
  - **Filter POI Berbasis Viewport**: Menampilkan seluruh POI historis yang melintasi area layar saat Anda menggeser chart ke masa lalu, termasuk POI lama yang belum *mitigated*.
  - **Indikator Tren & Volatilitas**: Trend Tracer (EMA), Trend Cloud (`Smooth`, `Scalping`, `Scalping+`, `Swing` dengan dukungan MTF), Reversal Band berbasis KAMA (3 pita deviasi dengan dukungan MTF), dan Session VWAP beserta pita deviasi 2 dan 3.
- **Alat Gambar & Jurnal Simulasi Posisi**:
  - Alat gambar global: Garis tren (*Trendline*, tahan `Shift` untuk garis horizontal), Garis horizontal (`H-Line`), Garis vertikal (`V-Line`), Kotak (`Rect`), Posisi `Buy` (`Long`), Posisi `Sell` (`Short`), dan *Fixed Range Volume Profile* (`VP`: POC, VAH, VAL).
  - Posisi `Buy` dan `Sell` diselesaikan secara otomatis oleh backend (`resolve_positions`) berdasarkan pergerakan M1, lengkap dengan perhitungan Realisasi USD, Mengambang USD, Win Rate, dan rata-rata R-multiple di tab **Jurnal**.

## Prasyarat Sistem

1. **Python 3.10+** (beserta `venv` / `pip`)
2. **Node.js 18+** (diperlukan untuk menjalankan `dukascopy-node` pada `scripts/dukascopy_fetch.mjs`)

## Cara Menjalankan

### 1. Menggunakan `start_server.bat` (Windows)
Klik dua kali atau jalankan dari terminal:
```bat
start_server.bat
```
Skrip ini akan memeriksa keberadaan Node.js, menginstal `dukascopy-node` bila belum ada, lalu menjalankan server FastAPI di `http://127.0.0.1:8792`.

### 2. Menjalankan Secara Manual
```powershell
# 1. Buat virtual environment Python dan instal dependensi
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt

# 2. Instal dependensi Node.js (dukascopy-node)
npm install

# 3. Jalankan server
.\.venv\Scripts\python.exe backend\main.py
```
Buka browser dan akses `http://127.0.0.1:8792`.

> **Catatan Saat Pertama Kali Dijalankan**: Apabila file `data/xauusd_dukascopy.db` atau `data/btcusd_dukascopy.db` belum ada, server akan mengunduh riwayat M1 dari Dukascopy secara paralel di latar belakang dan menggabungkan seluruh timeframe secara otomatis. Proses inisialisasi pertama membutuhkan waktu beberapa menit, sedangkan pemakaian berikutnya langsung memuat cache lokal.

## Pintasan Keyboard (Shortcuts)

| Tombol | Fungsi |
| :--- | :--- |
| `Spasi` | Putar / Jeda (*Play / Pause*) mode Replay |
| `Panah Kanan` / `Panah Kiri` | Maju / Mundur satu langkah waktu saat Replay |
| `Shift` (saat menggambar garis tren) | Kunci garis tren agar lurus horizontal |
| `Delete` / `Backspace` | Hapus objek gambar atau posisi terpilih |
| `Ctrl + Z` | Batalkan (*Undo*) perubahan gambar terakhir |
| `Escape` | Batalkan mode gambar aktif dan kembali ke Kursor |
| `Double Click` pada area chart | Reset zoom dan kembali ke candle terakhir |

## Variabel Lingkungan (Opsional)

- `GOLD_HOST`: Alamat bind server (default: `127.0.0.1`)
- `GOLD_PORT`: Port HTTP server (default: `8792`)
- `GOLD_LIVE_SEC`: Interval sinkronisasi live Dukascopy dalam detik (default: `5`)
- `GOLD_NODE`: Path executable Node.js (default: `node`)

## Menjalankan Pengujian (Unit Tests)

```powershell
# Uji modul seri waktu, Volume Profile, dan filter POI (JavaScript)
node tests/series.test.mjs

# Uji agregasi OHLC dan penyelesaian TP/SL posisi (Python)
.\.venv\Scripts\pytest.exe tests/test_store.py
```
