import asyncio
import json
import os
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from graph import simulate_telemetry_frame, run_tripwires, inject_anomaly

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

HAS_NIM_KEY = bool(os.getenv("NVIDIA_NIM_API_KEY", ""))

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


@app.websocket("/ws/race")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    lap = 1
    tick = 0
    tyre_type = "medium"
    race_control_texts: list[str] = []

    try:
        while True:
            await asyncio.sleep(0.1)
            tick += 1

            # Sim telemetry frame
            frame = simulate_telemetry_frame(lap, tick, tyre_type)
            frame = inject_anomaly(frame, {"lap": lap})

            telemetry_payload = {
                "type": "TELEMETRY_TICK",
                "lap": frame["lap"],
                "speed": frame["speed"],
                "rpm": frame["rpm"],
                "throttle": frame["throttle"],
                "brake": frame["brake"],
                "tyre_wear": frame["tyre_wear"],
                "tyre_type": frame["tyre_type"],
                "drs": frame["drs"],
            }
            await websocket.send_text(json.dumps(telemetry_payload))

            # Run tripwires
            state = {
                "lap": lap,
                "tick": tick,
                "telemetry": frame,
                "position": 3,
                "gap_to_leader": 2.4,
                "tyre_type": tyre_type,
            }
            alerts = run_tripwires(state, race_control_texts)
            race_control_texts.clear()

            if alerts:
                print(f"[Tripwire] Lap {lap}, Tick {tick}: {[a['type'] for a in alerts]}")
                asyncio.create_task(crewai_worker(state, alerts, websocket))

            if tick >= 100:
                lap += 1
                tick = 0
    except Exception as e:
        print(f"Client disconnected: {e}")
    finally:
        await websocket.close()


@app.get("/rc")
async def race_control(text: str):
    """Inject a race control message. e.g. GET /rc?text=SAFETY+CAR+DEPLOYED"""
    from graph import check_race_control
    alert = check_race_control(text)
    return {"alert": alert}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)