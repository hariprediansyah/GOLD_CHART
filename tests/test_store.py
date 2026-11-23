"""Uji penggabungan candle dan jalur TP/SL."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from store import Store, aggregate, hit_bar


def test_aggregate_m1_to_m5():
    rows = [
        (0, 10, 12, 9, 11, 1),
        (60, 11, 14, 10, 12, 2),
        (240, 12, 13, 8, 9, 4),
        (300, 20, 21, 19, 20.5, 3),
    ]
    bars = list(aggregate(rows, 300))
    assert bars == [
        [0, 10, 14, 8, 9, 7],
        [300, 20, 21, 19, 20.5, 3],
    ]


def test_hit_bullish_stops_before_target():
    # Naik: open, low, high, close. Low menyentuh SL lebih dulu.
    assert hit_bar("long", 100, 90, 110, 100, 112, 89, 105) == "sl"


def test_hit_bearish_target_before_stop():
    # Turun: open, high, low, close. High menyentuh TP lebih dulu.
    assert hit_bar("long", 100, 90, 110, 100, 111, 89, 90) == "tp"


def test_gap_open_through_stop():
    assert hit_bar("long", 100, 90, 110, 80, 82, 79, 81) == "sl"


def test_short_high_hits_stop_before_target():
    # Short, candle turun: high disentuh lebih dulu, jadi SL di atas kena sebelum TP.
    assert hit_bar("short", 100, 110, 90, 100, 111, 89, 95) == "sl"


def test_resolve_skips_entry_bar_and_uses_next(tmp_path):
    store = Store(tmp_path / "t.db")
    store.connect()
    store.insert_m1(
        [
            (1_000, 100, 101, 99, 100, 1),
            (1_060, 100, 112, 99, 111, 1),
        ]
    )
    result = store.resolve_positions(
        [{"id": "a", "side": "long", "t": 1_000, "entry": 100, "sl": 90, "tp": 110}],
        1_060,
    )[0]
    assert result["status"] == "tp"
    assert result["exit"] == 110
    assert result["final"] is True

    waiting = store.resolve_positions(
        [{"id": "b", "side": "long", "t": 2_000, "entry": 100, "sl": 90, "tp": 110}],
        1_060,
    )[0]
    assert waiting["status"] == "wait"

    opened = store.resolve_positions(
        [{"id": "c", "side": "short", "t": 1_000, "entry": 100, "sl": 120, "tp": 80}],
        1_000,
    )[0]
    assert opened["status"] == "open"
    assert opened["exit"] == 100


def test_resolve_continues_from_scanned(tmp_path):
    store = Store(tmp_path / "t.db")
    store.connect()
    store.insert_m1(
        [
            (1_000, 100, 100, 100, 100, 1),
            (1_060, 100, 101, 99, 100, 1),
            (1_120, 100, 130, 99, 120, 1),
        ]
    )
    result = store.resolve_positions(
        [{
            "id": "a",
            "side": "long",
            "t": 1_000,
            "entry": 100,
            "sl": 90,
            "tp": 110,
            "scannedTo": 1_060,
            "mark": 100,
            "markT": 1_060,
        }],
        1_120,
    )[0]
    assert result["status"] == "tp"
    assert result["exitT"] == 1_120


def test_btcusd_store_meta_and_resolution(tmp_path):
    store = Store(tmp_path / "btc.db", symbol="BTCUSD")
    store.connect()
    meta = store.public_meta()
    assert meta["symbol"] == "BTCUSD"
    assert meta["contract"] == 1
    assert meta["digits"] == 2
    store.insert_m1(
        [
            (1_000, 60000, 60100, 59900, 60050, 10),
            (1_060, 60050, 61200, 60000, 61100, 15),
        ]
    )
    result = store.resolve_positions(
        [{"id": "btc1", "side": "long", "t": 1_000, "entry": 60000, "sl": 59000, "tp": 61000}],
        1_060,
    )[0]
    assert result["status"] == "tp"
    assert result["exit"] == 61000
    assert result["final"] is True
