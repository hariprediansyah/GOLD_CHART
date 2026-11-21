/** Waktu, jendela M1, dan pemotongan candle saat replay. */

export const TF_SEC = {
  M1: 60,
  M5: 300,
  M15: 900,
  M30: 1800,
  H1: 3600,
  H4: 14400,
  D1: 86400,
}

export const TZ = { UTC: 0, WIB: 7 * 3600 }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

export function bucket(t, sec) {
  return Math.floor(t / sec) * sec
}

export function parts(sec, offsetSec) {
  const d = new Date((sec + offsetSec) * 1000)
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth(),
    d: d.getUTCDate(),
    hh: d.getUTCHours(),
    mm: d.getUTCMinutes(),
  }
}

export function formatTs(sec, offsetSec) {
  if (!Number.isFinite(sec)) return '—'
  const p = parts(sec, offsetSec)
  const hh = String(p.hh).padStart(2, '0')
  const mm = String(p.mm).padStart(2, '0')
  return `${p.d} ${MONTHS[p.m]} ${p.y} ${hh}:${mm}`
}

export function formatHm(sec, offsetSec) {
  const p = parts(sec, offsetSec)
  return `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`
}

export function formatAxis(sec, tfSec, offsetSec) {
  const p = parts(sec, offsetSec)
  if (tfSec >= 86400) return `${p.d} ${MONTHS[p.m]}`
  if (p.hh === 0 && p.mm === 0) return `${p.d} ${MONTHS[p.m]}`
  return `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`
}

export function formatInput(sec, offsetSec) {
  const p = parts(sec, offsetSec)
  const pad = (n) => String(n).padStart(2, '0')
  return `${p.y}-${pad(p.m + 1)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}`
}

export function zonedToUnix(value, offsetSec) {
  const [date, time] = String(value).split('T')
  if (!date || !time) return null
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  if (![y, m, d, hh, mm].every(Number.isFinite)) return null
  return Math.floor(Date.UTC(y, m - 1, d, hh, mm) / 1000 - offsetSec)
}

export function fmtPrice(p) {
  if (!Number.isFinite(p)) return '—'
  return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtCompact(n) {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}jt`
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}rb`
  return sign + abs.toFixed(abs >= 100 ? 0 : 2)
}

export function round2(n) {
  return Math.round(n * 100) / 100
}

export function pnlUsd(side, entry, exit, lot, contract = 100) {
  const dir = side === 'long' || side === 'buy' ? 1 : -1
  return (exit - entry) * dir * contract * lot
}

export function pnlIdr(side, entry, exit, lot, tickSize, tickValue) {
  if (!(tickSize > 0) || !(tickValue > 0)) return null
  const dir = side === 'long' || side === 'buy' ? 1 : -1
  return ((exit - entry) / tickSize) * dir * tickValue * lot
}

export function rMultiple(side, entry, exit, sl) {
  const risk = side === 'long' || side === 'buy' ? entry - sl : sl - entry
  if (!(risk > 0)) return null
  const gained = side === 'long' || side === 'buy' ? exit - entry : entry - exit
  return gained / risk
}

export function seriesUntil(bars, tfSec, asof) {
  if (!bars?.length) return []
  const lastOpen = asof + 60 - tfSec
  let lo = 0
  let hi = bars.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (bars[mid].t <= lastOpen) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans < 0 ? [] : bars.slice(0, ans + 1)
}

export function partialFromM1(m1, tfSec, asof) {
  if (!(tfSec > 60) || asof == null) return null
  const b0 = bucket(asof, tfSec)
  const lastOpen = asof + 60 - tfSec
  if (b0 <= lastOpen) return null
  const rows = []
  for (const bar of m1) {
    if (bar.t >= b0 && bar.t <= asof) rows.push(bar)
  }
  if (!rows.length) return null
  let h = -Infinity
  let l = Infinity
  let v = 0
  for (const bar of rows) {
    if (bar.h > h) h = bar.h
    if (bar.l < l) l = bar.l
    v += bar.v || 0
  }
  return { t: b0, o: rows[0].o, h, l, c: rows[rows.length - 1].c, v, partial: true }
}

export class TimeBook {
  constructor() {
    this.times = new Uint32Array()
    this.map = new Map()
    this.covered = []
  }

  setTimes(times) {
    this.times = times
    this.map = new Map()
    this.covered = []
  }

  updateTimes(times) {
    this.times = times
  }

  forgetFrom(t) {
    this.covered = this.covered
      .map(([a, b]) => {
        if (b < t) return [a, b]
        if (a < t) return [a, t - 1]
        return null
      })
      .filter(Boolean)
    for (const key of [...this.map.keys()]) {
      if (key >= t) this.map.delete(key)
    }
  }

  mergeRows(rows) {
    if (!rows?.length) return
    const sorted = [...rows].sort((a, b) => a.t - b.t)
    const addedTimes = []
    const lastTime = this.last()
    for (const row of sorted) {
      this.map.set(row.t, row)
      if (row.t > lastTime || this.indexAt(row.t) < 0 || this.times[this.indexAt(row.t)] !== row.t) {
        addedTimes.push(row.t)
      }
    }
    if (addedTimes.length) {
      const merged = new Set(this.times)
      for (const t of addedTimes) merged.add(t)
      this.times = Uint32Array.from([...merged].sort((a, b) => a - b))
    }
    const last = sorted[sorted.length - 1].t
    const first = sorted[0].t
    this.cover(first, last)
  }

  get length() {
    return this.times.length
  }

  first() {
    return this.times.length ? this.times[0] : 0
  }

  last() {
    return this.times.length ? this.times[this.times.length - 1] : 0
  }

  indexAt(t) {
    const a = this.times
    let lo = 0
    let hi = a.length - 1
    let ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (a[mid] <= t) {
        ans = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return ans
  }

  indexFrom(t) {
    const a = this.times
    let lo = 0
    let hi = a.length - 1
    let ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (a[mid] >= t) {
        ans = mid
        hi = mid - 1
      } else lo = mid + 1
    }
    return ans
  }

  step(t, n, stepSec) {
    if (!this.times.length || !n) return t
    const i = this.indexAt(t)
    const base = i < 0 ? 0 : i
    if (stepSec <= 60) {
      const j = Math.max(0, Math.min(this.times.length - 1, base + n))
      return this.times[j]
    }
    const target = t + n * stepSec
    if (n > 0) {
      let j = this.indexFrom(target)
      if (j < 0) j = this.times.length - 1
      if (j <= base) j = Math.min(this.times.length - 1, base + 1)
      return this.times[j]
    }
    let j = this.indexAt(target)
    if (j < 0) j = 0
    if (j >= base) j = Math.max(0, base - 1)
    return this.times[j]
  }

  gaps(t0, t1) {
    if (t1 < t0) return []
    const out = []
    let cursor = t0
    for (const [a, b] of this.covered) {
      if (b < cursor) continue
      if (a > t1) break
      if (a > cursor) out.push([cursor, Math.min(t1, a - 1)])
      cursor = b + 1
      if (cursor > t1) return out
    }
    if (cursor <= t1) out.push([cursor, t1])
    return out
  }

  cover(t0, t1) {
    this.covered.push([t0, t1])
    this.covered.sort((a, b) => a[0] - b[0])
    const merged = []
    for (const iv of this.covered) {
      if (!merged.length || iv[0] > merged[merged.length - 1][1] + 1) merged.push([iv[0], iv[1]])
      else merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], iv[1])
    }
    this.covered = merged
  }

  covers(t0, t1) {
    if (!this.times.length) return false
    const a = Math.max(t0, this.first())
    const b = Math.min(t1, this.last())
    if (b < a) return true
    return this.gaps(a, b).length === 0
  }

  slice(t0, t1) {
    const i0 = this.indexFrom(t0)
    const i1 = this.indexAt(t1)
    const out = []
    if (i0 < 0 || i1 < 0 || i0 > i1) return out
    for (let i = i0; i <= i1; i++) {
      const candle = this.map.get(this.times[i])
      if (candle) out.push(candle)
    }
    return out
  }

  async ensure(t0, t1, loader) {
    if (!this.times.length) return
    t0 = Math.max(t0, this.first())
    t1 = Math.min(t1, this.last())
    if (t1 < t0) return
    const pending = this.gaps(t0, t1)
    for (const [a, b] of pending) {
      let cursor = a
      while (cursor <= b) {
        const rows = await loader(cursor, b)
        if (!rows.length) break
        for (const row of rows) this.map.set(row.t, row)
        const last = rows[rows.length - 1].t
        if (rows.length < 10000 || last >= b) break
        cursor = last + 1
      }
      this.cover(a, b)
    }
  }
}
