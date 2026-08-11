"use client";

import { useMemo } from "react";
import type { AnalysisEntry } from "../../hooks/useRaceWebSocket";

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold font-mono ${accent || "text-zinc-100"}`}>{value}</div>
      {sub && <div className="text-xs text-zinc-600 mt-1">{sub}</div>}
    </div>
  );
}

export default function SummaryStats({ entries }: { entries: AnalysisEntry[] }) {
  const stats = useMemo(() => {
    const total = entries.length;
    const analyzed = entries.filter((e) => e.status !== "skipped").length;
    const answered = entries.filter((e) => e.status === "answered").length;
    const crewai = entries.filter((e) => e.verdict?.source === "crewai").length;
    const fallback = entries.filter((e) => e.verdict?.source === "fallback").length;
    const skipped = total - analyzed;

    const alertCounts = new Map<string, number>();
    for (const e of entries) {
      for (const t of e.alertTypes) {
        alertCounts.set(t, (alertCounts.get(t) ?? 0) + 1);
      }
    }
    const topAlert = [...alertCounts.entries()].sort((a, b) => b[1] - a[1])[0];

    return { total, analyzed, answered, crewai, fallback, skipped, topAlert };
  }, [entries]);

  const crewaiRate = stats.answered > 0 ? Math.round((stats.crewai / stats.answered) * 100) : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      <StatCard label="Total Tripwires" value={String(stats.total)} />
      <StatCard label="Sent to Agents" value={String(stats.analyzed)} sub={`${stats.skipped} skipped`} />
      <StatCard label="Verdicts Returned" value={String(stats.answered)} />
      <StatCard
        label="CrewAI Verdicts"
        value={String(stats.crewai)}
        sub={`${crewaiRate}% of verdicts`}
        accent="text-emerald-400"
      />
      <StatCard label="Fallback Verdicts" value={String(stats.fallback)} accent="text-zinc-400" />
      <StatCard
        label="Most Common Alert"
        value={stats.topAlert ? String(stats.topAlert[1]) : "—"}
        sub={stats.topAlert ? stats.topAlert[0].replaceAll("_", " ") : undefined}
      />
    </div>
  );
}
