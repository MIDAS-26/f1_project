"use client";

import { useMemo } from "react";
import { sankey, sankeyLinkHorizontal } from "d3-sankey";
import type { AnalysisEntry } from "../../hooks/useRaceWebSocket";

const ALERT_LABELS: Record<string, string> = {
  PACE_DROP: "Pace Drop",
  THROTTLE_BRAKE_OVERLAP: "Throttle/Brake Overlap",
  TYRE_CRITICAL: "Tyre Critical",
  RACE_CONTROL: "Race Control",
};

const ALERT_COLORS: Record<string, string> = {
  PACE_DROP: "#f59e0b",
  THROTTLE_BRAKE_OVERLAP: "#ef4444",
  TYRE_CRITICAL: "#dc2626",
  RACE_CONTROL: "#8b5cf6",
};

const OUTCOME_COLORS: Record<string, string> = {
  Analyzed: "#10b981",
  Skipped: "#52525b",
};

const SOURCE_COLORS: Record<string, string> = {
  CrewAI: "#10b981",
  Fallback: "#71717a",
};

interface SNode {
  name: string;
  color: string;
}
interface SLink {
  source: number;
  target: number;
  value: number;
}

// Matches the typical rendered width of its container (max-w-7xl page, minus
// padding) closely enough that scaling via viewBox + w-full doesn't stretch
// it into an oversized, disproportionate chart.
const WIDTH = 1100;
const HEIGHT = 420;

export default function TripwireSankey({ entries }: { entries: AnalysisEntry[] }) {
  const { nodes, links } = useMemo(() => buildGraph(entries), [entries]);

  const { computedNodes, computedLinks } = useMemo(() => {
    if (nodes.length === 0 || links.length === 0) {
      return { computedNodes: [], computedLinks: [] };
    }
    const generator = sankey<SNode, {}>()
      .nodeWidth(16)
      .nodePadding(18)
      .extent([
        [1, 8],
        [WIDTH - 1, HEIGHT - 8],
      ]);

    const graph = generator({
      nodes: nodes.map((n) => ({ ...n })),
      links: links.map((l) => ({ ...l })),
    });

    return { computedNodes: graph.nodes, computedLinks: graph.links };
  }, [nodes, links]);

  const linkPath = sankeyLinkHorizontal();

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-[420px] text-zinc-500 text-sm">
        No tripwire data yet — run live or replay mode to populate this chart.
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full h-auto"
      style={{ maxHeight: HEIGHT, minWidth: 640 }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        {computedLinks.map((link: any, i: number) => {
          const sourceColor = (link.source as any).color;
          const targetColor = (link.target as any).color;
          return (
            <linearGradient key={i} id={`sankey-grad-${i}`} gradientUnits="userSpaceOnUse"
              x1={link.source.x1} x2={link.target.x0}>
              <stop offset="0%" stopColor={sourceColor} />
              <stop offset="100%" stopColor={targetColor} />
            </linearGradient>
          );
        })}
      </defs>

      {/* Links */}
      <g fill="none">
        {computedLinks.map((link: any, i: number) => (
          <path
            key={i}
            d={linkPath(link) ?? undefined}
            stroke={`url(#sankey-grad-${i})`}
            strokeWidth={Math.max(1, link.width)}
            strokeOpacity={0.35}
          >
            <title>
              {(link.source as any).name} → {(link.target as any).name}: {link.value}
            </title>
          </path>
        ))}
      </g>

      {/* Nodes */}
      <g>
        {computedNodes.map((node: any, i: number) => (
          <g key={i}>
            <rect
              x={node.x0}
              y={node.y0}
              width={node.x1 - node.x0}
              height={node.y1 - node.y0}
              fill={node.color}
              rx={2}
            >
              <title>{node.name}: {node.value}</title>
            </rect>
            <text
              x={node.x0 < WIDTH / 2 ? node.x1 + 8 : node.x0 - 8}
              y={(node.y0 + node.y1) / 2}
              textAnchor={node.x0 < WIDTH / 2 ? "start" : "end"}
              dominantBaseline="middle"
              fill="#d4d4d8"
              fontSize={12}
              fontWeight={500}
            >
              {node.name}
            </text>
            <text
              x={node.x0 < WIDTH / 2 ? node.x1 + 8 : node.x0 - 8}
              y={(node.y0 + node.y1) / 2 + 14}
              textAnchor={node.x0 < WIDTH / 2 ? "start" : "end"}
              dominantBaseline="middle"
              fill="#71717a"
              fontSize={10}
              fontFamily="monospace"
            >
              {node.value}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

function buildGraph(entries: AnalysisEntry[]): { nodes: SNode[]; links: SLink[] } {
  // Column 1: alert type. Column 2: outcome (Analyzed / Skipped).
  // Column 3 (Analyzed branch only): verdict source (CrewAI / Fallback).
  const nodeIndex = new Map<string, number>();
  const nodes: SNode[] = [];

  function nodeId(name: string, color: string): number {
    if (nodeIndex.has(name)) return nodeIndex.get(name)!;
    const idx = nodes.length;
    nodes.push({ name, color });
    nodeIndex.set(name, idx);
    return idx;
  }

  const linkCounts = new Map<string, number>();
  function addLink(a: number, b: number) {
    const key = `${a}->${b}`;
    linkCounts.set(key, (linkCounts.get(key) ?? 0) + 1);
  }

  for (const entry of entries) {
    const outcome = entry.status === "skipped" ? "Skipped" : "Analyzed";
    const outcomeNode = nodeId(outcome, OUTCOME_COLORS[outcome]);

    for (const alertType of entry.alertTypes) {
      const label = ALERT_LABELS[alertType] || alertType;
      const alertNode = nodeId(label, ALERT_COLORS[alertType] || "#6366f1");
      addLink(alertNode, outcomeNode);
    }

    if (outcome === "Analyzed" && entry.status === "answered" && entry.verdict) {
      const sourceLabel = entry.verdict.source === "crewai" ? "CrewAI" : "Fallback";
      const sourceNode = nodeId(sourceLabel, SOURCE_COLORS[sourceLabel]);
      addLink(outcomeNode, sourceNode);
    } else if (outcome === "Analyzed" && entry.status === "analyzing") {
      const pendingNode = nodeId("Pending", "#f59e0b");
      addLink(outcomeNode, pendingNode);
    }
  }

  const links: SLink[] = Array.from(linkCounts.entries()).map(([key, value]) => {
    const [a, b] = key.split("->").map(Number);
    return { source: a, target: b, value };
  });

  return { nodes, links };
}
