#!/usr/bin/env node
/**
 * Ambil candle XAUUSD atau BTCUSD dari Dukascopy.
 *   node scripts/dukascopy_fetch.mjs history 2025-01-01 2025-02-01 [instrument]
 *   node scripts/dukascopy_fetch.mjs live [count] [instrument]
 * Output: JSON array ke stdout.
 *
 * Live M1 Dukascopy sering hanya sampai menit yang sudah close (~1 mnt delay).
 * Kita patch bar menit berjalan dari tick bid agar chart tidak tertinggal.
 */
import { getHistoricalRates, getRealTimeRates } from 'dukascopy-node'

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

const [mode, a, b, c] = process.argv.slice(2)
if (!mode || !['history', 'live'].includes(mode)) {
  fail('Usage: dukascopy_fetch.mjs history <from> <to> [instrument] | live [count] [instrument]')
}

const instrument = (mode === 'history' ? (c || 'xauusd') : (b || 'xauusd')).toLowerCase()

const common = {
  instrument,
  timeframe: 'm1',
  format: 'json',
  priceType: 'bid',
  volumes: true,
}

/** Lengkapi / buat candle M1 yang belum close dari tick bid. */
async function patchFormingM1(rows, inst = instrument) {
  if (!Array.isArray(rows) || !rows.length) return rows
  let ticks = []
  try {
    ticks = await getRealTimeRates({
      instrument: inst,
      timeframe: 'tick',
      format: 'json',
      priceType: 'bid',
      last: 1500,
    })
  } catch {
    return rows
  }
  if (!Array.isArray(ticks) || !ticks.length) return rows

  const now = Date.now()
  const bucketNow = Math.floor(now / 60_000) * 60_000
  const last = rows[rows.length - 1]
  const lastTs = Number(last.timestamp)
  const bid = Number(ticks[ticks.length - 1].bidPrice)
  if (!Number.isFinite(bid) || !Number.isFinite(lastTs)) return rows

  const byBucket = new Map()
  for (const t of ticks) {
    const p = Number(t.bidPrice)
    const ts = Number(t.timestamp)
    const v = Number(t.bidVolume)
    if (!Number.isFinite(p) || !Number.isFinite(ts)) continue
    const b = Math.floor(ts / 60_000) * 60_000
    if (b < lastTs || b > bucketNow) continue
    let entry = byBucket.get(b)
    if (!entry) {
      entry = { prices: [], volume: 0 }
      byBucket.set(b, entry)
    }
    entry.prices.push(p)
    if (Number.isFinite(v) && v > 0) entry.volume += v
  }

  const sameBucket = byBucket.get(lastTs)
  if (sameBucket?.prices.length) {
    last.high = Math.max(Number(last.high), ...sameBucket.prices)
    last.low = Math.min(Number(last.low), ...sameBucket.prices)
    last.close = sameBucket.prices[sameBucket.prices.length - 1]
    if (sameBucket.volume > Number(last.volume || 0)) last.volume = sameBucket.volume
    if (lastTs === bucketNow) last.partial = true
  }

  let prevClose = Number(last.close)
  for (let b = lastTs + 60_000; b <= bucketNow; b += 60_000) {
    const entry = byBucket.get(b)
    if (!entry?.prices.length && b < bucketNow) continue
    const list = entry?.prices.length ? entry.prices : [bid]
    const open = prevClose
    const close = list[list.length - 1]
    rows.push({
      timestamp: b,
      open,
      high: Math.max(open, ...list),
      low: Math.min(open, ...list),
      close,
      volume: entry?.volume || 0,
      partial: b === bucketNow,
    })
    prevClose = close
  }
  return rows
}

try {
  let rows
  if (mode === 'history') {
    if (!a || !b) fail('history butuh from dan to (YYYY-MM-DD)')
    rows = await getHistoricalRates({
      ...common,
      dates: { from: a, to: b },
    })
  } else {
    const last = Math.max(1, Math.min(5000, Number(a) || 300))
    rows = await getRealTimeRates({ ...common, last })
    rows = await patchFormingM1(rows || [], instrument)
  }
  process.stdout.write(JSON.stringify(rows || []))
} catch (err) {
  fail(err?.message || String(err))
}
