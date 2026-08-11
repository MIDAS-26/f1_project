import asyncio
import itertools
import json
import os
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from graph import simulate_telemetry_frame, inject_anomaly, TripwireEngine
from drivers import SIM_DRIVER_NUMBERS, driver_by_number
from track_layouts import SIM_TRACK_ID, track_id_for_race, get_track_polyline

_alert_ids = itertools.count(1)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def crewai_worker(state: dict, alerts: list[dict], websocket: WebSocket, alert_id: int):
    """Fire CrewAI deliberation in background. Non-blocking.

    Always goes through agents.deliberate(), which itself decides whether a
    real OpenRouter LLM call can be made (key present + model on the free
    allowlist) or whether to return a clearly-labeled rule-based fallback.
    main.py doesn't duplicate that decision here.

    `alert_id` ties this verdict back to the TRIPWIRE_ALERT message sent the
    moment the anomaly was detected, so the frontend can show a detected ->
    analyzing -> verdict timeline instead of a bare, unattributed overlay.

    Wrapped in its own timeout as defense-in-depth: agents.deliberate()
    already bounds the underlying LLM call, but if that ever regressed, a
    permanently in-flight worker would starve the dispatcher's concurrency
    slot forever (every later tripwire would show "skipped" and never
    recover). This guarantees the slot frees up regardless.
    """
    from agents import deliberate
    try:
        verdict = await asyncio.wait_for(deliberate(state, alerts), timeout=60.0)
    except asyncio.TimeoutError:
        t = state.get("telemetry", {})
        verdict = {
            "type": "AI_STRATEGY_OVERLAY",
            "content": f"[FALLBACK — deliberation timed out] Tripwire on Lap {t.get('lap', '?')}.",
            "alerts": alerts,
            "lap": t.get("lap"),
            "tick": t.get("tick"),
            "driver": t.get("driver"),
            "source": "fallback",
        }
    verdict["alert_id"] = alert_id
    try:
        await websocket.send_text(json.dumps(verdict))
    except RuntimeError:
        # Client disconnected while this deliberation was still in flight —
        # nothing to do, the verdict just has no one left to reach.
        pass


async def _run_deliberation(state: dict, alerts: list[dict], websocket: WebSocket, alert_id: int):
    """Hold the shared LLM concurrency slot for the duration of one deliberation."""
    async with _GLOBAL_LLM_CONCURRENCY:
        await crewai_worker(state, alerts, websocket, alert_id)


def _state_for(frame: dict) -> dict:
    return {
        "lap": frame.get("lap"),
        "tick": frame.get("tick"),
        "telemetry": frame,
        "position": frame.get("race_position") or frame.get("grid_position") or 0,
        "gap_to_leader": 0,
        "tyre_type": frame.get("tyre_type", "medium"),
    }


# Concurrency budget shared across every WebSocket connection in this
# process, not per-connection. OpenRouter's free-tier quota is a single pool
# for the whole API key regardless of how many browser tabs/live+replay
# sessions are open against this backend — a per-connection cap alone lets
# N simultaneous connections each independently max out, multiplying actual
# request volume by N. A single process-wide semaphore caps real concurrent
# LLM calls no matter how many dispatchers exist.
_GLOBAL_LLM_CONCURRENCY = asyncio.Semaphore(2)


class TripwireDispatcher:
    """Runs tripwires across every driver in a tick and fans out to CrewAI.

    Bounds concurrent CrewAI deliberations via the shared, process-wide
    `_GLOBAL_LLM_CONCURRENCY` semaphore — letting a 20-car grid, or several
    concurrent connections, all fire simultaneous deliberations would blow
    through the free-tier daily quota almost immediately.

    Also applies a per-driver cooldown: at 10Hz, a sustained condition (e.g.
    a driver holding throttle+brake together for a full second) would
    otherwise re-trigger a brand-new alert on every single tick — producing
    dozens of near-duplicate "alerts" for what is really one ongoing
    incident, and flooding the analysis feed with skip noise that makes it
    useless for judging output quality. The cooldown treats repeat hits on
    the same driver within the window as the same incident.
    """

    def __init__(self, cooldown_seconds: float = 8.0):
        self.engine = TripwireEngine()
        self._cooldown_seconds = cooldown_seconds
        self._last_alert_at: dict[int, float] = {}

    async def process_tick(self, frames: list[dict], race_control_texts: list[str],
                            websocket: WebSocket):
        # Check every driver's frame this tick, not just one arbitrarily-chosen car —
        # otherwise a tripwire on any driver except whichever sits at index 0 never
        # reaches the strategy layer at all.
        texts_for_this_tick = list(race_control_texts)
        race_control_texts.clear()
        now = asyncio.get_event_loop().time()

        for frame in frames:
            alerts = self.engine.check(_state_for(frame), texts_for_this_tick)
            if not alerts:
                continue

            driver = frame.get("driver")
            last = self._last_alert_at.get(driver)
            if last is not None and (now - last) < self._cooldown_seconds:
                continue
            self._last_alert_at[driver] = now

            driver_label = frame.get("code") or driver
            print(f"[Tripwire] Lap {frame.get('lap')} Driver {driver_label}: "
                  f"{[a['type'] for a in alerts]}")

            alert_id = next(_alert_ids)
            # Non-blocking check against the shared, process-wide budget —
            # if every slot is taken (by this connection or any other), skip
            # rather than queue, since a queued slot would free up too late
            # for the telemetry snapshot to still be current.
            will_analyze = not _GLOBAL_LLM_CONCURRENCY.locked()

            # Broadcast the raw detection immediately, before the LLM call even
            # starts, so the frontend can show "detected" right away and then
            # fill in the verdict when it lands (or mark it skipped if the
            # concurrency cap was hit).
            await websocket.send_text(json.dumps({
                "type": "TRIPWIRE_ALERT",
                "alert_id": alert_id,
                "lap": frame.get("lap"),
                "tick": frame.get("tick"),
                "driver": frame.get("driver"),
                "code": frame.get("code"),
                "name": frame.get("name"),
                "team": frame.get("team"),
                "color": frame.get("color"),
                "alerts": alerts,
                "will_analyze": will_analyze,
            }))

            if not will_analyze:
                # Deliberately dropped rather than queued: by the time a queued
                # slot freed up the telemetry snapshot would be stale anyway.
                continue

            asyncio.create_task(
                _run_deliberation(_state_for(frame), alerts, websocket, alert_id)
            )


# --- REST Endpoints ---

@app.get("/races")
async def list_races():
    """List available historical races for replay."""
    from replay import get_available_races
    return {"races": get_available_races()}


@app.get("/agent_status")
async def agent_status():
    """Report whether tripwire detection is real LangGraph and whether AI
    verdicts are real CrewAI/OpenRouter calls or the labeled rule-based
    fallback — so the UI can state this truthfully instead of assuming.
    Also reports the daily-quota circuit breaker state, if tripped.
    """
    import agents
    import time

    quota_exhausted_until = agents._quota_exhausted_until
    quota_status = None
    if quota_exhausted_until is not None:
        remaining = max(0, quota_exhausted_until - time.time())
        quota_status = {
            "exhausted": remaining > 0,
            "resets_in_seconds": int(remaining),
        }

    return {
        "langgraph": {
            "engine": "langgraph.graph.StateGraph",
            "nodes": ["check_pace_drop", "check_throttle_brake_overlap",
                      "check_tyre_degradation", "check_race_control"],
        },
        "crewai": {
            "has_llm_key": agents.HAS_LLM_KEY,
            "model": agents.OPENROUTER_MODEL,
            "provider": "openrouter",
            "agents": ["F1 Race Strategist"],
            "process": "single-agent (one LLM call per tripwire)",
            "quota": quota_status,
        },
    }


@app.get("/rc")
async def race_control(text: str):
    """Inject a race control message."""
    from graph import check_race_control
    alert = check_race_control(text)
    return {"alert": alert}


# --- WebSocket: Simulation Mode (single driver, legacy) ---

@app.websocket("/ws/race")
async def websocket_simulate(websocket: WebSocket):
    """Simulated 10Hz telemetry with injected anomalies (default dev mode)."""
    await websocket.accept()
    lap = 1
    tick = 0
    tyre_type = "medium"
    race_control_texts: list[str] = []
    dispatcher = TripwireDispatcher()

    try:
        while True:
            await asyncio.sleep(0.1)
            tick += 1

            frame = simulate_telemetry_frame(lap, tick, tyre_type)
            frame = inject_anomaly(frame, {"lap": lap})

            payload = {
                "type": "TELEMETRY_TICK",
                **frame,
            }
            await websocket.send_text(json.dumps(payload))
            await dispatcher.process_tick([frame], race_control_texts, websocket)

            if tick >= 100:
                lap += 1
                tick = 0
    except Exception as e:
        print(f"Client disconnected: {e}")
    finally:
        try:
            await websocket.close()
        except RuntimeError:
            pass


# --- WebSocket: Multi‑Driver Simulation (for overview) ---
@app.websocket("/ws/race_multi")
async def websocket_simulate_multi(websocket: WebSocket):
    """Stream telemetry for the full simulated grid, each with a track position."""
    await websocket.accept()
    lap = 1
    tick = 0
    tyre_type = "medium"
    race_control_texts: list[str] = []
    driver_ids = SIM_DRIVER_NUMBERS
    dispatcher = TripwireDispatcher()

    try:
        # Trace the exact circuit geometry (cached after first call) and announce
        # which circuit layout the frontend should render.
        polyline = await asyncio.to_thread(get_track_polyline, SIM_TRACK_ID)
        await websocket.send_text(json.dumps({
            "type": "RACE_INFO",
            "race": "sim",
            "track_id": SIM_TRACK_ID,
            "track_polyline": polyline,
            "total_laps": None,
            "drivers": [driver_by_number(d) for d in driver_ids],
        }))

        while True:
            await asyncio.sleep(0.1)
            tick += 1

            frames = []
            for did in driver_ids:
                frame = simulate_telemetry_frame(lap, tick, tyre_type, driver_id=did)
                frame = inject_anomaly(frame, {"lap": lap})
                frames.append(frame)

            # Derive running order from track progress (lower progress = further back this lap)
            # combined with lap count, so the leader is whoever has completed the most track.
            ranked = sorted(frames, key=lambda f: (f["lap"], f["track_progress"]), reverse=True)
            for rank, f in enumerate(ranked, start=1):
                f["race_position"] = rank

            # Send a single message containing an array of frames for this tick
            payload = {
                "type": "TELEMETRY_TICK_MULTI",
                "tick": tick,
                "lap": lap,
                "track_id": SIM_TRACK_ID,
                "frames": frames,
            }
            await websocket.send_text(json.dumps(payload))

            # Check tripwires across every driver in the grid this tick, not just
            # one — and attribute any resulting AI overlay to the driver who
            # actually triggered it.
            await dispatcher.process_tick(frames, race_control_texts, websocket)

            if tick >= 100:
                lap += 1
                tick = 0
    except Exception as e:
        print(f"Client disconnected: {e}")
    finally:
        try:
            await websocket.close()
        except RuntimeError:
            pass


# --- WebSocket: Replay Mode ---

@app.websocket("/ws/replay")
async def websocket_replay(websocket: WebSocket):
    """Replay a historical race at 10Hz using real FastF1 data for the whole grid.

    Client sends a JSON message on connect to select the race:
      {"race_id": "2024-monaco", "speed": 5}

    - speed: replay speed multiplier (1=real-time, 5=5x faster). Default 5.

    Car X/Y come straight from FastF1's recorded position telemetry, so the
    on-screen path traced by the cars is the actual circuit shape.
    """
    await websocket.accept()
    race_control_texts: list[str] = []
    dispatcher = TripwireDispatcher()

    try:
        # Wait for race selection message
        init_msg = json.loads(await websocket.receive_text())
        race_id = init_msg.get("race_id", "2024-monaco")
        speed = init_msg.get("speed", 5)

        from replay import RaceReplay
        replay = RaceReplay(race_id)
        # Loading pulls + processes FastF1 telemetry for up to 8 drivers — keep the
        # event loop responsive by running the blocking work in a thread.
        await asyncio.to_thread(replay.load)

        # Send race metadata, including the real track outline traced from telemetry
        await websocket.send_text(json.dumps({
            "type": "RACE_INFO",
            "race": replay.race_id,
            "track_id": track_id_for_race(replay.race_id),
            "track_polyline": replay.track_polyline,
            "total_laps": replay.total_laps,
            "drivers": replay.driver_meta_list(),
        }))

        # Stream at 10Hz (or faster based on speed multiplier)
        interval = 0.1 / speed
        tick = 0

        while True:
            result = replay.advance_tick(dt_seconds=0.1)
            if result is None:
                await websocket.send_text(json.dumps({
                    "type": "RACE_COMPLETE",
                    "message": "Replay finished.",
                }))
                break

            tick += 1
            frames = result["frames"]
            lap = result["lap"]

            payload = {
                "type": "TELEMETRY_TICK_MULTI",
                "tick": tick,
                "lap": lap,
                "track_id": track_id_for_race(replay.race_id),
                "frames": frames,
            }
            await websocket.send_text(json.dumps(payload))

            # Real telemetry drives tripwires per-driver here too, using each
            # driver's actual FastF1 data for this tick.
            await dispatcher.process_tick(frames, race_control_texts, websocket)

            await asyncio.sleep(interval)

    except Exception as e:
        print(f"Replay client disconnected: {e}")
        try:
            await websocket.send_text(json.dumps({
                "type": "RACE_COMPLETE",
                "message": f"Replay error: {e}",
            }))
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except RuntimeError:
            pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
