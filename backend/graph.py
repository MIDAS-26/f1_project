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
    # driver identification
    driver: int
    code: str            # 3-letter driver code, e.g. "VER"
    name: str             # full driver name
    team: str
    color: str            # hex team color for track marker
    track_progress: float # 0.0 to 1.0, normalized progress around the lap (for track placement)
    race_position: int    # 1-based race rank (1 = leader)

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

# Tripwire State for LangGraph subgraph.
# `speed_window` carries a per-driver, per-connection deque (see
# TripwireEngine below) through the graph so pace-drop z-scores are never
# mixed across different clients or different drivers on the same client —
# a single module-level deque would corrupt every other driver/session's
# rolling window as soon as more than one frame source was live.
class TripwireState(TypedDict):
    telemetry: TelemetryFrame
    race_control_texts: List[str]
    alerts: List[dict]
    speed_window: "deque[float]"
    pace_drop_streak: List[int]  # single-element mutable box: [consecutive-tick count]

# --- Tripwire Detectors ---

# Simulated speed cycles between straight (~310 km/h) and corner (~180 km/h)
# roughly every 100 ticks (10s). A window shorter than that cycle treats a
# routine corner as a statistical anomaly against its own recent straight-
# line speeds — 60 samples (6s) covers most of one cycle so the baseline
# reflects a full lap's variation, not just the tail end of one phase.
SPEED_WINDOW_SIZE = 60

# Race control regex patterns
RACE_CONTROL_PATTERNS = {
    "SAFETY_CAR": re.compile(r"SAFETY\s*CAR", re.IGNORECASE),
    "VIRTUAL_SAFETY_CAR": re.compile(r"VIRTUAL\s*SAFETY\s*CAR|VSC", re.IGNORECASE),
    "YELLOW_FLAG": re.compile(r"YELLOW\s*FLAG", re.IGNORECASE),
    "RED_FLAG": re.compile(r"RED\s*FLAG", re.IGNORECASE),
    "WEATHER_CHANGE": re.compile(r"RAIN|DRIZZLE|WET\s*TRACK|SHOWER", re.IGNORECASE),
    "INCIDENT": re.compile(r"INCIDENT|CRASH|COLLISION|DEBRIS|RETIREMENT", re.IGNORECASE),
}


# Consecutive below-threshold ticks required before PACE_DROP actually
# fires. A bare z-score threshold alone isn't enough: the simulated speed
# profile dips to the same corner-minimum every lap, and even at z < -3.0
# that recurring minimum reliably crosses the line for a tick or two on
# nearly every cycle (verified empirically — every driver retriggered like
# clockwork, ~13s apart, forever). Real random jitter breaks a momentary dip
# back above threshold almost immediately, so requiring 3 consecutive ticks
# (0.3s sustained) filters out routine cornering while still catching a
# genuinely sustained pace loss (lockup, off-track excursion, mechanical
# issue) within a third of a second.
PACE_DROP_DEBOUNCE_TICKS = 3


def check_pace_drop(speed: float, speed_window: "deque[float]", streak: List[int]) -> Optional[dict]:
    """Z-score thresholding: flag if current speed is far below the rolling mean,
    sustained for PACE_DROP_DEBOUNCE_TICKS consecutive ticks.

    `speed_window` and `streak` must both be scoped to a single driver/
    connection — the caller owns their lifetime (see TripwireEngine).

    Threshold is -3.0, not the textbook -2.0: with a speed profile that
    swings ~130 km/h between straights and corners every lap, z < -2.0
    flags a large share of *routine* corner entries as anomalies (verified
    empirically — fires on ~9% of ticks). -3.0 isolates genuinely unusual
    drops rather than the car braking for a corner like it does every lap.
    """
    speed_window.append(speed)
    if len(speed_window) < speed_window.maxlen:
        return None

    mean = sum(speed_window) / len(speed_window)
    variance = sum((s - mean) ** 2 for s in speed_window) / len(speed_window)
    std = variance ** 0.5
    if std < 1:
        streak[0] = 0
        return None

    z = (speed - mean) / std
    if z < -3.0:
        streak[0] += 1
    else:
        streak[0] = 0

    if streak[0] >= PACE_DROP_DEBOUNCE_TICKS:
        streak[0] = 0  # require a fresh sustained dip before firing again
        return {
            "type": "PACE_DROP",
            "z_score": round(z, 2),
            "current_speed": speed,
            "rolling_mean": round(mean, 1),
            "severity": "high" if z < -4.0 else "medium",
        }
    return None


def check_throttle_divergence(throttle: float, brake: float) -> Optional[dict]:
    """Flag simultaneous throttle+brake (possible mechanical issue or driver error).

    Threshold is 0.5/0.5, not 0.3/0.3: normal trail-braking on corner entry
    legitimately has some throttle overlap with brake in the 0.1-0.4 range
    (verified against the simulated braking-zone profile) — 0.3 caught that
    routine overlap on most braking-zone ticks for every driver, every lap.
    0.5/0.5 requires a much heavier simultaneous application than any normal
    braking technique produces, isolating genuine driver-error/mechanical
    cases instead of ordinary trail braking.
    """
    if throttle > 0.5 and brake > 0.5:
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
    pace = check_pace_drop(t["speed"], state["speed_window"], state["pace_drop_streak"])
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


def run_tripwires(state: dict, race_control_texts: List[str],
                   speed_window: "deque[float]", pace_drop_streak: List[int]) -> List[dict]:
    """Run all tripwire detectors using LangGraph for a single driver's frame.

    `speed_window` and `pace_drop_streak` must both belong to that specific
    driver within that specific connection (see TripwireEngine) so pace-drop
    stats never mix drivers or sessions.
    """
    t = state["telemetry"]
    initial_state = {
        "telemetry": t,
        "race_control_texts": race_control_texts,
        "alerts": [],
        "speed_window": speed_window,
        "pace_drop_streak": pace_drop_streak,
    }
    result = tripwire_app.invoke(initial_state)
    return result["alerts"]


class TripwireEngine:
    """Owns per-driver rolling state for one WebSocket connection.

    Each connected client (a live-sim viewer or a replay session) gets its
    own TripwireEngine, and within it every driver number gets its own
    speed-history deque — so two clients, or two drivers in the same multi-
    car feed, never corrupt each other's pace-drop baseline the way a single
    module-level deque did previously.
    """

    def __init__(self):
        self._speed_windows: dict[int, "deque[float]"] = {}
        self._pace_drop_streaks: dict[int, List[int]] = {}

    def _window_for(self, driver: int) -> "deque[float]":
        w = self._speed_windows.get(driver)
        if w is None:
            w = deque(maxlen=SPEED_WINDOW_SIZE)
            self._speed_windows[driver] = w
        return w

    def _streak_for(self, driver: int) -> List[int]:
        s = self._pace_drop_streaks.get(driver)
        if s is None:
            s = [0]
            self._pace_drop_streaks[driver] = s
        return s

    def check(self, state: dict, race_control_texts: List[str]) -> List[dict]:
        """Run tripwires for one driver's frame, keyed by state['telemetry']['driver']."""
        driver = state["telemetry"].get("driver", 0)
        return run_tripwires(
            state, race_control_texts, self._window_for(driver), self._streak_for(driver)
        )


# --- Telemetry Simulator (Phase 1 mock — replaced by FastF1/OpenF1 later) ---

import random
from drivers import driver_by_number, SIM_DRIVER_NUMBERS

# Stagger drivers around the lap so the grid isn't all bunched at the same point,
# and give each a slightly different pace so the running order changes over time.
_GRID_OFFSETS = {
    num: idx / len(SIM_DRIVER_NUMBERS) for idx, num in enumerate(SIM_DRIVER_NUMBERS)
}
_PACE_FACTORS = {
    num: 1.0 + (idx - len(SIM_DRIVER_NUMBERS) / 2) * 0.004
    for idx, num in enumerate(SIM_DRIVER_NUMBERS)
}


def simulate_telemetry_frame(lap: int, tick: int, tyre_type: str, driver_id: int = 1) -> TelemetryFrame:
    """Generate a realistic-ish telemetry frame for development."""
    pace = _PACE_FACTORS.get(driver_id, 1.0)
    offset = _GRID_OFFSETS.get(driver_id, 0.0)

    # Simulate a cornering cycle every ~100 ticks, offset per-driver so the grid spreads out
    phase = (((tick * pace) % 100) / 100 + offset) % 1.0

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

    info = driver_by_number(driver_id)

    return TelemetryFrame(
        lap=lap,
        tick=tick,
        speed=round(speed, 1),
        rpm=round(10500 + (speed / 370) * 4500 + random.uniform(-50, 50)),
        throttle=round(throttle, 2),
        brake=round(brake, 2),
        # Wear accumulates across the *stint* (laps), not within a single
        # lap: the old formula was `0.01 * tick`, and since `tick` resets to
        # 0 every lap while climbing to ~100 by the lap's end, every driver
        # spent the second half of every single lap pinned above the 0.8
        # "critical" threshold — it modeled a full tyre change every lap,
        # not gradual degradation. ~28 laps to reach critical wear is a
        # plausible one-stint window; tick contributes only a small within-
        # lap ripple so wear still ticks up smoothly rather than jumping.
        tyre_wear=round(min(1.0, 0.035 * (lap - 1) + 0.00035 * tick + random.uniform(0, 0.01)), 3),
        tyre_type=tyre_type,
        drs=tick > 30 and tick < 70,
        driver=driver_id,
        code=info["code"],
        name=info["name"],
        team=info["team"],
        color=info["color"],
        track_progress=phase,  # 0.0 = start/finish, 1.0 = end of lap
        race_position=0,  # filled in by caller once all drivers for the tick are known
    )


# --- Anomaly Injection (for testing) ---

def inject_anomaly(frame: TelemetryFrame, state: dict) -> TelemetryFrame:
    """Occasionally inject a genuine anomaly so the tripwire pipeline can be
    exercised without waiting for real conditions (e.g. ~24 laps for tyre
    wear) to occur naturally.

    Was dead code before: `lap == lap % 5 == 0` chains to `(lap == lap % 5)
    and (lap % 5 == 0)`, which — since laps start at 1 — requires lap == 0
    and so never fired. Also the injected throttle/brake of exactly 0.5/0.5
    no longer clears the tightened `> 0.5` overlap threshold, and a single
    injected tick can't clear PACE_DROP's 3-consecutive-tick debounce.
    Fixed to fire every 5th lap across ticks 50-52 (3 consecutive ticks) and
    inject values that clearly exceed both current thresholds.
    """
    t = frame["tick"]
    lap = frame["lap"]
    if lap % 5 == 0 and 50 <= t <= 55:
        # Sustaining a moderate dip (e.g. 60 km/h) for many ticks doesn't
        # work here: each identical low sample pulls the rolling window's
        # own mean *and* inflates its std (the window becomes bimodal, half
        # normal-pace half anomaly), and z-score actually drifts back
        # *toward* zero the longer the anomaly persists against its own
        # increasingly-skewed baseline (verified empirically). A brief,
        # sharp spike well outside anything the window has seen avoids that
        # self-dilution — but whether any single tick clears -3.0 still
        # depends on exactly where in the straight/corner cycle the window
        # sits when the spike lands (verified: 3 ticks can land right on
        # the -3.0/-2.98 edge). Injecting across 6 ticks instead of the
        # minimum 3 gives PACE_DROP_DEBOUNCE_TICKS' 3-consecutive-tick
        # requirement enough room to find 3 in a row regardless of cycle
        # phase, without relying on hitting an exact tick window.
        frame["speed"] = 20.0
        frame["throttle"] = 0.7
        frame["brake"] = 0.7
    return frame