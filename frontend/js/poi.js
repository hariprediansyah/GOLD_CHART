/**
 * Deteksi zona POI (mirip OB + FVG).
 *
 * Bullish: 1–3 candle bearish, lalu ekspansi bullish (boleh ada 0–2 candle
 * searah di antaranya). Ekspansi = body >= min ATR, atau close menembus
 * cluster. Valid jika high cluster < low candle setelah ekspansi (FVG)
 * dan zona belum full mitigated (wick/high-low menutup 100%).
 * Bearish: mirror. Zona termasuk wick candle yang di-skip sebelum ekspansi.
 */

export const DEFAULT_POI = {
  showPoi: true,
  poiM5: true,
  poiM15: true,
  poiM30: true,
  poiH1: true,
  poiH4: true,
  poiD1: true,
  poiMaxOpp: 3,
  poiMaxSameDir: 2,
  poiMinExpansionAtr: 1.0,
  poiAtrLen: 14,
  /** false = tampilkan juga mitigated, ujung kanan terpotong di candle penutup. */
  poiUntappedOnly: false,
  /** Batas overlay per TF (untapped diprioritaskan). */
  poiMaxPerTf: 8,
  poiMaxDistAtr: 10,
}

const TF_LABEL = { M5: '5M', M15: '15M', M30: '30M', H1: 'H1', H4: 'H4', D1: 'D1' }
const TF_SEC = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 }

function atrSeries(candles, len) {
  const n = candles.length
  const tr = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const h = candles[i].h
    const l = candles[i].l
    if (i === 0) {
      tr[i] = h - l
      continue
    }
    const pc = candles[i - 1].c
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))
  }
  const out = new Float64Array(n).fill(NaN)
  if (n < len) return out
  let sum = 0
  for (let i = 0; i < len; i++) sum += tr[i]
  out[len - 1] = sum / len
  for (let i = len; i < n; i++) {
    out[i] = (out[i - 1] * (len - 1) + tr[i]) / len
  }
  return out
}

function isBull(c) {
  return c.c > c.o
}

function isBear(c) {
  return c.c < c.o
}

function body(c) {
  return Math.abs(c.c - c.o)
}

function zoneIntersects(c, hi, lo) {
  return c.l <= hi && c.h >= lo
}

function wickTopBot(c) {
  return { top: c.h, bot: c.l }
}

function zoneFullyMitigatedByWick(c, hi, lo) {
  return c.l <= lo && c.h >= hi
}

function subtractRangeFromSegments(segments, bot, top, eps) {
  if (!(top > bot + eps)) return segments
  const out = []
  for (const [a, b] of segments) {
    if (top <= a + eps || bot >= b - eps) {
      out.push([a, b])
      continue
    }
    if (bot > a + eps) out.push([a, Math.min(bot, b)])
    if (top < b - eps) out.push([Math.max(top, a), b])
  }
  return out.filter(([a, b]) => b - a > eps)
}

/** Mitigasi wick kumulatif / satu wick menutup zona 100% / close tembus distal. */
function findWickMitigation(candles, fromI, hi, lo, side) {
  const eps = Math.max(1e-8, (hi - lo) * 1e-9)
  let unfilled = [[lo, hi]]
  let tappedAt = null
  let tappedT = null
  let touchedAt = null
  let touchedT = null
  for (let t = fromI; t < candles.length; t++) {
    const c = candles[t]
    if (touchedAt == null && zoneIntersects(c, hi, lo)) {
      touchedAt = t
      touchedT = c.t
    }
    const { top, bot } = wickTopBot(c)
    const ob = Math.max(bot, lo)
    const ot = Math.min(top, hi)
    if (ot > ob + eps) {
      unfilled = subtractRangeFromSegments(unfilled, ob, ot, eps)
    }
    const closedThrough = side === 1 ? c.c < lo - eps : c.c > hi + eps
    if (unfilled.length === 0 || closedThrough || zoneFullyMitigatedByWick(c, hi, lo)) {
      tappedAt = t
      tappedT = c.t
      break
    }
  }
  return { tappedAt, tappedT, touchedAt, touchedT, untapped: tappedAt == null }
}

/**
 * @param {Array<{t:number,o:number,h:number,l:number,c:number}>} candles
 * @param {object} opts
 * @returns {Array<object>}
 */
export function detectPois(candles, opts = {}) {
  const maxOpp = Math.max(1, Math.min(3, opts.maxOpp ?? 3))
  const maxSame = Math.max(0, opts.maxSameDir ?? 2)
  const minExp = Math.max(0.1, opts.minExpansionAtr ?? 1.0)
  const atrLen = Math.max(2, opts.atrLen ?? 14)
  const tf = opts.tf || ''
  const label = opts.label || TF_LABEL[tf] || tf || 'POI'
  const n = candles.length
  if (n < atrLen + 5) return []

  const atr = atrSeries(candles, atrLen)
  const out = []
  let i = atrLen

  while (i < n - 2) {
    let found = null

    for (let oppLen = maxOpp; oppLen >= 1 && !found; oppLen--) {
      const start = i
      const end = i + oppLen - 1
      if (end >= n - 2) continue

      let allBear = true
      let allBull = true
      let hi = -Infinity
      let lo = Infinity
      for (let j = start; j <= end; j++) {
        const c = candles[j]
        if (!isBear(c)) allBear = false
        if (!isBull(c)) allBull = false
        if (c.h > hi) hi = c.h
        if (c.l < lo) lo = c.l
      }
      if (!allBear && !allBull) continue

      // Cari ekspansi setelah 0..maxSame candle searah (bukan ekspansi dulu).
      // Ekspansi = body >= min ATR, ATAU close menembus high/low cluster
      // (ATR sering membengkak karena spike, padahal FVG tetap valid).
      let k = end + 1
      let skipped = 0
      while (k < n - 1 && skipped <= maxSame) {
        const c = candles[k]
        const a = atr[k]
        if (!Number.isFinite(a) || a <= 0) {
          k += 1
          continue
        }
        const sized = body(c) >= minExp * a
        const bullExp = isBull(c) && (sized || (allBear && c.c > hi))
        const bearExp = isBear(c) && (sized || (allBull && c.c < lo))

        if (allBear && bullExp) break
        if (allBull && bearExp) break

        if (allBear && isBull(c) && skipped < maxSame) {
          skipped += 1
          k += 1
          continue
        }
        if (allBull && isBear(c) && skipped < maxSame) {
          skipped += 1
          k += 1
          continue
        }
        // candle netral / lawan arah lagi → batalkan jalur ini
        k = -1
        break
      }
      if (k < 0 || k >= n - 1) continue

      const exp = candles[k]
      const a = atr[k]
      if (!Number.isFinite(a) || a <= 0) continue

      const side = allBear ? 1 : -1
      const sized = body(exp) >= minExp * a
      const isExp =
        side === 1
          ? isBull(exp) && (sized || exp.c > hi)
          : isBear(exp) && (sized || exp.c < lo)
      if (!isExp) continue

      // Zona ikut wick candle yang di-skip sebelum ekspansi (swing high/low).
      for (let j = end + 1; j < k; j++) {
        if (candles[j].h > hi) hi = candles[j].h
        if (candles[j].l < lo) lo = candles[j].l
      }

      const after = candles[k + 1]
      // Candle setelah ekspansi (candle ke-3 FVG) wajib sudah close agar POI valid (anti-repaint).
      if (after.partial) continue
      const pre = candles[k - 1] // candle tepat sebelum ekspansi
      // FVG klasik (candle sebelum ekspansi vs candle setelah ekspansi)
      // + high/low zona lawan tren harus TERHUBUNG ke FVG itu
      //   bullish: poi.hi >= high[pre] dan high[pre] < low[after]
      //   (kalau pre = candle zona, FVG menempel di atas zona;
      //    kalau pre bullish lebih tinggi dari zona → FVG mengambang, ditolak)
      if (side === 1) {
        if (!(pre.h < after.l)) continue
        if (!(hi >= pre.h)) continue
        if (!(hi < after.l)) continue
      } else {
        if (!(pre.l > after.h)) continue
        if (!(lo <= pre.l)) continue
        if (!(lo > after.h)) continue
      }

      // Displacement: close ekspansi melewati sisi cluster
      if (side === 1 && !(exp.c > hi)) continue
      if (side === -1 && !(exp.c < lo)) continue

      const mit = findWickMitigation(candles, k + 2, hi, lo, side)
      const tfSec = opts.tfSec || TF_SEC[tf] || (after.t > exp.t ? after.t - exp.t : 900)

      found = {
        side,
        tf,
        label: `${label} POI`,
        t0: candles[start].t,
        tOppEnd: candles[end].t,
        tExp: exp.t,
        tAfter: after.t,
        tValid: after.t + tfSec - 60,
        hi,
        lo,
        mid: (hi + lo) / 2,
        oppStart: start,
        oppEnd: end,
        expI: k,
        afterI: k + 1,
        tapped: mit.tappedAt != null,
        tappedAt: mit.tappedAt,
        tappedT: mit.tappedT,
        untapped: mit.untapped,
        touched: mit.touchedAt != null,
        touchedAt: mit.touchedAt,
        touchedT: mit.touchedT,
      }
    }

    if (found) {
      out.push(found)
      i = found.expI + 1
    } else {
      i += 1
    }
  }

  return out
}

function distToPrice(p, price) {
  if (!Number.isFinite(price)) return Infinity
  if (price >= p.lo && price <= p.hi) return 0
  if (price > p.hi) return price - p.hi
  return p.lo - price
}

/**
 * Filter + set t1 untuk overlay chart.
 * - Untapped: kotak sampai ujung chart (chartEndT)
 * - Mitigated: tetap tampil, t1 = waktu candle yang menutup (terpotong)
 * - Jika viewStart / viewEnd diberikan, tampilkan semua POI yang bentang [t0, t1]-nya
 *   melintasi viewport (termasuk POI yang lahir jauh di kiri tetapi belum mitigated saat memasuki layar).
 */
export function preparePoisForChart(pois, chartEndT, opts = {}) {
  const untappedOnly = opts.untappedOnly === true
  const viewStart = Number.isFinite(opts.viewStart) ? opts.viewStart : -Infinity
  const viewEnd = Number.isFinite(opts.viewEnd) ? opts.viewEnd : Infinity
  const maxPerTf = opts.maxPerTf
  const maxDistAtr = opts.maxDistAtr
  const refPrice = opts.refPrice
  const atr = opts.atr
  const maxDist =
    Number.isFinite(atr) && atr > 0 && Number.isFinite(maxDistAtr) && maxDistAtr > 0
      ? maxDistAtr * atr
      : Infinity

  const byTf = new Map()
  for (const p of pois) {
    if (untappedOnly && p.tapped) continue
    // POI baru valid dan muncul setelah candle ke-3 (after) close penuh di menit tValid (akhir 4/9)
    if (p.tValid != null && chartEndT < p.tValid) continue
    // Mitigated: potong di candle penutup; untapped: lanjut ke asof chart
    const t1 = p.tapped && p.tappedT != null ? p.tappedT : chartEndT
    if (t1 < p.t0) continue
    // Perpotongan interval [p.t0, t1] dengan [viewStart, viewEnd]
    if (p.t0 > viewEnd || t1 < viewStart) continue
    const d = Number.isFinite(refPrice) ? distToPrice(p, refPrice) : 0
    if (d > maxDist) continue
    const key = p.tf || '_'
    if (!byTf.has(key)) byTf.set(key, [])
    byTf.get(key).push({ ...p, t1, _dist: d })
  }

  const list = []
  for (const arr of byTf.values()) {
    arr.sort((a, b) => a.t0 - b.t0)
    const sliced = Number.isFinite(maxPerTf) && maxPerTf > 0 ? arr.slice(-maxPerTf) : arr
    for (const p of sliced) {
      const { _dist, ...rest } = p
      list.push(rest)
    }
  }
  return list
}

export function poiTfList(settings) {
  const out = []
  if (settings.poiM5 !== false) out.push('M5')
  if (settings.poiM15 !== false) out.push('M15')
  if (settings.poiM30 !== false) out.push('M30')
  if (settings.poiH1 !== false) out.push('H1')
  if (settings.poiH4 !== false) out.push('H4')
  if (settings.poiD1 !== false) out.push('D1')
  return out
}

function lowerBoundTime(candles, t) {
  let lo = 0
  let hi = candles.length - 1
  let ans = candles.length
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (candles[mid].t >= t) {
      ans = mid
      hi = mid - 1
    } else lo = mid + 1
  }
  return ans
}

function upperBoundTime(candles, t) {
  let lo = 0
  let hi = candles.length - 1
  let ans = candles.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (candles[mid].t <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

/**
 * Deteksi sinyal BUY / SELL pada chart M1 berbasis State-Based Re-Entry (#1 dan #2★):
 * - Tipe 1 (sigTypeRb): POI + Reversal Band (Band 1) -> candle balik arah pertama
 * - Tipe 2 (sigTypeCloud): POI + Pullback ke Pita Trend Cloud M1 searah -> candle balik arah pertama
 * - Tipe 3 (sigTypePure): POI Murni + Strong Engulfing (Close > High[-1] / Close < Low[-1]) + Volume >= 1.2x MA20
 */
export function detectPoiSignals(candles, ind, pois, settings = {}, chartEndT = Infinity) {
  if (!settings.showSignals || !candles?.length || !ind || !pois?.length) return []
  const allowRb = settings.sigTypeRb !== false
  const allowCloud = settings.sigTypeCloud !== false
  const allowPure = settings.sigTypePure === true
  if (!allowRb && !allowCloud && !allowPure) return []

  const n = candles.length
  const volMa = new Float64Array(n)
  let vSum = 0
  for (let i = 0; i < n; i++) {
    const v = candles[i].v || 0
    vSum += v
    if (i >= 20) {
      vSum -= candles[i - 20].v || 0
      volMa[i] = vSum / 20
    } else {
      volMa[i] = Math.max(1, vSum / (i + 1))
    }
  }

  const s = ind.settings || {}
  const smoothCloud = !s.cloudStyle || s.cloudStyle === 'Smooth'
  const scalpingPlus = s.cloudStyle === 'Scalping+'

  function cloudZoneAt(i) {
    if (smoothCloud) {
      const a = ind.ema150?.[i]
      const b = ind.ema250?.[i]
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null
      return { hi: Math.max(a, b), lo: Math.min(a, b), dir: a >= b ? 1 : -1 }
    }
    if (scalpingPlus) {
      const a = ind.hma?.[i]
      const b = ind.hma2?.[i]
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null
      return { hi: Math.max(a, b), lo: Math.min(a, b), dir: a >= b ? 1 : -1 }
    }
    const st = ind.trendcloud?.[i]
    const avg = ind.avgOc?.[i]
    const cl = ind.tcClose?.[i]
    if (!Number.isFinite(st) || st === 0 || !Number.isFinite(avg) || !Number.isFinite(cl)) return null
    return { hi: Math.max(st, avg), lo: Math.min(st, avg), dir: cl > st ? 1 : -1 }
  }

  const tfRank = { D1: 6, H4: 5, H1: 4, M30: 3, M15: 2, M5: 1 }
  const eligiblePois = pois
    .filter((p) => p.tf !== 'M1' && (tfRank[p.tf] || 0) >= 1)
    .slice()
    .sort((a, b) => (tfRank[b.tf] || 0) - (tfRank[a.tf] || 0) || a.t0 - b.t0)

  const rawSignals = []

  for (const p of eligiblePois) {
    const tValid = p.tValid != null ? p.tValid + 60 : p.t0
    if (tValid > chartEndT) continue
    const tStop = p.tapped && p.tappedT != null ? Math.min(p.tappedT, chartEndT) : chartEndT
    if (tStop < tValid) continue

    const iStart = Math.max(2, lowerBoundTime(candles, tValid))
    const iStop = Math.min(n - 1, upperBoundTime(candles, tStop))
    if (iStart > iStop) continue

    const side = p.side
    const hi = p.hi
    const lo = p.lo
    const tfShort = TF_LABEL[p.tf] || p.tf

    let touchedPoi = false
    let touchedRb = false
    let touchedCloud = false
    let lowestW = Infinity
    let highestW = -Infinity
    let attempt = 0
    let activeSl = null
    let activeTp = null

    for (let i = iStart; i <= iStop; i++) {
      const b = candles[i]
      if (b.t > chartEndT) break

      // Jika sudah ada sinyal aktif (#1), cek apakah kena TP (selesai) atau kena SL (buka peluang #2★)
      if (activeSl != null) {
        if (side === 1) {
          if (b.h >= activeTp) break
          if (b.l <= activeSl) {
            activeSl = null
            activeTp = null
          } else {
            continue
          }
        } else {
          if (b.l <= activeTp) break
          if (b.h >= activeSl) {
            activeSl = null
            activeTp = null
          } else {
            continue
          }
        }
      }

      // Batal jika close M1 keluar jauh menembus distal line
      if ((side === 1 && b.c < lo) || (side === -1 && b.c > hi)) break

      const inPoi = b.l <= hi && b.h >= lo
      if (inPoi) touchedPoi = true
      if (!touchedPoi) continue

      if (b.l < lowestW) lowestW = b.l
      if (b.h > highestW) highestW = b.h

      const rbLine = side === 1 ? ind.lower1?.[i] : ind.upper1?.[i]
      if (Number.isFinite(rbLine)) {
        if (side === 1 && b.l <= rbLine) touchedRb = true
        else if (side === -1 && b.h >= rbLine) touchedRb = true
      }

      const cz = cloudZoneAt(i)
      if (cz && cz.dir === side && inPoi) {
        const inCloud = b.l <= cz.hi && b.h >= cz.lo
        const zoneOverlap = cz.lo <= hi && cz.hi >= lo
        if (inCloud || zoneOverlap) touchedCloud = true
      }

      // Anti-repaint: sinyal hanya boleh muncul pada candle yang sudah close (!b.partial)
      if (b.partial) continue

      const prev = candles[i - 1]
      const isBull = b.c > b.o
      const isBear = b.c < b.o
      const firstRev = side === 1 ? isBull && prev.c < prev.o : isBear && prev.c > prev.o
      if (!firstRev) continue

      let sigKind = null
      let tag = ''

      if (allowRb && touchedRb) {
        sigKind = 'rb'
        const vwapLine = side === 1 ? ind.vwapL2?.[i] : ind.vwapU2?.[i]
        const hitVwap = Number.isFinite(vwapLine) && (side === 1 ? b.l <= vwapLine : b.h >= vwapLine)
        tag = hitVwap ? `${tfShort}+RB+VWAP` : `${tfShort}+RB`
      } else if (allowCloud && touchedCloud) {
        sigKind = 'cloud'
        tag = `${tfShort}+TC`
      } else if (allowPure) {
        const strongEng = side === 1 ? b.c > prev.h : b.c < prev.l
        const volOk = (b.v || 0) >= 1.2 * volMa[i] || (prev.v || 0) >= 1.2 * volMa[i - 1]
        if (strongEng && volOk) {
          sigKind = 'pure'
          tag = `${tfShort} ENG`
        }
      }

      if (!sigKind) continue

      const entry = b.c
      const sl = side === 1 ? Math.min(b.l, prev.l, lowestW) - 0.25 : Math.max(b.h, prev.h, highestW) + 0.25
      const risk = side === 1 ? entry - sl : sl - entry
      if (!(risk >= 0.25 && risk <= 40)) continue

      const tp = side === 1 ? entry + 2 * risk : entry - 2 * risk
      attempt += 1
      activeSl = sl
      activeTp = tp

      const word = side === 1 ? 'BUY' : 'SELL'
      const badge = attempt === 2 ? '#2★' : '#1'
      rawSignals.push({
        t: b.t,
        index: i,
        side,
        attempt,
        kind: sigKind,
        tf: p.tf,
        rank: tfRank[p.tf] || 0,
        price: side === 1 ? b.l : b.h,
        entry,
        sl,
        tp,
        label: `${word} ${badge} · ${tag}`,
      })

      if (attempt >= 2) break
    }
  }

  // Deduplikasi bila di candle M1 yang sama ada >1 POI bertumpuk (ambil TF POI terbesar / percobaan #2★)
  const byTimeSide = new Map()
  for (const sig of rawSignals) {
    const key = `${sig.t}:${sig.side}`
    const prev = byTimeSide.get(key)
    if (!prev || sig.attempt > prev.attempt || (sig.attempt === prev.attempt && sig.rank > prev.rank)) {
      byTimeSide.set(key, sig)
    }
  }
  return [...byTimeSide.values()].sort((a, b) => a.t - b.t)
}
