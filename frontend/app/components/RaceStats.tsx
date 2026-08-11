"use client";

import { useRaceWebSocket } from "../hooks/useRaceWebSocket";

export default function RaceStats() {
  const { frames, connected, phase, mode, raceMeta } = useRaceWebSocket();

  if (phase === "loading_race") {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        Loading real telemetry from FastF1… this can take up to a minute the first time.
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex items-center gap-2 text-sm text-red-400">
        <span className="w-2 h-2 rounded-full bg-red-400" />
        Connection error — check the backend is running.
      </div>
    );
  }

  if (!connected || frames.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <span className="w-2 h-2 rounded-full bg-zinc-600 animate-pulse" />
        Connecting…
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
    <div className="flex items-center gap-6 text-sm">
      <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${mode === "replay" ? "bg-red-400" : "bg-emerald-400"}`} />
        <span className="text-zinc-300 font-medium">
          {mode === "replay" ? "Replay" : "Live Simulation"}
        </span>
      </div>

      <div className="text-zinc-500">
        Lap <span className="font-mono text-zinc-200">{lap}</span>
        {raceMeta?.total_laps ? <span className="text-zinc-600">/{raceMeta.total_laps}</span> : null}
      </div>

      <div className="text-zinc-500">
        <span className="text-zinc-600">Drivers</span>{" "}
        <span className="font-mono text-zinc-200">{driverCount}</span>
      </div>

      <div className="text-zinc-500 flex items-center gap-1.5">
        <span className="text-zinc-600">Leader</span>
        <span
          className="w-1.5 h-1.5 rounded-full inline-block"
          style={{ backgroundColor: leader.color || "#888" }}
        />
        <span className="font-mono text-zinc-200">{leader.code || leader.driver}</span>
      </div>

      <div className="text-zinc-500">
        <span className="text-zinc-600">Fastest</span>{" "}
        <span className="font-mono text-zinc-200">{fastest.speed.toFixed(0)} km/h</span>{" "}
        <span className="text-zinc-600">({fastest.code || fastest.driver})</span>
      </div>
    </div>
  );
}
