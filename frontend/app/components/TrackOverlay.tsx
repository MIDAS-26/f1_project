import { useEffect, useState } from "react";
import { useRaceWebSocket } from "../hooks/useRaceWebSocket";

export default function TrackOverlay() {
  const { frames, selectedDriverId, setSelectedDriverId } = useRaceWebSocket();

  // Track path data (matches the SVG in public/track.svg)
  const trackOuterPath = "M 150 100 C 150 50, 350 50, 350 100 L 350 150 C 350 180, 320 200, 280 200 C 240 200, 200 180, 200 150 L 200 120 C 200 100, 180 90, 160 90 C 140 90, 120 100, 120 120 L 120 150 C 120 180, 160 200, 200 200 C 240 200, 280 180, 280 150 L 280 120 C 280 100, 300 90, 320 90 C 340 90, 360 100, 360 120 L 360 150 C 360 180, 320 200, 280 200 C 240 200, 200 180, 200 150 Z";
  const trackInnerPath = "M 160 110 C 160 80, 340 80, 340 110 L 340 140 C 340 150, 310 160, 260 160 C 210 160, 160 150, 160 140 L 160 110 Z";
  const startFinishLine = { x1: 250, y1: 100, x2: 250, y2: 90 };

  const width = 500;
  const height = 500;

  return (
    <div style={{ position: "relative", width: width, height: height, margin: "0 auto" }}>
      <svg width={width} height={height} style={{ display: "block" }}>
        {/* Track outer boundary */}
        <path
          d={trackOuterPath}
          fill="none"
          stroke="#555"
          strokeWidth="4"
        />
        {/* Track surface */}
        <path
          d={trackInnerPath}
          fill="#111"
        />
        {/* Start/Finish line */}
        <line
          x1={startFinishLine.x1}
          y1={startFinishLine.y1}
          x2={startFinishLine.x2}
          y2={startFinishLine.y2}
          stroke="#fff"
          strokeWidth="2"
        />
        {/* Driver markers */}
        {frames.map((frame) => {
          const isSelected = selectedDriverId != null && frame.driver == selectedDriverId;
          // Clamp to visible area (roughly the track bounds)
          const x = Math.max(120, Math.min(380, frame.x ?? 250));
          const y = Math.max(90, Math.min(410, frame.y ?? 250));
          return (
            <g key={frame.driver}>
              <circle
                cx={x}
                cy={y}
                r={isSelected ? 10 : 6}
                fill={isSelected ? "#ff0" : "#0f0"}
                stroke="#fff"
                strokeWidth={1}
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedDriverId(frame.driver)}
              />
              {/* Show driver number */}
              <text
                x={x}
                y={y - 12}
                textAnchor="middle"
                fill={isSelected ? "#000" : "#fff"}
                fontSize="9"
                fontWeight={isSelected ? "bold" : "normal"}
                pointerEvents="none"
              >
                {frame.driver}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}