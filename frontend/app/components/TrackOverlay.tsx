import { useEffect, useState } from "react";
import { useRaceWebSocket } from "../hooks/useRaceWebSocket";

export default function TrackOverlay() {
  const { frames, selectedDriverId, setSelectedDriverId } = useRaceWebSocket();

  // Canvas size – matches the simulation's coordinate system
  const width = 500;
  const height = 500;
  const trackRx = 200; // horizontal radius
  const trackRy = 100; // vertical radius
  const cx = width / 2;
  const cy = height / 2;

  return (
    <div style={{ position: "relative", width: width, height: height, margin: "0 auto" }}>
      {/* Simple oval track */}
      <svg
        width={width}
        height={height}
        style={{ display: "block" }}
      >
        {/* Track outline */}
        <ellipse
          cx={cx}
          cy={cy}
          rx={trackRx}
          ry={trackRy}
          fill="none"
          stroke="#555"
          strokeWidth="4"
        />
        {/* Inner filler for contrast */}
        <ellipse
          cx={cx}
          cy={cy}
          rx={trackRx - 4}
          ry={trackRy - 4}
          fill="#111"
        />
        {/* Driver markers */}
        {frames.map((frame) => {
          const isSelected = selectedDriverId != null && frame.driver == selectedDriverId;
          // Convert simulation x,y (which are already in pixel space with same center) to SVG coords
          // Our simulation already output x,y relative to same center (250,250) radius.
          // So we can use them directly.
          const x = frame.x ?? cx;
          const y = frame.y ?? cy;
          return (
            <circle
              key={frame.driver}
              cx={x}
              cy={y}
              r={isSelected ? 8 : 5}
              fill={isSelected ? "#ff0" : "#0f0"}
              onClick={() => setSelectedDriverId(frame.driver)}
              style={{ cursor: "pointer" }}
            />
          );
        })}
      </svg>
    </div>
  );
}