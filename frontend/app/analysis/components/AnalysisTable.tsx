"use client";

import { useMemo, useState } from "react";
import type { AnalysisEntry } from "../../hooks/useRaceWebSocket";

const ALERT_LABELS: Record<string, string> = {
  PACE_DROP: "Pace Drop",
  THROTTLE_BRAKE_OVERLAP: "Throttle/Brake Overlap",
  TYRE_CRITICAL: "Tyre Critical",
  RACE_CONTROL: "Race Control",
};

type StatusFilter = "all" | "answered" | "analyzing" | "skipped";
type SourceFilter = "all" | "crewai" | "fallback";

export default function AnalysisTable({ entries }: { entries: AnalysisEntry[] }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (sourceFilter !== "all") {
        if (!e.verdict || e.verdict.source !== sourceFilter) return false;
      }
      return true;
    });
  }, [entries, statusFilter, sourceFilter]);

  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl flex flex-col">
      <div className="px-4 py-3 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-sm text-zinc-100">
          All Tripwires{" "}
          <span className="text-zinc-500 font-normal">({filtered.length})</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-300"
          >
            <option value="all">All statuses</option>
            <option value="answered">Answered</option>
            <option value="analyzing">Analyzing</option>
            <option value="skipped">Skipped</option>
          </select>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-300"
          >
            <option value="all">All sources</option>
            <option value="crewai">CrewAI only</option>
            <option value="fallback">Fallback only</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-zinc-900">
            <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
              <th className="px-4 py-2 font-medium">Driver</th>
              <th className="px-4 py-2 font-medium">Lap</th>
              <th className="px-4 py-2 font-medium">Alert(s)</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Source</th>
              <th className="px-4 py-2 font-medium">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                  No entries match these filters.
                </td>
              </tr>
            )}
            {filtered.map((entry) => (
              <tr
                key={entry.alertId}
                className="border-b border-zinc-800/60 hover:bg-zinc-800/30 align-top"
              >
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: entry.color || "#888" }}
                    />
                    <span className="font-mono text-xs text-zinc-200">{entry.code || entry.driver}</span>
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">{entry.name}</div>
                </td>
                <td className="px-4 py-2.5 font-mono text-zinc-400">{entry.lap}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1 max-w-[220px]">
                    {entry.alertTypes.map((t, i) => (
                      <span
                        key={i}
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-500/10 text-red-300 border border-red-500/20 whitespace-nowrap"
                      >
                        {ALERT_LABELS[t] || t}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  {entry.status === "answered" && (
                    <span className="text-emerald-400 text-xs">Answered</span>
                  )}
                  {entry.status === "analyzing" && (
                    <span className="text-amber-400 text-xs">Analyzing…</span>
                  )}
                  {entry.status === "skipped" && (
                    <span className="text-zinc-500 text-xs">Skipped</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {entry.verdict ? (
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide whitespace-nowrap ${
                        entry.verdict.source === "crewai"
                          ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                          : "bg-zinc-700/50 text-zinc-400 border border-zinc-600/40"
                      }`}
                    >
                      {entry.verdict.source === "crewai" ? "CrewAI" : "Fallback"}
                    </span>
                  ) : (
                    <span className="text-zinc-700 text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-zinc-400 max-w-[360px]">
                  {entry.verdict?.content || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
