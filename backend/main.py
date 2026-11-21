"""Chart replay + live XAUUSD Dukascopy."""

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

app = FastAPI(title="XAUUSD Chart · Dukascopy")
db = store_mod.Store()


@app.on_event("startup")
def _startup() -> None:
    threading.Thread(target=_boot, daemon=True).start()


def _boot() -> None:
    try:
        db.bootstrap()
    except Exception as exc:
        import traceback

        traceback.print_exc()
        db.message = f"Gagal menyiapkan data Dukascopy: {exc}"
        db.ready = False


@app.exception_handler(ValueError)
def _value(_, exc: ValueError):
    return JSONResponse({"error": str(exc)}, status_code=400)


@app.get("/api/meta")
def meta():
    return db.public_meta()


@app.get("/api/times")
def times():
    if not db.ready:
        return JSONResponse({"error": db.message}, status_code=503)
    with db.lock:
        payload = db.times.tobytes()
    return Response(payload, media_type="application/octet-stream", headers=NO_CACHE)


@app.get("/api/candles")
def candles(
    tf: str = "M15",
    start: int = 0,
    end: int = 2_100_000_000,
    limit: int = Query(5000, ge=1, le=20_000),
):
    if not db.ready:
        return JSONResponse({"error": db.message}, status_code=503)
    if tf not in store_mod.TFS:
        raise ValueError("Timeframe tidak dikenal.")
    if end < start:
        raise ValueError("Rentang waktu kosong.")
    with db.lock:
        rows = db.candles(tf, start, end, limit)
    return {"candles": rows}


@app.post("/api/resolve")
def resolve(body: dict = Body(...)):
    if not db.ready:
        return JSONResponse({"error": db.message}, status_code=503)
    positions = body.get("positions") or []
    if not isinstance(positions, list) or len(positions) > 200:
        raise ValueError("Posisi tidak valid.")
    cursor = int(body.get("cursor") or 0)
    with db.lock:
        results = db.resolve_positions(positions, cursor)
    return {"results": results}


@app.post("/api/refresh")
def refresh():
    if not db.ready:
        return JSONResponse({"error": db.message}, status_code=409)
    threading.Thread(target=db.catchup_async, daemon=True).start()
    return {"ok": True, "message": "Memperbarui dari Dukascopy…"}


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
    print(f"XAUUSD Chart · Dukascopy  http://{host}:{port}", flush=True)
    uvicorn.run(app, host=host, port=port, log_level="info")
