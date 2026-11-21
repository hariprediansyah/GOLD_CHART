"""Wrapper Dukascopy via dukascopy-node (historis + realtime)."""

from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "dukascopy_fetch.mjs"
NODE = os.environ.get("GOLD_NODE", "node")

SYMBOL_INFO = {
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
}


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
        out.append(
            (
                ts,
                float(bar["open"]),
                float(bar["high"]),
                float(bar["low"]),
                float(bar["close"]),
                max(0, int(round(vol * 100_000))),
            )
        )
    out.sort(key=lambda r: r[0])
    return out


def fetch_history(start: datetime, end: datetime) -> list[tuple]:
    """Unduh M1 historis [start, end). Pecah per bulan agar aman memori."""
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    rows: list[tuple] = []
    cur = start
    while cur < end:
        if cur.month == 12:
            nxt = cur.replace(year=cur.year + 1, month=1, day=1)
        else:
            nxt = cur.replace(month=cur.month + 1, day=1)
        chunk_end = min(nxt, end)
        from_s = cur.strftime("%Y-%m-%d")
        to_s = chunk_end.strftime("%Y-%m-%d")
        part = _run(["history", from_s, to_s], timeout=900)
        rows.extend(_to_rows(part))
        cur = chunk_end
    uniq: dict[int, tuple] = {}
    for row in rows:
        uniq[row[0]] = row
    return [uniq[k] for k in sorted(uniq)]


def fetch_live(count: int = 500) -> list[tuple]:
    """Candle M1 terbaru; skrip live mem-patch bar menit berjalan dari tick."""
    return _to_rows(_run(["live", str(count)], timeout=120))


def fetch_since(since: datetime, pad_minutes: int = 30) -> list[tuple]:
    """Ambil dari since-pad sampai sekarang.

    Feed historis Dukascopy sering tertinggal beberapa jam. Tip terbaru
    selalu diambil dari endpoint live, lalu digabung dengan history bila perlu.
    """
    now = datetime.now(timezone.utc)
    if since.tzinfo is None:
        since = since.replace(tzinfo=timezone.utc)
    diff_min = max(1, int((now - since).total_seconds() // 60))
    eff_pad = min(pad_minutes, max(15, diff_min + 10))
    start = since - timedelta(minutes=eff_pad)
    since_ts = int(since.timestamp())
    gap_min = max(15, int((now - start).total_seconds() // 60) + 5)

    live = fetch_live(min(5000, gap_min))
    if live and live[0][0] <= since_ts:
        return live

    hist_end = datetime.fromtimestamp(live[0][0], tz=timezone.utc) if live else (now + timedelta(minutes=1))
    hist = fetch_history(start, hist_end) if start < hist_end else []
    merged: dict[int, tuple] = {}
    for row in hist:
        merged[row[0]] = row
    for row in live:
        merged[row[0]] = row
    return [merged[k] for k in sorted(merged)]


def symbol_info() -> dict:
    return dict(SYMBOL_INFO)
