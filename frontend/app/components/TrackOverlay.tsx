"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRaceWebSocket } from "../hooks/useRaceWebSocket";
import { trackFor } from "../lib/tracks";

const WIDTH = 500;
const HEIGHT = 500;

export default function TrackOverlay() {
  const {
    frames, selectedDriverId, setSelectedDriverId,
    mode, trackId, trackPolyline,
  } = useRaceWebSocket();

  const pathRef = useRef<SVGPathElement | null>(null);
  const [pathLength, setPathLength] = useState(0);

  const layout = useMemo(() => trackFor(trackId), [trackId]);

  // Both live-sim and replay send a real polyline traced from FastF1 GPS
  // telemetry (see backend/track_layouts.py and backend/replay.py) — this is
  // exact circuit geometry, not an approximation. The hand-drawn fallback
  // shape only renders for the brief moment before that trace arrives.
  const tracedPathD = useMemo(() => {
    if (!trackPolyline || trackPolyline.length < 3) return null;
    const [first, ...rest] = trackPolyline;
    return `M ${first[0]} ${first[1]} ` + rest.map((p) => `L ${p[0]} ${p[1]}`).join(" ") + " Z";
  }, [trackPolyline]);

  const activePathD = tracedPathD ?? layout.path;

  useEffect(() => {
    if (pathRef.current) {
      setPathLength(pathRef.current.getTotalLength());
    }
  }, [activePathD]);

  // For live sim: cars carry track_progress (0..1); sample the path geometry to place them.
  // For replay: cars already carry real x/y from FastF1 telemetry.
  const positioned = frames.map((frame) => {
    if (mode === "replay" && frame.x != null && frame.y != null) {
      return { frame, x: frame.x, y: frame.y };
    }
    if (pathRef.current && pathLength > 0 && frame.track_progress != null) {
      const pt = pathRef.current.getPointAtLength(frame.track_progress * pathLength);
      return { frame, x: pt.x, y: pt.y };
    }
    return { frame, x: WIDTH / 2, y: HEIGHT / 2 };
  });

  return (
    <div style={{ position: "relative", width: WIDTH, height: HEIGHT, margin: "0 auto" }}>
      <svg width={WIDTH} height={HEIGHT} style={{ display: "block" }}>
        <defs>
          <filter id="track-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#000" floodOpacity="0.6" />
          </filter>
        </defs>

        {/* Track surface (tarmac) */}
        <path
          ref={pathRef}
          d={activePathD}
          fill="none"
          stroke="#2a2a2e"
          strokeWidth="26"
          strokeLinejoin="round"
          strokeLinecap="round"
          filter="url(#track-shadow)"
        />
        {/* Racing line */}
        <path
          d={activePathD}
          fill="none"
          stroke="#555"
          strokeWidth="1"
          strokeDasharray="6,6"
          opacity="0.6"
        />

        {/* Track name label */}
        <text x={12} y={24} fill="#888" fontSize="13" fontWeight="600" letterSpacing="0.5">
          {layout.name}
        </text>

        {/* Driver markers */}
        {positioned.map(({ frame, x, y }) => {
          const isSelected = selectedDriverId != null && frame.driver == selectedDriverId;
          const color = frame.color || "#0f0";
          return (
            <g
              key={frame.driver}
              onClick={() => setSelectedDriverId(frame.driver)}
              style={{ cursor: "pointer" }}
            >
              {isSelected && (
                <circle cx={x} cy={y} r={14} fill="none" stroke="#fff" strokeWidth={1.5} opacity={0.8}>
                  <animate attributeName="r" values="10;16;10" dur="1.4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.8;0;0.8" dur="1.4s" repeatCount="indefinite" />
                </circle>
              )}
              <circle
                cx={x}
                cy={y}
                r={isSelected ? 9 : 6.5}
                fill={color}
                stroke={isSelected ? "#fff" : "#111"}
                strokeWidth={isSelected ? 2 : 1}
              />
              <text
                x={x}
                y={y - (isSelected ? 15 : 12)}
                textAnchor="middle"
                fill="#fff"
                fontSize={isSelected ? 11 : 9}
                fontWeight={isSelected ? "bold" : "600"}
                stroke="#000"
                strokeWidth={2.5}
                paintOrder="stroke"
                pointerEvents="none"
              >
                {frame.code || frame.driver}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
