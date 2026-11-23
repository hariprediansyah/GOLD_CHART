"""Wrapper Dukascopy via dukascopy-node (historis + realtime)."""

from __future__ import annotations

import concurrent.futures
import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "dukascopy_fetch.mjs"
NODE = os.environ.get("GOLD_NODE", "node")

SYMBOLS = {
    "XAUUSD": {
        "symbol": "XAUUSD",
        "dukas_name": "xauusd",
        "broker": "Dukascopy",
        "company": "Dukascopy Bank",
        "server": "datafeed",
        "point": 0.001,
        "digits": 3,
        "contract": 100,
        "tickSize": 0.001,
        "tickValue": 0.0,
        "accountCurrency": "USD",
        "profitCurrency": "USD",
        "priceType": "bid",
    },
    "BTCUSD": {
        "symbol": "BTCUSD",
        "dukas_name": "btcusd",
        "broker": "Dukascopy",
        "company": "Dukascopy Bank",
        "server": "datafeed",
        "point": 0.1,
        "digits": 2,
        "contract": 1,
        "tickSize": 0.1,
        "tickValue": 0.0,
        "accountCurrency": "USD",
        "profitCurrency": "USD",
        "priceType": "bid",
    },
}

SYMBOL_INFO = SYMBOLS["XAUUSD"]


def _run(args: list[str], timeout: int = 600) -> list[dict]:
    if not SCRIPT.is_file():
        raise RuntimeError(f"Skrip Dukascopy tidak ada: {SCRIPT}")
    proc = subprocess.run(
        [NODE, str(SCRIPT), *args],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "gagal").strip()
        raise RuntimeError(err.splitlines()[-1] if err else "dukascopy_fetch gagal")
    raw = (proc.stdout or "").strip()
    if not raw:
        return []
    data = json.loads(raw)
    if not isinstance(data, list):
        raise RuntimeError("Respons Dukascopy tidak valid")
    return data


def _to_rows(candles: list[dict]) -> list[tuple]:
    out = []
    for bar in candles:
        ts = int(bar["timestamp"] // 1000)
        vol = float(bar.get("volume") or 0)
        v_int = int(round(vol * 100_000))
        if vol > 0 and v_int == 0:
            v_int = 1
        out.append(
            (
                ts,
                float(bar["open"]),
                float(bar["high"]),
                float(bar["low"]),
                float(bar["close"]),
                max(0, v_int),
            )
        )
    out.sort(key=lambda r: r[0])
    return out


def fetch_history(start: datetime, end: datetime, symbol: str = "XAUUSD") -> list[tuple]:
    """Unduh M1 historis [start, end). Pecah per bulan agar hemat memori."""
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    dukas_name = SYMBOLS.get(symbol.upper(), {}).get("dukas_name", symbol.lower())
    rows: list[tuple] = []
    chunks: list[tuple[datetime, datetime]] = []
    cur = start
    while cur < end:
        if cur.month == 12:
            nxt = cur.replace(year=cur.year + 1, month=1, day=1)
        else:
            nxt = cur.replace(month=cur.month + 1, day=1)
        chunk_end = min(nxt, end)
        chunks.append((cur, chunk_end))
        cur = chunk_end

    def _fetch_one_chunk(c_start: datetime, c_end: datetime) -> list[dict]:
        from_s = c_start.strftime("%Y-%m-%d")
        to_s = c_end.strftime("%Y-%m-%d")
        return _run(["history", from_s, to_s, dukas_name], timeout=900)

    if len(chunks) > 2:
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
            future_to_chunk = {ex.submit(_fetch_one_chunk, cs, ce): (cs, ce) for cs, ce in chunks}
            for fut in concurrent.futures.as_completed(future_to_chunk):
                part = fut.result()
                rows.extend(_to_rows(part))
    else:
        for cs, ce in chunks:
            part = _fetch_one_chunk(cs, ce)
            rows.extend(_to_rows(part))

    uniq: dict[int, tuple] = {}
    for row in rows:
        uniq[row[0]] = row
    return [uniq[k] for k in sorted(uniq)]


def fetch_live(count: int = 500, symbol: str = "XAUUSD") -> list[tuple]:
    """Candle M1 terbaru; skrip live mem-patch bar menit berjalan dari tick."""
    dukas_name = SYMBOLS.get(symbol.upper(), {}).get("dukas_name", symbol.lower())
    return _to_rows(_run(["live", str(count), dukas_name], timeout=120))


def fetch_since(since: datetime, pad_minutes: int = 30, symbol: str = "XAUUSD") -> list[tuple]:
    """Ambil dari since-pad sampai sekarang."""
    now = datetime.now(timezone.utc)
    if since.tzinfo is None:
        since = since.replace(tzinfo=timezone.utc)
    diff_min = max(1, int((now - since).total_seconds() // 60))
    eff_pad = min(pad_minutes, max(15, diff_min + 10))
    start = since - timedelta(minutes=eff_pad)
    since_ts = int(since.timestamp())
    gap_min = max(15, int((now - start).total_seconds() // 60) + 5)

    live = fetch_live(min(5000, gap_min), symbol=symbol)
    if live and live[0][0] <= since_ts:
        return live

    hist_end = datetime.fromtimestamp(live[0][0], tz=timezone.utc) if live else (now + timedelta(minutes=1))
    hist = fetch_history(start, hist_end, symbol=symbol) if start < hist_end else []
    merged: dict[int, tuple] = {}
    for row in hist:
        merged[row[0]] = row
    for row in live:
        merged[row[0]] = row
    return [merged[k] for k in sorted(merged)]


def symbol_info(symbol: str = "XAUUSD") -> dict:
    sym = (symbol or "XAUUSD").upper()
    info = SYMBOLS.get(sym) or SYMBOLS["XAUUSD"]
    return dict(info)
