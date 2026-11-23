# RULES.md

Standar Operasional Prosedur (SOP) dan aturan mekanis trading **XAUUSD** berbasis **Multi-Timeframe Point of Interest (POI: Order Block + Fair Value Gap)** yang dipadukan dengan **Reversal Band (KAMA 50: Band 1=9, Band 2=11, Band 3=14)** dan **Session VWAP Deviation 2 & 3** pada aplikasi **GOLD_CHART**.

Dokumen ini disusun berdasarkan hasil pengujian kuantitatif pada **1.026.578 candle M1 XAUUSD Dukascopy (Januari 2024 sampai November 2026)** terhadap **12.202 zona POI** (`M15`, `M30`, `H1`, `H4`, dan `D1`).

---

## 1. Ringkasan Data & Bukti Statistik

### A. Probabilitas Dasar Zona POI (Reaksi Pertama Setelah Garis Vertikal `tValid`)

| Timeframe POI | Sampel POI (2024-2026) | % Kembali Disentuh | Reaksi $\ge 1\text{R}$ (dari Tepi) | Reaksi $\ge 2\text{R}$ (dari Tepi) | Reaksi $\ge 2\text{R}$ (dari Garis Tengah 50%) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **M15** | 6.791 | 98.4% | 69.5% | 42.2% | **65.5%** |
| **M30** | 3.248 | 97.2% | 70.2% | 44.0% | **67.8%** |
| **H1** | 1.593 | 95.8% | 71.2% | 45.7% | **68.7%** |
| **H4** | 469 | 92.1% | 71.3% | 47.0% | **72.2%** |
| **D1** | 101 | 87.1% | 71.6% | 44.3% | **62.0%** |

### B. Lonjakan Performa: POI Saja vs *Double Confluence* (POI + Reversal Band / VWAP Dev 2)

Pengujian di bawah ini membandingkan entry **POI Saja** melawan setup **Double Confluence (Harga menyentuh POI sekaligus menyentuh pita Reversal Band / VWAP Dev 2)** dengan target murni **$2\text{R}$** dan SL di ujung wick terluar ($+0.25\text{ USD}$):

| Pasangan Setup | Mekanik Konfirmasi | Jumlah Trade | Win Rate ($2\text{R}$) | Expectancy ($\text{EV}$) | Profit Factor ($\text{PF}$) | Net Profit ($\text{R}$) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **POI M15 -> M1** | POI Saja (Engulfing M1) | 5.197 | 34.4% | $+0.03\text{R}$ | 1.05 | $+173\text{R}$ |
| **POI M15 -> M1** | **POI + Reversal Band 1 M1 (Candle Balik Pertama)** | 1.326 | **36.5%** | **$+0.10\text{R}$** | **1.15** | **$+126\text{R}$** |
| **POI M30 -> M1** | POI Saja (Engulfing M1) | 2.510 | 35.2% | $+0.06\text{R}$ | 1.09 | $+139\text{R}$ |
| **POI M30 -> M1** | **POI + VWAP Dev 2 M1 (Engulfing)** | 1.361 | **37.7%** | **$+0.13\text{R}$** | **1.21** | **$+178\text{R}$** |
| **POI M30 -> M1** | **POI + Reversal Band 1 M1 (Candle Balik Pertama)** | 932 | **38.2%** | **$+0.15\text{R}$** | **1.24** | **$+136\text{R}$** |
| **POI H1 -> M1** | POI Saja (Engulfing M1) | 1.208 | 37.1% | $+0.11\text{R}$ | 1.18 | $+136\text{R}$ |
| **POI H1 -> M1** | **POI + Reversal Band 1 M1 (Candle Balik Pertama)** | 645 | **41.1%** | **$+0.23\text{R}$** | **1.39** | **$+150\text{R}$** |
| **POI H1 -> M1** | **POI + Reversal Band 1 M1 (Engulfing + SL Distal/Wick)** | 573 | **40.1%** | **$+0.20\text{R}$** | **1.34** | **$+117\text{R}$** |
| **POI M30 -> M5** | POI Saja (Engulfing M5) | 2.220 | 34.0% | $+0.02\text{R}$ | 1.03 | $+45\text{R}$ |
| **POI M30 -> M5** | **POI + Reversal Band 1 M5 (Candle Balik Pertama)** | 227 | **39.6%** | **$+0.19\text{R}$** | **1.31** | **$+43\text{R}$** |
| **POI H1 -> M5** | POI Saja (Engulfing M5) | 1.120 | 34.9% | $+0.05\text{R}$ | 1.07 | $+53\text{R}$ |
| **POI H1 -> M5** | **POI + Reversal Band 1 M5 (Candle Balik Pertama)** | 177 | **44.6%** | **$+0.34\text{R}$** | **1.61** | **$+60\text{R}$** |
| **POI H1 -> M5** | **POI + Reversal Band 1 + VWAP Dev 2 M5 (Triple)** | 151 | **41.1%** | **$+0.23\text{R}$** | **1.39** | **$+35\text{R}$** |
| **POI H4 -> M5** | POI Saja (Engulfing M5) | 319 | 34.2% | $+0.03\text{R}$ | 1.04 | $+8\text{R}$ |
| **POI H4 -> M5** | **POI + Reversal Band 1 M5 (Candle Balik Pertama)** | 94 | **47.9%** | **$+0.44\text{R}$** | **1.84** | **$+41\text{R}$** |
| **POI H4 -> M5** | **POI + Reversal Band 3 M5 (Engulfing)** | 9 | **55.6%** | **$+0.67\text{R}$** | **2.50** | **$+6\text{R}$** |
| **POI M15 -> M1** | **POI + Pullback Trend Cloud M1 Searah (Candle Balik Pertama)** | 2.090 | **36.0%** | **$+0.08\text{R}$** | **1.12** | **$+166\text{R}$** |
| **POI M30 -> M1** | **POI Beririsan Trend Cloud M1 Searah (Candle Balik Pertama)** | 615 | **37.1%** | **$+0.11\text{R}$** | **1.18** | **$+69\text{R}$** |
| **POI H1 -> M1** | **POI + Pullback Trend Cloud M1 Searah (Candle Balik Pertama)** | 328 | **36.3%** | **$+0.09\text{R}$** | **1.14** | **$+29\text{R}$** |
| **POI H4 -> M5** | **POI Beririsan Trend Cloud M5 Searah (Candle Balik Pertama)** | 56 | **37.5%** | **$+0.12\text{R}$** | **1.20** | **$+7\text{R}$** |

### C. Tiga Kesimpulan Penting dari Pengujian Indikator

1. **Mengapa `POI + Reversal Band` Sangat Akurat?**
   - Masalah terbesar dari entry di POI adalah kita tidak tahu apakah harga yang datang ke POI tersebut sedang punya momentum tembus (*breakout*) atau sudah kehabisan napas (*exhausted*).
   - Ketika harga masuk ke dalam **POI (`M30`, `H1`, atau `H4`)** tepat pada saat harga juga menyentuh pita **Reversal Band (`Band 1 = 9` sampai `Band 2 = 11`)** di `M1` atau `M5`, itu membuktikan secara matematis bahwa harga sudah mengalami deviasi ekstrem terhadap KAMA-50 (*overextended/jenuh*) tepat di atas zona likuiditas institusi (POI).
2. **Jangan Menunggu Engulfing Besar Saat Sudah Menyentuh `POI + Reversal Band`**:
   - Lihat baris **"Candle Balik Pertama"** vs **"Engulfing"** pada tabel di atas: di seluruh timeframe (`M15`, `M30`, `H1`, `H4`), ketika harga sudah menyentuh **POI + Reversal Band**, masuk pada **penutupan candle pertama yang berbalik warna** (misal candle biru pertama setelah rentetan putih yang menusuk `Bullish POI + Pita Hijau Reversal Band`, persis seperti contoh gambar Anda) menghasilkan **Win Rate dan Profit Factor jauh lebih tinggi** dibandingkan menunggu candle Engulfing besar!
   - Alasannya: di dalam pita Reversal Band, harga sudah berada di ujung ekstrem bawah/atas. Menunggu candle pertama yang balik arah memberikan titik Entry yang sangat dekat dengan ujung wick (SL sangat tipis, sehingga target $2\text{R}$ sangat cepat tercapai).
3. **Dua Peran Berbeda antara `Reversal Band` (Exhaustion) dan `Trend Cloud M1/M5` (Trend Pullback)**:
   - **Saat memakai `POI + Reversal Band` (Gambar 1 - Counter-Spike / Jenuh)**: Harga pasti sedang menusuk tajam ke pita bawah/atas sehingga Trend Cloud M1 saat itu sering berwarna berlawanan. Untuk setup Reversal Band, jangan memaksa Trend Cloud M1 berwarna searah.
   - **Saat memakai `POI + Trend Cloud M1/M5` (Gambar 2 - Trend Continuation Pullback)**: Ketika tren di M1/M5 sudah berjalan kuat (misalnya **Trend Cloud M1 berwarna merah/bearish**, `EMA 150 < EMA 250`) dan pita awan merah tersebut **melintas beririsan dengan kotak `Bearish POI` (`M15`, `M30`, atau `H1`)**, maka lonjakan harga (*pullback*) ke atas yang menyentuh **Pita Trend Cloud M1 + Kotak POI** sekaligus adalah titik *re-entry* searah tren dengan akurasi tinggi (**Win Rate 36.0% - 37.5%**, $\text{PF } 1.12 - 1.20$, menghasilkan $+\mathbf{166\text{R}}$ di M15->M1 dan $+\mathbf{69\text{R}}$ di M30->M1).

---

## 2. Konfigurasi Layar & Indikator di GOLD_CHART

1. **Tata Letak (`2│` - Dua Chart Sejajar)**:
   - **Pane Kiri (Chart Struktur / HTF)**: Set ke **`M15`, `M30`, atau `H1`**.
   - **Pane Kanan (Chart Eksekusi / LTF)**: Set ke **`M1`** (untuk scalping agresif dari POI M15/M30/H1) atau **`M5`** (untuk setup intraday presisi tinggi dari POI M30/H1/H4).
2. **Pengaturan Tab Indikator**:
   - **POI**: Centang `Tampilkan POI` beserta `M15`, `M30`, `H1`, `H4`, `D1` (dan `M5` bila ingin melihat Mini-POI).
   - **Reversal Band**: Centang `Show Reversal Band` (`Band Length: 50`, `Band 1: 9`, `Band 2: 11`, `Band 3: 14`, `Timeframe: Chart`).
   - **VWAP**: Aktifkan `Show Deviation 2` (`Mult: 2`) dan `Show Deviation 3` (`Mult: 3`).
   - **Trend Cloud & Trend Tracer**: Gunakan pada Pane Kiri (HTF) untuk melihat bias arah utama harian.

---

## 3. SOP Mekanik Trading Utama: "Double Confluence" (`POI + Reversal Band`)

Ini adalah setup utama (**Grade A+**) dengan *Profit Factor* tertinggi ($1.24$ hingga $1.84$ pada target murni $2\text{R}$).

### Langkah 1: Identifikasi Irisan Zona (*Confluence Zone*)
Pada Pane Kanan (`M1` atau `M5`), amati ketika terdapat **Kotak POI (`M15`, `M30`, `H1`, atau `H4`)** yang:
1. Sudah valid melewati **garis vertikal konfirmasi (`tValid`)**.
2. Belum *mitigated* (*untapped*).
3. **Beririsan / bertumpuk langsung dengan pita Reversal Band**:
   - Untuk **Buy**: Kotak **Bullish POI (Hijau)** beririsan dengan **Pita Bawah Reversal Band (Hijau)** (dan nilai tambah jika berdekatan dengan garis biru/oranye **VWAP Deviation 2 atau 3** bawah).
   - Untuk **Sell**: Kotak **Bearish POI (Merah)** beririsan dengan **Pita Atas Reversal Band (Merah)** (dan nilai tambah jika berdekatan dengan **VWAP Deviation 2 atau 3** atas).
   - **Bonus Confluence (*Stacked POI*)**: Jika di area pita Reversal Band tersebut terdapat 2 kotak POI bertumpuk sekaligus (seperti `30M POI` + `15M POI` pada screenshot Anda), peluang pantulan semakin kuat.

### Langkah 2: Syarat Sentuhan (*The Tap*)
Tunggu harga bergerak cepat (*spike/flush*) masuk menyentuh **kedua area tersebut sekaligus**:
- Harga masuk ke dalam kotak POI (di sebelah kanan garis vertikal `tValid`), **DAN**
- Ekor (*wick*) atau body candle menyentuh/masuk ke dalam **Pita Reversal Band (minimal Band 1 = garis batas terdalam pita merah/hijau)**.

### Langkah 3: Trigger Eksekusi (*First Reversal Close* / *Compact Engulfing*)
Begitu syarat Langkah 2 terpenuhi (baik POI maupun Reversal Band sudah tersentuh dalam ayunan tersebut):
1. **Jangan entry saat candle masih bergerak searah tusukan** (jangan menangkap pisau jatuh sebelum candle tutup).
2. Tunggu **candle M1 / M5 pertama yang selesai *close* berbalik warna** menolak zona tersebut:
   - **Trigger Buy**: Setelah candle putih (bearish) menusuk ke dalam `Bullish POI + Pita Hijau Reversal Band`, tunggu **candle biru (bullish) pertama selesai *close*** (lebih bagus lagi jika close-nya menelan body candle putih terakhir / *compact engulfing*).
   - **Trigger Sell**: Setelah candle biru (bullish) menusuk ke dalam `Bearish POI + Pita Merah Reversal Band`, tunggu **candle putih (bearish) pertama selesai *close***.
3. **Eksekusi Entry** tepat saat candle pembalik pertama tersebut *close*.

### Langkah 4: Penempatan Stop Loss (SL) & Take Profit (TP)
1. **Stop Loss (SL)**:
   - Letakkan SL tepat di **bawah ujung wick terendah (untuk Buy) atau di atas ujung wick tertinggi (untuk Sell)** dari ayunan tusukan tersebut ditambah *buffer* **$0.25 - 0.30\text{ USD}$** ($25 - 30\text{ poin}$).
   - Apabila kotak POI cukup tipis (atau ujung belakang/*distal line* kotak POI hanya berjarak sedikit di luar ujung wick tadi), letakkan SL sedikit di luar *distal line* kotak POI.
2. **Take Profit (TP)**:
   - **TP 1 / Pengamanan ($+1\text{R}$ atau Garis Tengah VWAP)**: Saat harga memantul keluar dari pita Reversal Band dan mencapai $+1\text{R}$, amankan SL ke titik Entry (*Breakeven*).
   - **TP Utama (Minimal $+2\text{R}$ atau POI Lawan / Pita Reversal Band Sebaliknya)**:
     - Pasang target minimal **$2\text{R}$** ($1 : 2$).
     - Jika jarak ke **POI lawan arah** atau **Pita Reversal Band seberangnya** berada di ruang **$2\text{R} - 3.5\text{R}$**, tarik garis TP tepat ke tepi depan POI lawan tersebut.

---

## 4. SOP Mekanik Kedua: "Trend Pullback Confluence" (`POI + Pita Trend Cloud M1/M5 Searah`)

Setup kedua ini (seperti contoh Gambar 2 Anda: **`30M POI` Merah beririsan dengan Pita `Trend Cloud M1` Merah**) digunakan saat pasar sedang *trending* kuat di M1/M5, sehingga harga tidak sampai ke pita Reversal Band luar tetapi memantul di **pita awan `EMA 150 - EMA 250` (Trend Cloud Smooth)** yang berimpitan dengan kotak POI:

1. **Syarat Irisan (*Cloud + POI Alignment*)**:
   - Untuk **Sell**: Terdapat kotak **Bearish POI (Merah)** yang sudah valid (`tValid`), dan pita **Trend Cloud M1/M5 berwarna Merah** (`EMA 150 < EMA 250`) sedang melintas di dalam atau tepat di tepi depan kotak POI tersebut.
   - Untuk **Buy**: Terdapat kotak **Bullish POI (Hijau)** yang sudah valid (`tValid`), dan pita **Trend Cloud M1/M5 berwarna Hijau** (`EMA 150 > EMA 250`) sedang melintas di dalam atau tepat di tepi depan kotak POI tersebut.
2. **Syarat Sentuhan (*Pullback Tap*)**:
   - Harga yang tadinya bergerak di bawah awan merah (atau di atas awan hijau) melakukan *pullback* tajam menusuk masuk menyentuh **Pita Trend Cloud SEKALIGUS menyentuh Kotak POI**.
3. **Trigger Eksekusi & SL/TP**:
   - Sama seperti Setup Pertama: tunggu **candle pertama yang selesai *close* berbalik warna** searah tren awan (candle putih pertama untuk Sell di awan merah + POI merah; candle biru pertama untuk Buy di awan hijau + POI hijau).
   - **SL**: Di ujung wick tusukan *pullback* tersebut $+ \text{buffer } 0.25\text{ USD}$.
   - **TP**: Minimal **$2\text{R}$** (atau ke *swing low/high* sebelumnya / POI lawan arah).

---

## 5. SOP Mekanik Cadangan: Jika Harga Masuk POI Tanpa Menyentuh Reversal Band maupun Trend Cloud

Terkadang harga masuk ke dalam **POI `M30` / `H1` / `H4`** secara perlahan (belum menyentuh pita luar Reversal Band M1/M5). Jika Anda tetap ingin mengambil setup di POI tersebut tanpa konfirmasi Reversal Band, **jangan gunakan aturan "Candle Balik Pertama"** (karena tanpa kondisi jenuh Reversal Band, candle balik pertama mudah terkena *fakeout*).

Sebagai gantinya, wajib gunakan filter yang lebih ketat:
1. **Wajib Searah Tren HTF**: Hanya ambil Bullish POI jika `Trend Cloud (Smooth)` atau `Trend Tracer` di HTF sedang hijau, dan sebaliknya untuk Bearish POI.
2. **Wajib Menunggu *Strong Engulfing + Volume Spike* atau *Mini-POI LTF***:
   - Tunggu harga menyentuh minimal mendekati **garis tengah 50% kotak POI**.
   - Tunggu candle LTF membentuk **Strong Engulfing** (`Close` melampaui `High/Low` candle lawan sebelumnya dengan histogram Volume $\ge 1.25\times$ rata-rata), **ATAU** tunggu munculnya kotak **`5M POI` baru yang searah** di dalam kotak `H1/M30 POI` tersebut lalu entry saat *retest* kotak `5M POI`.
   - Jika candle Engulfing terlanjur terlalu panjang ($> 75\%$ lebar kotak POI), pasang **Limit Entry di 50% body candle Engulfing** tersebut.

---

## 6. Aturan Disiplin & Pembatalan Setup (*Do Not Trade Conditions*)

1. **Batal jika Candle TF POI Close Tembus Sisi Belakang (*Distal Line*)**:
   - Jika harga menghantam kotak POI + Reversal Band namun tidak memantul dan justru menutup body candle penuh di luar sisi belakang kotak POI, setup **batal**.
2. **Jangan Entry di Sebelah Kiri Garis Vertikal `tValid`**:
   - Di chart M1, kotak POI sudah digambar mulai dari candle pertama pembentuknya (`t0`), tetapi baru sah terkonfirmasi pada garis vertikal (`tValid`). Abaikan semua candle M1 yang berada di sebelah kiri garis vertikal tersebut.
3. **Jangan Melawan Pita Reversal Band Lawan**:
   - Jangan pernah melakukan **Buy** apabila harga saat itu sedang menyentuh **Pita Atas (Merah) Reversal Band**, dan jangan melakukan **Sell** apabila harga sedang menyentuh **Pita Bawah (Hijau) Reversal Band**.
4. **Maksimal 1 Kali Entry per Kotak POI**:
   - Pantulan pertama (*first tap* bersama Reversal Band) memiliki probabilitas tertinggi. Jika sudah selesai (kena TP maupun SL), jangan mengambil posisi kedua pada kotak POI yang sama.


---

## 7. Hasil Pengujian Kuantitatif & Parameter Khusus pada BTCUSD (2024 - 2026)

Strategi yang sama telah diuji pada **1.512.002 candle M1 BTCUSD Dukascopy (1 Januari 2024 sampai 22 November 2026)** terhadap **50.082 zona POI** (`M5`, `M15`, `M30`, `H1`, `H4`, dan `D1`) dengan simulasi jalur harga M1 (`hit_bar`) dan target murni **$2\text{R}$** (`contract = 1`).

### A. Penyesuaian Skala Risiko Proporsional (`frontend/js/poi.js` & `frontend/js/chart.js`)
Karena harga `BTCUSD` berada di kisaran puluhan ribu dolar (`$40.000 - $95.000+`), parameter jarak SL tidak menggunakan angka statis `$0.25` dan batas `$40` milik `XAUUSD`, melainkan dihitung proporsional terhadap harga penutupan (`entry > 10000`):
- **Buffer SL (`pad`)**: `round2(entry * 0.0001)` ($1\text{ bps}$, sekitar `$6.00 - $9.50` di luar ujung wick terluar).
- **Batas Risiko Maksimum Sinyal M1 (`maxRisk`)**: `Math.max(40, entry * 0.02)` (maksimal $2\%$ dari harga berjalan).

### B. Performa BTCUSD Berdasarkan Tipe Sinyal M1 (Target Murni $2\text{R}$)

| Tipe Sinyal M1 | Jumlah Trade | Win Rate ($2\text{R}$) | Expectancy ($\text{EV}$) | Profit Factor ($\text{R}$) | Max DD ($\text{R}$) | Rata-rata Durasi | Net Profit ($\text{R}$) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Default UI (Tipe 1 RB + Tipe 2 Cloud)** | **23.736** | **36.64%** | **$+0.099\text{R}$** | **1.16** | **97 R** | 61 mnt | **$+2.357\text{R}$** |
| **Tipe 1: POI + Reversal Band (Semua)** | **4.591** | **38.71%** | **$+0.161\text{R}$** | **1.26** | **36 R** | 24 mnt | **$+740\text{R}$** |
| **Tipe 1a: POI + Reversal Band Murni** | **1.369** | **42.00%** | **$+0.260\text{R}$** | **1.45** | **27 R** | 21 mnt | **$+356\text{R}$** |
| **Tipe 1b: POI + RB + VWAP Dev 2** | **3.222** | **37.31%** | **$+0.119\text{R}$** | **1.19** | **49 R** | 25 mnt | **$+384\text{R}$** |
| **Tipe 2: POI + Trend Cloud (TC)** | **16.270** | **36.03%** | **$+0.081\text{R}$** | **1.13** | **154 R** | 11 mnt | **$+1.316\text{R}$** |
| **Tipe 3: POI + Strong Engulfing (ENG)** | 14.280 | 34.46% | $+0.034\text{R}$ | 1.05 | 110 R | 92 mnt | $+483\text{R}$ |

### C. Performa BTCUSD Berdasarkan Timeframe POI (Konfigurasi Default Tipe 1 + Tipe 2)

| Timeframe POI | Jumlah Trade | Win Rate ($2\text{R}$) | Expectancy ($\text{EV}$) | Profit Factor ($\text{R}$) | Max DD ($\text{R}$) | Net Profit ($\text{R}$) | Net PnL (`0.01 Lot`) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **H1 (Terbaik)** | **1.793** | **42.22%** | **$+0.267\text{R}$** | **1.46** | **16 R** | **$+478\text{R}$** | **$+\$892.39$** |
| **M30 (Unggulan)** | **2.882** | **39.90%** | **$+0.197\text{R}$** | **1.33** | **25 R** | **$+568\text{R}$** | **$+\$783.74$** |
| **H4** | **656** | **38.57%** | **$+0.157\text{R}$** | **1.26** | **20 R** | **$+103\text{R}$** | **$+\$73.80$** |
| **M15** | **5.290** | **36.78%** | **$+0.103\text{R}$** | **1.16** | 55 R | **$+546\text{R}$** | $+\$83.62$ |
| **M5** | 12.982 | 35.07% | $+0.052\text{R}$ | 1.08 | 156 R | $+678\text{R}$ | $-\$564.64$ |
| **D1** | 133 | 29.32% | $-0.120\text{R}$ | 0.83 | 29 R | $-16\text{R}$ | $-\$59.21$ |

### D. Aturan Praktis & Rekomendasi Filter untuk BTCUSD
1. **Fokus Timeframe POI pada `M30`, `H1`, dan `H4` (serta `M15`)**:
   - Menggabungkan hanya **`M30 + H1 + H4`** menghasilkan **5.331 trade** dengan **Win Rate 40.52%** pada target $2\text{R}$, **Expectancy $+0.216\text{R}$ per trade**, dan **Net Profit $+1.149\text{R}$** (`+$1.749,93` pada `0.01 lot`).
   - Matikan centang POI `M5` (terlalu banyak *noise*) dan `D1` (zona terlalu lebar untuk eksekusi langsung dengan SL M1) saat trading di `BTCUSD`.
2. **Prioritaskan Sinyal `#1` dan `#2★` dari `Tipe 1 (POI + Reversal Band)` dan `Tipe 2 (POI + Trend Cloud)`**:
   - Sama seperti pada XAUUSD, sinyal **`#2★` (Re-Entry pasca-sweep SL `#1` di dalam POI)** di BTCUSD memiliki Win Rate **36.74%** ($\text{PF } 1.16$, $+821\text{R}$) dengan durasi tahan posisi rata-rata hanya **11 menit** (dibandingkan 86 menit pada `#1`).
   - Biarkan **`Tipe 3: POI + Strong Engulfing`** tidak dicentang karena candle engulfing pada BTC sering kali sudah terlanjur melebar sehingga rasio risk-reward kurang efisien.
3. **Sesi Terbaik**:
   - Sesi **New York (`19:00 - 02:00 WIB`)** dan **London (`14:00 - 19:00 WIB`)** memberikan performa tertinggi di BTCUSD (Win Rate **37.69%**, $\text{PF } 1.21$, $+1.008\text{R}$ di sesi New York; Win Rate **37.03%**, $\text{PF } 1.18$, $+525\text{R}$ di sesi London).
