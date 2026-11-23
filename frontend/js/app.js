import { Chart } from './chart.js'
import { DEFAULT_IND, computeIndicators } from './indicators.js'
import { detectPois, detectPoiSignals, preparePoisForChart, poiTfList } from './poi.js'
import {
  TF_SEC,
  TZ,
  TimeBook,
  bucket,
  formatTs,
  partialFromM1,
  pnlIdr,
  pnlUsd,
  rMultiple,
  seriesUntil,
  zonedToUnix,
} from './series.js'

const KEY = 'gold-chart-v1'
const TFS = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1']
const LIVE_MS = 5000
const TOOLS = [
  ['cursor', 'Kursor', '<path d="M5 3.5 11.2 20l2-6.3L19.5 11.5z" fill="currentColor"/>'],
  ['trend', 'Garis tren', '<path d="M5 18 18 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="5" cy="18" r="1.8" fill="currentColor"/><circle cx="18" cy="6" r="1.8" fill="currentColor"/>'],
  ['hline', 'Garis horizontal', '<path d="M4 12h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="12" r="1.7" fill="currentColor"/><circle cx="16" cy="12" r="1.7" fill="currentColor"/>'],
  ['vline', 'Garis vertikal', '<path d="M12 4v16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="8" r="1.7" fill="currentColor"/><circle cx="12" cy="16" r="1.7" fill="currentColor"/>'],
  ['rect', 'Kotak', '<rect x="4.5" y="6.5" width="15" height="11" fill="none" stroke="currentColor" stroke-width="1.8"/>'],
  ['long', 'Buy', '<path d="M12 19V7M7.5 11 12 6.5 16.5 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'],
  ['short', 'Sell', '<path d="M12 5v12M7.5 13 12 17.5 16.5 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'],
  ['vp', 'Volume profile', '<path d="M5 18V9h3v9H5zm5.5 0V5h3v13h-3zM16 18v-7h3v7h-3z" fill="currentColor"/>'],
]
const DEFAULT_TF = ['M15', 'H1', 'M5', 'H4']

const book = new TimeBook()
const htfCache = new Map()
const htfInflight = new Map()
const poiCache = new Map()
const panes = []
const drawings = []
const undo = []

const state = {
  symbol: 'XAUUSD',
  drawingsBySymbol: {},
  layout: '2h',
  tz: 'WIB',
  lot: 0.01,
  va: 70,
  speed: 10,
  step: 60,
  follow: true,
  syncCross: true,
  magnet: 'low',
  tool: 'cursor',
  cursor: null,
  playing: false,
  armPick: false,
  liveAuto: true,
  active: 0,
  contract: 100,
  tickSize: 0.01,
  tickValue: 0,
  meta: null,
  revision: -1,
  ind: { ...DEFAULT_IND },
}

let tail = Promise.resolve()
let saveTimer = 0
let editorKey = ''
let liveTimer = 0

const $ = (id) => document.getElementById(id)

function enqueue(fn) {
  const run = tail.then(fn, fn)
  tail = run.then(() => {}, () => {})
  return run
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function api(path, opts) {
  const res = await fetch(path, opts)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Permintaan gagal (${res.status})`)
  return data
}

function setBanner(text, error = false) {
  const el = $('banner')
  if (!text) {
    el.hidden = true
    el.textContent = ''
    return
  }
  el.hidden = false
  el.className = error ? 'error' : ''
  el.textContent = text
}

function offset() {
  return TZ[state.tz] || 0
}

function visiblePanes() {
  const n = state.layout === '1' ? 1 : state.layout === '4' ? 4 : 2
  return panes.slice(0, n)
}

function activePane() {
  return panes[state.active] || panes[0]
}

function persistDrawing(drawing) {
  const out = {}
  for (const [key, value] of Object.entries(drawing)) {
    if (key === 'result' || key.startsWith('_')) continue
    out[key] = value
  }
  return out
}

function save() {
  const bySym = state.drawingsBySymbol || {}
  bySym[state.symbol] = drawings.map(persistDrawing)
  const data = {
    symbol: state.symbol,
    drawingsBySymbol: bySym,
    layout: state.layout,
    tz: state.tz,
    lot: state.lot,
    va: state.va,
    speed: state.speed,
    step: state.step,
    follow: state.follow,
    syncCross: state.syncCross,
    magnet: state.magnet,
    liveAuto: state.liveAuto,
    ind: state.ind,
    tool: state.tool,
    cursor: state.cursor,
    active: state.active,
    drawings: drawings.map(persistDrawing),
    panes: panes.map((pane) => ({
      tf: pane.tf,
    })),
  }
  localStorage.setItem(KEY, JSON.stringify(data))
}

function saveSoon() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(save, 400)
}

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null')
  } catch {
    return null
  }
}

function snapshot() {
  undo.push(JSON.stringify(drawings.map(persistDrawing)))
  if (undo.length > 40) undo.shift()
}

function adoptSaved(saved, sym = state.symbol) {
  drawings.length = 0
  const symKey = sym || 'XAUUSD'
  let incoming
  if (state.drawingsBySymbol && Array.isArray(state.drawingsBySymbol[symKey])) {
    incoming = state.drawingsBySymbol[symKey]
  } else if (saved?.drawingsBySymbol && typeof saved.drawingsBySymbol === 'object') {
    incoming = Array.isArray(saved.drawingsBySymbol[symKey]) ? saved.drawingsBySymbol[symKey] : []
  } else if (symKey === 'XAUUSD') {
    incoming = Array.isArray(saved?.drawings)
      ? saved.drawings
      : (saved?.panes || []).flatMap((pane) => pane.drawings || [])
  } else {
    incoming = []
  }
  const seen = new Set()
  for (const drawing of incoming) {
    if (!drawing || seen.has(drawing.id)) continue
    seen.add(drawing.id)
    drawings.push(drawing)
  }
  state.drawingsBySymbol = state.drawingsBySymbol || {}
  state.drawingsBySymbol[symKey] = drawings.map(persistDrawing)
}

function paintAll() {
  for (const pane of panes) pane.chart.requestRender()
}

function selectDrawing(id) {
  for (const pane of panes) pane.chart.selectedId = id
}

async function loadM1(start, end) {
  const data = await api(`/api/candles?symbol=${state.symbol}&tf=M1&start=${Math.floor(start)}&end=${Math.floor(end)}&limit=10000`)
  return data.candles || []
}

function loadHtf(tf) {
  const sym = state.symbol
  const key = `${sym}:${tf}`
  if (htfCache.has(key)) return Promise.resolve(htfCache.get(key))
  if (htfInflight.has(key)) return htfInflight.get(key)
  const job = (async () => {
    const all = []
    let start = 0
    setBanner(`Memuat ${sym} ${tf}…`)
    for (;;) {
      const data = await api(`/api/candles?symbol=${sym}&tf=${tf}&start=${start}&limit=20000`)
      const rows = data.candles || []
      all.push(...rows)
      if (rows.length < 20000) break
      start = rows[rows.length - 1].t + 1
    }
    htfCache.set(key, all)
    htfInflight.delete(key)
    if (state.meta?.ready && state.symbol === sym) setBanner('')
    return all
  })()
  htfInflight.set(key, job)
  return job
}

function applyChartOptions(chart) {
  chart.setOptions({ tz: offset(), va: state.va, lot: state.lot, tfSec: chart.tfSec, magnet: state.magnet, contract: state.contract })
  chart.lot = state.lot
  chart.contract = state.contract
  chart.va = state.va
  chart.tz = offset()
}

async function syncM1(pane, asof) {
  const chart = pane.chart
  if (pane.reset || !chart.candles.length) {
    const i1 = book.indexAt(asof)
    if (i1 < 0) {
      chart.setMessage('Belum ada candle sampai waktu ini')
      chart.setCandles([], { reset: true, tfSec: 60 })
      pane.reset = false
      return
    }
    const lookback = state.ind?.enabled ? 3500 : 500
    const i0 = Math.max(0, i1 - lookback)
    await book.ensure(book.times[i0], book.times[i1], loadM1)
    chart.setNoMore(book.times[i0] === book.first())
    chart.setMessage('')
    chart.setCandles(book.slice(book.times[i0], asof), { tfSec: 60, reset: true })
    pane.reset = false
    return
  }
  const firstT = chart.candles[0]?.t
  if (firstT == null || firstT > asof) {
    pane.reset = true
    await syncM1(pane, asof)
    return
  }
  const last = chart.candles[chart.candles.length - 1].t
  if (last < asof) {
    await book.ensure(last + 1, asof, loadM1)
  }
  const fresh = book.slice(firstT, asof)
  if (!fresh.length) {
    pane.reset = true
    await syncM1(pane, asof)
    return
  }
  chart.setCandles(fresh, { tfSec: 60, follow: state.follow && state.cursor != null })
  chart.setNoMore(!chart.candles.length || chart.candles[0].t === book.first())
}

async function syncHtf(pane, asof, sec) {
  const all = await loadHtf(pane.tf)
  let candles
  if (state.cursor == null) {
    candles = all.slice()
    if (candles.length) {
      const nowSec = Math.floor(Date.now() / 1000)
      const bucketNow = bucket(nowSec, sec)
      const last = candles[candles.length - 1]
      if (last.t >= bucketNow) candles[candles.length - 1] = { ...last, partial: true }
    }
  } else {
    candles = seriesUntil(all, sec, asof)
    const start = bucket(asof, sec)
    await book.ensure(start, asof, loadM1)
    const part = partialFromM1(book.slice(start, asof), sec, asof)
    if (part) candles = candles.concat(part)
  }
  pane.chart.setNoMore(true)
  pane.chart.setMessage(candles.length ? '' : 'Belum ada candle sampai waktu ini')
  pane.chart.setCandles(candles, {
    tfSec: sec,
    reset: pane.reset,
    follow: state.follow && state.cursor != null,
  })
  pane.reset = false
}

async function loadCandleRange(tf, start, end) {
  if (!tf) return []
  const a = Math.floor(start)
  const b = Math.floor(end)
  if (b < a) return []
  if (tf === 'M1') {
    const out = []
    let cursor = a
    while (cursor <= b) {
      const rows = await loadM1(cursor, b)
      if (!rows.length) break
      out.push(...rows)
      const last = rows[rows.length - 1].t
      if (rows.length < 10000 || last >= b) break
      cursor = last + 1
    }
    return out
  }
  const all = await loadHtf(tf)
  return all.filter((c) => c.t >= a && c.t <= b)
}

/** Ambil series MTF untuk rentang chart yang terlihat (+ warmup). */
async function mtfSeriesForPane(pane, tf) {
  if (!tf) return null
  const candles = pane.chart.candles
  if (!candles.length) return null
  const srcSec = TF_SEC[tf]
  const chartSec = TF_SEC[pane.tf] || pane.chart.tfSec || 60
  const vis = pane.chart.visibleTimeRange()
  const warm = Math.max(600, (state.ind.rbLen || 50) * 20, (state.ind.tracerLen || 250) * 3) * srcSec

  let from
  let to
  if (srcSec < chartSec) {
    // Sumber lebih rendah (RB M1 di chart M5): wajib cover jendela terlihat.
    from = (vis ? vis.start : candles[0].t) - warm
    to = (vis ? vis.end : candles[candles.length - 1].t + chartSec) - 1
  } else {
    from = candles[0].t - warm
    to = candles[candles.length - 1].t + chartSec
  }
  from = Math.max(book.first() || 0, from)
  to = Math.min(book.last() || to, to)
  return loadCandleRange(tf, from, to)
}

async function applyIndicators(pane) {
  const chart = pane.chart
  const candles = chart.candles
  if (!candles.length) {
    chart.setIndicators(null)
    chart.setPois([])
    chart.setSignals([])
    return
  }
  try {
    if (!state.ind.enabled) {
      chart.setIndicators(null)
    } else {
      const opts = { chartSec: TF_SEC[pane.tf] || chart.tfSec || 60, symbol: state.symbol }
      if (state.ind.cloudTf && state.ind.cloudTf !== pane.tf) {
        const rows = await mtfSeriesForPane(pane, state.ind.cloudTf)
        if (rows?.length) {
          opts.cloudCandles = rows
          opts.cloudSec = TF_SEC[state.ind.cloudTf]
        }
      }
      if (state.ind.rbTf && state.ind.rbTf !== pane.tf) {
        const rows = await mtfSeriesForPane(pane, state.ind.rbTf)
        if (rows?.length) {
          opts.rbCandles = rows
          opts.rbSec = TF_SEC[state.ind.rbTf]
        }
      }
      chart.setIndicators(computeIndicators(candles, state.ind, opts))
    }
    await applyPois(pane)
  } catch (err) {
    console.error('indikator', err)
    chart.setIndicators(null)
    chart.setPois([])
    chart.setSignals([])
  }
}

async function fullPoiSeriesForTf(tf, chartEnd) {
  const sec = TF_SEC[tf]
  const all = await loadHtf(tf)
  if (!all?.length) return []
  if (state.cursor == null) {
    const nowSec = Math.floor(Date.now() / 1000)
    const bucketNow = bucket(nowSec, sec)
    const last = all[all.length - 1]
    if (last.t >= bucketNow) {
      const copy = all.slice()
      copy[copy.length - 1] = { ...last, partial: true }
      return copy
    }
    return all
  }
  let rows = seriesUntil(all, sec, chartEnd)
  const start = bucket(chartEnd, sec)
  if (book.covers(start, chartEnd)) {
    const part = partialFromM1(book.slice(start, chartEnd), sec, chartEnd)
    if (part) rows = rows.concat(part)
  }
  return rows
}

async function applyPois(pane) {
  const chart = pane.chart
  const candles = chart.candles
  if (!state.ind.showPoi || !candles.length) {
    chart.setPois([])
    chart.setSignals([])
    return
  }
  const tfs = poiTfList(state.ind)
  if (!tfs.length) {
    chart.setPois([])
    chart.setSignals([])
    return
  }
  const chartEnd = state.cursor ?? candles[candles.length - 1].t
  const vis = chart.visibleTimeRange()
  const viewStart = vis ? vis.start : candles[0].t
  const viewEnd = vis ? vis.end : chartEnd
  const detectOpts = {
    maxOpp: state.ind.poiMaxOpp ?? 3,
    maxSameDir: state.ind.poiMaxSameDir ?? 2,
    minExpansionAtr: state.ind.poiMinExpansionAtr ?? 1.0,
    atrLen: state.ind.poiAtrLen ?? 14,
    mitigation: state.ind.poiMitigation === 'half' ? 'half' : 'full',
  }
  const optsKey = `${detectOpts.maxOpp}:${detectOpts.maxSameDir}:${detectOpts.minExpansionAtr}:${detectOpts.atrLen}:${detectOpts.mitigation}`
  const merged = []
  const forSignals = []
  for (const tf of tfs) {
    const rows = tf === pane.tf && pane.tf !== 'M1' ? candles : await fullPoiSeriesForTf(tf, chartEnd)
    if (!rows?.length || rows.length < 20) continue
    const lastBar = rows[rows.length - 1]
    const cacheKey = `${state.symbol}:${tf}:${rows.length}:${lastBar.t}:${lastBar.partial ? 1 : 0}:${lastBar.h}:${lastBar.l}:${lastBar.c}:${optsKey}`
    let raw = poiCache.get(tf)
    if (!raw || raw.key !== cacheKey) {
      if (poiCache.size > 24) poiCache.clear()
      raw = { key: cacheKey, list: detectPois(rows, { ...detectOpts, tf }) }
      poiCache.set(tf, raw)
    }
    const ready = preparePoisForChart(raw.list, chartEnd, {
      untappedOnly: state.ind.poiUntappedOnly === true,
      viewStart,
      viewEnd,
    })
    merged.push(...ready)
    if (pane.tf === 'M1' && state.ind.showSignals) {
      const m1SpanPois = preparePoisForChart(raw.list, chartEnd, {
        untappedOnly: false,
        viewStart: candles[0].t,
        viewEnd: chartEnd,
      })
      forSignals.push(...m1SpanPois)
    }
  }
  const rank = { D1: 0, H4: 1, H1: 2, M30: 3, M15: 4, M5: 5 }
  merged.sort((a, b) => (rank[a.tf] ?? 9) - (rank[b.tf] ?? 9) || a.t0 - b.t0)
  chart.setPois(merged)
  if (pane.tf === 'M1' && state.ind.showSignals && chart.indicators) {
    const sigs = detectPoiSignals(candles, chart.indicators, forSignals, state.ind, chartEnd)
    chart.setSignals(sigs)
  } else {
    chart.setSignals([])
  }
}

function scheduleIndicatorRefresh(pane) {
  clearTimeout(pane._indViewTimer)
  pane._indViewTimer = setTimeout(() => {
    enqueue(() => applyIndicators(pane))
  }, 200)
}

async function syncPane(pane) {
  const asof = state.cursor ?? book.last()
  pane.chart.asof = state.cursor
  applyChartOptions(pane.chart)
  if (pane.tf === 'M1') await syncM1(pane, asof)
  else await syncHtf(pane, asof, TF_SEC[pane.tf])
  await applyIndicators(pane)
}

async function extendLeft(pane) {
  if (pane.tf !== 'M1' || pane.chart.noMore || pane.extending) return
  const chart = pane.chart
  if (chart.view.right - chart.view.bars > 40) return
  const first = chart.candles[0]
  if (!first || first.t <= book.first()) {
    chart.setNoMore(true)
    return
  }
  pane.extending = true
  try {
    const i1 = book.indexAt(first.t) - 1
    if (i1 < 0) {
      chart.setNoMore(true)
      return
    }
    const i0 = Math.max(0, i1 - 2500)
    await book.ensure(book.times[i0], book.times[i1], loadM1)
    const older = book.slice(book.times[i0], first.t - 1)
    if (!older.length) {
      chart.setNoMore(true)
      return
    }
    const edge = chart.rightEdgeTime()
    chart.candles = older.concat(chart.candles)
    chart.align(edge)
    chart.setNoMore(chart.candles[0].t === book.first())
    await applyIndicators(pane)
    chart.render()
  } finally {
    pane.extending = false
  }
}

async function resolvePositions() {
  const asof = state.cursor ?? book.last()
  const payload = []
  for (const drawing of drawings) {
    if (drawing.type !== 'long' && drawing.type !== 'short') continue
    if (drawing.result && drawing.result.scannedTo > asof) drawing.result = null
    if (drawing.result?.final) continue
    payload.push({
      id: drawing.id,
      side: drawing.type,
      t: drawing.t,
      entry: drawing.entry,
      sl: drawing.sl,
      tp: drawing.tp,
      scannedTo: drawing.result?.scannedTo ?? null,
      mark: drawing.result?.status === 'open' ? drawing.result.exit : null,
      markT: drawing.result?.status === 'open' ? drawing.result.exitT : null,
    })
  }
  if (!payload.length) return
  const data = await api('/api/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: state.symbol, cursor: asof, positions: payload }),
  })
  const byId = new Map((data.results || []).map((item) => [item.id, item]))
  let changed = false
  for (const drawing of drawings) {
    const result = byId.get(drawing.id)
    if (!result) continue
    drawing.result = result
    changed = true
  }
  if (changed) paintAll()
}

async function reveal() {
  if (!book.length) return
  const asof = state.cursor ?? book.last()
  const index = Math.max(0, book.indexAt(asof))
  const back = book.times[Math.max(0, index - 2200)]
  const fwd = book.times[Math.min(book.length - 1, index + Math.max(400, state.speed * 30))]
  await book.ensure(back, fwd, loadM1)
  for (const pane of visiblePanes()) await syncPane(pane)
  await resolvePositions()
  renderJournal()
  updateClock()
  saveSoon()
}

function armFromView() {
  const pane = activePane()
  const chart = pane.chart
  const index = Math.max(0, Math.min(chart.candles.length - 1, Math.floor(chart.view.right - chart.view.bars * 0.25)))
  const candle = chart.candles[index]
  if (!candle) {
    state.cursor = book.last()
    return
  }
  const target = candle.t + TF_SEC[pane.tf] - 60
  const at = book.indexAt(target)
  state.cursor = at < 0 ? book.first() : book.times[at]
}

async function stepBy(n) {
  if (!book.length) return
  if (state.cursor == null) armFromView()
  const next = book.step(state.cursor, n, state.step)
  if (n > 0 && next === state.cursor) {
    state.playing = false
    updatePlay()
    await reveal()
    return
  }
  state.cursor = next
  await reveal()
}

function updatePlay() {
  $('btnPlay').textContent = state.playing ? 'Jeda' : 'Putar'
  $('btnPick').classList.toggle('on', state.armPick)
}

function play() {
  if (state.playing) {
    state.playing = false
    updatePlay()
    saveSoon()
    return
  }
  if (state.cursor == null) armFromView()
  state.playing = true
  state.follow = true
  $('follow').checked = true
  updatePlay()
  tick()
}

function tick() {
  if (!state.playing) return
  setTimeout(async () => {
    if (!state.playing) return
    try {
      await enqueue(() => stepBy(state.speed))
    } catch (err) {
      state.playing = false
      updatePlay()
      setBanner(err.message, true)
    }
    if (state.playing) tick()
  }, 170)
}

function updateClock() {
  $('clock').textContent = state.cursor == null ? 'Seluruh data' : `${formatTs(state.cursor, offset())} ${state.tz}`
}

function moneyUsd(n) {
  if (!Number.isFinite(n)) return '—'
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
}

function moneyIdr(n) {
  if (!Number.isFinite(n)) return '—'
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${Math.abs(Math.round(n)).toLocaleString('id-ID')} IDR`
}

function signedClass(n) {
  return n > 0 ? 'pos' : n < 0 ? 'neg' : ''
}

function positions() {
  return drawings
    .filter((drawing) => drawing.type === 'long' || drawing.type === 'short')
    .map((drawing) => ({ drawing }))
}

function pnlOf(drawing) {
  const exit = drawing.result?.exit
  if (!Number.isFinite(exit) || drawing.result?.status === 'wait') return { usd: null, idr: null, r: null }
  const side = drawing.type
  return {
    usd: pnlUsd(side, drawing.entry, exit, drawing.lot || state.lot, state.contract),
    idr: pnlIdr(side, drawing.entry, exit, drawing.lot || state.lot, state.tickSize, state.tickValue),
    r: rMultiple(side, drawing.entry, exit, drawing.sl),
  }
}

function resultText(drawing) {
  const status = { wait: 'Menunggu', open: 'Terbuka', tp: 'TP', sl: 'SL' }[drawing.result?.status] || 'Menghitung…'
  const pnl = pnlOf(drawing)
  const r = pnl.r == null ? '' : ` · ${pnl.r >= 0 ? '+' : ''}${pnl.r.toFixed(2)}R`
  const idr = pnl.idr == null ? '' : ` · ${moneyIdr(pnl.idr)}`
  return `${status}${r} · ${moneyUsd(pnl.usd)}${idr}`
}

function renderStats() {
  let realized = 0
  let floating = 0
  let realizedIdr = 0
  let wins = 0
  let losses = 0
  let rSum = 0
  let rCount = 0
  for (const item of positions()) {
    const pnl = pnlOf(item.drawing)
    const status = item.drawing.result?.status
    if (status === 'tp' || status === 'sl') {
      realized += pnl.usd || 0
      realizedIdr += pnl.idr || 0
      if ((pnl.usd || 0) >= 0) wins += 1
      else losses += 1
      if (pnl.r != null) {
        rSum += pnl.r
        rCount += 1
      }
    } else if (status === 'open') {
      floating += pnl.usd || 0
    }
  }
  const avg = rCount ? rSum / rCount : null
  const totalClosed = wins + losses
  const winRate = totalClosed ? `${Math.round((wins / totalClosed) * 100)}%` : '—'
  const thirdCard = state.tickValue > 0
    ? `<div><span>Realisasi IDR</span><b class="${signedClass(realizedIdr)}">${moneyIdr(realizedIdr)}</b></div>`
    : `<div><span>Win rate</span><b>${winRate}</b></div>`
  $('stats').innerHTML = `
    <div><span>Realisasi</span><b class="${signedClass(realized)}">${moneyUsd(realized)}</b></div>
    <div><span>Mengambang</span><b class="${signedClass(floating)}">${moneyUsd(floating)}</b></div>
    ${thirdCard}
    <div><span>Menang / kalah</span><b>${wins} / ${losses}${avg == null ? '' : ` · ${avg.toFixed(2)}R`}</b></div>`
}

function selectedItem() {
  const id = panes.find((item) => item.chart.selectedId)?.chart.selectedId
  if (!id) return null
  const drawing = drawings.find((item) => item.id === id)
  return drawing ? { drawing } : null
}

function renderTrades() {
  const selected = selectedItem()
  const rows = positions()
  if (!rows.length) {
    $('trades').innerHTML = '<p class="muted">Belum ada posisi. Pilih Buy atau Sell, lalu klik chart.</p>'
    return
  }
  $('trades').innerHTML = rows.map(({ drawing }) => {
    const on = selected?.drawing.id === drawing.id ? ' on' : ''
    const side = drawing.type === 'long' ? 'Buy' : 'Sell'
    return `<button type="button" class="trade${on}" data-id="${drawing.id}">
      <b>${side} ${drawing.lot}</b>
      <small>${resultText(drawing)}</small>
    </button>`
  }).join('')
}

function renderEditor() {
  const selected = selectedItem()
  const key = selected ? selected.drawing.id : ''
  const box = $('editor')
  if (!selected) {
    editorKey = ''
    box.innerHTML = ''
    return
  }
  if (key === editorKey && box.childElementCount) {
    const slot = $('editResult')
    if (slot) slot.textContent = resultText(selected.drawing)
    return
  }
  editorKey = key
  const drawing = selected.drawing
  if (drawing.type !== 'long' && drawing.type !== 'short') {
    const names = { trend: 'Garis tren', hline: 'Garis horizontal', vline: 'Garis vertikal', rect: 'Kotak', vp: 'Volume profile' }
    box.innerHTML = `<p>${names[drawing.type] || 'Gambar'} dipilih.</p><button type="button" id="btnDelete">Hapus</button>`
    return
  }
  box.innerHTML = `
    <div class="editor">
      <span>Entry</span><input id="edEntry" type="number" step="0.01" value="${drawing.entry}">
      <span>SL</span><input id="edSl" type="number" step="0.01" value="${drawing.sl}">
      <span>TP</span><input id="edTp" type="number" step="0.01" value="${drawing.tp}">
      <span>Lot</span><input id="edLot" type="number" min="0.01" step="0.01" value="${drawing.lot}">
    </div>
    <p id="editResult">${resultText(drawing)}</p>
    <button type="button" id="btnDelete">Hapus</button>`
}

function renderJournal() {
  renderStats()
  renderTrades()
  renderEditor()
}

function activate(index) {
  state.active = index
  panes.forEach((pane, i) => pane.el.classList.toggle('active', i === index))
}

function updateTools() {
  document.querySelectorAll('#tools [data-tool]').forEach((button) => {
    button.classList.toggle('on', button.dataset.tool === state.tool)
  })
  for (const pane of panes) {
    pane.el.querySelectorAll('.tf').forEach((button) => {
      button.classList.toggle('on', button.dataset.tf === pane.tf)
    })
  }
}

function setGlobalTool(tool) {
  state.tool = tool || 'cursor'
  state.armPick = false
  for (const pane of panes) {
    pane.chart.setPick(false)
    pane.chart.draft = null
    pane.chart._draftDrag = false
    if (pane.chart.tool !== state.tool) pane.chart.setTool(state.tool)
    else pane.chart.render()
  }
  updatePlay()
  updateTools()
  saveSoon()
}

function iconButton(tool, title, svg, act) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'tool'
  button.title = title
  button.setAttribute('aria-label', title)
  if (tool) button.dataset.tool = tool
  if (act) button.dataset.act = act
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg>`
  return button
}

function applyLayout() {
  const grid = $('grid')
  grid.className = `grid n${state.layout}`
  grid.replaceChildren()
  for (const pane of visiblePanes()) grid.appendChild(pane.el)
  document.querySelectorAll('#layouts button').forEach((button) => {
    button.classList.toggle('on', button.dataset.layout === state.layout)
  })
  requestAnimationFrame(() => {
    for (const pane of visiblePanes()) pane.chart.resize()
  })
}

function buildPane(index, saved) {
  const el = document.createElement('section')
  el.className = 'pane'
  el.innerHTML = `<div class="pane-bar"></div><div class="stage"><canvas></canvas></div>`
  const bar = el.querySelector('.pane-bar')
  for (const tf of TFS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'tf'
    button.dataset.tf = tf
    button.textContent = tf
    bar.appendChild(button)
  }
  const sep = document.createElement('span')
  sep.className = 'sep'
  bar.appendChild(sep)
  const auto = document.createElement('button')
  auto.type = 'button'
  auto.className = 'tool on'
  auto.dataset.act = 'auto'
  auto.textContent = 'A'
  auto.title = 'Skala harga otomatis'
  bar.appendChild(auto)

  const canvas = el.querySelector('canvas')
  const pane = { id: index, tf: saved?.tf || DEFAULT_TF[index], el, reset: true, extending: false, chart: null }
  const chart = new Chart(canvas, {
    beforeChange: () => snapshot(),
    onChange: () => {
      for (const item of panes) item.chart.draft = null
      editorKey = ''
      paintAll()
      saveSoon()
      enqueue(async () => {
        await resolvePositions()
        renderJournal()
      })
    },
    onLive: () => {
      for (const item of panes) {
        if (item === pane) continue
        item.chart.draft = chart.draft
        item.chart.selectedId = chart.selectedId
        item.chart.requestRender()
      }
    },
    onSelect: (id) => {
      selectDrawing(id)
      paintAll()
      activate(index)
      editorKey = ''
      renderJournal()
    },
    onCross: (cross) => {
      if (!state.syncCross) return
      for (const other of visiblePanes()) {
        if (other === pane) continue
        other.chart.setExternalCross(cross ? cross.time : null, cross ? cross.price : null)
      }
    },
    onPick: (candle) => {
      const target = candle.t + TF_SEC[pane.tf] - 60
      const at = book.indexAt(target)
      state.cursor = at < 0 ? candle.t : book.times[at]
      state.playing = false
      state.follow = false
      state.armPick = false
      $('follow').checked = false
      for (const item of panes) item.chart.setPick(false)
      updatePlay()
      enqueue(() => reveal())
    },
    onUserPan: () => {
      state.follow = false
      $('follow').checked = false
    },
    onFollow: () => {
      state.follow = true
      $('follow').checked = true
      if (state.cursor != null) enqueue(() => reveal())
    },
    onView: () => {
      enqueue(() => extendLeft(pane))
      scheduleIndicatorRefresh(pane)
    },
    onAuto: (on) => auto.classList.toggle('on', on),
    onTool: (tool) => setGlobalTool(tool),
  })
  pane.chart = chart
  chart.drawings = drawings
  chart.tfSec = TF_SEC[pane.tf]
  chart.setTool(state.tool)
  bar.addEventListener('click', (event) => {
    const button = event.target.closest('button')
    if (!button) return
    activate(index)
    if (button.dataset.tf) {
      pane.tf = button.dataset.tf
      pane.reset = true
      chart.tfSec = TF_SEC[pane.tf]
      updateTools()
      enqueue(() => reveal())
      saveSoon()
      return
    }
    if (button.dataset.act === 'auto') {
      chart.autoScale = !chart.autoScale
      if (chart.autoScale) chart.priceView = null
      else chart.priceView = { min: chart._scale.min, max: chart._scale.max }
      button.classList.toggle('on', chart.autoScale)
      chart.render()
    }
  })
  el.addEventListener('pointerdown', () => {
    activate(index)
    if (state.armPick) {
      for (const item of panes) item.chart.setPick(item === pane)
    }
  }, true)
  new ResizeObserver(() => chart.resize()).observe(el.querySelector('.stage'))
  panes.push(pane)
}

function bindChrome() {
  const symEl = $('symbolSelect')
  if (symEl) {
    symEl.addEventListener('change', () => {
      enqueue(() => switchSymbol(symEl.value))
    })
  }
  $('layouts').addEventListener('click', (event) => {
    const button = event.target.closest('button')
    if (!button) return
    state.layout = button.dataset.layout
    if (state.active >= visiblePanes().length) state.active = 0
    applyLayout()
    activate(state.active)
    enqueue(() => reveal())
    saveSoon()
  })
  $('tz').addEventListener('change', () => {
    state.tz = $('tz').value
    for (const pane of panes) applyChartOptions(pane.chart)
    updateClock()
    if (state.meta) updateFooter(state.meta)
    saveSoon()
  })
  $('lot').addEventListener('change', () => {
    state.lot = Math.max(0.01, Number($('lot').value) || 0.01)
    $('lot').value = String(state.lot)
    for (const pane of panes) pane.chart.lot = state.lot
    saveSoon()
  })
  $('va').addEventListener('change', () => {
    state.va = Math.min(95, Math.max(50, Number($('va').value) || 70))
    $('va').value = String(state.va)
    for (const pane of panes) {
      pane.chart.va = state.va
      pane.chart._vpKey.clear()
      pane.chart.render()
    }
    saveSoon()
  })
  $('syncCross').addEventListener('change', () => {
    state.syncCross = $('syncCross').checked
    if (!state.syncCross) for (const pane of panes) pane.chart.setExternalCross(null, null)
    saveSoon()
  })
  $('magnet').addEventListener('change', () => {
    state.magnet = $('magnet').value || 'low'
    for (const pane of panes) applyChartOptions(pane.chart)
    saveSoon()
  })
  $('follow').addEventListener('change', () => {
    state.follow = $('follow').checked
    if (state.follow) enqueue(() => reveal())
    saveSoon()
  })
  $('speed').addEventListener('change', () => {
    state.speed = Number($('speed').value) || 1
    saveSoon()
  })
  $('step').addEventListener('change', () => {
    state.step = Number($('step').value) || 60
    saveSoon()
  })
  $('btnPlay').addEventListener('click', play)
  $('btnFwd').addEventListener('click', () => {
    state.playing = false
    updatePlay()
    enqueue(() => stepBy(1))
  })
  $('btnBack').addEventListener('click', () => {
    state.playing = false
    updatePlay()
    enqueue(() => stepBy(-1))
  })
  $('btnLive').addEventListener('click', () => {
    state.playing = false
    state.cursor = null
    state.follow = true
    state.liveAuto = true
    $('follow').checked = true
    if ($('liveAuto')) $('liveAuto').checked = true
    for (const pane of panes) pane.reset = true
    updatePlay()
    enqueue(() => reveal())
  })
  if ($('liveAuto')) {
    $('liveAuto').addEventListener('change', () => {
      state.liveAuto = $('liveAuto').checked
      saveSoon()
    })
  }
  $('btnStart').addEventListener('click', () => {
    state.playing = false
    state.cursor = book.first()
    state.follow = true
    $('follow').checked = true
    for (const pane of panes) pane.reset = true
    updatePlay()
    enqueue(() => reveal())
  })
  $('btnPick').addEventListener('click', () => {
    state.armPick = !state.armPick
    state.playing = false
    for (const pane of panes) pane.chart.setPick(state.armPick && pane === activePane())
    updatePlay()
  })
  $('btnJump').addEventListener('click', () => {
    const sec = zonedToUnix($('jump').value, offset())
    if (sec == null) return
    const at = book.indexAt(sec)
    if (at < 0) return
    state.playing = false
    state.cursor = book.times[at]
    state.follow = true
    $('follow').checked = true
    for (const pane of panes) pane.reset = true
    updatePlay()
    enqueue(() => reveal())
  })
  $('btnRefresh').addEventListener('click', () => enqueue(refreshData))
  $('btnJournal').addEventListener('click', () => {
    document.body.classList.remove('panel-hidden')
    setPanelTab('journal')
  })
  $('btnInd')?.addEventListener('click', () => {
    document.body.classList.remove('panel-hidden')
    setPanelTab('ind')
  })
  $('btnPanel').addEventListener('click', () => document.body.classList.add('panel-hidden'))
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => setPanelTab(btn.dataset.tab))
  })
  bindIndicatorForm()
  const rail = $('tools')
  for (const [tool, title, svg] of TOOLS) rail.appendChild(iconButton(tool, title, svg))
  rail.appendChild(iconButton(null, 'Hapus gambar terpilih', '<path d="M9 4h6l.4 2H20v2H4V6h4.6L9 4zm1 6h2v8h-2v-8zm4 0h2v8h-2v-8zM8 8h8l-.5 12h-7L8 8z" fill="currentColor"/>', 'delete'))
  rail.addEventListener('click', (event) => {
    const button = event.target.closest('button')
    if (!button) return
    if (button.dataset.act === 'delete') {
      activePane().chart.removeSelected()
      return
    }
    if (button.dataset.tool) setGlobalTool(button.dataset.tool)
  })
  $('trades').addEventListener('click', (event) => {
    const button = event.target.closest('.trade')
    if (!button) return
    selectDrawing(button.dataset.id)
    paintAll()
    editorKey = ''
    renderJournal()
  })
  $('editor').addEventListener('change', (event) => {
    const selected = selectedItem()
    if (!selected) return
    const drawing = selected.drawing
    if (event.target.id === 'edEntry') drawing.entry = Number(event.target.value)
    if (event.target.id === 'edSl') drawing.sl = Number(event.target.value)
    if (event.target.id === 'edTp') drawing.tp = Number(event.target.value)
    if (event.target.id === 'edLot') drawing.lot = Math.max(0.01, Number(event.target.value) || 0.01)
    drawing.result = null
    paintAll()
    saveSoon()
    enqueue(async () => {
      await resolvePositions()
      renderJournal()
    })
  })
  $('editor').addEventListener('click', (event) => {
    if (event.target.id !== 'btnDelete') return
    const selected = selectedItem()
    if (!selected) return
    activePane().chart.removeSelected()
  })
  window.addEventListener('keyup', (event) => {
    if (event.key !== 'Shift') return
    for (const pane of panes) pane.chart.setShift(false)
  })
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Shift') {
      for (const pane of panes) pane.chart.setShift(true)
    }
    const tag = document.activeElement?.tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
    if (event.key === 'Escape') {
      state.armPick = false
      for (const pane of panes) {
        pane.chart.setPick(false)
        pane.chart.cancelDraft()
      }
      setGlobalTool('cursor')
      updatePlay()
      return
    }
    if (event.key === ' ') {
      event.preventDefault()
      play()
      return
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      state.playing = false
      updatePlay()
      enqueue(() => stepBy(event.key === 'ArrowRight' ? 1 : -1))
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      activePane().chart.removeSelected()
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      const raw = undo.pop()
      if (!raw) return
      const next = JSON.parse(raw)
      drawings.splice(0, drawings.length, ...next)
      for (const pane of panes) {
        pane.chart.drawings = drawings
        pane.chart.selectedId = null
        pane.chart._vpKey.clear()
        pane.chart.render()
      }
      editorKey = ''
      enqueue(async () => {
        await resolvePositions()
        renderJournal()
      })
      saveSoon()
    }
  })
}

function setPanelTab(name) {
  document.querySelectorAll('.tab').forEach((btn) => btn.classList.toggle('on', btn.dataset.tab === name))
  const journal = $('tabJournal')
  const ind = $('tabInd')
  if (journal) journal.hidden = name !== 'journal'
  if (ind) ind.hidden = name !== 'ind'
}

function readIndicatorForm() {
  state.ind = {
    enabled: $('indEnabled')?.checked !== false,
    showTracer: $('indTracer')?.checked !== false,
    tracerLen: Math.max(1, Number($('indTracerLen')?.value) || 250),
    showCloud: $('indCloud')?.checked !== false,
    cloudStyle: $('indCloudStyle')?.value || 'Smooth',
    cloudTf: $('indCloudTf')?.value || '',
    showRb: $('indRb')?.checked !== false,
    rbLen: Math.max(1, Number($('indRbLen')?.value) || 50),
    bd1: Math.max(0.1, Number($('indBd1')?.value) || 9),
    bd2: Math.max(0.1, Number($('indBd2')?.value) || 11),
    bd3: Math.max(0.1, Number($('indBd3')?.value) || 14),
    rbTf: $('indRbTf')?.value || '',
    hideVwapDwm: !!$('indHideDwm')?.checked,
    vwapAnchor: $('indVwapAnchor')?.value || 'Session',
    showDev2: $('indDev2')?.checked !== false,
    multDev2: Math.max(0.1, Number($('indMult2')?.value) || 2),
    showDev3: $('indDev3')?.checked !== false,
    multDev3: Math.max(0.1, Number($('indMult3')?.value) || 3),
    showPoi: $('indPoi')?.checked !== false,
    poiM5: $('indPoiM5')?.checked !== false,
    poiM15: $('indPoiM15')?.checked !== false,
    poiM30: $('indPoiM30')?.checked !== false,
    poiH1: $('indPoiH1')?.checked !== false,
    poiH4: $('indPoiH4')?.checked !== false,
    poiD1: $('indPoiD1')?.checked !== false,
    poiUntappedOnly: !!$('indPoiUntapped')?.checked,
    poiMitigation: $('indPoiMit')?.value === 'half' ? 'half' : 'full',
    poiMinExpansionAtr: Math.max(0.1, Number($('indPoiExpAtr')?.value) || 1),
    poiMaxOpp: Math.max(1, Math.min(3, Number($('indPoiMaxOpp')?.value) || 3)),
    poiMaxSameDir: state.ind.poiMaxSameDir ?? 2,
    poiAtrLen: state.ind.poiAtrLen ?? 14,
    showSignals: $('indSig')?.checked !== false,
    sigTypeRb: $('indSigRb')?.checked !== false,
    sigTypeCloud: $('indSigCloud')?.checked !== false,
    sigTypePure: !!$('indSigPure')?.checked,
  }
}

function fillIndicatorForm() {
  const s = state.ind
  if ($('indEnabled')) $('indEnabled').checked = !!s.enabled
  if ($('indTracer')) $('indTracer').checked = !!s.showTracer
  if ($('indTracerLen')) $('indTracerLen').value = String(s.tracerLen)
  if ($('indCloud')) $('indCloud').checked = !!s.showCloud
  if ($('indCloudStyle')) $('indCloudStyle').value = s.cloudStyle
  if ($('indCloudTf')) $('indCloudTf').value = s.cloudTf || ''
  if ($('indRb')) $('indRb').checked = !!s.showRb
  if ($('indRbLen')) $('indRbLen').value = String(s.rbLen)
  if ($('indBd1')) $('indBd1').value = String(s.bd1)
  if ($('indBd2')) $('indBd2').value = String(s.bd2)
  if ($('indBd3')) $('indBd3').value = String(s.bd3)
  if ($('indRbTf')) $('indRbTf').value = s.rbTf || ''
  if ($('indHideDwm')) $('indHideDwm').checked = !!s.hideVwapDwm
  if ($('indDev2')) $('indDev2').checked = !!s.showDev2
  if ($('indMult2')) $('indMult2').value = String(s.multDev2)
  if ($('indDev3')) $('indDev3').checked = !!s.showDev3
  if ($('indMult3')) $('indMult3').value = String(s.multDev3)
  if ($('indPoi')) $('indPoi').checked = s.showPoi !== false
  if ($('indPoiM5')) $('indPoiM5').checked = s.poiM5 !== false
  if ($('indPoiM15')) $('indPoiM15').checked = s.poiM15 !== false
  if ($('indPoiM30')) $('indPoiM30').checked = s.poiM30 !== false
  if ($('indPoiH1')) $('indPoiH1').checked = s.poiH1 !== false
  if ($('indPoiH4')) $('indPoiH4').checked = s.poiH4 !== false
  if ($('indPoiD1')) $('indPoiD1').checked = s.poiD1 !== false
  if ($('indPoiUntapped')) $('indPoiUntapped').checked = s.poiUntappedOnly === true
  if ($('indPoiMit')) $('indPoiMit').value = s.poiMitigation === 'half' ? 'half' : 'full'
  if ($('indPoiExpAtr')) $('indPoiExpAtr').value = String(s.poiMinExpansionAtr ?? 1)
  if ($('indPoiMaxOpp')) $('indPoiMaxOpp').value = String(s.poiMaxOpp ?? 3)
  if ($('indSig')) $('indSig').checked = s.showSignals !== false
  if ($('indSigRb')) $('indSigRb').checked = s.sigTypeRb !== false
  if ($('indSigCloud')) $('indSigCloud').checked = s.sigTypeCloud !== false
  if ($('indSigPure')) $('indSigPure').checked = s.sigTypePure === true
}

function bindIndicatorForm() {
  const root = $('tabInd')
  if (!root) return
  const refresh = () => {
    readIndicatorForm()
    saveSoon()
    enqueue(async () => {
      for (const pane of visiblePanes()) {
        if (pane.tf === 'M1') pane.reset = true
        await syncPane(pane)
      }
    })
  }
  root.addEventListener('change', refresh)
  root.addEventListener('input', () => {
    clearTimeout(root._indTimer)
    root._indTimer = setTimeout(refresh, 250)
  })
}

function applyMeta(meta) {
  state.meta = meta
  state.contract = meta.contract || (meta.symbol === 'BTCUSD' ? 1 : 100)
  state.tickSize = meta.tickSize || 0.01
  state.tickValue = meta.tickValue || 0
  const live = meta.live ? ' · live' : ''
  $('brandSub').textContent = `${meta.company || 'Dukascopy'}${live}`
  document.title = `${meta.symbol} · Dukascopy`
  if ($('symbolSelect') && $('symbolSelect').value !== meta.symbol) {
    $('symbolSelect').value = meta.symbol
  }
  for (const pane of panes) {
    if (pane.chart) {
      pane.chart.contract = state.contract
    }
  }
  updateFooter(meta)
}

function updateFooter(meta) {
  if (!meta?.bars) {
    $('status').textContent = meta?.message || 'Menyiapkan…'
    return
  }
  const mode = state.cursor == null && state.liveAuto ? 'LIVE' : 'REPLAY'
  $('status').textContent = `${mode} · ${meta.symbol} · Dukascopy bid · ${Number(meta.bars).toLocaleString('id-ID')} bar M1 · ${formatTs(meta.first, offset())} - ${formatTs(meta.last, offset())}`
}

async function refreshData() {
  setBanner(`Memperbarui candle ${state.symbol} Dukascopy…`)
  await api(`/api/refresh?symbol=${state.symbol}`, { method: 'POST' })
  for (;;) {
    const meta = await api(`/api/meta?symbol=${state.symbol}`)
    applyMeta(meta)
    setBanner(meta.message || 'Memperbarui…')
    if (meta.ready && !meta.refreshing) break
    await sleep(700)
  }
  const buf = await fetch(`/api/times?symbol=${state.symbol}`).then((res) => res.arrayBuffer())
  book.setTimes(new Uint32Array(buf))
  htfCache.clear()
  htfInflight.clear()
  poiCache.clear()
  if (state.cursor != null && (state.cursor > book.last() || state.cursor < book.first())) state.cursor = book.last()
  for (const pane of panes) pane.reset = true
  await reveal()
  setBanner('')
}

async function refreshHtfTail(tf, since) {
  const key = `${state.symbol}:${tf}`
  const sec = TF_SEC[tf]
  const cut = Math.floor(since / sec) * sec
  const keep = (htfCache.get(key) || []).filter((bar) => bar.t < cut)
  const data = await api(`/api/candles?symbol=${state.symbol}&tf=${tf}&start=${cut}&limit=20000`)
  htfCache.set(key, keep.concat(data.candles || []))
}

async function softLiveSync() {
  if (!state.liveAuto || state.cursor != null || state.playing) return
  const meta = await api(`/api/meta?symbol=${state.symbol}`)
  applyMeta(meta)
  if (!meta.ready || !meta.last) return
  const prevLast = book.last()
  const prevRev = state.revision
  state.revision = meta.revision ?? state.revision
  const since = Math.max(book.first(), meta.last - 3600)
  book.forgetFrom(since)
  const rows = await loadM1(since, meta.last + 60)
  const bucketNow = Math.floor(Date.now() / 1000 / 60) * 60
  for (const row of rows) {
    if (row.t === bucketNow) row.partial = true
    else delete row.partial
  }
  book.mergeRows(rows)
  const need = new Set(visiblePanes().map((pane) => pane.tf).filter((tf) => tf !== 'M1'))
  await Promise.all([...need].map((tf) => refreshHtfTail(tf, since)))
  await reveal()
  if (meta.revision !== prevRev || meta.last !== prevLast) updateFooter(meta)
}

async function switchSymbol(newSymbol) {
  const sym = (newSymbol || 'XAUUSD').toUpperCase()
  if (sym === state.symbol) return
  state.drawingsBySymbol = state.drawingsBySymbol || {}
  state.drawingsBySymbol[state.symbol] = drawings.map(persistDrawing)

  state.symbol = sym
  state.cursor = null
  state.playing = false
  state.armPick = false
  state.revision = -1
  updatePlay()

  const saved = loadSaved()
  adoptSaved(saved, state.symbol)
  undo.length = 0
  editorKey = ''
  selectDrawing(null)
  save()

  book.setTimes(new Uint32Array())
  htfCache.clear()
  htfInflight.clear()
  poiCache.clear()

  for (const pane of panes) {
    pane.reset = true
    pane.chart.drawings = drawings
    pane.chart.draft = null
    pane.chart._draftDrag = false
    pane.chart.setPick(false)
    pane.chart.setExternalCross(null, null)
    pane.chart.autoScale = true
    pane.chart.priceView = null
    pane.chart.hooks.onAuto?.(true)
    pane.chart._vpKey.clear()
  }
  renderJournal()

  setBanner(`Menyiapkan data ${state.symbol} Dukascopy…`)
  let meta
  for (;;) {
    meta = await api(`/api/meta?symbol=${state.symbol}`)
    applyMeta(meta)
    setBanner(meta.ready ? '' : meta.message || `Menyiapkan data ${state.symbol}…`, !meta.ready && String(meta.message).startsWith('Gagal'))
    if (meta.ready) break
    if (String(meta.message).startsWith('Gagal')) return
    await sleep(800)
  }

  const buf = await fetch(`/api/times?symbol=${state.symbol}`).then((res) => {
    if (!res.ok) throw new Error('Indeks waktu belum siap')
    return res.arrayBuffer()
  })
  book.setTimes(new Uint32Array(buf))
  state.cursor = null

  for (const pane of panes) {
    pane.reset = true
    applyChartOptions(pane.chart)
  }

  await reveal()
  setBanner('')
}

function startLiveWatch() {
  clearInterval(liveTimer)
  liveTimer = setInterval(() => {
    enqueue(() => softLiveSync().catch(() => {}))
  }, LIVE_MS)
}

/** Update countdown sisa detik candle di label harga (kanan) tiap 1 detik. */
let countdownTimer = 0
function startCountdownWatch() {
  clearInterval(countdownTimer)
  countdownTimer = setInterval(() => {
    if (!state.liveAuto || state.cursor != null || state.playing) return
    for (const pane of visiblePanes()) {
      try { pane.chart.render() } catch { /* abaikan */ }
    }
  }, 1000)
}

async function boot() {
  const saved = loadSaved()
  if (saved?.symbol) {
    state.symbol = String(saved.symbol).toUpperCase()
  }
  if (saved?.drawingsBySymbol && typeof saved.drawingsBySymbol === 'object') {
    state.drawingsBySymbol = { ...saved.drawingsBySymbol }
  } else {
    state.drawingsBySymbol = {}
  }
  adoptSaved(saved, state.symbol)
  if (saved) {
    state.layout = saved.layout || state.layout
    state.tz = saved.tz || state.tz
    state.lot = saved.lot || state.lot
    state.va = saved.va || state.va
    state.speed = saved.speed || state.speed
    state.step = saved.step || state.step
    state.follow = saved.follow !== false
    state.syncCross = saved.syncCross !== false
    state.magnet = saved.magnet || 'low'
    state.liveAuto = saved.liveAuto !== false
    if (saved.ind) state.ind = { ...DEFAULT_IND, ...saved.ind }
    state.tool = saved.tool || saved.panes?.find((pane) => pane.tool && pane.tool !== 'cursor')?.tool || 'cursor'
    state.cursor = Number.isFinite(saved.cursor) ? saved.cursor : null
    state.active = saved.active || 0
  }
  if ($('symbolSelect')) $('symbolSelect').value = state.symbol
  setBanner(`Menyiapkan data ${state.symbol} Dukascopy…`)
  let meta
  for (;;) {
    meta = await api(`/api/meta?symbol=${state.symbol}`)
    applyMeta(meta)
    setBanner(meta.ready ? '' : meta.message || `Menyiapkan data ${state.symbol}…`, !meta.ready && String(meta.message).startsWith('Gagal'))
    if (meta.ready) break
    if (String(meta.message).startsWith('Gagal')) return
    await sleep(800)
  }
  $('tz').value = state.tz
  $('lot').value = String(state.lot)
  $('va').value = String(state.va)
  $('speed').value = String(state.speed)
  $('step').value = String(state.step)
  $('follow').checked = state.follow
  $('syncCross').checked = state.syncCross
  $('magnet').value = state.magnet
  if ($('liveAuto')) $('liveAuto').checked = state.liveAuto
  fillIndicatorForm()
  const buf = await fetch(`/api/times?symbol=${state.symbol}`).then((res) => {
    if (!res.ok) throw new Error('Indeks waktu belum siap')
    return res.arrayBuffer()
  })
  book.setTimes(new Uint32Array(buf))
  if (state.cursor != null && (state.cursor > book.last() || state.cursor < book.first())) state.cursor = null
  for (let i = 0; i < 4; i++) buildPane(i, saved?.panes?.[i])
  bindChrome()
  applyLayout()
  activate(Math.min(state.active, visiblePanes().length - 1))
  updateTools()
  updatePlay()
  await reveal()
  startLiveWatch()
  startCountdownWatch()
  setBanner('')
}

boot().catch((err) => setBanner(err.message, true))
