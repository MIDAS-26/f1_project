// CUSTOM UPDATE
"use client";

import TrackOverlay from "./components/TrackOverlay";
import RaceStats from "./components/RaceStats";
import DriverDetail from "./components/DriverDetail";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 font-sans">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <h1 className="text-xl font-semibold tracking-tight">
          F1 Telemetry AI
        </h1>
        <div className="flex items-center gap-3">
          {/* Mode badge will be handled inside components via hook */}
          <span className="text-sm text-zinc-500">Live Overview</span>
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