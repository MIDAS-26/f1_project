"""Historical race replay engine using FastF1.

Pulls real telemetry (including on-track X/Y position) from past F1 races
and replays the *entire grid* in lock-step through the 10Hz WebSocket
pipeline, feeding the same tripwire and CrewAI systems that live mode uses.

Because we use FastF1's actual car position telemetry, the on-screen track
shape traced by the cars IS the real circuit layout (Monaco, Silverstone,
etc.) rather than a generic oval.
"""

import os
import math
from typing import Optional

import fastf1
import pandas as pd

from drivers import driver_by_number


def _safe_float(val, default: float = 0.0) -> float:
    try:
        if val is None or (isinstance(val, float) and math.isnan(val)) or pd.isna(val):
            return default
        return float(val)
    except (TypeError, ValueError):
        return default


def _safe_int(val, default: int = 0) -> int:
    return int(round(_safe_float(val, default)))

CACHE_DIR = os.getenv("F1_CACHE_DIR", "/tmp/f1_cache")
os.makedirs(CACHE_DIR, exist_ok=True)
fastf1.Cache.enable_cache(CACHE_DIR)

# Pre-selected memorable races for replay, grouped implicitly by year.
# Restricted to circuits with traced geometry in track_layouts.py so the
# track shown during replay is always the real circuit outline, never the
# generic fallback shape. Add a circuit here only after adding a matching
# entry to track_layouts.TRACK_REFERENCE_SESSION / RACE_TRACK_MAP.
AVAILABLE_RACES = [
    # 2024
    {"id": "2024-monaco", "year": 2024, "gp": "Monaco", "session": "R",
     "label": "Monaco Grand Prix", "circuit": "Circuit de Monaco", "country": "Monaco"},
    {"id": "2024-silverstone", "year": 2024, "gp": "Great Britain", "session": "R",
     "label": "British Grand Prix", "circuit": "Silverstone Circuit", "country": "United Kingdom"},
    {"id": "2024-spa", "year": 2024, "gp": "Belgium", "session": "R",
     "label": "Belgian Grand Prix", "circuit": "Circuit de Spa-Francorchamps", "country": "Belgium"},
    {"id": "2024-interlagos", "year": 2024, "gp": "Sao Paulo", "session": "R",
     "label": "São Paulo Grand Prix", "circuit": "Autódromo José Carlos Pace", "country": "Brazil"},
    {"id": "2024-abudhabi", "year": 2024, "gp": "Abu Dhabi", "session": "R",
     "label": "Abu Dhabi Grand Prix", "circuit": "Yas Marina Circuit", "country": "United Arab Emirates"},
    # 2023
    {"id": "2023-monaco", "year": 2023, "gp": "Monaco", "session": "R",
     "label": "Monaco Grand Prix", "circuit": "Circuit de Monaco", "country": "Monaco"},
    {"id": "2023-silverstone", "year": 2023, "gp": "Great Britain", "session": "R",
     "label": "British Grand Prix", "circuit": "Silverstone Circuit", "country": "United Kingdom"},
    {"id": "2023-spa", "year": 2023, "gp": "Belgium", "session": "R",
     "label": "Belgian Grand Prix", "circuit": "Circuit de Spa-Francorchamps", "country": "Belgium"},
    {"id": "2023-interlagos", "year": 2023, "gp": "Sao Paulo", "session": "R",
     "label": "São Paulo Grand Prix", "circuit": "Autódromo José Carlos Pace", "country": "Brazil"},
    {"id": "2023-abudhabi", "year": 2023, "gp": "Abu Dhabi", "session": "R",
     "label": "Abu Dhabi Grand Prix", "circuit": "Yas Marina Circuit", "country": "United Arab Emirates"},
    # 2022
    {"id": "2022-monaco", "year": 2022, "gp": "Monaco", "session": "R",
     "label": "Monaco Grand Prix", "circuit": "Circuit de Monaco", "country": "Monaco"},
    {"id": "2022-silverstone", "year": 2022, "gp": "Great Britain", "session": "R",
     "label": "British Grand Prix", "circuit": "Silverstone Circuit", "country": "United Kingdom"},
    {"id": "2022-spa", "year": 2022, "gp": "Belgium", "session": "R",
     "label": "Belgian Grand Prix", "circuit": "Circuit de Spa-Francorchamps", "country": "Belgium"},
    {"id": "2022-abudhabi", "year": 2022, "gp": "Abu Dhabi", "session": "R",
     "label": "Abu Dhabi Grand Prix", "circuit": "Yas Marina Circuit", "country": "United Arab Emirates"},
]

# How many cars to replay at once — full grid for a realistic race
MAX_REPLAY_DRIVERS = 20

# Canvas the frontend draws onto (matches TrackOverlay.tsx)
CANVAS_SIZE = 500
CANVAS_PADDING = 30


def get_available_races() -> list[dict]:
    return AVAILABLE_RACES


class RaceReplay:
    """Replays a historical race at 10Hz, driving the *whole grid* through
    the standard telemetry pipeline using real car position data.
    """

    def __init__(self, race_id: str):
        self.race_id = race_id
        self.session = None
        self.driver_numbers: list[int] = []
        self.driver_pos: dict[int, pd.DataFrame] = {}   # driver_number -> car+pos data (indexed by Time)
        self.driver_lap_lookup: dict[int, pd.DataFrame] = {}  # driver_number -> laps table
        self.total_laps = 0
        self.track_bounds = None  # (min_x, max_x, min_y, max_y) in FastF1 track units
        self.track_polyline: list[list[float]] = []  # normalized [ [x,y], ... ] outline of the circuit
        self.start_time = None
        self.end_time = None
        self.elapsed = pd.Timedelta(0)

    def load(self):
        """Load race session + per-driver telemetry. Heavy call — cached after first pull."""
        race = next((r for r in AVAILABLE_RACES if r["id"] == self.race_id), None)
        if not race:
            raise ValueError(f"Unknown race: {self.race_id}")

        print(f"[Replay] Loading {self.race_id}...")
        session = fastf1.get_session(race["year"], race["gp"], race["session"])
        session.load()
        self.session = session
        self.total_laps = _safe_int(session.laps["LapNumber"].max()) if not session.laps.empty else 0

        all_numbers = [int(n) for n in session.drivers]
        chosen = all_numbers[:MAX_REPLAY_DRIVERS]
        self.driver_numbers = chosen

        min_x = min_y = math.inf
        max_x = max_y = -math.inf
        earliest = None
        latest = None

        for num in chosen:
            try:
                driver_laps = session.laps.pick_drivers(str(num))
                if driver_laps.empty:
                    continue
                tel = driver_laps.get_telemetry()
                if tel is None or tel.empty or "X" not in tel or "Y" not in tel:
                    continue
                tel = tel.dropna(subset=["X", "Y", "Time"]).sort_values("Time")
                if tel.empty:
                    continue

                self.driver_pos[num] = tel
                self.driver_lap_lookup[num] = driver_laps

                min_x = min(min_x, tel["X"].min())
                max_x = max(max_x, tel["X"].max())
                min_y = min(min_y, tel["Y"].min())
                max_y = max(max_y, tel["Y"].max())

                t0, t1 = tel["Time"].iloc[0], tel["Time"].iloc[-1]
                earliest = t0 if earliest is None else min(earliest, t0)
                latest = t1 if latest is None else max(latest, t1)
            except Exception as e:
                print(f"[Replay] Skipping driver {num}: {e}")
                continue

        if not self.driver_pos:
            raise RuntimeError(f"No telemetry position data available for {self.race_id}")

        self.track_bounds = (min_x, max_x, min_y, max_y)
        self.start_time = earliest
        self.end_time = latest
        self.elapsed = pd.Timedelta(0)

        # Trace the circuit outline from a single clean lap (the fastest lap of
        # the session), not a driver's full multi-lap telemetry stream — using
        # the full stream double-backs through the pit lane and jumps between
        # laps, producing a tangled, self-crossing shape instead of one loop.
        try:
            fastest_lap = session.laps.pick_fastest()
            outline_tel = fastest_lap.get_telemetry().dropna(subset=["X", "Y"])
            if outline_tel.empty:
                raise ValueError("empty fastest-lap telemetry")
        except Exception as e:
            print(f"[Replay] Could not get fastest-lap telemetry for outline, "
                  f"falling back to first driver's first lap: {e}")
            first_num, first_laps = next(iter(self.driver_lap_lookup.items()))
            single_lap = first_laps.iloc[[0]]
            outline_tel = single_lap.get_telemetry().dropna(subset=["X", "Y"])

        self.track_polyline = self._build_track_polyline(outline_tel)

        print(f"[Replay] Loaded {self.race_id}: {len(self.driver_pos)} cars, "
              f"{self.total_laps} laps, track bounds {self.track_bounds}")
        return self

    def _normalize_point(self, x: float, y: float) -> list[float]:
        min_x, max_x, min_y, max_y = self.track_bounds
        span_x = (max_x - min_x) or 1.0
        span_y = (max_y - min_y) or 1.0
        usable = CANVAS_SIZE - 2 * CANVAS_PADDING
        # Preserve aspect ratio so the real track shape isn't distorted
        scale = min(usable / span_x, usable / span_y)
        nx = CANVAS_PADDING + (x - min_x) * scale + (usable - span_x * scale) / 2
        # Flip Y: FastF1 track coords have Y increasing "up"; SVG has it increasing down
        ny = CANVAS_SIZE - (CANVAS_PADDING + (y - min_y) * scale + (usable - span_y * scale) / 2)
        return [round(nx, 1), round(ny, 1)]

    def _build_track_polyline(self, tel: pd.DataFrame, target_points: int = 150) -> list[list[float]]:
        n = len(tel)
        if n == 0:
            return []
        step = max(1, n // target_points)
        pts = [self._normalize_point(row.X, row.Y) for row in tel.iloc[::step].itertuples()]
        return pts

    def driver_meta_list(self) -> list[dict]:
        out = []
        for num in self.driver_numbers:
            if num not in self.driver_pos:
                continue
            meta = driver_by_number(num)
            out.append(meta)
        return out

    def advance_tick(self, dt_seconds: float = 0.1) -> Optional[dict]:
        """Advance simulated race clock by dt_seconds and return a frame per driver.

        Returns None once we run past the recorded session window.
        """
        if self.start_time is None:
            return None

        self.elapsed += pd.Timedelta(seconds=dt_seconds)
        current_time = self.start_time + self.elapsed
        if current_time > self.end_time:
            return None

        frames = []
        for num in self.driver_numbers:
            tel = self.driver_pos.get(num)
            if tel is None:
                continue
            frame = self._frame_for_driver_at(num, tel, current_time)
            if frame:
                frames.append(frame)

        if not frames:
            return None

        # Rank by lap then track distance covered this lap (Distance column) → race position
        ranked = sorted(frames, key=lambda f: (f["lap"], f.get("_progress", 0)), reverse=True)
        for rank, f in enumerate(ranked, start=1):
            f["race_position"] = rank
            f.pop("_progress", None)

        return {"frames": frames, "lap": max(f["lap"] for f in frames)}

    def _frame_for_driver_at(self, num: int, tel: pd.DataFrame, current_time) -> Optional[dict]:
        # Nearest sample at/after current_time (telemetry is already sorted by Time)
        idx = tel["Time"].searchsorted(current_time)
        if idx >= len(tel):
            idx = len(tel) - 1
        row = tel.iloc[idx]

        lap_number = _safe_int(row.get("Lap"), 1) if "Lap" in tel.columns else 1
        if lap_number < 1:
            lap_number = 1
        laps_tbl = self.driver_lap_lookup.get(num)
        compound = "MEDIUM"
        tyre_life = 0
        position = 0
        if laps_tbl is not None and not laps_tbl.empty:
            lap_rows = laps_tbl[laps_tbl["LapNumber"] == lap_number]
            if not lap_rows.empty:
                lap_row = lap_rows.iloc[0]
                raw_compound = lap_row.get("Compound", "MEDIUM")
                compound = str(raw_compound) if raw_compound and not pd.isna(raw_compound) else "MEDIUM"
                tyre_life = _safe_int(lap_row.get("TyreLife"), 0)
                position = _safe_int(lap_row.get("Position"), 0)

        compound_map = {"SOFT": "soft", "MEDIUM": "medium", "HARD": "hard",
                        "INTERMEDIATE": "inter", "WET": "wet"}
        tyre_type = compound_map.get(compound.upper(), "medium")
        tyre_wear = min(tyre_life / 30.0, 1.0)

        speed = _safe_float(row.get("Speed"), 0.0)
        throttle = _safe_float(row.get("Throttle"), 0.0) / 100.0
        brake_raw = row.get("Brake", False)
        brake = 1.0 if (brake_raw is True or brake_raw == 1) else 0.0
        gear = _safe_float(row.get("nGear"), 0.0)
        rpm = _safe_float(row.get("RPM"), 0.0)
        if rpm <= 0:
            rpm = gear * 1000 + 8000 if gear else 10000
        drs = bool(_safe_float(row.get("DRS"), 0.0) > 0)

        x, y = self._normalize_point(row.X, row.Y)
        info = driver_by_number(num)
        distance = _safe_float(row.get("Distance"), 0.0)

        return {
            "lap": lap_number,
            "tick": int(idx),
            "speed": round(speed, 1),
            "rpm": round(rpm),
            "throttle": round(throttle, 2),
            "brake": round(brake, 2),
            "tyre_wear": round(tyre_wear, 3),
            "tyre_type": tyre_type,
            "drs": drs,
            "driver": num,
            "code": info["code"],
            "name": info["name"],
            "team": info["team"],
            "color": info["color"],
            "x": x,
            "y": y,
            "compound": compound,
            "grid_position": position,
            "_progress": lap_number * 100000 + distance,  # internal sort key only
        }
