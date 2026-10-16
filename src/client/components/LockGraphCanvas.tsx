import React, { useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  Cpu,
  Info,
  Lock,
  Network,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type {
  DeadlockCycle,
  GraphEdge,
  GraphNode,
  LockEvent,
  RaceConflict,
  StarvationAlert,
} from '../../shared/types';

interface LockGraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  events?: LockEvent[];
  cycles: DeadlockCycle[];
  races: RaceConflict[];
  starvation: StarvationAlert[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}

interface PositionedNode extends GraphNode {
  x: number;
  y: number;
}

export const LockGraphCanvas: React.FC<LockGraphCanvasProps> = ({
  nodes,
  edges,
  events = [],
  cycles,
  races,
  starvation,
  selectedNodeId,
  onSelectNode,
}) => {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const width = 820;
  const height = 450;
  const centerX = width / 2;
  const centerY = height / 2 + 6;

  const positionedNodes: PositionedNode[] = useMemo(() => {
    const count = Math.max(nodes.length, 1);
    const radiusX = Math.min(275, 125 + count * 22);
    const radiusY = Math.min(152, 88 + count * 13);
    return nodes.map((node, index) => {
      const angle = (2 * Math.PI * index) / count - Math.PI / 2;
      return {
        ...node,
        x: Math.round(centerX + radiusX * Math.cos(angle)),
        y: Math.round(centerY + radiusY * Math.sin(angle)),
      };
    });
  }, [nodes, centerX, centerY]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, PositionedNode>();
    for (const node of positionedNodes) {
      map.set(node.id, node);
    }
    return map;
  }, [positionedNodes]);

  const activeNode = useMemo(() => {
    const targetId = hoveredNodeId ?? selectedNodeId;
    if (!targetId) return null;
    return nodeMap.get(targetId) ?? null;
  }, [hoveredNodeId, selectedNodeId, nodeMap]);

  const activeNodeDetails = useMemo(() => {
    if (!activeNode) return null;
    const connectedEdges = edges.filter(
      (e) => e.from === activeNode.id || e.to === activeNode.id,
    );
    const relatedEvents = events.filter(
      (ev) => ev.workerId === activeNode.id || ev.resourceId === activeNode.id,
    );
    return {
      connectedEdges,
      relatedEvents,
    };
  }, [activeNode, edges, events]);

  const primaryCyclePath = cycles[0]?.cycleNodes?.join(' → ');
  const hasDeadlock = cycles.length > 0;
  const hasRace = races.length > 0;
  const hasStarvation = starvation.length > 0;

  const borderStatusClass = hasDeadlock
    ? 'border-rose-500/40 shadow-[0_0_30px_-10px_rgba(244,63,94,0.3)]'
    : hasRace || hasStarvation
      ? 'border-amber-500/40 shadow-[0_0_30px_-10px_rgba(245,158,11,0.25)]'
      : 'border-emerald-500/40 shadow-[0_0_30px_-10px_rgba(16,185,129,0.25)]';

  return (
    <div
      className={`flex flex-col h-full bg-slate-900/90 border rounded-xl overflow-hidden transition-all duration-300 ${borderStatusClass}`}
    >
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-800/90 bg-slate-950/80">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-md bg-cyan-500/10 border border-cyan-500/30">
            <Network className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-xs font-bold tracking-wider uppercase text-slate-100">
              Wait-For Graph (WFG) // Tarjan&apos;s SCC Topology
            </h2>
            <p className="text-[11px] text-slate-400">
              Hover or click any worker or lock node to inspect hold/wait edges &amp; source lines
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasDeadlock ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/40">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
              {cycles.length} SCC CYCLE ACTIVE
            </span>
          ) : hasRace ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/40">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              {races.length} VECTOR RACE CONFLICT
            </span>
          ) : hasStarvation ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/40">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              POOL STARVATION (&gt;80%)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              DAG VERIFIED SAFE
            </span>
          )}
        </div>
      </div>

      {/* Live Status Banner */}
      {primaryCyclePath ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 px-4 py-2.5 bg-gradient-to-r from-rose-950/90 via-rose-950/60 to-slate-950 border-b border-rose-500/40 text-rose-200 text-xs font-mono"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0 animate-pulse" />
            <span className="font-bold uppercase tracking-wider text-rose-300 shrink-0">
              Tarjan SCC Deadlock Cycle:
            </span>
            <span className="truncate text-rose-100 font-semibold">{primaryCyclePath}</span>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-rose-200 shrink-0">
            O(V + E) Exact Match
          </span>
        </div>
      ) : hasRace ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 px-4 py-2.5 bg-gradient-to-r from-amber-950/90 via-amber-950/50 to-slate-950 border-b border-amber-500/40 text-amber-200 text-xs font-mono"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="font-bold uppercase tracking-wider text-amber-300 shrink-0">
              Lamport Vector-Clock Conflict:
            </span>
            <span className="truncate text-amber-100">
              {races[0].workerA} || {races[0].workerB} on {races[0].resourceId} (concurrent writes without common mutex)
            </span>
          </div>
        </div>
      ) : hasStarvation ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 px-4 py-2.5 bg-gradient-to-r from-amber-950/90 via-amber-950/50 to-slate-950 border-b border-amber-500/40 text-amber-200 text-xs font-mono"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="font-bold uppercase tracking-wider text-amber-300 shrink-0">
              Connection Pool Starvation:
            </span>
            <span className="truncate text-amber-100">{starvation[0].explanation}</span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-950/70 to-slate-950 border-b border-emerald-500/30 text-emerald-200 text-xs font-mono">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>
            Cycle-Free Canonical Lock Hierarchy Verified — 0 Strongly Connected Deadlock Components
          </span>
        </div>
      )}

      {/* Interactive SVG Graph Stage */}
      <div className="relative flex-1 min-h-[360px] bg-slate-950 sre-grid-bg flex items-center justify-center overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-full select-none"
          aria-label="Wait-For Graph SVG Canvas"
        >
          <defs>
            <filter id="glow-rose" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <filter id="glow-cyan" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <marker
              id="arrow-cycle"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6.5"
              markerHeight="6.5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#f43f5e" />
            </marker>
            <marker
              id="arrow-holds"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#10b981" />
            </marker>
            <marker
              id="arrow-waits"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#f59e0b" />
            </marker>
          </defs>

          {/* Render Directed Edges */}
          {edges.map((edge, idx) => {
            const source = nodeMap.get(edge.from);
            const target = nodeMap.get(edge.to);
            if (!source || !target) return null;

            const hasReverseEdge = edges.some(
              (other, otherIdx) =>
                otherIdx !== idx && other.from === edge.to && other.to === edge.from,
            );

            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const dist = Math.hypot(dx, dy) || 1;
            const ux = dx / dist;
            const uy = dy / dist;
            const nx = -uy;
            const ny = ux;

            const padStart = source.type === 'WORKER' ? 32 : 44;
            const padEnd = target.type === 'WORKER' ? 36 : 48;

            const curveOffset = hasReverseEdge ? 26 : 0;
            const startX = source.x + ux * padStart + nx * (curveOffset * 0.25);
            const startY = source.y + uy * padStart + ny * (curveOffset * 0.25);
            const endX = target.x - ux * padEnd + nx * (curveOffset * 0.25);
            const endY = target.y - uy * padEnd + ny * (curveOffset * 0.25);

            const ctrlX = (startX + endX) / 2 + nx * curveOffset;
            const ctrlY = (startY + endY) / 2 + ny * curveOffset;
            const labelX = (startX + 2 * ctrlX + endX) / 4;
            const labelY = (startY + 2 * ctrlY + endY) / 4 - 7;

            const stroke = edge.inCycle
              ? '#f43f5e'
              : edge.relation === 'HOLDS'
                ? '#10b981'
                : '#f59e0b';
            const markerEnd = edge.inCycle
              ? 'url(#arrow-cycle)'
              : edge.relation === 'HOLDS'
                ? 'url(#arrow-holds)'
                : 'url(#arrow-waits)';

            const pathData = `M ${startX} ${startY} Q ${ctrlX} ${ctrlY} ${endX} ${endY}`;
            const shortFile = edge.file.split('/').pop() ?? edge.file;

            return (
              <g key={`${edge.from}->${edge.to}:${idx}`}>
                {/* Base glowing track for cycle edges */}
                {edge.inCycle && (
                  <path
                    d={pathData}
                    fill="none"
                    stroke="#f43f5e"
                    strokeWidth={6}
                    strokeOpacity={0.18}
                  />
                )}
                <path
                  d={pathData}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={edge.inCycle ? 2.75 : 2}
                  className={
                    edge.inCycle
                      ? 'animate-scc-flow'
                      : edge.relation === 'WAITS_FOR'
                        ? 'animate-wait-flow'
                        : undefined
                  }
                  markerEnd={markerEnd}
                />
                <g transform={`translate(${labelX}, ${labelY})`}>
                  <rect
                    x={-54}
                    y={-10}
                    width={108}
                    height={16}
                    rx={4}
                    fill="#020617"
                    fillOpacity={0.88}
                    stroke={stroke}
                    strokeOpacity={0.45}
                    strokeWidth={1}
                  />
                  <text
                    y={1}
                    textAnchor="middle"
                    className="text-[9.5px] font-mono fill-slate-200"
                  >
                    {edge.relation} · {shortFile}:{edge.line}
                  </text>
                </g>
              </g>
            );
          })}

          {/* Render Worker & Resource Nodes */}
          {positionedNodes.map((node) => {
            const isSelected = selectedNodeId === node.id;
            const isHovered = hoveredNodeId === node.id;
            const isHighlighted = isSelected || isHovered;

            const strokeColor = node.inCycle
              ? '#f43f5e'
              : node.type === 'WORKER'
                ? '#22d3ee'
                : '#f59e0b';
            const fillColor = node.inCycle
              ? '#4c0519'
              : node.type === 'WORKER'
                ? '#083344'
                : '#1e293b';

            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                onClick={() => onSelectNode(isSelected ? null : node.id)}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId((prev) => (prev === node.id ? null : prev))}
                className="cursor-pointer"
              >
                {/* Animated outer pulse ring for nodes in an active deadlock cycle */}
                {node.inCycle &&
                  (node.type === 'WORKER' ? (
                    <circle
                      r={36}
                      fill="none"
                      stroke="#f43f5e"
                      strokeWidth={2}
                      className="animate-node-ring"
                    />
                  ) : (
                    <rect
                      x={-60}
                      y={-29}
                      width={120}
                      height={58}
                      rx={12}
                      fill="none"
                      stroke="#f43f5e"
                      strokeWidth={2}
                      className="animate-node-ring"
                    />
                  ))}

                {node.type === 'WORKER' ? (
                  <circle
                    r={30}
                    fill={fillColor}
                    stroke={strokeColor}
                    strokeWidth={isHighlighted || node.inCycle ? 3 : 2}
                    filter={node.inCycle ? 'url(#glow-rose)' : isHighlighted ? 'url(#glow-cyan)' : undefined}
                  />
                ) : (
                  <rect
                    x={-52}
                    y={-23}
                    width={104}
                    height={46}
                    rx={9}
                    fill={fillColor}
                    stroke={strokeColor}
                    strokeWidth={isHighlighted || node.inCycle ? 3 : 2}
                    filter={node.inCycle ? 'url(#glow-rose)' : undefined}
                  />
                )}

                <text
                  y={-3}
                  textAnchor="middle"
                  className="text-[11px] font-mono font-bold fill-slate-100 pointer-events-none"
                >
                  {node.label}
                </text>
                <text
                  y={11}
                  textAnchor="middle"
                  className="text-[9px] font-mono uppercase tracking-wider fill-slate-400 pointer-events-none"
                >
                  {node.type === 'WORKER' ? 'WORKER' : 'LOCK'}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Floating Node Forensic Tooltip */}
        {activeNode && activeNodeDetails && (
          <div className="absolute top-3 left-3 z-20 w-72 p-3 rounded-xl bg-slate-950/95 border border-slate-700/90 shadow-2xl backdrop-blur-md text-xs font-mono space-y-2 pointer-events-none">
            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
              <div className="flex items-center gap-1.5">
                {activeNode.type === 'WORKER' ? (
                  <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                ) : (
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                )}
                <span className="font-bold text-slate-100">{activeNode.label}</span>
              </div>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  activeNode.inCycle
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                }`}
              >
                {activeNode.inCycle ? 'IN SCC CYCLE' : 'ACYCLIC'}
              </span>
            </div>

            <div className="space-y-1 text-[11px]">
              <div className="text-slate-400">
                Active Edges ({activeNodeDetails.connectedEdges.length}):
              </div>
              {activeNodeDetails.connectedEdges.length === 0 ? (
                <div className="text-slate-500">No active hold/wait edges</div>
              ) : (
                activeNodeDetails.connectedEdges.map((edge, i) => (
                  <div key={i} className="text-slate-200 truncate">
                    • {edge.from} <span className="text-amber-300">[{edge.relation}]</span> →{' '}
                    {edge.to} ({edge.file.split('/').pop()}:{edge.line})
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Mini-Legend & Telemetry Pill */}
        <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-950/90 border border-slate-800/90 backdrop-blur-xs text-[11px] font-mono text-slate-300">
          <div className="flex flex-wrap items-center gap-3.5">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 ring-2 ring-cyan-400/30 inline-block" />
              Worker Thread / Service
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-2.5 rounded-xs bg-amber-400 ring-2 ring-amber-400/30 inline-block" />
              Resource Lock
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-0.5 bg-emerald-400 inline-block" />
              HOLDS Lock
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-0.5 border-b-2 border-dashed border-amber-400 inline-block" />
              WAITS_FOR Lock
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-0.5 bg-rose-500 shadow-[0_0_8px_#f43f5e] inline-block" />
              Deadlock Cycle Path
            </span>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <Info className="w-3.5 h-3.5 text-cyan-400" />
            <span>
              Nodes: {nodes.length} · Edges: {edges.length} · Cycles: {cycles.length}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LockGraphCanvas;
