/** Volume profile. Volume tick candle dibagi ke jenjang harga. Diadaptasi dari AMT. */

export function niceBinSize(range, targetRows) {
  if (!(range > 0) || !(targetRows > 0)) return 0.1
  const rough = range / targetRows
  const pow = 10 ** Math.floor(Math.log10(rough))
  let best = pow
  let bestScore = Infinity
  for (const mult of [1, 2, 2.5, 5, 10]) {
    const step = mult * pow
    const score = Math.abs(range / step - targetRows)
    if (score < bestScore) {
      best = step
      bestScore = score
    }
  }
  return best
}

function overlap(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

function weightsForCandle(candle, binSize, method) {
  const { o, h, l, c } = candle
  if (!Number.isFinite(h) || !Number.isFinite(l) || h < l) return []
  if (h === l) return [{ i: Math.floor(l / binSize), w: 1 }]
  const i0 = Math.floor(l / binSize)
  const i1 = Math.floor((h - 1e-9) / binSize)
  const spans = []
  for (let i = i0; i <= i1; i++) {
    const b0 = i * binSize
    const b1 = b0 + binSize
    spans.push({ i, ov: overlap(b0, b1, l, h), b0, b1 })
  }
  if (!spans.length) return []
  if (method !== 'body') return spans.map((s) => ({ i: s.i, w: s.ov }))
  const bodyTop = Math.max(o, c)
  const bodyBot = Math.min(o, c)
  const body = Math.max(0, bodyTop - bodyBot)
  const full = h - l
  const up = Math.max(0, h - bodyTop)
  const dn = Math.max(0, bodyBot - l)
  let bodyShare = 0.7
  if (!(body > full * 0.15)) bodyShare = 0
  if (up + dn <= 0) bodyShare = 1
  const wickShare = 1 - bodyShare
  const wick = up + dn
  return spans.map((s) => {
    if (bodyShare === 0) return { i: s.i, w: s.ov }
    let w = 0
    if (bodyShare > 0 && body > 0) w += bodyShare * (overlap(s.b0, s.b1, bodyBot, bodyTop) / body)
    if (wickShare > 0 && wick > 0) {
      w += wickShare * (overlap(s.b0, s.b1, l, bodyBot) / wick)
      w += wickShare * (overlap(s.b0, s.b1, bodyTop, h) / wick)
    }
    return { i: s.i, w }
  })
}

export function buildProfile(candles, opts = {}) {
  if (!candles?.length) return null
  let minL = Infinity
  let maxH = -Infinity
  for (const candle of candles) {
    if (Number.isFinite(candle.l) && candle.l < minL) minL = candle.l
    if (Number.isFinite(candle.h) && candle.h > maxH) maxH = candle.h
  }
  if (!Number.isFinite(minL) || !Number.isFinite(maxH)) return null
  const range = Math.max(0, maxH - minL)
  const targetRows = opts.targetRows || 56
  const manual = Number(opts.bin)
  const binSize = manual > 0 ? manual : range > 0 ? niceBinSize(range, targetRows) : 0.1
  const method = opts.method === 'uniform' ? 'uniform' : 'body'
  const map = new Map()
  for (const candle of candles) {
    const vol = candle.v
    if (!(vol > 0)) continue
    const weights = weightsForCandle(candle, binSize, method)
    let sum = 0
    for (const w of weights) sum += w.w
    if (!(sum > 0)) continue
    for (const w of weights) map.set(w.i, (map.get(w.i) || 0) + (vol * w.w) / sum)
  }
  if (!map.size) return null
  const indexes = [...map.keys()].sort((a, b) => a - b)
  const bins = []
  for (let i = indexes[0]; i <= indexes[indexes.length - 1]; i++) {
    bins.push({ price: Math.round(i * binSize * 1e8) / 1e8, volume: map.get(i) || 0 })
  }
  let total = 0
  let pocIndex = 0
  for (let i = 0; i < bins.length; i++) {
    total += bins[i].volume
    if (bins[i].volume > bins[pocIndex].volume) pocIndex = i
  }
  if (!(total > 0)) return null
  const vaPercent = Math.min(95, Math.max(50, opts.vaPercent ?? 70))
  const target = total * (vaPercent / 100)
  let lo = pocIndex
  let hi = pocIndex
  let acc = bins[pocIndex].volume
  while (acc < target && (lo > 0 || hi < bins.length - 1)) {
    const up = hi < bins.length - 1 ? bins[hi + 1].volume : -1
    const dn = lo > 0 ? bins[lo - 1].volume : -1
    if (up < 0 && dn < 0) break
    if (up >= dn) {
      hi += 1
      acc += bins[hi].volume
    } else {
      lo -= 1
      acc += bins[lo].volume
    }
  }
  for (let i = 0; i < bins.length; i++) {
    bins[i].va = i >= lo && i <= hi
    bins[i].poc = i === pocIndex
  }
  return {
    binSize,
    bins,
    pocPrice: bins[pocIndex].price + binSize / 2,
    vah: bins[hi].price + binSize,
    val: bins[lo].price,
    total,
    vaShare: acc / total,
    vaPercent,
  }
}
