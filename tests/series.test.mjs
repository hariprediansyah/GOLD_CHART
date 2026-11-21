import { buildProfile } from '../frontend/js/profile.js'
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

console.log('uji js ok')
