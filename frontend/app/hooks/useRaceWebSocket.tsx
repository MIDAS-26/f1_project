"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from "react";

export interface DriverMeta {
  driver: number;
  code: string;
  name: string;
  team: string;
  color: string;
}

interface TelemetryFrame {
  type?: "TELEMETRY_TICK";
  lap: number;
  speed: number;
  rpm: number;
  throttle: number;
  brake: number;
  tyre_wear: number;
  tyre_type: string;
  drs: boolean;
  driver: number;
  code?: string;
  name?: string;
  team?: string;
  color?: string;
  race_position?: number;
  compound?: string;
  // Live-sim: normalized 0..1 progress around the lap (placed via SVG path sampling)
  track_progress?: number;
  // Replay: real canvas x/y traced from FastF1 car-position telemetry
  x?: number;
  y?: number;
}

export interface TripwireAlertMsg {
  type: "TRIPWIRE_ALERT";
  alert_id: number;
  lap: number;
  tick: number;
  driver: number;
  code?: string;
  name?: string;
  team?: string;
  color?: string;
  alerts: { type: string; [k: string]: any }[];
  will_analyze: boolean;
}

export interface AIOverlay {
  type: "AI_STRATEGY_OVERLAY";
  content: string;
  alerts: { type: string; [k: string]: any }[];
  lap: number;
  tick: number;
  driver: number;
  source: "crewai" | "fallback";
  alert_id?: number;
  _id?: number;
}

// One entry per tripwire detection, filled in as its verdict arrives.
export interface AnalysisEntry {
  alertId: number;
  lap: number;
  tick: number;
  driver: number;
  code?: string;
  name?: string;
  team?: string;
  color?: string;
  alertTypes: string[];
  status: "analyzing" | "answered" | "skipped";
  verdict?: AIOverlay;
  receivedAt: number;
}

interface RaceInfo {
  type: "RACE_INFO";
  race: string;
  track_id?: string;
  track_polyline?: [number, number][];
  total_laps: number | null;
  drivers?: DriverMeta[];
}

interface RaceComplete {
  type: "RACE_COMPLETE";
  message: string;
}

// Multi-frame message from /ws/race_multi and /ws/replay
interface TelemetryMultiFrame {
  type: "TELEMETRY_TICK_MULTI";
  tick: number;
  lap: number;
  track_id?: string;
  frames: TelemetryFrame[];
}

type RaceMessage =
  | TelemetryFrame
  | TelemetryMultiFrame
  | AIOverlay
  | TripwireAlertMsg
  | RaceInfo
  | RaceComplete;

export interface RaceOption {
  id: string;
  year: number;
  label: string;
  circuit?: string;
  country?: string;
}

export interface AgentStatus {
  langgraph: { engine: string; nodes: string[] };
  crewai: {
    has_llm_key: boolean;
    model: string;
    provider: string;
    agents: string[];
    process: string;
    quota: { exhausted: boolean; resets_in_seconds: number } | null;
  };
}

type Mode = "sim" | "replay";
type ConnectionPhase = "idle" | "connecting" | "loading_race" | "live" | "complete" | "error";

interface RaceWebSocketState {
  frames: TelemetryFrame[];
  overlays: AIOverlay[];
  analysisLog: AnalysisEntry[];
  connected: boolean;
  phase: ConnectionPhase;
  errorMessage: string | null;
  mode: Mode;
  raceId: string;
  races: RaceOption[];
  raceMeta: RaceInfo | null;
  complete: boolean;
  startReplay: (rId: string) => void;
  startSim: () => void;
  selectedDriverId: string | number | null;
  setSelectedDriverId: (id: string | number | null) => void;
  trackId: string;
  trackPolyline: [number, number][] | null;
  driverRoster: DriverMeta[];
  agentStatus: AgentStatus | null;
}

// Kept generous enough to feed a dedicated analytics page (Sankey, stats)
// across a full replay session, not just the live sidebar feed.
const MAX_ANALYSIS_LOG = 500;

function useRaceWebSocketInternal(): RaceWebSocketState {
  const [frames, setFrames] = useState<TelemetryFrame[]>([]); // array of frames for latest tick
  const [overlays, setOverlays] = useState<AIOverlay[]>([]);
  const [analysisLog, setAnalysisLog] = useState<AnalysisEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [phase, setPhase] = useState<ConnectionPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("sim");
  const [raceId, setRaceId] = useState<string>("");
  const [raceMeta, setRaceMeta] = useState<RaceInfo | null>(null);
  const [races, setRaces] = useState<RaceOption[]>([]);
  const [complete, setComplete] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState<string | number | null>(null);
  const [trackId, setTrackId] = useState<string>("silverstone");
  const [trackPolyline, setTrackPolyline] = useState<[number, number][] | null>(null);
  const [driverRoster, setDriverRoster] = useState<DriverMeta[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch available races + agent status on mount
  useEffect(() => {
    fetch("http://localhost:8000/races")
      .then((r) => r.json())
      .then((data) => {
        if (data.races) {
          setRaces(
            data.races.map((r: any) => ({
              id: r.id,
              year: r.year,
              label: r.label,
              circuit: r.circuit,
              country: r.country,
            }))
          );
        }
      })
      .catch(() => {});

    const fetchAgentStatus = () => {
      fetch("http://localhost:8000/agent_status")
        .then((r) => r.json())
        .then((data) => setAgentStatus(data))
        .catch(() => {});
    };
    fetchAgentStatus();
    // Poll periodically so the daily-quota circuit breaker state (which can
    // trip or reset mid-session) is reflected live, not just at page load.
    const interval = setInterval(fetchAgentStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const connect = useCallback((m: Mode, rId?: string) => {
    if (wsRef.current) wsRef.current.close();

    let url: string;
    if (m === "replay" && rId) {
      url = "ws://localhost:8000/ws/replay";
    } else {
      // For simulation we now use the multi-driver endpoint by default
      url = "ws://localhost:8000/ws/race_multi";
    }

    setPhase(m === "replay" ? "loading_race" : "connecting");
    setErrorMessage(null);
    const ws = new WebSocket(url);

    ws.onopen = () => {
      setConnected(true);
      setComplete(false);
      setRaceMeta(null);
      setTrackPolyline(null);
      // If replay mode, send race selection
      if (m === "replay" && rId) {
        ws.send(JSON.stringify({ race_id: rId, speed: 10 }));
      }
    };
    ws.onclose = () => {
      setConnected(false);
      setPhase((p) => (p === "complete" || p === "error" ? p : "idle"));
    };
    ws.onerror = () => {
      setPhase("error");
      setErrorMessage("Connection to backend failed. Is the server running on :8000?");
    };

    ws.onmessage = (event) => {
      const data = event.data;
      let msg: RaceMessage;
      try {
        msg = JSON.parse(data);
      } catch (e) {
        console.warn("Failed to parse WebSocket message", data);
        return;
      }
      if (msg.type === "TELEMETRY_TICK") {
        // Single frame (backwards compatibility)
        setFrames([msg]);
        setPhase("live");
      } else if (msg.type === "TELEMETRY_TICK_MULTI") {
        setFrames(msg.frames);
        if (msg.track_id) setTrackId(msg.track_id);
        setPhase("live");
      } else if (msg.type === "TRIPWIRE_ALERT") {
        const entry: AnalysisEntry = {
          alertId: msg.alert_id,
          lap: msg.lap,
          tick: msg.tick,
          driver: msg.driver,
          code: msg.code,
          name: msg.name,
          team: msg.team,
          color: msg.color,
          alertTypes: msg.alerts.map((a) => a.type),
          status: msg.will_analyze ? "analyzing" : "skipped",
          receivedAt: Date.now(),
        };
        setAnalysisLog((prev) => [entry, ...prev].slice(0, MAX_ANALYSIS_LOG));
      } else if (msg.type === "AI_STRATEGY_OVERLAY") {
        const id = Date.now();
        setOverlays((prev) => [...prev, { ...msg, _id: id }]);
        setTimeout(() => {
          setOverlays((prev) => prev.filter((o) => o._id !== id));
        }, 8000);

        if (msg.alert_id != null) {
          setAnalysisLog((prev) =>
            prev.map((e) =>
              e.alertId === msg.alert_id
                ? { ...e, status: "answered", verdict: msg }
                : e
            )
          );
        }
      } else if (msg.type === "RACE_INFO") {
        setRaceMeta(msg);
        if (msg.track_id) setTrackId(msg.track_id);
        if (msg.track_polyline) setTrackPolyline(msg.track_polyline);
        if (msg.drivers) setDriverRoster(msg.drivers);
      } else if (msg.type === "RACE_COMPLETE") {
        setComplete(true);
        if (msg.message && msg.message.toLowerCase().includes("error")) {
          setPhase("error");
          setErrorMessage(msg.message);
        } else {
          setPhase("complete");
        }
      }
    };

    wsRef.current = ws;
  }, []);

  // Auto-connect in sim mode on mount
  useEffect(() => {
    connect("sim");
    return () => { wsRef.current?.close(); };
  }, [connect]);

  const startReplay = useCallback((rId: string) => {
    setMode("replay");
    setRaceId(rId);
    setFrames([]);
    setOverlays([]);
    setAnalysisLog([]);
    setTrackPolyline(null);
    setSelectedDriverId(null);
    connect("replay", rId);
  }, [connect]);

  const startSim = useCallback(() => {
    setMode("sim");
    setRaceId("");
    setRaceMeta(null);
    setComplete(false);
    setFrames([]);
    setOverlays([]);
    setAnalysisLog([]);
    setSelectedDriverId(null);
    setTrackPolyline(null);
    connect("sim");
  }, [connect]);

  return {
    frames, overlays, analysisLog, connected, phase, errorMessage, mode, raceId,
    races, raceMeta, complete, startReplay, startSim,
    selectedDriverId, setSelectedDriverId,
    trackId, trackPolyline, driverRoster, agentStatus,
  };
}

const RaceWebSocketContext = createContext<RaceWebSocketState | null>(null);

export function RaceWebSocketProvider({ children }: { children: ReactNode }) {
  const value = useRaceWebSocketInternal();
  return (
    <RaceWebSocketContext.Provider value={value}>
      {children}
    </RaceWebSocketContext.Provider>
  );
}

export function useRaceWebSocket(): RaceWebSocketState {
  const ctx = useContext(RaceWebSocketContext);
  if (!ctx) {
    throw new Error("useRaceWebSocket must be used within a RaceWebSocketProvider");
  }
  return ctx;
}
