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

  if (driverRoster.length === 0) {
    return (
      <div className="bg-zinc-800/50 backdrop-blur-sm p-3 rounded-lg border border-zinc-700 text-zinc-400 text-sm w-72">
        Waiting for grid...
      </div>
    );
  }

  return (
    <div className="bg-zinc-800/50 backdrop-blur-sm p-3 rounded-lg border border-zinc-700 text-zinc-200 text-sm w-72 max-h-[380px] overflow-y-auto">
      <div className="font-medium mb-2 text-xs uppercase tracking-wide text-zinc-400">
        Grid by Team
      </div>
      <div className="space-y-3">
        {byTeam.map(([team, drivers]) => (
          <div key={team}>
            <div className="flex items-center gap-2 mb-1">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: drivers[0]?.color || "#888" }}
              />
              <span className="text-xs font-semibold text-zinc-300 truncate">{team}</span>
            </div>
            <div className="grid grid-cols-2 gap-1 pl-4">
              {drivers.map((d) => {
                const isSelected = selectedDriverId != null && d.driver == selectedDriverId;
                const live = frames.find((f) => f.driver === d.driver);
                return (
                  <button
                    key={d.driver}
                    onClick={() => setSelectedDriverId(d.driver)}
                    className={`flex flex-col items-start px-2 py-1 rounded transition-colors text-left ${
                      isSelected
                        ? "bg-zinc-700 ring-1 ring-white/40"
                        : "hover:bg-zinc-700/50"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 w-full">
                      <span className="font-mono text-xs">{d.code}</span>
                      {live?.race_position && (
                        <span className="text-[10px] text-zinc-500 ml-auto">
                          P{live.race_position}
                        </span>
                      )}
                    </div>
                    <span className="truncate text-[11px] text-zinc-400 w-full">
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
