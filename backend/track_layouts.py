"""Exact circuit geometry sourced from real FastF1 GPS telemetry.

Rather than hand-drawn/estimated SVG paths, every track shown to the
frontend — in both replay and live-simulation modes — is a polyline
traced from a real car's recorded X/Y position telemetry for that
circuit. This is the same technique replay.py uses to build a track
outline for the selected race; here we do it once per known circuit
(using one representative session) and cache the result to disk so
later requests (including the live-sim boot) are instant.
"""

import os
import json
import math

import fastf1
import pandas as pd

CACHE_DIR = os.getenv("F1_CACHE_DIR", "/tmp/f1_cache")
os.makedirs(CACHE_DIR, exist_ok=True)
fastf1.Cache.enable_cache(CACHE_DIR)

POLYLINE_CACHE_FILE = os.path.join(CACHE_DIR, "track_polylines.json")

CANVAS_SIZE = 500
CANVAS_PADDING = 30

# One representative real session per circuit, used purely to trace the
# exact track geometry (not for telemetry playback).
TRACK_REFERENCE_SESSION = {
    "monaco":       {"year": 2024, "gp": "Monaco",         "session": "R"},
    "silverstone":  {"year": 2024, "gp": "Great Britain",  "session": "R"},
    "spa":          {"year": 2024, "gp": "Belgium",        "session": "R"},
    "interlagos":   {"year": 2024, "gp": "Sao Paulo",      "session": "R"},
    "abudhabi":     {"year": 2024, "gp": "Abu Dhabi",      "session": "R"},
}

RACE_TRACK_MAP = {
    "2024-monaco": "monaco",
    "2024-silverstone": "silverstone",
    "2024-spa": "spa",
    "2024-interlagos": "interlagos",
    "2024-abudhabi": "abudhabi",
}

SIM_TRACK_ID = "silverstone"

_polyline_cache: dict[str, list[list[float]]] = {}
_disk_cache_loaded = False


def track_id_for_race(race_id: str) -> str:
    return RACE_TRACK_MAP.get(race_id, "generic")


def _load_disk_cache():
    global _disk_cache_loaded, _polyline_cache
    if _disk_cache_loaded:
        return
    _disk_cache_loaded = True
    if os.path.exists(POLYLINE_CACHE_FILE):
        try:
            with open(POLYLINE_CACHE_FILE) as f:
                _polyline_cache = json.load(f)
        except Exception as e:
            print(f"[TrackLayouts] Failed to read polyline cache: {e}")


def _save_disk_cache():
    try:
        with open(POLYLINE_CACHE_FILE, "w") as f:
            json.dump(_polyline_cache, f)
    except Exception as e:
        print(f"[TrackLayouts] Failed to write polyline cache: {e}")


def _normalize_polyline(tel: pd.DataFrame, target_points: int = 180) -> list[list[float]]:
    min_x, max_x = tel["X"].min(), tel["X"].max()
    min_y, max_y = tel["Y"].min(), tel["Y"].max()
    span_x = (max_x - min_x) or 1.0
    span_y = (max_y - min_y) or 1.0
    usable = CANVAS_SIZE - 2 * CANVAS_PADDING
    scale = min(usable / span_x, usable / span_y)

    def norm(x, y):
        nx = CANVAS_PADDING + (x - min_x) * scale + (usable - span_x * scale) / 2
        ny = CANVAS_SIZE - (CANVAS_PADDING + (y - min_y) * scale + (usable - span_y * scale) / 2)
        return [round(nx, 1), round(ny, 1)]

    n = len(tel)
    step = max(1, n // target_points)
    return [norm(row.X, row.Y) for row in tel.iloc[::step].itertuples()]


def _trace_track(track_id: str) -> list[list[float]]:
    ref = TRACK_REFERENCE_SESSION.get(track_id)
    if not ref:
        return []

    print(f"[TrackLayouts] Tracing exact geometry for {track_id} from {ref['gp']} {ref['year']}...")
    session = fastf1.get_session(ref["year"], ref["gp"], ref["session"])
    session.load(telemetry=True, laps=True, weather=False, messages=False)

    # Use the fastest recorded lap as the reference line — cleanest single pass
    # around the full circuit with minimal pit-lane/formation-lap noise.
    try:
        fastest = session.laps.pick_fastest()
        tel = fastest.get_telemetry()
    except Exception:
        tel = None

    if tel is None or tel.empty or "X" not in tel or "Y" not in tel:
        # Fall back to whichever driver has the most position telemetry samples
        best_tel = None
        for num in session.drivers:
            try:
                driver_laps = session.laps.pick_drivers(str(num))
                if driver_laps.empty:
                    continue
                candidate = driver_laps.get_telemetry()
                if candidate is None or candidate.empty or "X" not in candidate:
                    continue
            except Exception:
                candidate = None
            if candidate is not None and (best_tel is None or len(candidate) > len(best_tel)):
                best_tel = candidate
        tel = best_tel

    if tel is None or tel.empty:
        return []

    tel = tel.dropna(subset=["X", "Y"])
    if tel.empty:
        return []

    return _normalize_polyline(tel)


def get_track_polyline(track_id: str) -> list[list[float]]:
    """Return the exact traced polyline for a circuit, tracing + caching on first use."""
    _load_disk_cache()
    if track_id in _polyline_cache and _polyline_cache[track_id]:
        return _polyline_cache[track_id]

    try:
        polyline = _trace_track(track_id)
    except Exception as e:
        print(f"[TrackLayouts] Failed to trace {track_id}: {e}")
        polyline = []

    if polyline:
        _polyline_cache[track_id] = polyline
        _save_disk_cache()
    return polyline
