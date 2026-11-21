/** Port Pine: VWAP + Reversal Band + Trend Cloud (semantik mendekati TradingView). */

export const DEFAULT_IND = {
  enabled: true,
  // Trend Tracer
  showTracer: true,
  tracerLen: 250,
  // Trend Cloud
  showCloud: true,
  cloudStyle: 'Smooth', // Smooth | Scalping | Scalping+ | Swing
  cloudTf: '', // '' = chart TF
  // Reversal Band
  showRb: true,
  rbLen: 50,
  bd1: 9.0,
  bd2: 11.0,
  bd3: 14.0,
  rbTf: '',
  // VWAP
  hideVwapDwm: false,
  vwapAnchor: 'Session',
  showDev2: true,
  multDev2: 2.0,
  showDev3: true,
  multDev3: 3.0,
  // POI (M15 / H1 / H4)
  showPoi: true,
  poiM15: true,
  poiH1: true,
  poiH4: true,
  poiMaxOpp: 3,
  poiMaxSameDir: 2,
  poiMinExpansionAtr: 1.0,
  poiAtrLen: 14,
  poiUntappedOnly: false,
}

const BULL = '#16e045'
const BEAR = '#e1320f'

function arr(n, fill = NaN) {
  return new Float64Array(n).fill(fill)
}

function shift(src, n) {
  const out = arr(src.length)
  for (let i = n; i < src.length; i++) out[i] = src[i - n]
  return out
}

function rollingSum(src, len) {
  const out = arr(src.length)
  for (let i = 0; i < src.length; i++) {
    if (i + 1 < len) {
      out[i] = NaN
      continue
    }
    let s = 0
    let ok = true
    for (let j = i - len + 1; j <= i; j++) {
      if (!Number.isFinite(src[j])) {
        ok = false
        break
      }
      s += src[j]
    }
    out[i] = ok ? s : NaN
  }
  return out
}

function sma(src, len) {
  const out = arr(src.length)
  const rs = rollingSum(src, len)
  for (let i = 0; i < src.length; i++) out[i] = Number.isFinite(rs[i]) ? rs[i] / len : NaN
  return out
}

function seededEma(src, len) {
  const out = arr(src.length)
  const alpha = 2 / (len + 1)
  const seed = sma(src, len)
  let prev = NaN
  for (let i = 0; i < src.length; i++) {
    if (!Number.isFinite(prev)) {
      if (Number.isFinite(seed[i])) {
        prev = seed[i]
        out[i] = prev
      }
    } else if (Number.isFinite(src[i])) {
      prev = alpha * src[i] + (1 - alpha) * prev
      out[i] = prev
    } else out[i] = prev
  }
  return out
}

function rma(src, len) {
  const out = arr(src.length)
  const alpha = 1 / len
  const seed = sma(src, len)
  let prev = NaN
  for (let i = 0; i < src.length; i++) {
    if (!Number.isFinite(prev)) {
      if (Number.isFinite(seed[i])) {
        prev = seed[i]
        out[i] = prev
      }
    } else if (Number.isFinite(src[i])) {
      prev = alpha * src[i] + (1 - alpha) * prev
      out[i] = prev
    } else out[i] = prev
  }
  return out
}

function wma(src, len) {
  const out = arr(src.length)
  const wsum = (len * (len + 1)) / 2
  for (let i = len - 1; i < src.length; i++) {
    let s = 0
    let ok = true
    for (let k = 0; k < len; k++) {
      const v = src[i - len + 1 + k]
      if (!Number.isFinite(v)) {
        ok = false
        break
      }
      s += v * (k + 1)
    }
    out[i] = ok ? s / wsum : NaN
  }
  return out
}

function hma(src, len) {
  const half = Math.floor(len / 2)
  const sqrt = Math.round(Math.sqrt(len))
  const wHalf = wma(src, half)
  const wFull = wma(src, len)
  const raw = arr(src.length)
  for (let i = 0; i < src.length; i++) {
    if (Number.isFinite(wHalf[i]) && Number.isFinite(wFull[i])) raw[i] = 2 * wHalf[i] - wFull[i]
  }
  return wma(raw, sqrt)
}

function trueRange(h, l, c) {
  const out = arr(h.length)
  for (let i = 0; i < h.length; i++) {
    if (i === 0) out[i] = h[i] - l[i]
    else {
      const pc = c[i - 1]
      out[i] = Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc))
    }
  }
  return out
}

function atr(h, l, c, len) {
  return rma(trueRange(h, l, c), len)
}

/** KAMA persis Pine (er=0 saat sum belum valid; seed rekursi 0). */
export function kama(src, len) {
  const out = arr(src.length)
  const absDiff = arr(src.length)
  for (let i = 1; i < src.length; i++) {
    if (Number.isFinite(src[i]) && Number.isFinite(src[i - 1])) absDiff[i] = Math.abs(src[i] - src[i - 1])
  }
  const noise = rollingSum(absDiff, len)
  let prev = 0
  for (let i = 0; i < src.length; i++) {
    if (!Number.isFinite(src[i])) {
      out[i] = NaN
      prev = 0
      continue
    }
    let er = 0
    if (Number.isFinite(noise[i]) && noise[i] !== 0 && Number.isFinite(src[i - len])) {
      er = Math.abs(src[i] - src[i - len]) / noise[i]
    }
    const sc = (er * (0.288 - 0.0666) + 0.0666) ** 2
    prev = prev + sc * (src[i] - prev)
    out[i] = prev
  }
  return out
}

function supertrend(ohlc4, close, h, l, factor, len) {
  const a = atr(h, l, close, len)
  const n = close.length
  const upper = arr(n)
  const lower = arr(n)
  const st = arr(n)
  for (let i = 0; i < n; i++) {
    const prevLower = i === 0 || !Number.isFinite(lower[i - 1]) ? 0 : lower[i - 1]
    const prevUpper = i === 0 || !Number.isFinite(upper[i - 1]) ? 0 : upper[i - 1]
    const prevClose = i > 0 ? close[i - 1] : NaN
    const lo = ohlc4[i] - factor * a[i]
    const up = ohlc4[i] + factor * a[i]
    lower[i] = lo > prevLower || prevClose < prevLower ? lo : prevLower
    upper[i] = up < prevUpper || prevClose > prevUpper ? up : prevUpper
    const prevSt = i > 0 ? st[i - 1] : NaN
    let direction
    if (prevSt === prevUpper) direction = close[i] > upper[i] ? 1 : -1
    else direction = close[i] < lower[i] ? -1 : 1
    st[i] = direction === 1 ? lower[i] : upper[i]
  }
  return st
}

function dayKey(tSec) {
  // Session ≈ UTC day (setara timeframe.change("D") di feed UTC)
  return Math.floor(tSec / 86400)
}

function sessionVwap(src, vol, times) {
  const n = src.length
  const vwap = arr(n)
  const stdev = arr(n)
  let sumPv = 0
  let sumV = 0
  let sumP2v = 0
  let prevDay = null
  for (let i = 0; i < n; i++) {
    const day = dayKey(times[i])
    if (prevDay == null || day !== prevDay) {
      sumPv = 0
      sumV = 0
      sumP2v = 0
      prevDay = day
    }
    const v = Number.isFinite(vol[i]) && vol[i] > 0 ? vol[i] : 1
    const s = src[i]
    if (!Number.isFinite(s)) {
      vwap[i] = NaN
      stdev[i] = NaN
      continue
    }
    sumPv += s * v
    sumV += v
    sumP2v += s * s * v
    const mean = sumPv / sumV
    const variance = Math.max(0, sumP2v / sumV - mean * mean)
    vwap[i] = mean
    stdev[i] = Math.sqrt(variance)
  }
  return { vwap, stdev }
}

function pack(candles) {
  const n = candles.length
  const t = new Int32Array(n)
  const o = arr(n)
  const h = arr(n)
  const l = arr(n)
  const c = arr(n)
  const v = arr(n)
  for (let i = 0; i < n; i++) {
    const bar = candles[i]
    t[i] = bar.t
    o[i] = bar.o
    h[i] = bar.h
    l[i] = bar.l
    c[i] = bar.c
    v[i] = bar.v || 0
  }
  return { t, o, h, l, c, v, n }
}

/**
 * Map nilai TF sumber ke TF chart (mirip request.security).
 * Jika sumber lebih rendah (M1 → M5), ambil bar sumber terakhir di dalam periode chart.
 */
export function mapSeries(srcTimes, srcValues, chartTimes, srcSec, chartSec = 0) {
  const out = arr(chartTimes.length)
  let j = 0
  const ltf = chartSec > 0 && srcSec > 0 && srcSec < chartSec
  for (let i = 0; i < chartTimes.length; i++) {
    const ct = chartTimes[i]
    const target = ltf ? ct + chartSec - srcSec : ct
    while (j + 1 < srcTimes.length && srcTimes[j + 1] <= target) j++
    if (j < srcTimes.length && srcTimes[j] <= target) out[i] = srcValues[j]
  }
  return out
}

function computeCore(candles, settings) {
  const { t, o, h, l, c, v, n } = pack(candles)
  const ohlc4 = arr(n)
  const hlc3 = arr(n)
  const avgOc = arr(n)
  for (let i = 0; i < n; i++) {
    ohlc4[i] = (o[i] + h[i] + l[i] + c[i]) / 4
    hlc3[i] = (h[i] + l[i] + c[i]) / 3
    avgOc[i] = (o[i] + c[i]) / 2
  }

  const factor = settings.cloudStyle === 'Swing' ? 7 : 4
  const ema150 = seededEma(c, 150)
  const ema250 = seededEma(c, 250)
  const trendcloud = supertrend(ohlc4, c, h, l, factor, 10)
  const hmaVal = settings.cloudStyle === 'Scalping+' ? hma(c, 55) : arr(n)
  const hma2 = shift(hmaVal, 2)
  const tracer = seededEma(c, settings.tracerLen)
  const close8 = shift(c, 8)

  const tr = trueRange(h, l, c)
  const rg = kama(tr, settings.rbLen)
  const basis = kama(c, settings.rbLen)
  const upper1 = arr(n)
  const upper2 = arr(n)
  const upper3 = arr(n)
  const lower1 = arr(n)
  const lower2 = arr(n)
  const lower3 = arr(n)
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(basis[i]) || !Number.isFinite(rg[i])) continue
    upper1[i] = basis[i] + rg[i] * settings.bd1
    upper2[i] = basis[i] + rg[i] * settings.bd2
    upper3[i] = basis[i] + rg[i] * settings.bd3
    lower1[i] = basis[i] - rg[i] * settings.bd1
    lower2[i] = basis[i] - rg[i] * settings.bd2
    lower3[i] = basis[i] - rg[i] * settings.bd3
  }

  const { vwap, stdev } = sessionVwap(hlc3, v, t)
  const vwapU2 = arr(n)
  const vwapL2 = arr(n)
  const vwapU3 = arr(n)
  const vwapL3 = arr(n)
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(vwap[i]) || !Number.isFinite(stdev[i])) continue
    vwapU2[i] = vwap[i] + stdev[i] * settings.multDev2
    vwapL2[i] = vwap[i] - stdev[i] * settings.multDev2
    vwapU3[i] = vwap[i] + stdev[i] * settings.multDev3
    vwapL3[i] = vwap[i] - stdev[i] * settings.multDev3
  }

  return {
    t,
    n,
    ema150,
    ema250,
    trendcloud,
    hma: hmaVal,
    hma2,
    avgOc,
    close: c,
    tracer,
    close8,
    upper1,
    upper2,
    upper3,
    lower1,
    lower2,
    lower3,
    vwap,
    vwapU2,
    vwapL2,
    vwapU3,
    vwapL3,
  }
}

/**
 * Hitung indikator untuk candle chart.
 * opts.cloudCandles / opts.rbCandles: series MTF opsional (sudah di TF sumber).
 * opts.cloudSec / opts.rbSec: detik TF sumber.
 */
export function computeIndicators(candles, settings, opts = {}) {
  if (!candles?.length || !settings?.enabled) return null
  const chart = computeCore(candles, settings)
  const chartT = chart.t

  const chartSec = opts.chartSec || 0

  let cloud = chart
  if (opts.cloudCandles?.length && opts.cloudSec > 0) {
    const src = computeCore(opts.cloudCandles, settings)
    cloud = {
      ...chart,
      ema150: mapSeries(src.t, src.ema150, chartT, opts.cloudSec, chartSec),
      ema250: mapSeries(src.t, src.ema250, chartT, opts.cloudSec, chartSec),
      trendcloud: mapSeries(src.t, src.trendcloud, chartT, opts.cloudSec, chartSec),
      hma: mapSeries(src.t, src.hma, chartT, opts.cloudSec, chartSec),
      hma2: mapSeries(src.t, src.hma2, chartT, opts.cloudSec, chartSec),
      avgOc: mapSeries(src.t, src.avgOc, chartT, opts.cloudSec, chartSec),
      close: mapSeries(src.t, src.close, chartT, opts.cloudSec, chartSec),
    }
  }

  let rb = chart
  if (opts.rbCandles?.length && opts.rbSec > 0) {
    const src = computeCore(opts.rbCandles, settings)
    rb = {
      upper1: mapSeries(src.t, src.upper1, chartT, opts.rbSec, chartSec),
      upper2: mapSeries(src.t, src.upper2, chartT, opts.rbSec, chartSec),
      upper3: mapSeries(src.t, src.upper3, chartT, opts.rbSec, chartSec),
      lower1: mapSeries(src.t, src.lower1, chartT, opts.rbSec, chartSec),
      lower2: mapSeries(src.t, src.lower2, chartT, opts.rbSec, chartSec),
      lower3: mapSeries(src.t, src.lower3, chartT, opts.rbSec, chartSec),
    }
  }

  return {
    settings: { ...settings },
    ema150: cloud.ema150,
    ema250: cloud.ema250,
    trendcloud: cloud.trendcloud,
    hma: cloud.hma,
    hma2: cloud.hma2,
    avgOc: cloud.avgOc,
    tcClose: cloud.close,
    tracer: chart.tracer,
    close8: chart.close8,
    upper1: rb.upper1,
    upper2: rb.upper2,
    upper3: rb.upper3,
    lower1: rb.lower1,
    lower2: rb.lower2,
    lower3: rb.lower3,
    vwap: chart.vwap,
    vwapU2: chart.vwapU2,
    vwapL2: chart.vwapL2,
    vwapU3: chart.vwapU3,
    vwapL3: chart.vwapL3,
    colors: { bull: BULL, bear: BEAR },
  }
}

export function indicatorExtents(ind, i0, i1) {
  if (!ind) return null
  let min = Infinity
  let max = -Infinity
  const push = (series, on) => {
    if (!on || !series) return
    for (let i = i0; i <= i1; i++) {
      const v = series[i]
      if (!Number.isFinite(v)) continue
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  const s = ind.settings
  push(ind.upper3, s.showRb)
  push(ind.lower3, s.showRb)
  push(ind.vwapU3, s.showDev3)
  push(ind.vwapL3, s.showDev3)
  push(ind.vwapU2, s.showDev2)
  push(ind.vwapL2, s.showDev2)
  push(ind.vwap, true)
  push(ind.tracer, s.showTracer)
  push(ind.ema150, s.showCloud && s.cloudStyle === 'Smooth')
  push(ind.ema250, s.showCloud && s.cloudStyle === 'Smooth')
  push(ind.trendcloud, s.showCloud && s.cloudStyle !== 'Smooth' && s.cloudStyle !== 'Scalping+')
  push(ind.hma, s.showCloud && s.cloudStyle === 'Scalping+')
  if (!Number.isFinite(min)) return null
  return { min, max }
}
