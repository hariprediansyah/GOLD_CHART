"""Cache candle XAUUSD / BTCUSD dari Dukascopy. M1 disimpan, timeframe lain digabung dari M1."""

from __future__ import annotations

import json
import sqlite3
import threading
from array import array
from datetime import datetime, timedelta, timezone
from pathlib import Path

import dukascopy

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "xauusd_dukascopy.db"
SYMBOL = "XAUUSD"
HISTORY_START = datetime(2023, 1, 1, tzinfo=timezone.utc)
LIVE_INTERVAL_SEC = float(__import__("os").environ.get("GOLD_LIVE_SEC", "5"))

TFS = {
    "M1": 60,
    "M5": 300,
    "M15": 900,
    "M30": 1800,
    "H1": 3600,
    "H4": 14400,
    "D1": 86400,
}

INSERT_M1 = """
INSERT INTO m1(t,o,h,l,c,v) VALUES(?,?,?,?,?,?)
ON CONFLICT(t) DO UPDATE SET
  o=excluded.o, h=excluded.h, l=excluded.l, c=excluded.c, v=excluded.v
"""


def aggregate(rows, sec: int):
    """Gabungkan bar M1 yang sudah urut menjadi OHLC per ember waktu."""
    bucket = None
    cur = None
    for t, o, h, l, c, v in rows:
        b = int(t) // sec * sec
        if cur is None or b != bucket:
            if cur is not None:
                yield cur
            bucket = b
            cur = [b, float(o), float(h), float(l), float(c), int(v)]
            continue
        if h > cur[2]:
            cur[2] = float(h)
        if l < cur[3]:
            cur[3] = float(l)
        cur[4] = float(c)
        cur[5] += int(v)
    if cur is not None:
        yield cur


def first_between(sl: float, tp: float, prev: float, price: float) -> str | None:
    lo, hi = (prev, price) if price >= prev else (price, prev)
    hits = []
    if lo <= sl <= hi:
        hits.append(("sl", sl))
    if lo <= tp <= hi:
        hits.append(("tp", tp))
    if not hits:
        return None
    hits.sort(key=lambda item: item[1], reverse=price < prev)
    return hits[0][0]


def hit_bar(side: str, entry: float, sl: float, tp: float, o: float, h: float, l: float, c: float) -> str | None:
    long = side == "long"
    open_sl = o <= sl if long else o >= sl
    open_tp = o >= tp if long else o <= tp
    if open_sl or open_tp:
        if open_sl and open_tp:
            return first_between(sl, tp, entry, o) or "sl"
        return "sl" if open_sl else "tp"
    path = (o, l, h, c) if c >= o else (o, h, l, c)
    for i in range(1, len(path)):
        hit = first_between(sl, tp, path[i - 1], path[i])
        if hit:
            return hit
    return None


class Store:
    def __init__(
        self,
        path: Path | None = None,
        symbol: str = "XAUUSD",
        history_start: datetime | None = None,
    ):
        self.symbol = (symbol or "XAUUSD").upper()
        if path:
            self.path = Path(path)
        else:
            self.path = ROOT / "data" / f"{self.symbol.lower()}_dukascopy.db"
        if history_start:
            self.history_start = history_start
        elif self.symbol == "BTCUSD":
            self.history_start = datetime(2024, 1, 1, tzinfo=timezone.utc)
        else:
            self.history_start = HISTORY_START

        self.lock = threading.Lock()
        self.ready = False
        self.refreshing = False
        self.live = False
        self.message = "Menunggu"
        self.conn: sqlite3.Connection | None = None
        self.times = array("I")
        self._live_stop = threading.Event()
        self._live_thread: threading.Thread | None = None
        self.revision = 0

    def connect(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        with self.lock:
            self.conn = conn
            self._schema()

    def _schema(self) -> None:
        assert self.conn is not None
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS m1 (
              t INTEGER PRIMARY KEY,
              o REAL NOT NULL,
              h REAL NOT NULL,
              l REAL NOT NULL,
              c REAL NOT NULL,
              v INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS bar (
              tf TEXT NOT NULL,
              t INTEGER NOT NULL,
              o REAL NOT NULL,
              h REAL NOT NULL,
              l REAL NOT NULL,
              c REAL NOT NULL,
              v INTEGER NOT NULL,
              PRIMARY KEY (tf, t)
            );
            CREATE TABLE IF NOT EXISTS meta (
              k TEXT PRIMARY KEY,
              v TEXT NOT NULL
            );
            """
        )
        self.conn.commit()

    def meta_get(self, key: str) -> str | None:
        assert self.conn is not None
        row = self.conn.execute("SELECT v FROM meta WHERE k=?", (key,)).fetchone()
        return None if row is None else row[0]

    def meta_set(self, key: str, value: str) -> None:
        assert self.conn is not None
        self.conn.execute(
            "INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
            (key, value),
        )

    def bootstrap(self) -> None:
        self.message = f"Menyiapkan database {self.symbol} Dukascopy…"
        self.connect()
        assert self.conn is not None
        with self.lock:
            source = self.meta_get("source")
            complete = self.meta_get("complete")
            count = self._count()
            sane = self._sane()
        if source != "dukascopy" or complete != "1" or count == 0 or not sane:
            self._reset_bars()
            self._import_history()
            self.message = f"Menggabungkan timeframe {self.symbol}…"
            self.rebuild_all()
            with self.lock:
                self.meta_set("source", "dukascopy")
                self.meta_set("complete", "1")
                self.meta_set("symbol", json.dumps(dukascopy.symbol_info(self.symbol)))
                self.conn.commit()
        else:
            self.message = f"Memakai cache {self.symbol} lokal…"
            with self.lock:
                self.meta_set("symbol", json.dumps(dukascopy.symbol_info(self.symbol)))
                self.conn.commit()
        try:
            self.catchup()
        except Exception as exc:
            self.message = f"Cache {self.symbol} siap. Sync awal dilewati: {exc}"
        self.reload_times()
        self.ready = True
        self.message = "Siap"
        self.start_live()

    def _import_history(self) -> None:
        end = datetime.now(timezone.utc) + timedelta(minutes=1)
        cur = self.history_start
        total = 0
        while cur < end:
            nxt = cur
            for _ in range(4):
                if nxt >= end:
                    break
                if nxt.month == 12:
                    nxt = datetime(nxt.year + 1, 1, 1, tzinfo=timezone.utc)
                else:
                    nxt = datetime(nxt.year, nxt.month + 1, 1, tzinfo=timezone.utc)
            chunk_end = min(nxt, end)
            self.message = f"Mengunduh Dukascopy {self.symbol} M1 {cur.strftime('%Y-%m')}…"
            rows = dukascopy.fetch_history(cur, chunk_end, symbol=self.symbol)
            if rows:
                self.insert_m1(rows)
                total += len(rows)
            cur = chunk_end
        if total == 0:
            raise RuntimeError(f"Dukascopy tidak mengembalikan candle {self.symbol}.")
        self.message = f"Tersimpan {total:,} bar M1 {self.symbol}"

    def catchup_async(self) -> None:
        if self.refreshing or not self.ready:
            return
        self.refreshing = True
        self.message = f"Memperbarui {self.symbol} dari Dukascopy…"
        try:
            n = self.catchup()
            self.reload_times()
            self.message = f"Siap · +{n} bar" if n else "Siap"
        except Exception as exc:
            self.message = f"Gagal memperbarui Dukascopy {self.symbol}: {exc}"
        finally:
            self.refreshing = False

    def catchup(self) -> int:
        assert self.conn is not None
        with self.lock:
            row = self.conn.execute("SELECT MAX(t) FROM m1").fetchone()
        last = int(row[0] or 0)
        if last:
            since = datetime.fromtimestamp(last, tz=timezone.utc)
            rows = dukascopy.fetch_since(since, symbol=self.symbol)
        else:
            rows = dukascopy.fetch_live(2000, symbol=self.symbol)
        if not rows:
            return 0
        self.insert_m1(rows)
        self.rebuild_from(min(r[0] for r in rows))
        with self.lock:
            self.meta_set("symbol", json.dumps(dukascopy.symbol_info(self.symbol)))
            self.conn.commit()
        self.revision += 1
        return len(rows)

    def start_live(self) -> None:
        if self._live_thread and self._live_thread.is_alive():
            return
        self._live_stop.clear()
        self.live = True

        def loop():
            while not self._live_stop.wait(LIVE_INTERVAL_SEC):
                if not self.ready or self.refreshing:
                    continue
                try:
                    self.catchup()
                    self.reload_times()
                except Exception:
                    pass

        self._live_thread = threading.Thread(target=loop, name=f"duka-live-{self.symbol.lower()}", daemon=True)
        self._live_thread.start()

    def stop_live(self) -> None:
        self._live_stop.set()
        self.live = False

    def _count(self) -> int:
        assert self.conn is not None
        return int(self.conn.execute("SELECT COUNT(*) FROM m1").fetchone()[0])

    def _sane(self) -> bool:
        assert self.conn is not None
        row = self.conn.execute("SELECT MAX(t) FROM m1").fetchone()
        return bool(row and row[0] and int(row[0]) > 1_500_000_000)

    def _reset_bars(self) -> None:
        assert self.conn is not None
        with self.lock:
            self.conn.execute("DELETE FROM m1")
            self.conn.execute("DELETE FROM bar")
            self.conn.commit()

    def insert_m1(self, rows) -> None:
        assert self.conn is not None
        total = len(rows)
        for i in range(0, total, 20_000):
            chunk = rows[i : i + 20_000]
            with self.lock:
                self.conn.executemany(INSERT_M1, chunk)
                self.conn.commit()
            if total > 20_000:
                self.message = f"Menyimpan Dukascopy {self.symbol} {min(i + len(chunk), total):,} / {total:,}"

    def rebuild_all(self) -> None:
        assert self.conn is not None
        with self.lock:
            self.conn.execute("DELETE FROM bar")
            self.conn.commit()
        for tf, sec in TFS.items():
            if sec == 60:
                continue
            self.message = f"Menggabungkan {self.symbol} {tf}…"
            self._fill_tf(tf, sec, 0)

    def rebuild_from(self, t0: int) -> None:
        for tf, sec in TFS.items():
            if sec == 60:
                continue
            bucket = int(t0) // sec * sec
            assert self.conn is not None
            with self.lock:
                self.conn.execute("DELETE FROM bar WHERE tf=? AND t>=?", (tf, bucket))
                self.conn.commit()
            self._fill_tf(tf, sec, bucket)

    def _fill_tf(self, tf: str, sec: int, t0: int) -> None:
        assert self.conn is not None
        with self.lock:
            rows = self.conn.execute(
                "SELECT t,o,h,l,c,v FROM m1 WHERE t>=? ORDER BY t",
                (t0,),
            ).fetchall()
        batch = []
        sql = "INSERT INTO bar(tf,t,o,h,l,c,v) VALUES(?,?,?,?,?,?,?)"
        for bar in aggregate(rows, sec):
            batch.append((tf, *bar))
            if len(batch) >= 5_000:
                with self.lock:
                    self.conn.executemany(sql, batch)
                    self.conn.commit()
                batch.clear()
        with self.lock:
            if batch:
                self.conn.executemany(sql, batch)
            self.conn.commit()

    def reload_times(self) -> None:
        assert self.conn is not None
        with self.lock:
            cur = self.conn.execute("SELECT t FROM m1 ORDER BY t")
            self.times = array("I", (int(row[0]) for row in cur if int(row[0]) > 0))

    def candles(self, tf: str, start: int, end: int, limit: int) -> list[dict]:
        assert self.conn is not None
        if tf == "M1":
            cur = self.conn.execute(
                "SELECT t,o,h,l,c,v FROM m1 WHERE t>=? AND t<=? ORDER BY t LIMIT ?",
                (start, end, limit),
            )
        else:
            cur = self.conn.execute(
                "SELECT t,o,h,l,c,v FROM bar WHERE tf=? AND t>=? AND t<=? ORDER BY t LIMIT ?",
                (tf, start, end, limit),
            )
        return [
            {"t": int(t), "o": o, "h": h, "l": l, "c": c, "v": int(v)}
            for t, o, h, l, c, v in cur
        ]

    def resolve_positions(self, positions: list[dict], cursor: int) -> list[dict]:
        assert self.conn is not None
        return [self._resolve_one(pos, int(cursor)) for pos in positions]

    def _resolve_one(self, pos: dict, cursor: int) -> dict:
        assert self.conn is not None
        side = pos.get("side")
        if side not in ("long", "short"):
            raise ValueError("Arah posisi harus long atau short.")
        entry_t = int(pos["t"])
        entry = float(pos["entry"])
        sl = float(pos["sl"])
        tp = float(pos["tp"])
        ident = pos.get("id")
        if cursor < entry_t:
            return {"id": ident, "status": "wait", "scannedTo": cursor}
        start = entry_t
        if pos.get("scannedTo") is not None:
            start = max(entry_t, int(pos["scannedTo"]))
        last_c = pos.get("mark")
        last_t = pos.get("markT")
        rows = self.conn.execute(
            "SELECT t,o,h,l,c FROM m1 WHERE t>? AND t<=? ORDER BY t",
            (start, cursor),
        )
        for t, o, h, l, c in rows:
            hit = hit_bar(side, entry, sl, tp, float(o), float(h), float(l), float(c))
            if hit:
                return {
                    "id": ident,
                    "status": hit,
                    "exit": sl if hit == "sl" else tp,
                    "exitT": int(t),
                    "scannedTo": int(t),
                    "final": True,
                }
            last_c = float(c)
            last_t = int(t)
        if last_c is None:
            row = self.conn.execute(
                "SELECT t,c FROM m1 WHERE t>=? AND t<=? ORDER BY t DESC LIMIT 1",
                (entry_t, cursor),
            ).fetchone()
            if row is not None:
                last_t, last_c = int(row[0]), float(row[1])
            else:
                last_t, last_c = entry_t, entry
        return {
            "id": ident,
            "status": "open",
            "exit": float(last_c),
            "exitT": int(last_t),
            "scannedTo": cursor,
            "mark": True,
        }

    def public_meta(self) -> dict:
        info = dukascopy.symbol_info(self.symbol)
        first = last = bars = None
        if self.conn is not None:
            with self.lock:
                raw = self.meta_get("symbol")
                row = self.conn.execute("SELECT MIN(t), MAX(t), COUNT(*) FROM m1").fetchone()
            if raw:
                try:
                    info.update(json.loads(raw))
                except Exception:
                    pass
            if row and row[2]:
                first, last, bars = int(row[0]), int(row[1]), int(row[2])
        return {
            "ready": self.ready,
            "refreshing": self.refreshing,
            "live": self.live,
            "revision": self.revision,
            "message": self.message,
            "symbol": self.symbol,
            "broker": info.get("broker") or "Dukascopy",
            "company": info.get("company") or "Dukascopy Bank",
            "server": info.get("server") or "datafeed",
            "point": info.get("point", 0.001),
            "digits": info.get("digits", 3),
            "contract": info.get("contract", 100),
            "tickSize": info.get("tickSize", 0.001),
            "tickValue": info.get("tickValue", 0),
            "accountCurrency": info.get("accountCurrency") or "USD",
            "profitCurrency": info.get("profitCurrency") or "USD",
            "first": first,
            "last": last,
            "bars": bars or 0,
            "tfs": list(TFS),
            "source": "dukascopy",
        }
