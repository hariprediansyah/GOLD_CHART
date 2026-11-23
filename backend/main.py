"""Chart replay + live XAUUSD & BTCUSD Dukascopy."""

from __future__ import annotations

import mimetypes
import os
import threading
from pathlib import Path

import uvicorn
from fastapi import Body, FastAPI, Query
from fastapi.responses import FileResponse, JSONResponse, Response

import store as store_mod

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")

ROOT = Path(__file__).resolve().parents[1]
FRONT = ROOT / "frontend"
NO_CACHE = {"Cache-Control": "no-cache"}

SUPPORTED_SYMBOLS = ["XAUUSD", "BTCUSD"]

app = FastAPI(title="Chart Replay & Live · Dukascopy")
STORES: dict[str, store_mod.Store] = {
    sym: store_mod.Store(symbol=sym) for sym in SUPPORTED_SYMBOLS
}


def get_store(symbol: str = "XAUUSD") -> store_mod.Store:
    sym = (symbol or "XAUUSD").upper()
    if sym not in STORES:
        raise ValueError(
            f"Simbol tidak dikenal: {symbol}. Pilih salah satu dari: {', '.join(SUPPORTED_SYMBOLS)}"
        )
    return STORES[sym]


@app.on_event("startup")
def _startup() -> None:
    for sym in SUPPORTED_SYMBOLS:
        threading.Thread(target=_boot_one, args=(sym,), name=f"boot-{sym.lower()}", daemon=True).start()


def _boot_one(sym: str) -> None:
    store = STORES[sym]
    try:
        store.bootstrap()
    except Exception as exc:
        import traceback

        traceback.print_exc()
        store.message = f"Gagal menyiapkan data Dukascopy {sym}: {exc}"
        store.ready = False


@app.exception_handler(ValueError)
def _value(_, exc: ValueError):
    return JSONResponse({"error": str(exc)}, status_code=400)


@app.get("/api/symbols")
def symbols():
    return {"symbols": SUPPORTED_SYMBOLS, "default": "XAUUSD"}


@app.get("/api/meta")
def meta(symbol: str = "XAUUSD"):
    db = get_store(symbol)
    res = db.public_meta()
    res["symbols"] = SUPPORTED_SYMBOLS
    return res


@app.get("/api/times")
def times(symbol: str = "XAUUSD"):
    db = get_store(symbol)
    if not db.ready:
        return JSONResponse({"error": db.message}, status_code=503)
    with db.lock:
        payload = db.times.tobytes()
    return Response(payload, media_type="application/octet-stream", headers=NO_CACHE)


@app.get("/api/candles")
def candles(
    symbol: str = "XAUUSD",
    tf: str = "M15",
    start: int = 0,
    end: int = 2_100_000_000,
    limit: int = Query(5000, ge=1, le=20_000),
):
    db = get_store(symbol)
    if not db.ready:
        return JSONResponse({"error": db.message}, status_code=503)
    if tf not in store_mod.TFS:
        raise ValueError("Timeframe tidak dikenal.")
    if end < start:
        raise ValueError("Rentang waktu kosong.")
    with db.lock:
        rows = db.candles(tf, start, end, limit)
    return {"candles": rows, "symbol": db.symbol}


@app.post("/api/resolve")
def resolve(body: dict = Body(...)):
    sym = body.get("symbol") or "XAUUSD"
    db = get_store(sym)
    if not db.ready:
        return JSONResponse({"error": db.message}, status_code=503)
    positions = body.get("positions") or []
    if not isinstance(positions, list) or len(positions) > 200:
        raise ValueError("Posisi tidak valid.")
    cursor = int(body.get("cursor") or 0)
    with db.lock:
        results = db.resolve_positions(positions, cursor)
    return {"results": results, "symbol": db.symbol}


@app.post("/api/refresh")
def refresh(symbol: str = Query("XAUUSD")):
    db = get_store(symbol)
    if not db.ready:
        return JSONResponse({"error": db.message}, status_code=409)
    threading.Thread(target=db.catchup_async, daemon=True).start()
    return {"ok": True, "message": f"Memperbarui {db.symbol} dari Dukascopy…"}


@app.get("/")
def index():
    return FileResponse(FRONT / "index.html", headers=NO_CACHE)


@app.get("/{path:path}")
def static_files(path: str):
    full = (FRONT / path).resolve()
    front = FRONT.resolve()
    if front not in full.parents or not full.is_file():
        return JSONResponse({"error": "Tidak ditemukan."}, status_code=404)
    return FileResponse(full, headers=NO_CACHE)


if __name__ == "__main__":
    host = os.environ.get("GOLD_HOST", "127.0.0.1")
    port = int(os.environ.get("GOLD_PORT", "8792"))
    print(f"Chart Replay & Live (XAUUSD & BTCUSD) · Dukascopy  http://{host}:{port}", flush=True)
    uvicorn.run(app, host=host, port=port, log_level="info")
