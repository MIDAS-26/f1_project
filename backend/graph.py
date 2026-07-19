"""LangGraph state machine for real-time F1 telemetry processing.

Deterministic 10Hz loop that never blocks. Tripwires trigger async CrewAI spawns.
"""

from typing import TypedDict, Annotated, Optional, List
from dataclasses import dataclass, field
from collections import deque
import re
import asyncio
import json

# LangGraph imports
from langgraph.graph import StateGraph, END

# --- State ---

class TelemetryFrame(TypedDict):
    lap: int
    tick: int
    speed: float        # km/h
    rpm: float
    throttle: float     # 0.0 - 1.0
    brake: float        # 0.0 - 1.0
    tyre_wear: float    # 0.0 - 1.0
    tyre_type: str
    drs: bool
    # driver identification and track position for overlay
    driver: int
    x: float            # pixels from left of track image
    y: float            # pixels from top of track image
    position: float     # 0.0 to 1.0, normalized lap progress (lower is ahead)

class RaceState(TypedDict):
    lap: int
    tick: int
    position: int
    gap_to_leader: float
    tyre_type: str
    telemetry: TelemetryFrame
    speed_history: list[float]
    alerts: list[dict]
    race_control_texts: list[str]
    last_tripwire: Optional[str]

# Tripwire State for LangGraph subgraph
class TripwireState(TypedDict):
    telemetry: TelemetryFrame
    race_control_texts: List[str]
    alerts: List[dict]

# --- Tripwire Detectors ---

# Rolling Z-score for pace anomalies
SPEED_WINDOW = 30  # 3 seconds at 10Hz

speed_window = deque(maxlen=SPEED_WINDOW)

# Race control regex patterns
RACE_CONTROL_PATTERNS = {
    "SAFETY_CAR": re.compile(r"SAFETY\s*CAR", re.IGNORECASE),
    "VIRTUAL_SAFETY_CAR": re.compile(r"VIRTUAL\s*SAFETY\s*CAR|VSC", re.IGNORECASE),
    "YELLOW_FLAG": re.compile(r"YELLOW\s*FLAG", re.IGNORECASE),
    "RED_FLAG": re.compile(r"RED\s*FLAG", re.IGNORECASE),
    "WEATHER_CHANGE": re.compile(r"RAIN|DRIZZLE|WET\s*TRACK|SHOWER", re.IGNORECASE),
    "INCIDENT": re.compile(r"INCIDENT|CRASH|COLLISION|DEBRIS|RETIREMENT", re.IGNORECASE),
}


def check_pace_drop(speed: float) -> Optional[dict]:
    """Z-score thresholding: flag if current speed is >2 std below rolling mean."""
    speed_window.append(speed)
    if len(speed_window) < SPEED_WINDOW:
        return None

    mean = sum(speed_window) / len(speed_window)
    variance = sum((s - mean) ** 2 for s in speed_window) / len(speed_window)
    std = variance ** 0.5
    if std < 1:
        return None

    z = (speed - mean) / std
    if z < -2.0:
        return {
            "type": "PACE_DROP",
            "z_score": round(z, 2),
            "current_speed": speed,
            "rolling_mean": round(mean, 1),
            "severity": "high" if z < -3.0 else "medium",
        }
    return None


def check_throttle_divergence(throttle: float, brake: float) -> Optional[dict]:
    """Flag simultaneous throttle+brake (possible mechanical issue or driver error)."""
    if throttle > 0.3 and brake > 0.3:
        return {
            "type": "THROTTLE_BRAKE_OVERLAP",
            "throttle": throttle,
            "brake": brake,
        }
    return None


def check_race_control(text: str) -> Optional[dict]:
    """Regex match race control messages for safety-critical events."""
    for event_type, pattern in RACE_CONTROL_PATTERNS.items():
        if pattern.search(text):
            return {
                "type": "RACE_CONTROL",
                "event": event_type,
                "text": text,
            }
    return None


def check_tyre_degradation(wear: float) -> Optional[dict]:
    """Flag when tyre wear crosses critical threshold."""
    if wear > 0.8:
        return {
            "type": "TYRE_CRITICAL",
            "wear": wear,
        }
    return None


# --- LangGraph Tripwire Subgraph ---

def check_pace_drop_node(state: TripwireState) -> TripwireState:
    t = state["telemetry"]
    pace = check_pace_drop(t["speed"])
    if pace:
        new_alerts = state["alerts"] + [pace]
        return {**state, "alerts": new_alerts}
    return state


def check_throttle_brake_overlap_node(state: TripwireState) -> TripwireState:
    t = state["telemetry"]
    throt = check_throttle_divergence(t["throttle"], t["brake"])
    if throt:
        new_alerts = state["alerts"] + [throt]
        return {**state, "alerts": new_alerts}
    return state


def check_tyre_degradation_node(state: TripwireState) -> TripwireState:
    t = state["telemetry"]
    tyre = check_tyre_degradation(t["tyre_wear"])
    if tyre:
        new_alerts = state["alerts"] + [tyre]
        return {**state, "alerts": new_alerts}
    return state


def check_race_control_node(state: TripwireState) -> TripwireState:
    alerts = []
    for text in state["race_control_texts"]:
        rc = check_race_control(text)
        if rc:
            alerts.append(rc)
    new_alerts = state["alerts"] + alerts
    return {**state, "alerts": new_alerts}


# Build the LangGraph tripwire checking workflow
tripwire_workflow = StateGraph(TripwireState)

# Add nodes
tripwire_workflow.add_node("check_pace_drop", check_pace_drop_node)
tripwire_workflow.add_node("check_throttle_brake_overlap", check_throttle_brake_overlap_node)
tripwire_workflow.add_node("check_tyre_degradation", check_tyre_degradation_node)
tripwire_workflow.add_node("check_race_control", check_race_control_node)

# Set entry point and edges (sequential execution)
tripwire_workflow.set_entry_point("check_pace_drop")
tripwire_workflow.add_edge("check_pace_drop", "check_throttle_brake_overlap")
tripwire_workflow.add_edge("check_throttle_brake_overlap", "check_tyre_degradation")
tripwire_workflow.add_edge("check_tyre_degradation", "check_race_control")
tripwire_workflow.add_edge("check_race_control", END)

# Compile the graph
tripwire_app = tripwire_workflow.compile()


def run_tripwires(state: dict, race_control_texts: List[str]) -> List[dict]:
    """Run all tripwire detectors using LangGraph. Returns list of triggered alerts."""
    t = state["telemetry"]
    initial_state = {
        "telemetry": t,
        "race_control_texts": race_control_texts,
        "alerts": []
    }
    result = tripwire_app.invoke(initial_state)
    return result["alerts"]


# --- Telemetry Simulator (Phase 1 mock — replaced by FastF1/OpenF1 later) ---

import random

def simulate_telemetry_frame(lap: int, tick: int, tyre_type: str, driver_id: int = 1) -> TelemetryFrame:
    """Generate a realistic-ish telemetry frame for development."""
    # Simulate a cornering cycle every ~100 ticks
    phase = (tick % 100) / 100  # 0..1 through the sector

    if phase < 0.3:
        speed = 180 + random.uniform(-5, 5)
        throttle = random.uniform(0.1, 0.4)
        brake = random.uniform(0.4, 0.8)
    elif phase < 0.6:
        speed = 310 + random.uniform(-10, 10)
        throttle = random.uniform(0.8, 1.0)
        brake = 0.0
    else:
        speed = 260 + random.uniform(-10, 10)
        throttle = random.uniform(0.4, 0.7)
        brake = random.uniform(0.1, 0.3)

    # Simple circular track overlay (center at 250,250, radius varies by driver)
    import math
    cx, cy = 250, 250
    base_radius = 120
    # spread drivers out by radius and phase
    radius = base_radius + ((driver_id - 1) % 5) * 15  # 0-60 extra
    angle = 2 * math.pi * phase + ((driver_id - 1) % 5) * (math.pi / 6)  # offset
    x = cx + radius * math.cos(angle)
    y = cy + radius * math.sin(angle)

    return TelemetryFrame(
        lap=lap,
        tick=tick,
        speed=round(speed, 1),
        rpm=round(10500 + (speed / 370) * 4500 + random.uniform(-50, 50)),
        throttle=round(throttle, 2),
        brake=round(brake, 2),
        tyre_wear=round(0.01 * tick + random.uniform(0, 0.02), 3),
        tyre_type=tyre_type,
        drs=tick > 30 and tick < 70,
        driver=driver_id,
        x=round(x, 1),
        y=round(y, 1),
        position=phase,  # Normalized lap progress (0.0 = start/finish, 1.0 = end of lap)
    )


# --- Anomaly Injection (for testing) ---

def inject_anomaly(frame: TelemetryFrame, state: dict) -> TelemetryFrame:
    """Occasionally inject anomalies so tripwires fire during development."""
    t = frame["tick"]
    lap = frame["lap"]
    if lap == lap % 5 == 0 and t == 50:
        frame["speed"] = frame["speed"] * 0.6
        frame["throttle"] = 0.5
        frame["brake"] = 0.5
    return frame