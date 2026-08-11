"use client";

import { useState } from "react";
import { useRaceWebSocket } from "../hooks/useRaceWebSocket";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

export default function AgentStatusBadge() {
  const { agentStatus } = useRaceWebSocket();
  const [open, setOpen] = useState(false);

  if (!agentStatus) return null;

  const hasKey = agentStatus.crewai.has_llm_key;
  const quota = agentStatus.crewai.quota;
  const quotaExhausted = !!quota?.exhausted;
  const live = hasKey && !quotaExhausted;

  const label = quotaExhausted
    ? "AI: Quota Exhausted"
    : live
    ? "AI: Live (CrewAI)"
    : "AI: Fallback";

  const colorClasses = quotaExhausted
    ? "bg-red-500/10 border-red-500/40 text-red-300 hover:bg-red-500/20"
    : live
    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20"
    : "bg-amber-500/10 border-amber-500/40 text-amber-300 hover:bg-amber-500/20";

  const dotClass = quotaExhausted ? "bg-red-400" : live ? "bg-emerald-400" : "bg-amber-400";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${colorClasses}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
        {label}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-4 text-xs text-zinc-300 z-50">
          <div className="font-semibold text-zinc-100 mb-2">Agent Pipeline</div>

          <div className="mb-3">
            <div className="text-zinc-400 mb-1">Tripwire detection</div>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="font-mono">{agentStatus.langgraph.engine}</span>
            </div>
            <div className="text-zinc-500 mt-1">
              {agentStatus.langgraph.nodes.join(" → ")}
            </div>
          </div>

          <div>
            <div className="text-zinc-400 mb-1">Strategy deliberation</div>
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
              <span>
                {quotaExhausted
                  ? "CrewAI via OpenRouter — daily quota exhausted"
                  : live
                  ? "CrewAI via OpenRouter"
                  : "Rule-based fallback (no API key)"}
              </span>
            </div>
            {hasKey && (
              <>
                <div className="text-zinc-500 mt-1 font-mono">{agentStatus.crewai.model}</div>
                <div className="text-zinc-500 mt-1">
                  {agentStatus.crewai.agents.join(" → ")} ({agentStatus.crewai.process})
                </div>
              </>
            )}
          </div>

          {quotaExhausted && quota && (
            <div className="mt-3 pt-3 border-t border-zinc-800">
              <div className="text-red-300">
                OpenRouter's free-tier daily request cap is exhausted for this API key.
              </div>
              <div className="text-zinc-500 mt-1">
                Resets in ~{formatDuration(quota.resets_in_seconds)}. Verdicts are falling
                back to a labeled rule-based suggestion until then — no requests are being
                retried against the exhausted quota in the meantime.
              </div>
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-zinc-800 text-zinc-500">
            Every tripwire hit appears in the AI Analysis feed with its full verdict and
            source, so output quality can be checked directly.
          </div>
        </div>
      )}
    </div>
  );
}
