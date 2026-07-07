"""Historical race replay engine using FastF1.

Pulls real telemetry data from past F1 races and replays them
through the 10Hz WebSocket pipeline, feeding the same tripwire
and CrewAI systems that live mode would use.
"""

import os
import json
import asyncio
import time
import math
from typing import Optional

import fastf1

CACHE_DIR = os.getenv("F1_CACHE_DIR", "/tmp/f1_cache")
os.makedirs(CACHE_DIR, exist_ok=True)
fastf1.Cache.enable_cache(CACHE_DIR)

# Pre-selected memorable races for replay
AVAILABLE_RACES = [
    {"id": "2024-monaco", "year": 2024, "gp": "Monaco", "session": "R",
     "label": "2024 Monaco GP"},
    {"id": "2024-silverstone", "year": 2024, "gp": "Great Britain", "session": "R",
     "label": "2024 British GP"},
    {"id": "2024-spa", "year": 2024, "gp": "Belgium", "session": "R",
     "label": "2024 Belgian GP"},
    {"id": "2024-interlagos", "year": 2024, "gp": "Sao Paulo", "session": "R",
     "label": "2024 Sao Paulo GP"},
    {"id": "2024-abudhabi", "year": 2024, "gp": "Abu Dhabi", "session": "R",
     "label": "2024 Abu Dhabi GP"},
]


def get_available_races() -> list[dict]:
    return AVAILABLE_RACES


def load_race(race_id: str) -> dict:
    """Load a historical race session. Returns session metadata + lap data."""
    race = next((r for r in AVAILABLE_RACES if r["id"] == race_id), None)
    if not race:
        raise ValueError(f"Unknown race: {race_id}")

    session = fastf1.get_session(race["year"], race["gp"], race["session"])
    session.load()

    return {
        "race": race,
        "session": session,
        "total_laps": len(session.laps),
        "drivers": session.drivers[:10],
    }


def get_driver_telemetry(session, driver_number: int, lap_number: int) -> Optional[dict]:
    """Extract telemetry for a specific driver and lap."""
    try:
        laps = session.laps[
            (session.laps["DriverNumber"] == str(driver_number)) &
            (session.laps["LapNumber"] == lap_number)
        ]
        if laps.empty:
            return None

        lap = laps.iloc[0]
        car_data = lap.get_car_data()
        if car_data is None or car_data.empty:
            return None

        return {
            "lap_info": {
                "driver": lap.get("Driver", "?"),
                "driver_number": str(driver_number),
                "lap_number": int(lap_number),
                "lap_time": str(lap.get("LapTime", "")),
                "sector1": str(lap.get("Sector1Time", "")),
                "sector2": str(lap.get("Sector2Time", "")),
                "sector3": str(lap.get("Sector3Time", "")),
                "compound": str(lap.get("Compound", "UNKNOWN")),
                "tyre_life": int(lap.get("TyreLife", 0)) if lap.get("TyreLife") is not None else 0,
                "position": int(lap.get("Position", 0)) if lap.get("Position") is not None else 0,
            },
            "car_data": car_data,
        }
    except Exception as e:
        print(f"[Replay] Error getting telemetry for driver {driver_number} lap {lap_number}: {e}")
        return None


def frame_from_car_data(row, lap_info: dict) -> dict:
    """Convert a FastF1 car data row into our telemetry frame format."""
    speed = float(row.get("Speed", 0))
    rpm = float(row.get("nGear", 0)) * 1000 + 8000 if row.get("nGear") else 0
    throttle = float(row.get("Throttle", 0)) / 100.0
    brake = 1.0 if row.get("Brake", False) else 0.0
    drs = bool(row.get("DRS", 0) > 0)

    # Estimate tyre wear from tyre life (rough: 0 at start, ~1.0 at ~30 laps)
    tyre_life = lap_info.get("tyre_life", 0)
    tyre_wear = min(tyre_life / 30.0, 1.0)

    compound_map = {"SOFT": "soft", "MEDIUM": "medium", "HARD": "hard",
                    "INTERMEDIATE": "inter", "WET": "wet"}
    tyre_type = compound_map.get(lap_info.get("compound", "").upper(), "medium")

    return {
        "type": "TELEMETRY_TICK",
        "lap": lap_info.get("lap_number", 1),
        "speed": round(speed, 1),
        "rpm": int(rpm) if rpm else 10000,
        "throttle": round(throttle, 2),
        "brake": round(brake, 2),
        "tyre_wear": round(tyre_wear, 3),
        "tyre_type": tyre_type,
        "drs": drs,
        "driver": lap_info.get("driver", "?"),
        "position": lap_info.get("position", 0),
        "compound": lap_info.get("compound", "UNKNOWN"),
    }


class RaceReplay:
    """Replays a historical race at 10Hz through the standard telemetry pipeline."""

    def __init__(self, race_id: str, driver_number: int = 1):
        self.race_id = race_id
        self.driver_number = driver_number
        self.data = None
        self.current_lap = 1
        self.current_row = 0
        self.current_car_data = None
        self.running = False
        self.speed_multiplier = 1.0  # 1.0 = real-time, higher = faster replay

    def load(self):
        """Load race data. Heavy call — caches locally after first pull."""
        print(f"[Replay] Loading {self.race_id} for driver {self.driver_number}...")
        self.data = load_race(self.race_id)
        driver = self.data["drivers"][0] if self.driver_number == 1 else str(self.driver_number)
        self.driver_number = int(driver)
        print(f"[Replay] Loaded. {self.data['total_laps']} laps, driver #{self.driver_number}")
        return self.data

    def advance_frame(self) -> Optional[dict]:
        """Get the next telemetry frame. Returns None when race is over."""
        if not self.data:
            return None

        session = self.data["session"]

        # If we don't have car data for the current lap, load it
        if self.current_car_data is None:
            result = get_driver_telemetry(
                session, self.driver_number, self.current_lap
            )
            if result is None:
                # Try next lap or end
                if self.current_lap < self.data["total_laps"]:
                    self.current_lap += 1
                    self.current_row = 0
                    return self.advance_frame()
                else:
                    return None
            self.current_car_data = result["car_data"]
            self.current_lap_info = result["lap_info"]
            self.current_row = 0

        if self.current_row >= len(self.current_car_data):
            # Move to next lap
            self.current_lap += 1
            self.current_car_data = None
            self.current_row = 0
            if self.current_lap > self.data["total_laps"]:
                return None
            return self.advance_frame()

        row = self.current_car_data.iloc[self.current_row]
        self.current_row += 1

        frame = frame_from_car_data(row, self.current_lap_info)
        return frame

    def reset(self):
        self.current_lap = 1
        self.current_row = 0
        self.current_car_data = None