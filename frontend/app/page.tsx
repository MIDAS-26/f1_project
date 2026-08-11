"use client";

import { useState } from "react";
import Link from "next/link";
import TrackOverlay from "./components/TrackOverlay";
import RaceStats from "./components/RaceStats";
import DriverDetail from "./components/DriverDetail";
import TeamDriverGrid from "./components/TeamDriverGrid";
import AnalysisFeed from "./components/AnalysisFeed";
import AgentStatusBadge from "./components/AgentStatusBadge";
import RaceBrowser from "./components/RaceBrowser";
import { useRaceWebSocket } from "./hooks/useRaceWebSocket";

export default function Home() {
  const { mode, raceMeta, races, startSim } = useRaceWebSocket();
  const [browserOpen, setBrowserOpen] = useState(false);

  const activeRace = raceMeta?.race ? races.find((r) => r.id === raceMeta.race) : null;

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold tracking-tight">F1 Telemetry AI</h1>
          {mode === "replay" && activeRace && (
            <span className="text-xs text-zinc-500 border-l border-zinc-700 pl-3">
              Replaying {activeRace.year} {activeRace.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/analysis"
            className="text-sm font-medium px-3 py-1.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
          >
            Tripwires &amp; Analysis →
          </Link>

          <AgentStatusBadge />

          <div className="flex items-center bg-zinc-800 rounded-full p-0.5 text-sm">
            <button
              onClick={startSim}
              className={`px-3 py-1 rounded-full font-medium transition-colors ${
                mode === "sim" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Live
            </button>
            <button
              onClick={() => setBrowserOpen(true)}
              className={`px-3 py-1 rounded-full font-medium transition-colors ${
                mode === "replay" ? "bg-red-600 text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Replay
            </button>
          </div>
        </div>
      </header>

      {/* Stats strip */}
      <div className="px-6 py-2.5 border-b border-zinc-800 shrink-0">
        <RaceStats />
      </div>

      {/* Main content grid */}
      <main className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[220px_1fr_280px_320px] gap-4 p-4">
        <div className="hidden lg:block min-h-0">
          <TeamDriverGrid />
        </div>
        <div className="min-h-0">
          <TrackOverlay />
        </div>
        <div className="min-h-0">
          <DriverDetail />
        </div>
        <div className="min-h-0">
          <AnalysisFeed />
        </div>
      </main>

      {browserOpen && <RaceBrowser onClose={() => setBrowserOpen(false)} />}
    </div>
  );
}
