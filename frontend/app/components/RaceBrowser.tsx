"use client";

import { useMemo, useState } from "react";
import { useRaceWebSocket } from "../hooks/useRaceWebSocket";

export default function RaceBrowser({ onClose }: { onClose: () => void }) {
  const { races, raceId, startReplay } = useRaceWebSocket();
  const [year, setYear] = useState<number | null>(null);

  const years = useMemo(
    () => Array.from(new Set(races.map((r) => r.year))).sort((a, b) => b - a),
    [races]
  );

  const effectiveYear = year ?? years[0] ?? null;
  const racesForYear = races.filter((r) => r.year === effectiveYear);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm pt-20" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl max-h-[70vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <div>
            <div className="font-semibold text-zinc-100">Choose a race to replay</div>
            <div className="text-xs text-zinc-500">Real historical telemetry via FastF1</div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 text-xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {years.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 text-sm">Loading race calendar…</div>
        ) : (
          <>
            <div className="flex gap-2 px-5 pt-4 shrink-0">
              {years.map((y) => (
                <button
                  key={y}
                  onClick={() => setYear(y)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    y === effectiveYear
                      ? "bg-red-600 text-white"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-5 pt-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {racesForYear.map((race) => {
                  const isActive = race.id === raceId;
                  return (
                    <button
                      key={race.id}
                      onClick={() => {
                        startReplay(race.id);
                        onClose();
                      }}
                      className={`text-left p-3 rounded-lg border transition-colors ${
                        isActive
                          ? "bg-red-600/10 border-red-500/50"
                          : "bg-zinc-800/50 border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800"
                      }`}
                    >
                      <div className="font-medium text-sm text-zinc-100">{race.label}</div>
                      {race.circuit && (
                        <div className="text-xs text-zinc-400 mt-0.5">{race.circuit}</div>
                      )}
                      {race.country && (
                        <div className="text-xs text-zinc-600 mt-0.5">{race.country}</div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
