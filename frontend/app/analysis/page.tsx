"use client";

import Link from "next/link";
import { useRaceWebSocket } from "../hooks/useRaceWebSocket";
import AgentStatusBadge from "../components/AgentStatusBadge";
import TripwireSankey from "./components/TripwireSankey";
import SummaryStats from "./components/SummaryStats";
import AnalysisTable from "./components/AnalysisTable";

export default function AnalysisPage() {
  const { analysisLog, mode, raceMeta, races } = useRaceWebSocket();

  const activeRace = raceMeta?.race ? races.find((r) => r.id === raceMeta.race) : null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-lg font-bold tracking-tight hover:text-zinc-300">
            F1 Telemetry AI
          </Link>
          <span className="text-zinc-700">/</span>
          <span className="text-sm font-medium text-zinc-300">Tripwires &amp; Analysis</span>
          {mode === "replay" && activeRace && (
            <span className="text-xs text-zinc-500 border-l border-zinc-700 pl-3">
              {activeRace.year} {activeRace.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <AgentStatusBadge />
          <Link
            href="/"
            className="text-sm font-medium px-3 py-1.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
          >
            ← Back to Race View
          </Link>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto space-y-6">
        <SummaryStats entries={analysisLog} />

        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
          <div className="mb-3">
            <div className="font-semibold text-sm text-zinc-100">Tripwire → Analysis Flow</div>
            <div className="text-xs text-zinc-500">
              How detected anomalies flow from alert type, through whether they were sent for
              agent analysis, to the verdict source that ultimately answered them.
            </div>
          </div>
          <div className="w-full">
            <TripwireSankey entries={analysisLog} />
          </div>
        </div>

        <AnalysisTable entries={analysisLog} />
      </main>
    </div>
  );
}
