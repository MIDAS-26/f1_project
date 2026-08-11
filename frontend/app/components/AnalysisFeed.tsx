"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRaceWebSocket } from "../hooks/useRaceWebSocket";

const ALERT_LABELS: Record<string, string> = {
  PACE_DROP: "Pace Drop",
  THROTTLE_BRAKE_OVERLAP: "Throttle/Brake Overlap",
  TYRE_CRITICAL: "Tyre Critical",
  RACE_CONTROL: "Race Control",
};

function timeAgo(ts: number) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

export default function AnalysisFeed() {
  const { analysisLog, setSelectedDriverId } = useRaceWebSocket();
  const [hideSkipped, setHideSkipped] = useState(true);

  const visible = useMemo(
    () => (hideSkipped ? analysisLog.filter((e) => e.status !== "skipped") : analysisLog),
    [analysisLog, hideSkipped]
  );
  const skippedCount = analysisLog.length - analysisLog.filter((e) => e.status !== "skipped").length;

  return (
    <div className="bg-zinc-900/70 backdrop-blur-sm border border-zinc-800 rounded-xl flex flex-col h-full min-h-0">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between shrink-0 gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-sm text-zinc-100">AI Tripwires &amp; Analysis</div>
          <div className="text-xs text-zinc-500 truncate">
            Detected anomalies and the agent verdicts they produced
          </div>
        </div>
        <span className="text-xs font-mono text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded shrink-0">
          {visible.length}
        </span>
      </div>

      <Link
        href="/analysis"
        className="text-[11px] text-zinc-400 hover:text-zinc-200 px-4 py-1.5 border-b border-zinc-800 shrink-0 flex items-center justify-between"
      >
        <span>Full analysis view with Sankey chart</span>
        <span>→</span>
      </Link>

      {skippedCount > 0 && (
        <button
          onClick={() => setHideSkipped((v) => !v)}
          className="text-[11px] text-zinc-500 hover:text-zinc-300 px-4 py-1.5 border-b border-zinc-800 text-left shrink-0"
        >
          {hideSkipped
            ? `${skippedCount} skipped hidden (already analyzing) — show`
            : "Hide skipped entries"}
        </button>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-zinc-800/80">
        {visible.length === 0 && (
          <div className="px-4 py-8 text-center text-zinc-500 text-sm">
            No tripwires triggered yet. This feed fills in as anomalies are detected
            in real telemetry (pace drops, throttle/brake overlap, critical tyre wear).
          </div>
        )}

        {visible.map((entry) => (
          <button
            key={entry.alertId}
            onClick={() => setSelectedDriverId(entry.driver)}
            className="w-full text-left px-4 py-3 hover:bg-zinc-800/50 transition-colors"
          >
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: entry.color || "#888" }}
                />
                <span className="font-mono text-xs text-zinc-200 shrink-0">
                  {entry.code || entry.driver}
                </span>
                <span className="text-xs text-zinc-500 truncate">
                  Lap {entry.lap} · {entry.name}
                </span>
              </div>
              <span className="text-[10px] text-zinc-600 shrink-0">
                {timeAgo(entry.receivedAt)}
              </span>
            </div>

            <div className="flex flex-wrap gap-1 mb-2">
              {entry.alertTypes.map((t, i) => (
                <span
                  key={i}
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-500/10 text-red-300 border border-red-500/20"
                >
                  {ALERT_LABELS[t] || t}
                </span>
              ))}
            </div>

            {entry.status === "analyzing" && (
              <div className="flex items-center gap-1.5 text-xs text-amber-300">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                Agents deliberating…
              </div>
            )}

            {entry.status === "skipped" && (
              <div className="text-xs text-zinc-500">
                Skipped — an analysis was already in flight when this fired.
              </div>
            )}

            {entry.status === "answered" && entry.verdict && (
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                      entry.verdict.source === "crewai"
                        ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                        : "bg-zinc-700/50 text-zinc-400 border border-zinc-600/40"
                    }`}
                  >
                    {entry.verdict.source === "crewai" ? "CrewAI verdict" : "Rule-based fallback"}
                  </span>
                </div>
                <p className="text-xs text-zinc-300 leading-snug">
                  {entry.verdict.content}
                </p>
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
