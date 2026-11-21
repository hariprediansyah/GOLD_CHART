import { buildProfile } from './profile.js'
import { indicatorExtents } from './indicators.js'
import { fmtCompact, fmtPrice, formatAxis, formatHm, formatTs, round2 } from './series.js'

const UP = '#1848cc'
const UP_TEXT = '#5b8cff'
const DOWN = '#ffffff'
const TEXT = '#d7dee7'
const MUTED = '#8b97a6'
const GRID = 'rgba(255,255,255,0.045)'
const BUY = '#2962ff'
const GOLD = '#e6b84d'
const BG = '#0f0f0f'

function hexAlpha(hex, alpha) {
  const raw = String(hex || '').replace('#', '')
  if (raw.length !== 6) return `rgba(255,255,255,${alpha})`
  const r = parseInt(raw.slice(0, 2), 16)
  const g = parseInt(raw.slice(2, 4), 16)
  const b = parseInt(raw.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function uid() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4)
}

function distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = dx * dx + dy * dy
  let t = len ? ((px - x1) * dx + (py - y1) * dy) / len : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

export class Chart {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.hooks = hooks
    this.candles = []
    this.drawings = []
    this.selectedId = null
    this.tool = 'cursor'
    this.pick = false
    this.draft = null
    this.asof = null
    this.tfSec = 900
    this.tz = 7 * 3600
    this.va = 70
    this.lot = 0.01
    this.view = { right: 0, bars: 140 }
    this.autoScale = true
    this.priceView = null
    this.noMore = false
    this.cross = null
    this.extTime = null
    this.extPrice = null
    this.drag = null
    this.message = 'Memuat candle…'
    this.w = 0
    this.h = 0
    this._scale = { min: 0, max: 1 }
    this._raf = 0
    this.magnet = 'low'
    this.shift = false
    this._point = null
    this._box = null
    this._hover = false
    this._draftDrag = false
    this._vp = new Map()
    this._vpKey = new Map()
    this.indicators = null
    this.pois = []
    this._bind()
  }

  setIndicators(ind) {
    this.indicators = ind || null
    this.render()
  }

  setPois(pois) {
    this.pois = Array.isArray(pois) ? pois : []
    this.render()
  }

  setOptions(opts) {
    if (opts.tz != null) this.tz = opts.tz
    if (opts.va != null) this.va = opts.va
    if (opts.lot != null) this.lot = opts.lot
    if (opts.tfSec) this.tfSec = opts.tfSec
    if (opts.magnet) this.magnet = opts.magnet
    this.render()
  }

  setTool(tool) {
    this.tool = tool
    this.draft = null
    this._draftDrag = false
    this.canvas.style.cursor = tool === 'cursor' ? 'default' : 'crosshair'
    this.render()
  }

  setShift(on) {
    if (this.shift === on) return
    this.shift = on
    if (!this._hover || !this._point || !this._box) return
    if (on && this.tool === 'trend' && !this.draft) {
      const snapped = this.snap(this._point, this._box)
      if (snapped?.t != null) {
        const anchor = { t: snapped.t, p: snapped.p }
        this.draft = { type: 'trend', a: anchor, b: { t: anchor.t, p: anchor.p } }
        this._draftX = this._point.x
        this._draftY = this._point.y
        this._draftDrag = false
        this.hooks.onLive?.()
        this.render()
      }
      return
    }
    if (this.draft?.type === 'trend') {
      this.draft.b = this.aim(this._point, this._box)
      this.hooks.onLive?.()
      this.render()
    } else if (this.drag?.kind === 'draw') {
      this.applyDraw(this._point, this._box)
      this.render()
    }
  }

  aim(point, box) {
    const snapped = this.snap(point, box)
    if (this.shift && this.draft?.type === 'trend') {
      const index = this.indexAtX(point.x, box)
      const candle = index >= 0 && index < this.candles.length ? this.candles[index] : null
      const t = candle ? candle.t : this.timeAtIndex(index)
      const price = this.draft.a.p
      if (t == null) return snapped
      return { t, p: price, x: this.xOfTime(t, box), y: this.yOf(price, box), hit: true }
    }
    return snapped
  }

  setPick(on) {
    this.pick = on
    if (on) this.canvas.style.cursor = 'crosshair'
    this.render()
  }

  setExternalCross(time, price) {
    this.extTime = time
    this.extPrice = Number.isFinite(price) ? price : null
    this.requestRender()
  }

  setMessage(text) {
    this.message = text || ''
    this.render()
  }

  setNoMore(value) {
    this.noMore = value
  }

  rightEdgeTime() {
    if (!this.candles.length) return null
    return this.timeAtIndex(this.view.right)
  }

  setCandles(next, opts = {}) {
    const edge = opts.reset ? null : this.rightEdgeTime()
    this.candles = next || []
    if (opts.tfSec) this.tfSec = opts.tfSec
    // Indikator lama beda panjang → jangan digambar sampai dihitung ulang.
    if (this.indicators && (!this.candles.length || this.indicators.upper1?.length !== this.candles.length)) {
      this.indicators = null
    }
    if (!this.candles.length) {
      this.render()
      return
    }
    if (opts.reset || edge == null) this.jumpToEnd()
    else if (opts.follow) this.jumpToEnd()
    else this.align(edge)
    this.render()
  }

  visibleTimeRange() {
    if (!this.candles.length) return null
    const left = this.view.right - this.view.bars
    const i0 = Math.max(0, Math.floor(left))
    const i1 = Math.min(this.candles.length - 1, Math.max(i0, Math.ceil(this.view.right)))
    return {
      start: this.candles[i0].t,
      end: this.candles[i1].t + (this.tfSec || 60),
      i0,
      i1,
    }
  }

  rightPad() {
    return Math.max(14, this.view.bars * 0.18)
  }

  jumpToEnd() {
    this.view.right = Math.max(0, this.candles.length - 1 + this.rightPad())
    this.clamp()
  }

  align(t) {
    if (t == null || !this.candles.length) return
    this.view.right = this.fractionalIndex(t)
    this.clamp()
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.w = rect.width
    this.h = rect.height
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr))
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr))
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.render()
  }

  removeSelected() {
    if (!this.selectedId) {
      if (!this.drawings.length) return false
      this.selectedId = this.drawings[this.drawings.length - 1].id
    }
    const index = this.drawings.findIndex((d) => d.id === this.selectedId)
    if (index < 0) return false
    this.hooks.beforeChange?.()
    this.drawings.splice(index, 1)
    this.selectedId = null
    this.hooks.onChange?.()
    this.hooks.onSelect?.(null)
    this.render()
    return true
  }

  updateDrawing(id, patch) {
    const drawing = this.drawings.find((d) => d.id === id)
    if (!drawing) return
    this.hooks.beforeChange?.()
    Object.assign(drawing, patch)
    if (drawing.type === 'long' || drawing.type === 'short') drawing.result = null
    this.hooks.onChange?.()
    this.render()
  }

  cancelDraft() {
    if (!this.draft && !this.pick) return false
    this.draft = null
    this.pick = false
    this.render()
    this.hooks.onLive?.()
    return true
  }

  requestRender() {
    if (this._raf) return
    this._raf = requestAnimationFrame(() => {
      this._raf = 0
      this.render()
    })
  }

  layout() {
    const priceW = 78
    const timeH = 22
    const volH = Math.max(36, Math.min(56, this.h * 0.13))
    const top = 4
    const left = 8
    const plotW = Math.max(10, this.w - left - priceW)
    const plotH = Math.max(10, this.h - top - volH - timeH)
    return {
      plot: { x: left, y: top, w: plotW, h: plotH },
      vol: { x: left, y: top + plotH, w: plotW, h: volH - 2 },
      time: { x: left, y: top + plotH + volH, w: plotW, h: timeH },
      priceAxis: left + plotW,
    }
  }

  clamp() {
    const n = this.candles.length
    if (!n) return
    this.view.bars = Math.max(8, Math.min(2000, this.view.bars))
    const pad = this.rightPad()
    const maxRight = n - 1 + pad
    const minLeft = this.noMore ? 0 : -8
    const minRight = minLeft + Math.min(this.view.bars, n + pad)
    if (this.view.right > maxRight) this.view.right = maxRight
    if (this.view.right < minRight) this.view.right = minRight
  }

  avgStep() {
    const candles = this.candles
    if (candles.length < 2) return this.tfSec || 60
    return (candles[candles.length - 1].t - candles[0].t) / (candles.length - 1) || this.tfSec || 60
  }

  timeAtIndex(index) {
    const candles = this.candles
    if (!candles.length) return null
    if (index <= 0) return candles[0].t + index * this.avgStep()
    const last = candles.length - 1
    if (index >= last) return candles[last].t + (index - last) * this.avgStep()
    const i = Math.floor(index)
    const frac = index - i
    const span = candles[Math.min(last, i + 1)].t - candles[i].t
    return candles[i].t + frac * span
  }

  fractionalIndex(t) {
    const candles = this.candles
    if (!candles.length) return 0
    const step = this.avgStep()
    if (t <= candles[0].t) return (t - candles[0].t) / step
    const last = candles.length - 1
    if (t >= candles[last].t) return last + (t - candles[last].t) / step
    let lo = 0
    let hi = last
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1
      if (candles[mid].t <= t) lo = mid
      else hi = mid
    }
    const span = candles[hi].t - candles[lo].t || 1
    return lo + (t - candles[lo].t) / span
  }

  xOfIndex(index, box) {
    const left = this.view.right - this.view.bars
    const slot = box.plot.w / this.view.bars
    return box.plot.x + (index - left) * slot + slot / 2
  }

  xOfTime(t, box) {
    return this.xOfIndex(this.fractionalIndex(t), box)
  }

  yOf(price, box) {
    const span = this._scale.max - this._scale.min || 1
    return box.plot.y + ((this._scale.max - price) / span) * box.plot.h
  }

  priceAt(y, box) {
    const span = this._scale.max - this._scale.min || 1
    const t = (y - box.plot.y) / (box.plot.h || 1)
    return this._scale.max - t * span
  }

  indexAtX(x, box) {
    const left = this.view.right - this.view.bars
    const slot = box.plot.w / this.view.bars
    return Math.round(left + (x - box.plot.x) / slot - 0.5)
  }

  candleAtX(x, box) {
    const index = this.indexAtX(x, box)
    if (index < 0 || index >= this.candles.length) return null
    return this.candles[index]
  }

  snap(point, box) {
    const index = this.indexAtX(point.x, box)
    const raw = round2(this.priceAt(point.y, box))
    const candle = index >= 0 && index < this.candles.length ? this.candles[index] : null
    const t = candle ? candle.t : this.timeAtIndex(index)
    if (this.magnet === 'off' || !this.candles.length) return { t, p: raw, hit: false }
    const strong = this.magnet === 'strong'
    const limit = strong ? Infinity : 18
    const slot = box.plot.w / this.view.bars || 1
    const cw = slot >= 2.2 ? Math.max(1, slot * 0.68) : 1
    const reach = strong ? Math.ceil(this.view.bars) : Math.ceil((limit + cw) / slot) + 1
    const from = Math.max(0, index - reach)
    const to = Math.min(this.candles.length - 1, index + reach)
    let best = null
    const consider = (dist, price, time, barIndex) => {
      if (!(dist <= limit) || (best && dist >= best.dist)) return
      best = {
        dist,
        price,
        t: time,
        x: this.xOfIndex(barIndex, box),
        y: this.yOf(price, box),
      }
    }
    for (let i = from; i <= to; i++) {
      const bar = this.candles[i]
      if (!bar) continue
      const x = this.xOfIndex(i, box)
      const half = cw / 2
      const yH = this.yOf(bar.h, box)
      const yL = this.yOf(bar.l, box)
      const yO = this.yOf(bar.o, box)
      const yC = this.yOf(bar.c, box)
      consider(Math.hypot(point.x - x, point.y - yH), bar.h, bar.t, i)
      consider(Math.hypot(point.x - x, point.y - yL), bar.l, bar.t, i)
      const nearX = Math.max(x - half, Math.min(x + half, point.x))
      consider(Math.hypot(point.x - nearX, point.y - yO), bar.o, bar.t, i)
      consider(Math.hypot(point.x - nearX, point.y - yC), bar.c, bar.t, i)
    }
    if (!best) return { t, p: raw, hit: false }
    return { t: best.t, p: round2(best.price), x: best.x, y: best.y, hit: true }
  }

  render() {
    const ctx = this.ctx
    const { w, h } = this
    if (w < 20 || h < 20) return
    const box = this.layout()
ctx.clearRect(0, 0, w, h)
ctx.fillStyle = BG
ctx.fillRect(0, 0, w, h)
ctx.fillStyle = BG
    ctx.fillRect(box.priceAxis, 0, w - box.priceAxis, h)
    if (!this.candles.length) {
      ctx.fillStyle = MUTED
      ctx.font = '13px Segoe UI, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(this.message || 'Memuat candle…', box.plot.x + box.plot.w / 2, box.plot.y + box.plot.h / 2)
      return
    }
    const left = this.view.right - this.view.bars
    const i0 = Math.max(0, Math.floor(left))
    const i1 = Math.min(this.candles.length - 1, Math.ceil(this.view.right))
    let min = Infinity
    let max = -Infinity
    let maxVol = 0
    for (let i = i0; i <= i1; i++) {
      const candle = this.candles[i]
      if (!candle) continue
      if (candle.l < min) min = candle.l
      if (candle.h > max) max = candle.h
      if (candle.v > maxVol) maxVol = candle.v
    }
    const ext = indicatorExtents(this.indicators, i0, i1)
    if (ext) {
      if (ext.min < min) min = ext.min
      if (ext.max > max) max = ext.max
    }
    if (!Number.isFinite(min)) {
      min = 0
      max = 1
    }
    if (this.autoScale || !this.priceView) {
      const pad = (max - min) * 0.08 || 1
      min -= pad
      max += pad
      if (!this.autoScale) this.priceView = { min, max }
    } else {
      min = this.priceView.min
      max = this.priceView.max
    }
    this._scale = { min, max }
    const yOf = (price) => this.yOf(price, box)
    const xOf = (index) => this.xOfIndex(index, box)
    this.drawGrid(ctx, box, min, max, yOf)
    this.drawIndicatorFills(ctx, box, xOf, yOf, i0, i1)
    this.drawProfiles(ctx, box, yOf)
    this.drawRects(ctx, box)
    this.drawPois(ctx, box)
    this.drawCandles(ctx, box, xOf, yOf, i0, i1)
    this.drawIndicatorLines(ctx, box, xOf, yOf, i0, i1)
    this.drawPositions(ctx, box, yOf)
    this.drawLines(ctx, box, yOf)
    this.drawVolume(ctx, box, xOf, i0, i1, maxVol)
    this.drawAxes(ctx, box, min, max, yOf, xOf, i0, i1)
    this.drawReplayHead(ctx, box, yOf)
    this.drawCross(ctx, box, yOf)
    this.drawLegend(ctx, box)
  }

  drawIndicatorFills(ctx, box, xOf, yOf, i0, i1) {
    const ind = this.indicators
    if (!ind) return
    const s = ind.settings
    ctx.save()
    ctx.beginPath()
    ctx.rect(box.plot.x, box.plot.y, box.plot.w, box.plot.h)
    ctx.clip()

    if (s.showRb) {
      this.fillBetween(ctx, xOf, yOf, i0, i1, ind.upper1, ind.upper2, 'rgba(87,32,44,0.30)')
      this.fillBetween(ctx, xOf, yOf, i0, i1, ind.upper2, ind.upper3, 'rgba(87,32,44,0.50)')
      this.fillBetween(ctx, xOf, yOf, i0, i1, ind.lower1, ind.lower2, 'rgba(16,60,60,0.30)')
      this.fillBetween(ctx, xOf, yOf, i0, i1, ind.lower2, ind.lower3, 'rgba(16,60,60,0.50)')
    }

    if (s.showCloud) {
      const bull = ind.colors.bull
      const bear = ind.colors.bear
      if (s.cloudStyle === 'Smooth') {
        this.fillBetweenSigned(ctx, xOf, yOf, i0, i1, ind.ema150, ind.ema250, hexAlpha(bull, 0.30), hexAlpha(bear, 0.30))
      } else if (s.cloudStyle === 'Scalping+') {
        this.fillBetweenSigned(ctx, xOf, yOf, i0, i1, ind.hma, ind.hma2, hexAlpha(bull, 0.35), hexAlpha(bear, 0.35))
      } else {
        // Scalping / Swing: fill supertrend <-> avgOC
        this.fillCloudBreak(ctx, xOf, yOf, i0, i1, ind.trendcloud, ind.avgOc, ind.tcClose, bull, bear)
      }
    }

    if (s.showDev2 && s.showDev3) {
      this.fillBetween(ctx, xOf, yOf, i0, i1, ind.vwapU2, ind.vwapU3, 'rgba(41,98,255,0.10)')
      this.fillBetween(ctx, xOf, yOf, i0, i1, ind.vwapL2, ind.vwapL3, 'rgba(41,98,255,0.10)')
    }
    ctx.restore()
  }

  drawIndicatorLines(ctx, box, xOf, yOf, i0, i1) {
    const ind = this.indicators
    if (!ind) return
    const s = ind.settings
    ctx.save()
    ctx.beginPath()
    ctx.rect(box.plot.x, box.plot.y, box.plot.w, box.plot.h)
    ctx.clip()

    if (s.showTracer) {
      this.strokeSigned(ctx, xOf, yOf, i0, i1, ind.tracer, (i) => {
        const bull = Number.isFinite(ind.close8[i]) && ind.close8[i] > ind.tracer[i]
        return hexAlpha(bull ? ind.colors.bull : ind.colors.bear, 0.55)
      }, 2)
    }

    if (s.showCloud && (s.cloudStyle === 'Scalping' || s.cloudStyle === 'Swing')) {
      this.strokeCloudEdge(ctx, xOf, yOf, i0, i1, ind.trendcloud, ind.tcClose, ind.colors.bull, ind.colors.bear)
    }

    if (!(s.hideVwapDwm && this.tfSec >= 86400)) {
      this.strokeSeries(ctx, xOf, yOf, i0, i1, ind.vwap, '#2962FF', 1.5)
      if (s.showDev2) {
        this.strokeSeries(ctx, xOf, yOf, i0, i1, ind.vwapU2, 'rgba(41,98,255,0.70)', 1)
        this.strokeSeries(ctx, xOf, yOf, i0, i1, ind.vwapL2, 'rgba(41,98,255,0.70)', 1)
      }
      if (s.showDev3) {
        this.strokeSeries(ctx, xOf, yOf, i0, i1, ind.vwapU3, 'rgba(255,109,0,0.70)', 1)
        this.strokeSeries(ctx, xOf, yOf, i0, i1, ind.vwapL3, 'rgba(255,109,0,0.70)', 1)
      }
    }
    ctx.restore()
  }

  fillBetween(ctx, xOf, yOf, i0, i1, a, b, color) {
    if (!a || !b) return
    ctx.fillStyle = color
    let start = -1
    const flush = (end) => {
      if (start < 0 || end < start) return
      ctx.beginPath()
      ctx.moveTo(xOf(start), yOf(a[start]))
      for (let i = start + 1; i <= end; i++) ctx.lineTo(xOf(i), yOf(a[i]))
      for (let i = end; i >= start; i--) ctx.lineTo(xOf(i), yOf(b[i]))
      ctx.closePath()
      ctx.fill()
      start = -1
    }
    for (let i = i0; i <= i1; i++) {
      if (Number.isFinite(a[i]) && Number.isFinite(b[i])) {
        if (start < 0) start = i
      } else flush(i - 1)
    }
    flush(i1)
  }

  fillBetweenSigned(ctx, xOf, yOf, i0, i1, a, b, upColor, downColor) {
    if (!a || !b) return
    let i = i0
    while (i <= i1) {
      while (i <= i1 && (!Number.isFinite(a[i]) || !Number.isFinite(b[i]))) i++
      if (i > i1) break
      const bull = a[i] >= b[i]
      const color = bull ? upColor : downColor
      const start = i
      i++
      while (i <= i1 && Number.isFinite(a[i]) && Number.isFinite(b[i]) && a[i] >= b[i] === bull) i++
      this.fillBetween(ctx, xOf, yOf, start, i - 1, a, b, color)
    }
  }

  fillCloudBreak(ctx, xOf, yOf, i0, i1, st, avg, close, bull, bear) {
    if (!st || !avg || !close) return
    let i = i0
    while (i <= i1) {
      while (i <= i1 && (!Number.isFinite(st[i]) || !Number.isFinite(avg[i]) || st[i] === 0 || !Number.isFinite(close[i]))) i++
      if (i > i1) break
      const up = close[i] > st[i]
      const start = i
      i++
      while (
        i <= i1
        && Number.isFinite(st[i])
        && Number.isFinite(avg[i])
        && st[i] !== 0
        && Number.isFinite(close[i])
        && close[i] > st[i] === up
      ) i++
      this.fillBetween(ctx, xOf, yOf, start, i - 1, st, avg, hexAlpha(up ? bull : bear, 0.10))
    }
  }

  strokeSeries(ctx, xOf, yOf, i0, i1, series, color, width) {
    if (!series) return
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineJoin = 'round'
    ctx.beginPath()
    let pen = false
    for (let i = i0; i <= i1; i++) {
      if (!Number.isFinite(series[i])) {
        pen = false
        continue
      }
      const x = xOf(i)
      const y = yOf(series[i])
      if (!pen) {
        ctx.moveTo(x, y)
        pen = true
      } else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  strokeSigned(ctx, xOf, yOf, i0, i1, series, colorAt, width) {
    if (!series) return
    ctx.lineWidth = width
    ctx.lineJoin = 'round'
    let i = i0
    while (i <= i1) {
      while (i <= i1 && !Number.isFinite(series[i])) i++
      if (i > i1) break
      const bull = colorAt(i)
      ctx.strokeStyle = bull
      ctx.beginPath()
      ctx.moveTo(xOf(i), yOf(series[i]))
      const key = bull
      let j = i + 1
      while (j <= i1 && Number.isFinite(series[j]) && colorAt(j) === key) {
        ctx.lineTo(xOf(j), yOf(series[j]))
        j++
      }
      if (j <= i1 && Number.isFinite(series[j])) ctx.lineTo(xOf(j), yOf(series[j]))
      ctx.stroke()
      i = Math.max(j, i + 1)
    }
  }

  strokeCloudEdge(ctx, xOf, yOf, i0, i1, st, close, bull, bear) {
    if (!st || !close) return
    let i = i0
    while (i <= i1) {
      while (i <= i1 && (!Number.isFinite(st[i]) || st[i] === 0 || !Number.isFinite(close[i]))) i++
      if (i > i1) break
      const up = close[i] > st[i]
      ctx.strokeStyle = up ? bull : bear
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(xOf(i), yOf(st[i]))
      i++
      while (i <= i1 && Number.isFinite(st[i]) && st[i] !== 0 && Number.isFinite(close[i]) && close[i] > st[i] === up) {
        ctx.lineTo(xOf(i), yOf(st[i]))
        i++
      }
      ctx.stroke()
    }
  }

  drawGrid(ctx, box, min, max, yOf) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(box.plot.x, box.plot.y, box.plot.w, box.plot.h)
    ctx.clip()
    const step = niceStep(max - min)
    const first = Math.ceil(min / step) * step
    ctx.strokeStyle = GRID
    ctx.lineWidth = 1
    for (let price = first; price <= max; price += step) {
      const y = yOf(price)
      ctx.beginPath()
      ctx.moveTo(box.plot.x, y)
      ctx.lineTo(box.plot.x + box.plot.w, y)
      ctx.stroke()
    }
    ctx.restore()
  }

  drawCandles(ctx, box, xOf, yOf, i0, i1) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(box.plot.x, box.plot.y, box.plot.w, box.plot.h)
    ctx.clip()
    const slot = box.plot.w / this.view.bars
    const cw = slot >= 2.2 ? Math.max(1, slot * 0.68) : 1
    for (let i = i0; i <= i1; i++) {
      const candle = this.candles[i]
      if (!candle) continue
      const x = xOf(i)
      const up = candle.c >= candle.o
      ctx.strokeStyle = up ? UP : DOWN
      ctx.fillStyle = up ? UP : DOWN
      ctx.globalAlpha = candle.partial ? 0.75 : 1
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, yOf(candle.h))
      ctx.lineTo(x, yOf(candle.l))
      ctx.stroke()
      if (slot >= 2.2) {
        const top = Math.min(yOf(candle.o), yOf(candle.c))
        const height = Math.max(1, Math.abs(yOf(candle.c) - yOf(candle.o)))
        ctx.fillRect(x - cw / 2, top, cw, height)
      }
    }
    ctx.globalAlpha = 1
    const last = this.candles[this.candles.length - 1]
    const y = yOf(last.c)
    ctx.setLineDash([4, 3])
    ctx.strokeStyle = last.c >= last.o ? UP : DOWN
    ctx.beginPath()
    ctx.moveTo(box.plot.x, y)
    ctx.lineTo(box.plot.x + box.plot.w, y)
    ctx.stroke()
    ctx.restore()
  }

  drawVolume(ctx, box, xOf, i0, i1, maxVol) {
    if (!(maxVol > 0)) return
    const slot = box.plot.w / this.view.bars
    const cw = Math.max(1, slot * 0.68)
    ctx.save()
    for (let i = i0; i <= i1; i++) {
      const candle = this.candles[i]
      if (!candle) continue
      const h = Math.max(1, (candle.v / maxVol) * (box.vol.h - 2))
      ctx.fillStyle = candle.c >= candle.o ? 'rgba(8,153,129,0.45)' : 'rgba(242,54,69,0.45)'
      ctx.fillRect(xOf(i) - cw / 2, box.vol.y + box.vol.h - h, cw, h)
    }
    ctx.restore()
  }

  drawAxes(ctx, box, min, max, yOf, xOf, i0, i1) {
    ctx.font = '11px Segoe UI, sans-serif'
    ctx.fillStyle = MUTED
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const step = niceStep(max - min)
    const first = Math.ceil(min / step) * step
    for (let price = first; price <= max; price += step) {
      ctx.fillText(fmtPrice(price), box.priceAxis + 6, yOf(price))
    }
    const last = this.candles[this.candles.length - 1]
    const yLast = yOf(last.c)
    if (yLast >= box.plot.y && yLast <= box.plot.y + box.plot.h) {
      const up = last.c >= last.o
      const label = fmtPrice(last.c)
      const tfSec = this.tfSec || 60
      const nowSec = Date.now() / 1000
      const bucketNow = Math.floor(nowSec / tfSec) * tfSec
      // Countdown sisa detik sampai close candle TF aktif (live / bar forming).
      const liveBar = this.asof == null || last.partial || last.t === bucketNow
      const remain = liveBar
        ? Math.max(0, Math.ceil(last.t + tfSec - nowSec))
        : 0
      const cd = `${String(Math.floor(remain / 60)).padStart(2, '0')}:${String(remain % 60).padStart(2, '0')}`
      ctx.font = '11px Segoe UI, sans-serif'
      const wPrice = ctx.measureText(label).width
      ctx.font = '10px Segoe UI, sans-serif'
      const wCd = liveBar ? ctx.measureText(cd).width : 0
      const width = Math.max(wPrice, wCd) + 12
      const height = liveBar ? 28 : 16
      ctx.fillStyle = up ? UP : DOWN
      ctx.fillRect(box.priceAxis + 2, yLast - height / 2, width, height)
      ctx.fillStyle = up ? '#ffffff' : '#0f0f0f'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.font = '11px Segoe UI, sans-serif'
      ctx.fillText(label, box.priceAxis + 7, liveBar ? yLast - 6 : yLast)
      if (liveBar) {
        ctx.font = '10px Segoe UI, sans-serif'
        ctx.globalAlpha = 0.9
        ctx.fillText(cd, box.priceAxis + 7, yLast + 7)
        ctx.globalAlpha = 1
      }
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = MUTED
    let lastX = -Infinity
    for (let i = i0; i <= i1; i++) {
      const x = xOf(i)
      if (x - lastX < 72) continue
      const candle = this.candles[i]
      if (!candle) continue
      ctx.fillText(formatAxis(candle.t, this.tfSec, this.tz), x, box.time.y + 4)
      lastX = x
    }
  }

  drawReplayHead(ctx, box, yOf) {
    if (this.asof == null || !this.candles.length) return
    const last = this.candles[this.candles.length - 1]
    const x = this.xOfIndex(this.candles.length - 1, box)
    if (x < box.plot.x || x > box.plot.x + box.plot.w) return
    const y = yOf(last.c)
    ctx.save()
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(215,222,231,0.7)'
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.moveTo(x, box.plot.y)
    ctx.lineTo(x, box.time.y + 1)
    ctx.stroke()
    if (y >= box.plot.y && y <= box.plot.y + box.plot.h) {
      ctx.setLineDash([1, 3])
      ctx.beginPath()
      ctx.moveTo(box.plot.x, y)
      ctx.lineTo(box.plot.x + box.plot.w, y)
      ctx.stroke()
    }
    const label = formatHm(this.asof, this.tz)
    ctx.setLineDash([])
    ctx.font = '11px Segoe UI, sans-serif'
    const tw = ctx.measureText(label).width + 12
    const tx = Math.min(box.plot.x + box.plot.w - tw, Math.max(box.plot.x, x - tw / 2))
    const ty = box.time.y + 3
    ctx.fillStyle = '#363a45'
    ctx.beginPath()
    ctx.roundRect(tx, ty, tw, 16, 3)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, tx + tw / 2, ty + 8)
    ctx.restore()
  }

  drawLegend(ctx, box) {
    const candle = this.cross?.candle || this.candles[this.candles.length - 1]
    if (!candle) return
    const up = candle.c >= candle.o
    const chg = candle.o ? ((candle.c - candle.o) / candle.o) * 100 : 0
    const text = `O ${fmtPrice(candle.o)}  H ${fmtPrice(candle.h)}  L ${fmtPrice(candle.l)}  C ${fmtPrice(candle.c)}  ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%  V ${fmtCompact(candle.v)}`
    ctx.font = '12px Segoe UI, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = up ? UP_TEXT : DOWN
    ctx.fillText(text, box.plot.x + 8, box.plot.y + 6)
  }

  drawCross(ctx, box, yOf) {
    const time = this.cross ? this.timeAtIndex(this.indexAtX(this.cross.x, box)) : this.extTime
    const price = this.cross ? this.cross.price : this.extPrice
    const y = this.cross ? this.cross.y : price == null ? null : yOf(price)
    if (time == null && y == null) return
    ctx.save()
    ctx.setLineDash([3, 3])
    ctx.strokeStyle = 'rgba(215,222,231,0.35)'
    ctx.lineWidth = 1
    if (time != null) {
      const x = this.xOfTime(time, box)
      if (x >= box.plot.x && x <= box.plot.x + box.plot.w) {
        ctx.beginPath()
        ctx.moveTo(x, box.plot.y)
        ctx.lineTo(x, box.plot.y + box.plot.h)
        ctx.stroke()
      }
    }
    if (y != null && y >= box.plot.y && y <= box.plot.y + box.plot.h) {
      ctx.beginPath()
      ctx.moveTo(box.plot.x, y)
      ctx.lineTo(box.plot.x + box.plot.w, y)
      ctx.stroke()
      const label = fmtPrice(price)
      ctx.font = '11px Segoe UI, sans-serif'
      ctx.setLineDash([])
      ctx.fillStyle = '#2c3848'
      const width = ctx.measureText(label).width + 10
      ctx.fillRect(box.priceAxis + 2, y - 8, width, 16)
      ctx.fillStyle = TEXT
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, box.priceAxis + 7, y)
      if (time != null) {
        const stamp = formatTs(time, this.tz)
        const tw = ctx.measureText(stamp).width + 8
        const x = Math.min(box.plot.x + box.plot.w - tw, Math.max(box.plot.x, this.xOfTime(time, box) - tw / 2))
        ctx.fillStyle = '#2c3848'
        ctx.fillRect(x, box.time.y + 2, tw, 16)
        ctx.fillStyle = TEXT
        ctx.textAlign = 'center'
        ctx.fillText(stamp, x + tw / 2, box.time.y + 10)
      }
    }
    ctx.restore()
  }

  drawProfiles(ctx, box, yOf) {
    const items = this.drawings.filter((d) => d.type === 'vp')
    if (this.tool === 'vp' && this.draft?.type === 'vp') items.push({ id: 'draft', type: 'vp', t0: this.draft.a.t, t1: this.draft.b.t, draft: true })
    ctx.save()
    ctx.beginPath()
    ctx.rect(box.plot.x, box.plot.y, box.plot.w, box.plot.h)
    ctx.clip()
    for (const drawing of items) {
      const profile = this.profileFor(drawing)
      if (!profile) continue
      const xA = this.xOfTime(Math.min(drawing.t0, drawing.t1), box)
      const xB = this.xOfTime(Math.max(drawing.t0, drawing.t1), box)
      const width = Math.max(8, Math.abs(xB - xA) * 0.38)
      let maxV = 0
      for (const bin of profile.bins) if (bin.volume > maxV) maxV = bin.volume
      if (!(maxV > 0)) continue
      for (const bin of profile.bins) {
        const y0 = yOf(bin.price)
        const y1 = yOf(bin.price + profile.binSize)
        const top = Math.min(y0, y1)
        const bh = Math.max(1, Math.abs(y1 - y0) - 0.4)
        ctx.fillStyle = bin.poc ? 'rgba(230,184,77,0.9)' : bin.va ? 'rgba(41,98,255,0.45)' : 'rgba(139,151,166,0.28)'
        ctx.fillRect(xA, top, (bin.volume / maxV) * width, bh)
      }
      ctx.setLineDash([4, 3])
      ctx.strokeStyle = GOLD
      ctx.lineWidth = 1
      this.hline(ctx, yOf(profile.pocPrice), xA, xB)
      ctx.strokeStyle = '#7aa2f7'
      this.hline(ctx, yOf(profile.vah), xA, xB)
      this.hline(ctx, yOf(profile.val), xA, xB)
      ctx.setLineDash([])
      ctx.fillStyle = GOLD
      ctx.font = '11px Segoe UI, sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText(`POC ${fmtPrice(profile.pocPrice)}`, xA + 4, yOf(profile.pocPrice) - 2)
    }
    ctx.restore()
  }

  drawRects(ctx, box) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(box.plot.x, box.plot.y, box.plot.w, box.plot.h)
    ctx.clip()
    const items = this.drawings.filter((d) => d.type === 'rect')
    if (this.tool === 'rect' && this.draft?.type === 'rect') items.push({ id: 'draft', type: 'rect', a: this.draft.a, b: this.draft.b })
    for (const drawing of items) {
      const x0 = this.xOfTime(drawing.a.t, box)
      const x1 = this.xOfTime(drawing.b.t, box)
      const y0 = this.yOf(drawing.a.p, box)
      const y1 = this.yOf(drawing.b.p, box)
      ctx.fillStyle = 'rgba(158,183,229,0.12)'
      ctx.strokeStyle = drawing.id === this.selectedId ? GOLD : '#9eb7e5'
      ctx.lineWidth = drawing.id === this.selectedId ? 1.6 : 1
      const left = Math.min(x0, x1)
      const right = Math.max(x0, x1)
      const top = Math.min(y0, y1)
      const bot = Math.max(y0, y1)
      ctx.fillRect(left, top, right - left, bot - top)
      ctx.strokeRect(left, top, right - left, bot - top)
      if (drawing.id === this.selectedId) {
        const midY = (top + bot) / 2
        ctx.save()
        ctx.setLineDash([4, 3])
        ctx.strokeStyle = 'rgba(180,198,220,0.85)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(left, midY)
        ctx.lineTo(right, midY)
        ctx.stroke()
        ctx.restore()
        const pts = this.rectHandles(drawing, box)
        for (const name of ['top', 'bottom', 'left', 'right']) this.handleEdge(ctx, pts[name][0], pts[name][1])
        for (const name of ['tl', 'tr', 'bl', 'br']) this.handleCorner(ctx, pts[name][0], pts[name][1])
      }
    }
    ctx.restore()
  }

  drawPois(ctx, box) {
    const items = this.pois
    if (!items?.length) return
    ctx.save()
    ctx.beginPath()
    ctx.rect(box.plot.x, box.plot.y, box.plot.w, box.plot.h)
    ctx.clip()
    ctx.font = '11px Segoe UI, sans-serif'
    ctx.textBaseline = 'top'
    for (const poi of items) {
      const x0 = this.xOfTime(poi.t0, box)
      const x1 = this.xOfTime(poi.t1 ?? poi.t0, box)
      const y0 = this.yOf(poi.hi, box)
      const y1 = this.yOf(poi.lo, box)
      const left = Math.min(x0, x1)
      const right = Math.max(x0, x1)
      const top = Math.min(y0, y1)
      const bot = Math.max(y0, y1)
      if (right < box.plot.x || left > box.plot.x + box.plot.w) continue
      if (bot < box.plot.y || top > box.plot.y + box.plot.h) continue
      const cLeft = Math.max(box.plot.x - 2, left)
      const cRight = Math.min(box.plot.x + box.plot.w + 2, right)
      const bull = poi.side === 1
      const mitigated = !!poi.tapped
      // Mitigated: lebih pudar; ujung kanan sudah terpotong di t1 = candle penutup
      ctx.fillStyle = mitigated
        ? (bull ? 'rgba(22,224,69,0.05)' : 'rgba(225,50,15,0.05)')
        : (bull ? 'rgba(22,224,69,0.12)' : 'rgba(225,50,15,0.12)')
      ctx.strokeStyle = mitigated
        ? (bull ? 'rgba(22,224,69,0.35)' : 'rgba(225,50,15,0.35)')
        : (bull ? 'rgba(22,224,69,0.75)' : 'rgba(225,50,15,0.75)')
      ctx.lineWidth = 1
      ctx.fillRect(cLeft, top, Math.max(2, cRight - cLeft), Math.max(2, bot - top))
      ctx.strokeRect(left, top, Math.max(2, right - left), Math.max(2, bot - top))
      const midY = (top + bot) / 2
      ctx.save()
      ctx.setLineDash([4, 3])
      ctx.strokeStyle = mitigated
        ? (bull ? 'rgba(22,224,69,0.2)' : 'rgba(225,50,15,0.2)')
        : (bull ? 'rgba(22,224,69,0.45)' : 'rgba(225,50,15,0.45)')
      ctx.beginPath()
      ctx.moveTo(cLeft, midY)
      ctx.lineTo(cRight, midY)
      ctx.stroke()
      ctx.restore()
      if (poi.tValid != null) {
        const xValid = this.xOfTime(poi.tValid, box)
        if (xValid > left + 1 && xValid <= right + 1 && xValid >= box.plot.x && xValid <= box.plot.x + box.plot.w) {
          ctx.beginPath()
          ctx.moveTo(xValid, top)
          ctx.lineTo(xValid, bot)
          ctx.stroke()
        }
      }
      ctx.fillStyle = mitigated
        ? (bull ? 'rgba(180,255,200,0.55)' : 'rgba(255,200,190,0.55)')
        : (bull ? 'rgba(180,255,200,0.95)' : 'rgba(255,200,190,0.95)')
      ctx.textAlign = 'left'
      const label = poi.label || 'POI'
      const tx = Math.min(Math.max(left + 4, box.plot.x + 2), Math.max(box.plot.x + 2, cRight - 48))
      const ty = Math.min(Math.max(top + 3, box.plot.y + 2), box.plot.y + box.plot.h - 14)
      if (tx <= cRight - 10) ctx.fillText(label, tx, ty)
    }
    ctx.restore()
  }

  drawLines(ctx, box, yOf) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(box.plot.x, 0, box.plot.w, this.h)
    ctx.clip()
    const trends = this.drawings.filter((d) => d.type === 'trend')
    if (this.tool === 'trend' && this.draft?.type === 'trend') trends.push({ id: 'draft', a: this.draft.a, b: this.draft.b })
    for (const drawing of trends) {
      const x0 = this.xOfTime(drawing.a.t, box)
      const y0 = this.yOf(drawing.a.p, box)
      const x1 = this.xOfTime(drawing.b.t, box)
      const y1 = this.yOf(drawing.b.p, box)
      ctx.strokeStyle = drawing.id === this.selectedId ? '#fff' : GOLD
      ctx.lineWidth = drawing.id === this.selectedId ? 1.8 : 1.4
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
      if (drawing.id === this.selectedId) {
        this.handle(ctx, x0, y0)
        this.handle(ctx, x1, y1)
      }
    }
    for (const drawing of this.drawings) {
      if (drawing.type === 'hline') {
        const y = yOf(drawing.p)
        ctx.strokeStyle = drawing.id === this.selectedId ? '#fff' : '#c792ea'
        ctx.lineWidth = 1
        ctx.setLineDash([])
        this.hline(ctx, y, box.plot.x, box.plot.x + box.plot.w)
        this.tag(ctx, box.plot.x + 6, y - 8, fmtPrice(drawing.p), '#c792ea')
      } else if (drawing.type === 'vline') {
        const x = this.xOfTime(drawing.t, box)
        ctx.strokeStyle = drawing.id === this.selectedId ? '#fff' : '#80cbc4'
        ctx.beginPath()
        ctx.moveTo(x, box.plot.y)
        ctx.lineTo(x, box.plot.y + box.plot.h)
        ctx.stroke()
        this.tag(ctx, x + 4, box.plot.y + 18, formatTs(drawing.t, this.tz), '#80cbc4')
      }
    }
    ctx.restore()
  }

  drawPositions(ctx, box, yOf) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(box.plot.x, box.plot.y, box.plot.w, box.plot.h)
    ctx.clip()
    for (const drawing of this.drawings) {
      if (drawing.type !== 'long' && drawing.type !== 'short') continue
      const [x0, x1] = this.positionSpan(drawing, box)
      const yE = yOf(drawing.entry)
      const yS = yOf(drawing.sl)
      const yT = yOf(drawing.tp)
      ctx.fillStyle = 'rgba(8,153,129,0.14)'
      ctx.fillRect(x0, Math.min(yE, yT), x1 - x0, Math.abs(yT - yE))
      ctx.fillStyle = 'rgba(242,54,69,0.14)'
      ctx.fillRect(x0, Math.min(yE, yS), x1 - x0, Math.abs(yS - yE))
      const selected = drawing.id === this.selectedId
      ctx.lineWidth = selected ? 1.6 : 1
      ctx.strokeStyle = '#089981'
      this.hline(ctx, yT, x0, x1)
      ctx.strokeStyle = DOWN
      this.hline(ctx, yS, x0, x1)
      ctx.strokeStyle = selected ? '#fff' : drawing.type === 'long' ? BUY : DOWN
      this.hline(ctx, yE, x0, x1)
      const status = drawing.result?.status || '…'
      const word = { wait: 'MENUNGGU', open: 'TERBUKA', tp: 'TP', sl: 'SL' }[status] || '…'
      const exit = drawing.result?.exit
      const usd = Number.isFinite(exit) ? (exit - drawing.entry) * (drawing.type === 'long' ? 1 : -1) * 100 * (drawing.lot || this.lot) : null
      const usdText = usd == null ? '' : `  ${usd >= 0 ? '+' : ''}${usd.toFixed(2)} USD`
      this.tag(ctx, x0 + 4, Math.min(yE, yT, yS) - 18, `${drawing.type === 'long' ? 'BUY' : 'SELL'} ${drawing.lot || this.lot}  ${word}${usdText}`, drawing.type === 'long' ? BUY : DOWN)
      this.tag(ctx, x1 + 4, yE - 7, fmtPrice(drawing.entry), '#d7dee7')
      this.tag(ctx, x1 + 4, yT - 7, `TP ${fmtPrice(drawing.tp)}`, UP_TEXT)
      this.tag(ctx, x1 + 4, yS - 7, `SL ${fmtPrice(drawing.sl)}`, DOWN)
      if (selected) {
        this.handle(ctx, (x0 + x1) / 2, yE)
        this.handle(ctx, (x0 + x1) / 2, yT)
        this.handle(ctx, (x0 + x1) / 2, yS)
      }
    }
    ctx.restore()
  }

  positionSpan(drawing, box) {
    const xStart = this.xOfTime(drawing.t, box)
    const endT = drawing.result?.final ? drawing.result.exitT : this.asof ?? this.candles[this.candles.length - 1]?.t ?? drawing.t
    let xEnd = this.xOfTime(Math.max(endT, drawing.t), box)
    const minEnd = this.xOfIndex(this.fractionalIndex(drawing.t) + 6, box)
    if (xEnd < minEnd) xEnd = minEnd
    return [Math.min(xStart, xEnd), Math.max(xStart, xEnd)]
  }

  profileFor(drawing) {
    const t0 = Math.min(drawing.t0, drawing.t1)
    const t1 = Math.max(drawing.t0, drawing.t1)
    const last = this.candles.length ? this.candles[this.candles.length - 1].t : 0
    const key = `${t0}:${t1}:${this.candles.length}:${last}:${this.va}`
    if (this._vpKey.get(drawing.id) === key) return this._vp.get(drawing.id)
    const slice = []
    for (const candle of this.candles) {
      if (candle.t >= t0 && candle.t <= t1) slice.push(candle)
    }
    const profile = buildProfile(slice, { vaPercent: this.va, targetRows: 48 })
    this._vpKey.set(drawing.id, key)
    this._vp.set(drawing.id, profile)
    return profile
  }

  hline(ctx, y, x0, x1) {
    ctx.beginPath()
    ctx.moveTo(x0, y)
    ctx.lineTo(x1, y)
    ctx.stroke()
  }

  rectHandles(drawing, box) {
    const x0 = this.xOfTime(Math.min(drawing.a.t, drawing.b.t), box)
    const x1 = this.xOfTime(Math.max(drawing.a.t, drawing.b.t), box)
    const y0 = this.yOf(Math.max(drawing.a.p, drawing.b.p), box)
    const y1 = this.yOf(Math.min(drawing.a.p, drawing.b.p), box)
    const mx = (x0 + x1) / 2
    const my = (y0 + y1) / 2
    return {
      tl: [x0, y0],
      tr: [x1, y0],
      bl: [x0, y1],
      br: [x1, y1],
      top: [mx, y0],
      bottom: [mx, y1],
      left: [x0, my],
      right: [x1, my],
    }
  }

  handleEdge(ctx, x, y) {
    ctx.save()
    ctx.fillStyle = BG
    ctx.strokeStyle = '#4c8dff'
    ctx.lineWidth = 1.5
    ctx.fillRect(x - 4, y - 4, 8, 8)
    ctx.strokeRect(x - 4, y - 4, 8, 8)
    ctx.restore()
  }

  handleCorner(ctx, x, y) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(x, y, 4.5, 0, Math.PI * 2)
    ctx.fillStyle = BG
    ctx.fill()
    ctx.strokeStyle = '#4c8dff'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.restore()
  }

  moveRect(drawing, part, hit) {
    const side = this.drag.side
    const setT = (left) => {
      const key = left === side.leftIsA ? 'a' : 'b'
      drawing[key] = { t: hit.t, p: drawing[key].p }
    }
    const setP = (top) => {
      const key = top === side.topIsA ? 'a' : 'b'
      drawing[key] = { t: drawing[key].t, p: hit.p }
    }
    if (part === 'left' || part === 'tl' || part === 'bl') setT(true)
    if (part === 'right' || part === 'tr' || part === 'br') setT(false)
    if (part === 'top' || part === 'tl' || part === 'tr') setP(true)
    if (part === 'bottom' || part === 'bl' || part === 'br') setP(false)
  }

  handle(ctx, x, y) {
    ctx.save()
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = '#131722'
    ctx.lineWidth = 1
    ctx.fillRect(x - 3.5, y - 3.5, 7, 7)
    ctx.strokeRect(x - 3.5, y - 3.5, 7, 7)
    ctx.restore()
  }

  tag(ctx, x, y, text, color) {
    ctx.save()
    ctx.font = '11px Segoe UI, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    const width = ctx.measureText(text).width + 8
    ctx.fillStyle = 'rgba(11,14,17,0.88)'
    ctx.fillRect(x, y, width, 15)
    ctx.fillStyle = color
    ctx.fillText(text, x + 4, y + 2)
    ctx.restore()
  }

  hitTest(point, box) {
    if (this.selectedId) {
      const selected = this.drawings.find((d) => d.id === this.selectedId)
      const handle = selected && this.hitHandle(selected, point, box)
      if (handle) return { id: selected.id, part: handle }
    }
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const part = this.hitBody(this.drawings[i], point, box)
      if (part) return { id: this.drawings[i].id, part }
    }
    return null
  }

  hitHandle(drawing, point, box) {
    const near = (x, y) => Math.hypot(point.x - x, point.y - y) <= 8
    if (drawing.type === 'trend') {
      if (near(this.xOfTime(drawing.a.t, box), this.yOf(drawing.a.p, box))) return 'a'
      if (near(this.xOfTime(drawing.b.t, box), this.yOf(drawing.b.p, box))) return 'b'
    }
    if (drawing.type === 'rect') {
      const pts = this.rectHandles(drawing, box)
      let best = null
      for (const [name, xy] of Object.entries(pts)) {
        const dist = Math.hypot(point.x - xy[0], point.y - xy[1])
        if (dist <= 8 && (!best || dist < best.dist)) best = { name, dist }
      }
      if (best) return best.name
    }
    if (drawing.type === 'vp') {
      if (Math.abs(point.x - this.xOfTime(drawing.t0, box)) <= 6) return 't0'
      if (Math.abs(point.x - this.xOfTime(drawing.t1, box)) <= 6) return 't1'
    }
    if (drawing.type === 'long' || drawing.type === 'short') {
      const mid = (this.positionSpan(drawing, box)[0] + this.positionSpan(drawing, box)[1]) / 2
      if (near(mid, this.yOf(drawing.tp, box))) return 'tp'
      if (near(mid, this.yOf(drawing.sl, box))) return 'sl'
      if (near(mid, this.yOf(drawing.entry, box))) return 'entry'
    }
    return null
  }

  hitBody(drawing, point, box) {
    if (drawing.type === 'hline') return Math.abs(point.y - this.yOf(drawing.p, box)) <= 5 ? 'p' : null
    if (drawing.type === 'vline') return Math.abs(point.x - this.xOfTime(drawing.t, box)) <= 5 ? 't' : null
    if (drawing.type === 'trend') {
      const x0 = this.xOfTime(drawing.a.t, box)
      const y0 = this.yOf(drawing.a.p, box)
      const x1 = this.xOfTime(drawing.b.t, box)
      const y1 = this.yOf(drawing.b.p, box)
      return distSeg(point.x, point.y, x0, y0, x1, y1) <= 6 ? 'body' : null
    }
    if (drawing.type === 'rect') {
      const x0 = this.xOfTime(drawing.a.t, box)
      const x1 = this.xOfTime(drawing.b.t, box)
      const y0 = this.yOf(drawing.a.p, box)
      const y1 = this.yOf(drawing.b.p, box)
      const left = Math.min(x0, x1)
      const right = Math.max(x0, x1)
      const top = Math.min(y0, y1)
      const bot = Math.max(y0, y1)
      const inside = point.x >= left && point.x <= right && point.y >= top && point.y <= bot
      return inside ? 'body' : null
    }
    if (drawing.type === 'vp') {
      if (Math.abs(point.x - this.xOfTime(drawing.t0, box)) <= 6) return 't0'
      if (Math.abs(point.x - this.xOfTime(drawing.t1, box)) <= 6) return 't1'
      return null
    }
    if (drawing.type === 'long' || drawing.type === 'short') {
      const [x0, x1] = this.positionSpan(drawing, box)
      const ys = [drawing.entry, drawing.sl, drawing.tp].map((p) => this.yOf(p, box))
      const top = Math.min(...ys)
      const bot = Math.max(...ys)
      if (point.x < x0 - 4 || point.x > x1 + 4) return null
      if (Math.abs(point.y - this.yOf(drawing.entry, box)) <= 5) return 'entry'
      if (Math.abs(point.y - this.yOf(drawing.sl, box)) <= 5) return 'sl'
      if (Math.abs(point.y - this.yOf(drawing.tp, box)) <= 5) return 'tp'
      if (point.y >= top && point.y <= bot) return 'body'
    }
    return null
  }

  local(event) {
    const rect = this.canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  insidePlot(point, box) {
    return point.x >= box.plot.x && point.x <= box.plot.x + box.plot.w && point.y >= box.plot.y && point.y <= box.plot.y + box.plot.h
  }

  _bind() {
    this.canvas.addEventListener('pointerdown', (event) => this.onDown(event))
    this.canvas.addEventListener('pointermove', (event) => this.onMove(event))
    this.canvas.addEventListener('pointerup', (event) => this.onUp(event))
    this.canvas.addEventListener('pointerleave', () => {
      this._hover = false
      if (this.drag) return
      if (this.cross) {
        this.cross = null
        this.hooks.onCross?.(null)
        this.requestRender()
      }
    })
    this.canvas.addEventListener('wheel', (event) => this.onWheel(event), { passive: false })
    this.canvas.addEventListener('dblclick', () => {
      if (this.tool !== 'cursor') return
      this.view.bars = 140
      this.autoScale = true
      this.priceView = null
      this.jumpToEnd()
      this.hooks.onFollow?.()
      this.render()
    })
  }

  onDown(event) {
    if (event.button !== 0) return
    const point = this.local(event)
    const box = this.layout()
    try {
      this.canvas.setPointerCapture(event.pointerId)
    } catch {
      /* abaikan */
    }
    const onPrice = point.x >= box.priceAxis && point.y >= box.plot.y && point.y <= box.plot.y + box.plot.h
    if (onPrice) {
      if (this.autoScale) {
        this.autoScale = false
        this.hooks.onAuto?.(false)
      }
      this.drag = { kind: 'price', y: event.clientY, anchorY: point.y, min: this._scale.min, max: this._scale.max }
      return
    }
    if (!this.insidePlot(point, box)) return
    if (this.pick) {
      const candle = this.candleAtX(point.x, box)
      if (candle) this.hooks.onPick?.(candle)
      return
    }
    if (this.tool !== 'cursor') {
      this.placeTool(point, box)
      return
    }
    const hit = this.hitTest(point, box)
    this.drag = {
      kind: 'pending',
      x: event.clientX,
      y: event.clientY,
      px: point.x,
      py: point.y,
      hit,
      right: this.view.right,
      min: this._scale.min,
      max: this._scale.max,
    }
  }

  placeTool(point, box) {
    const snap = this.snap(point, box)
    if (!snap || snap.t == null) return
    const two = this.tool === 'trend' || this.tool === 'rect' || this.tool === 'vp'
    if (two && this.draft?.type === this.tool) {
      this.draft.b = this.aim(point, box)
      this.finishDraft()
      return
    }
    if (two) {
      const anchor = { t: snap.t, p: snap.p }
      this.draft = { type: this.tool, a: anchor, b: { t: anchor.t, p: anchor.p } }
      this._draftX = point.x
      this._draftY = point.y
      this._draftDrag = false
      this.hooks.onLive?.()
      this.render()
      return
    }
    if (this.tool === 'hline') this.commit({ type: 'hline', p: snap.p })
    else if (this.tool === 'vline') this.commit({ type: 'vline', t: snap.t })
    else if (this.tool === 'long' || this.tool === 'short') this.commit(this.makePosition(this.tool, snap))
  }

  finishDraft() {
    const draft = this.draft
    this.draft = null
    this._draftDrag = false
    this.hooks.onLive?.()
    if (!draft) return
    if (draft.type === 'vp') {
      if (draft.a.t === draft.b.t) return
      this.commit({ type: 'vp', t0: draft.a.t, t1: draft.b.t })
      return
    }
    if (draft.a.t === draft.b.t && draft.a.p === draft.b.p) return
    this.commit({ type: draft.type, a: { t: draft.a.t, p: draft.a.p }, b: { t: draft.b.t, p: draft.b.p } })
  }

  makePosition(type, snap) {
    const risk = this.defaultRisk()
    const entry = snap.p
    const sign = type === 'long' ? 1 : -1
    return {
      type,
      t: snap.t,
      entry,
      sl: round2(entry - sign * risk),
      tp: round2(entry + sign * risk * 2),
      lot: this.lot,
    }
  }

  defaultRisk() {
    const candles = this.candles
    const n = Math.min(20, candles.length)
    if (!n) return 3
    let sum = 0
    for (let i = candles.length - n; i < candles.length; i++) sum += candles[i].h - candles[i].l
    return Math.min(40, Math.max(0.3, (sum / n) * 1.2))
  }

  commit(drawing) {
    drawing.id = uid()
    this.hooks.beforeChange?.()
    this.drawings.push(drawing)
    this.selectedId = drawing.id
    this.setTool('cursor')
    this.hooks.onTool?.('cursor')
    this.hooks.onChange?.()
    this.hooks.onSelect?.(drawing.id)
    this.render()
  }

  onMove(event) {
    const point = this.local(event)
    const box = this.layout()
    this._point = point
    this._box = box
    this._hover = true
    this.shift = !!event.shiftKey
    if (this.drag?.kind === 'pending') {
      const moved = Math.hypot(event.clientX - this.drag.x, event.clientY - this.drag.y)
      if (moved > 4) {
        if (this.drag.hit) this.beginDrawDrag(point, box)
        else {
          this.drag.kind = 'pan'
          this.hooks.onUserPan?.()
        }
      }
    }
    if (this.drag?.kind === 'pan') {
      const slot = box.plot.w / this.view.bars
      this.view.right = this.drag.right - (event.clientX - this.drag.x) / slot
      if (!this.autoScale) {
        const span = this.drag.max - this.drag.min || 1
        const shift = ((event.clientY - this.drag.y) / box.plot.h) * span
        this.priceView = { min: this.drag.min + shift, max: this.drag.max + shift }
      }
      this.clamp()
      this.updateCross(point, box)
      this.requestRender()
      return
    }
    if (this.drag?.kind === 'price') {
      const factor = Math.exp((event.clientY - this.drag.y) / 190)
      this.applyPriceZoom(factor, this.drag.anchorY, box, this.drag)
      this.requestRender()
      return
    }
    if (this.drag?.kind === 'draw') {
      this.applyDraw(point, box)
      this.requestRender()
      return
    }
    if (this.draft && this.tool !== this.draft.type) {
      this.draft = null
      this._draftDrag = false
      this.hooks.onLive?.()
    } else if (this.draft) {
      if ((event.buttons & 1) && this._draftX != null && Math.hypot(point.x - this._draftX, point.y - this._draftY) > 6) {
        this._draftDrag = true
      }
      this.draft.b = this.aim(point, box)
      this.requestRender()
      this.hooks.onLive?.()
    }
    if (!this.insidePlot(point, box)) {
      if (this.cross) {
        this.cross = null
        this.hooks.onCross?.(null)
        this.requestRender()
      }
      this.canvas.style.cursor = point.x >= box.priceAxis ? 'ns-resize' : 'default'
      return
    }
    const hit = this.tool === 'cursor' ? this.hitTest(point, box) : null
    this.canvas.style.cursor = this.tool !== 'cursor' || this.pick ? 'crosshair' : this.cursorFor(hit)
    this.updateCross(point, box)
    this.requestRender()
  }

  beginDrawDrag(point, box) {
    const drawing = this.drawings.find((d) => d.id === this.drag.hit.id)
    if (!drawing) {
      this.drag = null
      return
    }
    this.hooks.beforeChange?.()
    if (drawing.type === 'long' || drawing.type === 'short') drawing.result = null
    this.drag.kind = 'draw'
    this.drag.part = this.drag.hit.part
    this.drag.id = drawing.id
    this.drag.originPrice = this.priceAt(this.drag.py, box)
    this.drag.originTime = this.timeAtIndex(this.indexAtX(this.drag.px, box))
    this.drag.snap = JSON.parse(JSON.stringify(drawing))
    if (drawing.type === 'rect') {
      this.drag.side = {
        leftIsA: drawing.a.t <= drawing.b.t,
        topIsA: drawing.a.p >= drawing.b.p,
      }
    }
    this.selectedId = drawing.id
    this.hooks.onSelect?.(drawing.id)
  }

  applyDraw(point, box) {
    const drawing = this.drawings.find((d) => d.id === this.drag.id)
    const snap = this.drag.snap
    if (!drawing || !snap) return
    const dp = this.priceAt(point.y, box) - this.drag.originPrice
    const nowT = this.timeAtIndex(this.indexAtX(point.x, box))
    const dt = (nowT ?? 0) - (this.drag.originTime ?? 0)
    const part = this.drag.part
    if (drawing.type === 'hline') drawing.p = round2(snap.p + dp)
    else if (drawing.type === 'vline') drawing.t = Math.round(snap.t + dt)
    else if (drawing.type === 'trend') {
      if (part === 'a' || part === 'b') {
        const snapped = this.snap(point, box)
        const other = part === 'a' ? drawing.b : drawing.a
        drawing[part] = { t: snapped.t, p: this.shift ? other.p : snapped.p }
      } else if (this.shift) {
        const level = round2(snap.a.p)
        drawing.a = { t: Math.round(snap.a.t + dt), p: level }
        drawing.b = { t: Math.round(snap.b.t + dt), p: level }
      } else {
        drawing.a = { t: Math.round(snap.a.t + dt), p: round2(snap.a.p + dp) }
        drawing.b = { t: Math.round(snap.b.t + dt), p: round2(snap.b.p + dp) }
      }
    } else if (drawing.type === 'rect') {
      if (part === 'body') {
        drawing.a = { t: Math.round(snap.a.t + dt), p: round2(snap.a.p + dp) }
        drawing.b = { t: Math.round(snap.b.t + dt), p: round2(snap.b.p + dp) }
      } else {
        this.moveRect(drawing, part, this.snap(point, box))
      }
    } else if (drawing.type === 'vp') {
      const snapped = this.snap(point, box)
      if (part === 't0') drawing.t0 = snapped.t
      else if (part === 't1') drawing.t1 = snapped.t
    } else if (drawing.type === 'long' || drawing.type === 'short') {
      if (part === 'sl') drawing.sl = round2(snap.sl + dp)
      else if (part === 'tp') drawing.tp = round2(snap.tp + dp)
      else if (part === 'entry') {
        drawing.entry = round2(snap.entry + dp)
        drawing.sl = round2(snap.sl + dp)
        drawing.tp = round2(snap.tp + dp)
      } else {
        drawing.entry = round2(snap.entry + dp)
        drawing.sl = round2(snap.sl + dp)
        drawing.tp = round2(snap.tp + dp)
        drawing.t = Math.round(snap.t + dt)
      }
    }
    this.hooks.onLive?.()
  }

  onUp() {
    if (this.draft && this._draftDrag && this.tool === this.draft.type) {
      if (this._point && this._box) this.draft.b = this.aim(this._point, this._box)
      this._draftDrag = false
      this.finishDraft()
    }
    if (!this.drag) return
    const ended = this.drag
    this.drag = null
    if (ended.kind === 'pending') {
      if (ended.hit) {
        this.selectedId = ended.hit.id
        this.hooks.onSelect?.(ended.hit.id)
      } else if (this.selectedId) {
        this.selectedId = null
        this.hooks.onSelect?.(null)
      }
      this.render()
      return
    }
    if (ended.kind === 'draw') {
      const drawing = this.drawings.find((d) => d.id === ended.id)
      if (drawing?.type === 'long' || drawing?.type === 'short') drawing.result = null
      this.hooks.onChange?.()
    }
    if (ended.kind === 'pan') this.hooks.onView?.()
    this.render()
  }

  cursorFor(hit) {
    if (!hit) return 'default'
    const map = {
      top: 'ns-resize',
      bottom: 'ns-resize',
      left: 'ew-resize',
      right: 'ew-resize',
      tl: 'nwse-resize',
      br: 'nwse-resize',
      tr: 'nesw-resize',
      bl: 'nesw-resize',
      tp: 'ns-resize',
      sl: 'ns-resize',
      entry: 'ns-resize',
      p: 'ns-resize',
      t: 'ew-resize',
      t0: 'ew-resize',
      t1: 'ew-resize',
      body: 'move',
    }
    return map[hit.part] || 'grab'
  }

  updateCross(point, box) {
    if (this.tool !== 'cursor' && !this.pick) {
      const aimed = this.aim(point, box)
      if (aimed.hit) {
        this.cross = { x: aimed.x, y: aimed.y, candle: null, price: aimed.p }
        this.hooks.onCross?.({ time: aimed.t, price: aimed.p, candle: null })
        return
      }
    }
    const candle = this.candleAtX(point.x, box)
    const price = this.priceAt(point.y, box)
    this.cross = { x: point.x, y: point.y, candle, price }
    this.hooks.onCross?.({ time: candle?.t ?? this.timeAtIndex(this.indexAtX(point.x, box)), price, candle })
  }

  onWheel(event) {
    event.preventDefault()
    const point = this.local(event)
    const box = this.layout()
    const onPrice = point.x >= box.priceAxis && point.y >= box.plot.y && point.y <= box.plot.y + box.plot.h
    if (onPrice || event.ctrlKey || event.metaKey) {
      this.applyPriceZoom(event.deltaY < 0 ? 0.85 : 1.18, point.y, box)
      this.render()
      return
    }
    const rel = Math.min(1, Math.max(0, (point.x - box.plot.x) / (box.plot.w || 1)))
    const left = this.view.right - this.view.bars
    const anchor = left + rel * this.view.bars
    const factor = event.deltaY < 0 ? 0.85 : 1.18
    this.view.bars = Math.max(8, Math.min(2000, this.view.bars * factor))
    this.view.right = anchor + (1 - rel) * this.view.bars
    this.clamp()
    this.render()
    clearTimeout(this._wheel)
    this._wheel = setTimeout(() => this.hooks.onView?.(), 160)
  }

  applyPriceZoom(factor, anchorY, box, base) {
    let min = this._scale.min
    let max = this._scale.max
    const wasAuto = this.autoScale
    if (base) {
      min = base.min
      max = base.max
    }
    const span = max - min || 1
    const y = Math.min(box.plot.y + box.plot.h, Math.max(box.plot.y, anchorY))
    const t = (y - box.plot.y) / (box.plot.h || 1)
    const price = max - t * span
    const next = Math.min(Math.max(span * factor, 0.2), Math.max(80, Math.abs(price) * 0.5))
    const newMax = price + t * next
    this.priceView = { min: newMax - next, max: newMax }
    this.autoScale = false
    if (wasAuto) this.hooks.onAuto?.(false)
  }
}

function niceStep(range) {
  if (!(range > 0)) return 1
  const rough = range / 6
  const pow = 10 ** Math.floor(Math.log10(rough))
  let best = pow
  let score = Infinity
  for (const mult of [1, 2, 2.5, 5, 10]) {
    const step = mult * pow
    const next = Math.abs(range / step - 6)
    if (next < score) {
      best = step
      score = next
    }
  }
  return best
}
