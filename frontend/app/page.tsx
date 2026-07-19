// CUSTOM UPDATE
"use client";

import TrackOverlay from "./components/TrackOverlay";
import RaceStats from "./components/RaceStats";
import DriverDetail from "./components/DriverDetail";
import { useRaceWebSocket } from "./hooks/useRaceWebSocket";

export default function Home() {
  const { mode, races, raceId, startReplay, startSim } = useRaceWebSocket();

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 font-sans">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <h1 className="text-xl font-semibold tracking-tight">
          F1 Telemetry AI
        </h1>
        <div className="flex items-center gap-3">
          {mode === 'sim' && races.length === 0 ? (
            <button disabled className="px-3 py-1 rounded text-sm font-medium bg-gray-400 text-white">
              Loading Races...
            </button>
          ) : (
            <button
              onClick={() => {
                if (mode === 'sim') {
                  // If we have a selected race, use it, else first race or default
                  const raceToLoad = raceId || (races.length > 0 ? races[0].value : '2024-monaco');
                  startReplay(raceToLoad);
                } else {
                  startSim();
                }
              }}
              className={`px-3 py-1 rounded text-sm font-medium ${mode === 'sim' ? 'bg-blue-600 text-white' : 'bg-gray-600 text-white'}`}
            >
              {mode === 'sim' ? 'Replay Mode' : 'Live Mode'}
            </button>
          )}
          {mode === 'replay' && (
            <select
              value={raceId}
              onChange={(e) => startReplay(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            >
              {races.map((race) => (
                <option key={race.value} value={race.value}>
                  {race.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>

      {/* Main content: track with overlay panels */}
      <main className="flex-1 flex relative">
        <TrackOverlay className="w-full h-full" />
        <RaceStats className="absolute top-4 right-4" />
        <DriverDetail className="absolute bottom-4 right-4" />
      </main>
    </div>
  );
}