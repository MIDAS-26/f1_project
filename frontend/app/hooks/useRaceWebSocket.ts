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
}

interface AIOverlay {
  type: "AI_STRATEGY_OVERLAY";
  content: string;
}

type RaceMessage = TelemetryFrame | AIOverlay;

export function useRaceWebSocket() {
  const [telemetry, setTelemetry] = useState<TelemetryFrame | null>(null);
  const [overlays, setOverlays] = useState<AIOverlay[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    const ws = new WebSocket("ws://localhost:8000/ws/race");

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (event) => {
      const msg: RaceMessage = JSON.parse(event.data);
      if (msg.type === "TELEMETRY_TICK") {
        setTelemetry(msg);
      } else if (msg.type === "AI_STRATEGY_OVERLAY") {
        const id = Date.now();
        setOverlays((prev) => [...prev, { ...msg, _id: id }]);
        setTimeout(() => {
          setOverlays((prev) => prev.filter((o) => (o as any)._id !== id));
        }, 8000);
      }
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    const interval = setInterval(() => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        connect();
      }
    }, 3000);
    return () => {
      clearInterval(interval);
      wsRef.current?.close();
    };
  }, [connect]);

  return { telemetry, overlays, connected };
}