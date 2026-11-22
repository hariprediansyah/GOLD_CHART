import { buildProfile } from '../frontend/js/profile.js'
import { detectPois, detectPoiSignals, preparePoisForChart } from '../frontend/js/poi.js'
import { TimeBook, partialFromM1, pnlUsd, rMultiple, seriesUntil } from '../frontend/js/series.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'gagal')
}

const bars = [
  { t: 0, o: 1, h: 1, l: 1, c: 1, v: 1 },
  { t: 300, o: 1, h: 1, l: 1, c: 1, v: 1 },
]
assert(seriesUntil(bars, 300, 180).length === 0, 'M5 belum selesai di menit ke-4')
assert(seriesUntil(bars, 300, 240).length === 1, 'M5 selesai di menit terakhir ember')
assert(seriesUntil(bars, 300, 300)[0].t === 0, 'ember berikut belum ikut')

const m1 = [
  { t: 0, o: 10, h: 12, l: 9, c: 11, v: 2 },
  { t: 60, o: 11, h: 13, l: 10, c: 12, v: 3 },
]
const part = partialFromM1(m1, 300, 60)
assert(part && part.partial && part.o === 10 && part.c === 12 && part.h === 13 && part.l === 9 && part.v === 5, 'partial')
assert(partialFromM1(m1, 300, 240) === null, 'tidak partial bila bar sudah utuh')

const book = new TimeBook()
book.times = Uint32Array.from([0, 60, 120, 300])
assert(book.step(120, 1, 60) === 300, 'langkah melewati akhir pekan')
assert(book.step(300, -1, 60) === 120, 'mundur melewati celah')
assert(book.step(0, 1, 300) === 300, 'langkah H lebih besar meloncat ke bar berikutnya')
book.cover(0, 100)
assert(JSON.stringify(book.gaps(50, 150)) === '[[101,150]]', 'gap kanan')
assert(book.gaps(0, 50).length === 0, 'sudah tertutup')
book.cover(90, 200)
assert(book.covers(0, 200), 'gabungan interval')

assert(pnlUsd('long', 100, 101, 0.01, 100) === 1, 'usd long')
assert(pnlUsd('short', 100, 99, 0.01, 100) === 1, 'usd short')
assert(rMultiple('long', 100, 110, 95) === 2, 'R')

const heavy = []
for (let i = 0; i < 8; i++) heavy.push({ t: i, o: 100, h: 100.4, l: 99.6, c: 100, v: 1 })
heavy.push({ t: 9, o: 100, h: 100.05, l: 99.95, c: 100, v: 50 })
const profile = buildProfile(heavy, { targetRows: 24, vaPercent: 70 })
assert(profile && profile.pocPrice > 99.9 && profile.pocPrice < 100.15, 'POC di volume terbesar')
assert(profile.vah >= profile.val, 'VAH di atas VAL')

// Uji mergeRows mempertahankan cache lama sekaligus menambah timestamp baru
const liveBook = new TimeBook()
liveBook.setTimes(Uint32Array.from([60, 120]))
liveBook.mergeRows([
  { t: 60, o: 1, h: 2, l: 1, c: 1.5, v: 10 },
  { t: 120, o: 1.5, h: 2.2, l: 1.4, c: 2.0, v: 12, partial: true },
])
assert(liveBook.slice(60, 120)[1].partial === true, 'bar 120 awalnya partial')
liveBook.forgetFrom(120)
liveBook.mergeRows([
  { t: 120, o: 1.5, h: 2.5, l: 1.2, c: 2.3, v: 30 },
  { t: 180, o: 2.3, h: 2.4, l: 2.2, c: 2.35, v: 5, partial: true },
])
const updated = liveBook.slice(60, 180)
assert(updated.length === 3, 'timestamp 180 otomatis masuk ke times tanpa mereset bar 60')
assert(updated[0].c === 1.5, 'cache bar 60 tetap utuh')
assert(updated[1].h === 2.5 && !updated[1].partial, 'bar 120 terupdate penuh dan tidak lagi partial')
assert(updated[2].t === 180 && updated[2].partial === true, 'bar 180 forming')

// Uji viewport filter POI: POI jauh di belakang yang belum mitigated tetap lewat di viewport
const samplePois = [
  { tf: 'H1', t0: 1000, hi: 2510, lo: 2500, tapped: false, tappedT: null },
  { tf: 'H1', t0: 1200, hi: 2550, lo: 2540, tapped: true, tappedT: 1800 },
  { tf: 'H1', t0: 2000, hi: 2600, lo: 2590, tapped: true, tappedT: 2600 },
]
const viewPois = preparePoisForChart(samplePois, 5000, {
  untappedOnly: false,
  viewStart: 2200,
  viewEnd: 3000,
})
assert(viewPois.length === 2, 'POI untapped dari t0=1000 dan POI mitigated di t1=2600 harus masuk viewport [2200, 3000]')
assert(viewPois[0].t0 === 1000 && viewPois[0].t1 === 5000, 'POI lama dari t0=1000 tetap melintasi viewport')
assert(viewPois[1].t0 === 2000 && viewPois[1].t1 === 2600, 'POI mitigated di dalam viewport ikut tampil')

// Uji anti-repaint POI: candle ke-2 setelah POI (candle after / ke-3 FVG) wajib sudah close (!partial)
const baseCandles = []
for (let i = 0; i < 16; i++) {
  baseCandles.push({ t: i * 900, o: 100, h: 101, l: 99, c: 99.5 })
}
// Candle ke-16: Bullish (calon POI bearish, lo=100, hi=102)
baseCandles.push({ t: 16 * 900, o: 100, h: 102, l: 100, c: 101.8 })
// Candle ke-17: Impuls turun (ekspansi bearish, close=96 < lo=100)
baseCandles.push({ t: 17 * 900, o: 101.8, h: 102.2, l: 95.5, c: 96.0 })

// Jika baru 1 candle setelah bullish (hanya candle impuls), belum ada POI
assert(detectPois(baseCandles, { tf: 'M15' }).length === 0, '1 candle setelah POI belum boleh muncul')

// Jika candle ke-2 setelah bullish masih berjalan (partial: true), belum boleh muncul
const withFormingAfter = baseCandles.concat([{ t: 18 * 900, o: 96.0, h: 98.0, l: 94.0, c: 95.0, partial: true }])
assert(detectPois(withFormingAfter, { tf: 'M15' }).length === 0, 'candle ke-2 masih partial belum boleh muncul POI')

// Jika candle ke-2 setelah bullish sudah close (partial: false/undefined) dan FVG valid (h=98 < lo=100), baru muncul POI
const withClosedAfter = baseCandles.concat([{ t: 18 * 900, o: 96.0, h: 98.0, l: 94.0, c: 95.0 }])
const validPois = detectPois(withClosedAfter, { tf: 'M15' })
assert(validPois.length === 1 && validPois[0].side === -1, 'setelah 2 candle close dan FVG valid baru muncul POI')
assert(validPois[0].tValid === 19 * 900 - 60, 'tValid tepat di menit close candle ke-3 (akhir 4/9: 14, 29, 44, 59)')
assert(
  preparePoisForChart(validPois, 19 * 900 - 120, { viewStart: 0, viewEnd: 20 * 900 }).length === 0,
  'sebelum menit close candle ke-3 (tValid), POI belum ditampilkan di chart M1',
)
assert(
  preparePoisForChart(validPois, 19 * 900 - 60, { viewStart: 0, viewEnd: 20 * 900 }).length === 1,
  'tepat saat menit terakhir candle ke-3 selesai (tValid), POI tampil beserta garis vertikal tValid',
)

// Uji State-Based Anti-Spam Signals (#1 dan #2★ pasca-sweep SL di dalam POI + Reversal Band)
const m1Candles = [
  { t: 1000, o: 2012, h: 2013, l: 2011, c: 2011.5, v: 10 },
  { t: 1060, o: 2011.5, h: 2012, l: 2010, c: 2010.2, v: 12 },
  // Masuk Bullish POI [2000, 2008] + menyentuh RB lower1 (2007)
  { t: 1120, o: 2010.2, h: 2010.5, l: 2006.0, c: 2006.5, v: 20 },
  // Candle balik arah pertama -> BUY #1 (entry=2007.5, sl=2006.0-0.25=2005.75, risk=1.75, tp=2011.0)
  { t: 1180, o: 2006.5, h: 2007.8, l: 2006.2, c: 2007.5, v: 25 },
  // Masih floating di dalam POI (tidak boleh spam sinyal walaupun candle bolak-balik)
  { t: 1240, o: 2007.5, h: 2008.0, l: 2006.8, c: 2007.0, v: 15 },
  { t: 1300, o: 2007.0, h: 2008.2, l: 2006.9, c: 2007.8, v: 15 },
  // Tersapu turun kena SL #1 (l=2004.0 <= 2005.75), tetapi masih di dalam Bullish POI [2000, 2008]!
  { t: 1360, o: 2007.8, h: 2007.9, l: 2004.0, c: 2004.5, v: 30 },
  // Candle balik arah kedua pasca-sweep -> harus muncul BUY #2★!
  { t: 1420, o: 2004.5, h: 2006.0, l: 2004.2, c: 2005.8, v: 28 },
]
const mockInd = {
  settings: { cloudStyle: 'Smooth' },
  lower1: new Float64Array(m1Candles.length).fill(2007.0),
  upper1: new Float64Array(m1Candles.length).fill(2030.0),
  vwapL2: new Float64Array(m1Candles.length).fill(1990.0),
  vwapU2: new Float64Array(m1Candles.length).fill(2040.0),
  ema150: new Float64Array(m1Candles.length).fill(2015.0),
  ema250: new Float64Array(m1Candles.length).fill(2020.0),
}
const mockPois = [
  { tf: 'M30', side: 1, t0: 500, tValid: 1000, hi: 2008.0, lo: 2000.0, tapped: false, tappedT: null },
]
const sigs = detectPoiSignals(
  m1Candles,
  mockInd,
  mockPois,
  { showSignals: true, sigTypeRb: true, sigTypeCloud: true, sigTypePure: false },
  2000,
)
assert(sigs.length === 2, 'harus muncul tepat 2 sinyal (#1 dan #2★ tanpa spam saat floating)')
assert(sigs[0].t === 1180 && sigs[0].attempt === 1 && sigs[0].label === 'BUY #1 · 30M+RB', 'sinyal pertama BUY #1')
assert(sigs[1].t === 1420 && sigs[1].attempt === 2 && sigs[1].label === 'BUY #2★ · 30M+RB', 'sinyal kedua BUY #2★ pasca-sweep')

console.log('uji js ok')
