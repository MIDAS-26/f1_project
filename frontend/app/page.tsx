"use client";

import { Card, ProgressBar, Badge, Callout } from "@tremor/react";
import { useRaceWebSocket } from "./hooks/useRaceWebSocket";

export default function Home() {
  const { telemetry, overlays, connected } = useRaceWebSocket();

  return (
    <div className="flex flex-1 flex-col bg-zinc-950 text-zinc-100 font-sans">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <h1 className="text-xl font-semibold tracking-tight">
          F1 Telemetry AI
        </h1>
        <Badge color={connected ? "emerald" : "red"} size="sm">
          {connected ? "Live" : "Disconnected"}
        </Badge>
      </header>

      {/* Main Dashboard */}
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-8">
        {telemetry ? (
          <div className="w-full max-w-lg space-y-6">
            {/* Lap Counter */}
            <Card className="text-center" decoration="bottom" decorationColor="indigo">
              <p className="text-sm text-zinc-500">LAP</p>
              <p className="font-mono text-6xl font-bold tabular-nums text-zinc-100">
                {telemetry.lap}
              </p>
            </Card>

            {/* Lap Info */}
            <Card className="text-center" decoration="bottom" decorationColor="indigo">
              <div className="flex items-center justify-center gap-4">
                <Badge color={telemetry.drs ? "green" : "slate"} size="sm">
                  DRS{telemetry.drs ? " ON" : " OFF"}
                </Badge>
                <Badge color="blue" size="sm">
                  {telemetry.tyre_type.toUpperCase()}
                </Badge>
              </div>
            </Card>

            {/* Telemetry Gauges */}
            <Card className="space-y-5">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-zinc-400">Speed</span>
                  <span className="font-mono font-bold tabular-nums">
                    {telemetry.speed} km/h
                  </span>
                </div>
                <ProgressBar value={(telemetry.speed / 370) * 100} color="red" showAnimation />
              </div>

              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-zinc-400">Throttle</span>
                  <span className="font-mono font-bold tabular-nums">
                    {(telemetry.throttle * 100).toFixed(0)}%
                  </span>
                </div>
                <ProgressBar value={telemetry.throttle * 100} color="emerald" showAnimation />
              </div>

              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-zinc-400">Brake</span>
                  <span className="font-mono font-bold tabular-nums">
                    {(telemetry.brake * 100).toFixed(0)}%
                  </span>
                </div>
                <ProgressBar value={telemetry.brake * 100} color="orange" showAnimation />
              </div>

              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-zinc-400">RPM</span>
                  <span className="font-mono font-bold tabular-nums">
                    {telemetry.rpm.toLocaleString()}
                  </span>
                </div>
                <ProgressBar value={(telemetry.rpm / 15000) * 100} color="blue" showAnimation />
              </div>

              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-zinc-400">Tyre Wear</span>
                  <span className="font-mono font-bold tabular-nums">
                    {(telemetry.tyre_wear * 100).toFixed(0)}%
                  </span>
                </div>
                <ProgressBar
                  value={telemetry.tyre_wear * 100}
                  color={telemetry.tyre_wear > 0.7 ? "amber" : "emerald"}
                  showAnimation
                />
              </div>
            </Card>
          </div>
        ) : (
          <div className="text-zinc-500 animate-pulse text-lg">
            Waiting for telemetry...
          </div>
        )}
      </main>

      {/* AI Overlay Toasts */}
      <div className="fixed top-20 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {overlays.map((overlay, i) => (
          <div
            key={i}
            className="animate-slide-in"
          >
            <Callout
              title={`AI Strategy (Lap ${telemetry?.lap ?? "?"})`}
              color="purple"
            >
              {overlay.content}
            </Callout>
          </div>
        ))}
      </div>
    </div>
  );
}