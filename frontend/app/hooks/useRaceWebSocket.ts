"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface TelemetryFrame {
  type: "TELEMETRY_TICK";
  lap: number;
  speed: number;
  rpm: number;
  throttle: number;
  brake: number;
  tyre_wear: number;
  tyre_type: string;
  drs: boolean;
  driver?: string | number;
  position?: number;
  compound?: string;
  // For track overlay
  x?: number;
  y?: number;
}

interface AIOverlay {
  type: "AI_STRATEGY_OVERLAY";
  content: string;
}

interface RaceInfo {
  type: "RACE_INFO";
  race: string;
  total_laps: number;
  driver: number;
}

interface RaceComplete {
  type: "RACE_COMPLETE";
  message: string;
}

// Multi-frame message from /ws/race_multi
interface TelemetryMultiFrame {
  type: "TELEMETRY_TICK_MULTI";
  tick: number;
  lap: number;
  frames: TelemetryFrame[];
}

type RaceMessage = TelemetryFrame | TelemetryMultiFrame | AIOverlay | RaceInfo | RaceComplete;

export interface RaceOption {
  id: string;
  label: string;
}

type Mode = "sim" | "replay";

export function useRaceWebSocket() {
  const [frames, setFrames] = useState<TelemetryFrame[]>([]); // array of frames for latest tick
  const [overlays, setOverlays] = useState<AIOverlay[]>([]);
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState<Mode>("sim");
  const [raceId, setRaceId] = useState<string>("");
  const [raceMeta, setRaceMeta] = useState<RaceInfo | null>(null);
  const [races, setRaces] = useState<RaceOption[]>([]);
  const [complete, setComplete] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState<string | number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch available races on mount
  useEffect(() => {
    fetch("http://localhost:8000/races")
      .then((r) => r.json())
      .then((data) => {
        if (data.races) setRaces(data.races);
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
      // If replay mode, send race selection
      if (m === "replay" && rId) {
        ws.send(JSON.stringify({ race_id: rId, speed: 10 }));
      }
    };
    ws.onclose = () => setConnected(false);

    ws.onmessage = (event) => {
      const data = event.data;
      // Sometimes we might get a string that's not JSON? but assume JSON.
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
      } else if (msg.type === "AI_STRATEGY_OVERLAY") {
        const id = Date.now();
        setOverlays((prev) => [...prev, { ...msg, _id: id }]);
        setTimeout(() => {
          setOverlays((prev) => prev.filter((o) => (o as any)._id !== id));
        }, 8000);
      } else if (msg.type === "RACE_INFO") {
        setRaceMeta(msg);
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
    connect("sim");
  }, [connect]);

  return {
    frames, overlays, connected, mode, raceId,
    races, raceMeta, complete, startReplay, startSim,
    selectedDriverId, setSelectedDriverId,
  };
}