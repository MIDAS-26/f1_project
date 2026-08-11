"use client";

import { useMemo } from "react";
import { useRaceWebSocket } from "../hooks/useRaceWebSocket";

export default function TeamDriverGrid() {
  const { driverRoster, frames, selectedDriverId, setSelectedDriverId } = useRaceWebSocket();

  // Static grid: grouped by team, in roster order — not resorted by live position.
  const byTeam = useMemo(() => {
    const groups = new Map<string, typeof driverRoster>();
    for (const d of driverRoster) {
      const list = groups.get(d.team) ?? [];
      list.push(d);
      groups.set(d.team, list);
    }
    return Array.from(groups.entries());
  }, [driverRoster]);

  return (
    <div className="bg-zinc-900/70 backdrop-blur-sm border border-zinc-800 rounded-xl flex flex-col h-full min-h-0">
      <div className="px-4 py-3 border-b border-zinc-800 shrink-0">
        <div className="font-semibold text-sm text-zinc-100">Grid</div>
        <div className="text-xs text-zinc-500">Grouped by team · click to inspect</div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {driverRoster.length === 0 && (
          <div className="px-3 py-6 text-center text-zinc-500 text-sm">Waiting for grid…</div>
        )}

        {byTeam.map(([team, drivers]) => (
          <div key={team} className="mb-2">
            <div className="flex items-center gap-2 px-2 py-1">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: drivers[0]?.color || "#888" }}
              />
              <span className="text-[11px] font-semibold text-zinc-400 truncate uppercase tracking-wide">
                {team}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {drivers.map((d) => {
                const isSelected = selectedDriverId != null && d.driver == selectedDriverId;
                const live = frames.find((f) => f.driver === d.driver);
                return (
                  <button
                    key={d.driver}
                    onClick={() => setSelectedDriverId(d.driver)}
                    className={`flex flex-col items-start px-2 py-1.5 rounded-lg transition-colors text-left ${
                      isSelected
                        ? "bg-zinc-700 ring-1 ring-white/40"
                        : "hover:bg-zinc-800"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 w-full">
                      <span className="font-mono text-xs font-medium text-zinc-100">{d.code}</span>
                      {live?.race_position && (
                        <span className="text-[10px] text-zinc-500 ml-auto font-mono">
                          P{live.race_position}
                        </span>
                      )}
                    </div>
                    <span className="truncate text-[11px] text-zinc-500 w-full">
                      {d.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
