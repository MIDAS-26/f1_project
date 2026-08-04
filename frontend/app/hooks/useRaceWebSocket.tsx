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

interface AIOverlay {
  type: "AI_STRATEGY_OVERLAY";
  content: string;
  _id?: number;
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

type RaceMessage = TelemetryFrame | TelemetryMultiFrame | AIOverlay | RaceInfo | RaceComplete;

export interface RaceOption {
  id: string;
  label: string;
}

type Mode = "sim" | "replay";

interface RaceWebSocketState {
  frames: TelemetryFrame[];
  overlays: AIOverlay[];
  connected: boolean;
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
}

function useRaceWebSocketInternal(): RaceWebSocketState {
  const [frames, setFrames] = useState<TelemetryFrame[]>([]); // array of frames for latest tick
  const [overlays, setOverlays] = useState<AIOverlay[]>([]);
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState<Mode>("sim");
  const [raceId, setRaceId] = useState<string>("");
  const [raceMeta, setRaceMeta] = useState<RaceInfo | null>(null);
  const [races, setRaces] = useState<RaceOption[]>([]);
  const [complete, setComplete] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState<string | number | null>(null);
  const [trackId, setTrackId] = useState<string>("silverstone");
  const [trackPolyline, setTrackPolyline] = useState<[number, number][] | null>(null);
  const [driverRoster, setDriverRoster] = useState<DriverMeta[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch available races on mount
  useEffect(() => {
    fetch("http://localhost:8000/races")
      .then((r) => r.json())
      .then((data) => {
        if (data.races) {
          setRaces(
            data.races.map((r: any) => ({ id: r.id, label: r.label }))
          );
        }
      })
      .catch(() => {});
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
    ws.onclose = () => setConnected(false);

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
      } else if (msg.type === "TELEMETRY_TICK_MULTI") {
        setFrames(msg.frames);
        if (msg.track_id) setTrackId(msg.track_id);
      } else if (msg.type === "AI_STRATEGY_OVERLAY") {
        const id = Date.now();
        setOverlays((prev) => [...prev, { ...msg, _id: id }]);
        setTimeout(() => {
          setOverlays((prev) => prev.filter((o) => o._id !== id));
        }, 8000);
      } else if (msg.type === "RACE_INFO") {
        setRaceMeta(msg);
        if (msg.track_id) setTrackId(msg.track_id);
        if (msg.track_polyline) setTrackPolyline(msg.track_polyline);
        if (msg.drivers) setDriverRoster(msg.drivers);
      } else if (msg.type === "RACE_COMPLETE") {
        setComplete(true);
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
    setSelectedDriverId(null);
    setTrackPolyline(null);
    connect("sim");
  }, [connect]);

  return {
    frames, overlays, connected, mode, raceId,
    races, raceMeta, complete, startReplay, startSim,
    selectedDriverId, setSelectedDriverId,
    trackId, trackPolyline, driverRoster,
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
