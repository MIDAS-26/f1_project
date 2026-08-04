import asyncio
import json
import os
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from graph import simulate_telemetry_frame, run_tripwires, inject_anomaly
from drivers import SIM_DRIVER_NUMBERS, driver_by_number
from track_layouts import SIM_TRACK_ID, track_id_for_race, get_track_polyline

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

HAS_NIM_KEY = bool(os.getenv("NVIDIA_NIM_API_KEY", ""))

# Active replay state (per-client)
_active_replays: dict[str, object] = {}


async def crewai_worker(state: dict, alerts: list[dict], websocket: WebSocket):
    """Fire CrewAI deliberation in background. Non-blocking."""
    try:
        if HAS_NIM_KEY:
            from agents import deliberate
            verdict = await deliberate(state, alerts)
        else:
            raise RuntimeError("No NVIDIA NIM API key set")
    except Exception as e:
        t = state.get("telemetry", {})
        verdict = {
            "type": "AI_STRATEGY_OVERLAY",
            "content": (
                f"STRATEGY OVERLAY (Lap {t.get('lap', '?')}): "
                f"Tripwire triggered — {', '.join(a['type'] for a in alerts)}. "
                f"{'NIM key missing — ' if not HAS_NIM_KEY else ''}"
                f"Simulated: Box this lap for Hard tires."
            ),
            "alerts": alerts,
            "lap": t.get("lap"),
        }
    await websocket.send_text(json.dumps(verdict))


async def send_telemetry_frame(websocket: WebSocket, frame: dict, state: dict,
                                race_control_texts: list[str]):
    """Send a telemetry frame, run tripwires, and spawn CrewAI if triggered."""
    await websocket.send_text(json.dumps(frame))

    alerts = run_tripwires(state, race_control_texts)
    race_control_texts.clear()

    if alerts:
        print(f"[Tripwire] Lap {frame.get('lap')}: {[a['type'] for a in alerts]}")
        asyncio.create_task(crewai_worker(state, alerts, websocket))


# --- REST Endpoints ---

@app.get("/races")
async def list_races():
    """List available historical races for replay."""
    from replay import get_available_races
    return {"races": get_available_races()}


@app.get("/rc")
async def race_control(text: str):
    """Inject a race control message."""
    from graph import check_race_control
    alert = check_race_control(text)
    return {"alert": alert}


# --- WebSocket: Simulation Mode ---

@app.websocket("/ws/race")
async def websocket_simulate(websocket: WebSocket):
    """Simulated 10Hz telemetry with injected anomalies (default dev mode)."""
    await websocket.accept()
    lap = 1
    tick = 0
    tyre_type = "medium"
    race_control_texts: list[str] = []

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

            state = {
                "lap": lap, "tick": tick,
                "telemetry": frame, "position": 3,
                "gap_to_leader": 2.4, "tyre_type": tyre_type,
            }
            await send_telemetry_frame(websocket, payload, state, race_control_texts)

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

            # Build a representative state for tripwire checking (use first driver)
            state = {
                "lap": lap,
                "tick": tick,
                "telemetry": frames[0],
                "position": 3,
                "gap_to_leader": 2.4,
                "tyre_type": tyre_type,
            }
            alerts = run_tripwires(state, race_control_texts)
            race_control_texts.clear()
            if alerts:
                print(f"[Tripwire] Lap {lap}: {[a['type'] for a in alerts]}")
                asyncio.create_task(crewai_worker(frames[0], alerts, websocket))

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

            state = {
                "lap": lap,
                "tick": tick,
                "telemetry": frames[0],
                "position": frames[0].get("grid_position", 0),
                "gap_to_leader": 0,
                "tyre_type": frames[0].get("tyre_type", "medium"),
            }
            alerts = run_tripwires(state, race_control_texts)
            race_control_texts.clear()
            if alerts:
                print(f"[Tripwire][Replay] Lap {lap}: {[a['type'] for a in alerts]}")
                asyncio.create_task(crewai_worker(frames[0], alerts, websocket))

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