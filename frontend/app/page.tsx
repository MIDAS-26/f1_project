// CUSTOM UPDATE
"use client";

import TrackOverlay from "./components/TrackOverlay";
import RaceStats from "./components/RaceStats";
import DriverDetail from "./components/DriverDetail";
import TeamDriverGrid from "./components/TeamDriverGrid";
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
          {mode === "sim" && races.length === 0 ? (
            <button disabled className="px-3 py-1 rounded text-sm font-medium bg-zinc-700 text-zinc-400">
              Loading Races...
            </button>
          ) : (
            <button
              onClick={() => {
                if (mode === "sim") {
                  const raceToLoad = raceId || (races.length > 0 ? races[0].id : "2024-monaco");
                  startReplay(raceToLoad);
                } else {
                  startSim();
                }
              }}
              className={`px-3 py-1 rounded text-sm font-medium ${
                mode === "sim" ? "bg-blue-600 text-white" : "bg-zinc-600 text-white"
              }`}
            >
              {mode === "sim" ? "Replay Mode" : "Live Mode"}
            </button>
          )}
          {mode === "replay" && (
            <select
              value={raceId}
              onChange={(e) => startReplay(e.target.value)}
              className="border border-zinc-700 bg-zinc-800 rounded px-2 py-1 text-sm text-zinc-100"
            >
              {races.map((race) => (
                <option key={race.id} value={race.id}>
                  {race.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>

      {/* Main content: track center, stats top-right, driver detail + team grid bottom-right */}
      <main className="flex-1 relative p-6">
        <div className="flex items-start justify-center">
          <TrackOverlay />
        </div>
        <div className="absolute top-6 right-6">
          <RaceStats />
        </div>
        <div className="absolute bottom-6 right-6 flex items-end gap-4">
          <DriverDetail />
          <TeamDriverGrid />
        </div>
      </main>
    </div>
  );
}
