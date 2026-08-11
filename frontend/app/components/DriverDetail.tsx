"use client";

import { useRaceWebSocket } from "../hooks/useRaceWebSocket";

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-zinc-800/60 rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-sm font-mono text-zinc-100">{value}</div>
      {sub && <div className="text-[10px] text-zinc-500">{sub}</div>}
    </div>
  );
}

export default function DriverDetail() {
  const { frames, selectedDriverId, overlays } = useRaceWebSocket();

  const frame = frames.find((f) => f.driver == selectedDriverId);
  // Only show overlays that belong to the selected driver — showing whatever
  // overlay happened to arrive last regardless of driver was misleading.
  const driverOverlay = [...overlays].reverse().find((o) => o.driver == selectedDriverId);

  if (!frame) {
    return (
      <div className="bg-zinc-900/70 border border-dashed border-zinc-700 rounded-xl p-6 text-center text-zinc-500 text-sm h-full flex flex-col items-center justify-center gap-2">
        <span className="text-2xl">🏎️</span>
        <span>Select a driver from the grid<br />or click a car on the track</span>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900/70 backdrop-blur-sm border border-zinc-800 rounded-xl p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: frame.color || "#888" }}
          />
          <div className="min-w-0">
            <div className="font-semibold text-zinc-100 truncate">
              {frame.name || `Driver ${frame.driver}`}
            </div>
            <div className="text-xs text-zinc-500 truncate">
              {frame.team || "—"} · #{frame.driver}{frame.code ? ` · ${frame.code}` : ""}
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold font-mono text-zinc-100 leading-none">
            {frame.race_position ? `P${frame.race_position}` : "—"}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">Lap {frame.lap}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric label="Speed" value={`${frame.speed.toFixed(0)} km/h`} />
        <Metric label="RPM" value={frame.rpm.toLocaleString()} />
        <Metric label="Throttle" value={`${(frame.throttle * 100).toFixed(0)}%`} />
        <Metric label="Brake" value={`${(frame.brake * 100).toFixed(0)}%`} />
        <Metric
          label="Tyres"
          value={frame.tyre_type.toUpperCase()}
          sub={`${(frame.tyre_wear * 100).toFixed(0)}% worn`}
        />
        <Metric label="DRS" value={frame.drs ? "OPEN" : "CLOSED"} />
      </div>

      <div className="flex-1" />

      {driverOverlay && (
        <div className="mt-4 p-3 bg-purple-950/50 border border-purple-700/40 rounded-lg text-xs">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                driverOverlay.source === "crewai"
                  ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                  : "bg-zinc-700/50 text-zinc-400 border border-zinc-600/40"
              }`}
            >
              {driverOverlay.source === "crewai" ? "CrewAI · Lap " : "Fallback · Lap "}{driverOverlay.lap}
            </span>
          </div>
          <div className="text-purple-200 leading-snug">{driverOverlay.content}</div>
        </div>
      )}
    </div>
  );
}
