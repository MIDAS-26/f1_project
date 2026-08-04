"use client";

import { useRaceWebSocket } from "../hooks/useRaceWebSocket";

export default function RaceStats() {
  const { frames, connected, mode, raceId, raceMeta } = useRaceWebSocket();

  if (!connected || frames.length === 0) {
    return (
      <div className="p-2 text-zinc-400">
        Waiting for data...
      </div>
    );
  }

  const lap = frames[0].lap ?? 0;
  const driverCount = frames.length;
  const fastest = frames.reduce((max, f) => (f.speed > max.speed ? f : max), frames[0]);
  const leader = frames.reduce((leader, f) => {
    const fPos = f.race_position ?? 99;
    const lPos = leader.race_position ?? 99;
    return fPos < lPos ? f : leader;
  }, frames[0]);

  return (
    <div className="bg-zinc-800/50 backdrop-blur-sm p-4 rounded-lg border border-zinc-700 text-zinc-200 text-sm min-w-[220px]">
      <div className="flex items-center justify-between mb-2">
        <div className="font-medium">Race Overview</div>
        <div className="text-xs text-zinc-400 text-right">
          {mode === "replay"
            ? raceMeta?.race
              ? raceMeta.race
              : raceId
            : "Live Simulation"}
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between">
          <span>Lap:</span>
          <span className="font-mono">
            {lap}
            {raceMeta?.total_laps ? ` / ${raceMeta.total_laps}` : ""}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Drivers:</span>
          <span className="font-mono">{driverCount}</span>
        </div>
        <div className="flex justify-between">
          <span>Leader:</span>
          <span className="font-mono flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ backgroundColor: leader.color || "#888" }}
            />
            {leader.code || leader.driver}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Fastest:</span>
          <span className="font-mono">
            {fastest.speed.toFixed(0)} km/h ({fastest.code || fastest.driver})
          </span>
        </div>
      </div>
    </div>
  );
}
