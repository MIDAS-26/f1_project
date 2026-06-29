# F1 Telemetry AI

Real-time F1 telemetry visualization and agentic strategy dashboard. Processes high-frequency telemetry streams (10Hz) alongside race control events, using multi-agent AI deliberation to surface strategic insights — all without blocking the live data feed.

## Architecture

The system is built on an **asynchronous non-blocking overlay** pattern:

```
FastF1/OpenF1 Live Feeds
        │
        ▼
   FastAPI Router
        │
        ▼
   LangGraph Loop (10Hz, never blocks)
        │
        ├── Normal tick ──▶ Instant WebSocket push to dashboard
        │
        └── Tripwire fires ──▶ asyncio.create_task()
                                    │
                                    ▼
                            CrewAI deliberation (NVIDIA NIM)
                                    │
                                    ▼
                            Strategy overlay payload (3-5s later)
```

The 10Hz telemetry stream *never pauses*. When a mathematical tripwire fires (pace anomaly, tyre degradation, safety car), the system snapshots the race state and spawns CrewAI agents in a background task. The agents debate the situation using NVIDIA NIM LLM inference, then overlay their verdict onto the dashboard seconds later — while the charts never stutter.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, Tremor v4, TailwindCSS, TypeScript |
| API Server | FastAPI, async WebSockets |
| Workflow Engine | LangGraph (state machine + tripwire math) |
| Multi-Agent | CrewAI (Strategist, Tyre Analyst, Race Engineer) |
| Inference | NVIDIA NIM API (openai-compatible endpoint) |
| Vector Store | Turbovec (self-hosted embeddings) |
| Data Sources | FastF1 (car telemetry), OpenF1 API (race control) |
| Hosting | Vercel (frontend) + Oracle Cloud Always-Free VM (backend + Turbovec) |

## Tripwire Detectors

| Tripwire | Method | Triggers When |
|----------|--------|---------------|
| **Pace Drop** | Z-score thresholding | Speed is >2 standard deviations below rolling 3s mean |
| **Throttle-Brake Overlap** | Threshold check | Simultaneous throttle + brake > 30% |
| **Tyre Critical** | Wear threshold | Tyre wear exceeds 80% |
| **Race Control** | Regex pattern matching | Safety Car, VSC, Yellow/Red flag, weather change, incident |

## Current Status — Phase 2 Complete (~30%)

| Phase | Description | Status |
|-------|-------------|--------|
| **1** | Foundation — FastAPI + WebSocket + Next.js dashboard | ✅ |
| **2** | LangGraph state machine + CrewAI agents + NVIDIA NIM | ✅ |
| **3** | Real data ingestion — FastF1 + OpenF1 integration | ⬜ |
| **4** | Live NVIDIA NIM agents — API key wiring, prompt tuning, tool calling | ⬜ |
| **5** | Vector store — Turbovec setup, embedding pipeline, semantic retrieval | ⬜ |
| **6** | Deployment — Oracle Cloud VM, Vercel, env management | ⬜ |

## Dashboard

The Tremor-based dashboard renders live telemetry at 10Hz:
- **Speed** — red progress bar, km/h readout
- **Throttle** — green progress bar, percentage readout
- **Brake** — orange progress bar, percentage readout
- **RPM** — blue progress bar
- **Tyre Wear** — dynamic color (green → amber at >70%)
- **DRS** — live on/off badge
- **Tyre Compound** — current compound badge (SOFT/MEDIUM/HARD)
- **AI Overlays** — purple Callout toasts that slide in when CrewAI delivers a strategy verdict

## Quick Start

### Backend

```bash
cd backend
pip install -r requirements.txt
python main.py
```

Server starts on `ws://localhost:8000/ws/race`. Tripwires fire automatically with simulated anomalies.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Dashboard opens at `http://localhost:3000`.

### NVIDIA NIM API (optional)

Without an API key, the system falls back gracefully — tripwires still fire and overlays still appear with alert context, but CrewAI deliberation is skipped.

To enable real LLM deliberation:

```bash
# backend/.env
NVIDIA_NIM_API_KEY=nvapi-xxxxx
```

### Injecting Race Control Messages

```bash
curl "http://localhost:8000/rc?text=SAFETY%20CAR%20DEPLOYED"
```

## Project Structure

```
f1-telemetry-ai/
├── guide.md                   # Full architectural blueprint
├── frontend/                  # Deployed to Vercel
│   ├── app/
│   │   ├── page.tsx           # Tremor dashboard
│   │   ├── layout.tsx         # Root layout
│   │   └── hooks/
│   │       └── useRaceWebSocket.ts  # WebSocket client + auto-reconnect
│   ├── package.json
│   └── ...
└── backend/                   # Deploys to Oracle Cloud VM
    ├── main.py                # FastAPI + WebSocket management
    ├── graph.py               # LangGraph state schema, tripwire math, telemetry sim
    ├── agents.py              # CrewAI agent profiles + NVIDIA NIM integration
    └── requirements.txt
```