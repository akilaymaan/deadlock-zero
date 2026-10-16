import React, { useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  Cpu,
  Info,
  Lock,
  Maximize2,
  Network,
  ShieldCheck,
  ZoomIn,
  ZoomOut,
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
  const [zoom, setZoom] = useState<number>(1);

  const width = 820;
  const height = 440;
  const centerX = width / 2;
  const centerY = height / 2 + 4;

  const positionedNodes: PositionedNode[] = useMemo(() => {
    const count = Math.max(nodes.length, 1);
    const radiusX = Math.min(265, 120 + count * 22);
    const radiusY = Math.min(148, 84 + count * 13);
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

  const panelBorderClass = hasDeadlock
    ? 'border-rose-500/40'
    : hasRace || hasStarvation
      ? 'border-amber-500/30'
      : 'border-slate-800/80';

  return (
    <div
      className={`flex flex-col h-full bg-slate-900/75 backdrop-blur-md border rounded-xl shadow-xl overflow-hidden transition-all duration-300 ease-out ${panelBorderClass}`}
    >
      {/* Standardized h-12 Header Bar */}
      <div className="h-12 px-4 flex items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-950/60 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shrink-0">
            <Network className="w-4 h-4 text-cyan-400" />
          </div>
          <h2 className="text-xs font-bold tracking-wider uppercase text-slate-100 truncate">
            Wait-For Graph (WFG) // Tarjan&apos;s SCC Topology
          </h2>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Zoom Controls */}
          <div className="hidden sm:flex items-center gap-1 bg-slate-950/90 border border-slate-800/80 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.12).toFixed(2))))}
              disabled={zoom <= 0.75}
              title="Zoom Out"
              aria-label="Zoom Out"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="px-1.5 text-[11px] font-mono tabular-nums text-slate-300">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(1.35, Number((z + 0.12).toFixed(2))))}
              disabled={zoom >= 1.35}
              title="Zoom In"
              aria-label="Zoom In"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                onSelectNode(null);
              }}
              title="Reset Graph View"
              aria-label="Reset Graph View"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] transition-all cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Semantic Status Badge */}
          {hasDeadlock ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono tabular-nums font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/40">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
              {cycles.length} SCC CYCLE
            </span>
          ) : hasRace ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono tabular-nums font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              {races.length} VECTOR RACE
            </span>
          ) : hasStarvation ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono tabular-nums font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              STARVATION (&gt;80%)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono tabular-nums font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              DAG SAFE
            </span>
          )}
        </div>
      </div>

      {/* Semantic Live Alert Banner */}
      {primaryCyclePath ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 px-4 py-2 bg-rose-500/10 border-b border-rose-500/40 text-rose-400 text-xs font-mono shrink-0"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="font-bold uppercase tracking-wider shrink-0">
              Tarjan SCC Deadlock Cycle:
            </span>
            <span className="truncate text-slate-100 font-semibold">{primaryCyclePath}</span>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/15 border border-rose-500/40 text-rose-300 shrink-0 tabular-nums">
            O(V + E) Verified
          </span>
        </div>
      ) : hasRace ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-400 text-xs font-mono shrink-0"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="font-bold uppercase tracking-wider shrink-0">
              Lamport Vector-Clock Conflict:
            </span>
            <span className="truncate text-slate-100">
              {races[0].workerA} || {races[0].workerB} on {races[0].resourceId}
            </span>
          </div>
        </div>
      ) : hasStarvation ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-400 text-xs font-mono shrink-0"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="font-bold uppercase tracking-wider shrink-0">
              Pool Starvation:
            </span>
            <span className="truncate text-slate-100">{starvation[0].explanation}</span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border-b border-emerald-500/30 text-emerald-400 text-xs font-mono shrink-0">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="truncate text-slate-100">
            Cycle-Free Canonical Lock Hierarchy Verified — 0 Strongly Connected Deadlock Components
          </span>
        </div>
      )}

      {/* Radial Dot-Matrix Graph Viewport */}
      <div className="relative flex-1 min-h-[360px] sre-dot-matrix flex items-center justify-center overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-full select-none"
          aria-label="Wait-For Graph SVG Canvas"
        >
          <defs>
            <filter id="glow-rose" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <filter id="glow-cyan" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            {/* Exact userSpaceOnUse markers so arrowheads never clip or detach during zoom or hover */}
            <marker
              id="arrow-cycle"
              markerUnits="userSpaceOnUse"
              viewBox="0 0 12 12"
              refX="10"
              refY="6"
              markerWidth="11"
              markerHeight="11"
              orient="auto-start-reverse"
            >
              <path d="M 1 2 L 11 6 L 1 10 z" fill="#f43f5e" fillOpacity="1" />
            </marker>
            <marker
              id="arrow-holds"
              markerUnits="userSpaceOnUse"
              viewBox="0 0 12 12"
              refX="10"
              refY="6"
              markerWidth="10"
              markerHeight="10"
              orient="auto-start-reverse"
            >
              <path d="M 1 2 L 11 6 L 1 10 z" fill="#10b981" fillOpacity="1" />
            </marker>
            <marker
              id="arrow-waits"
              markerUnits="userSpaceOnUse"
              viewBox="0 0 12 12"
              refX="10"
              refY="6"
              markerWidth="10"
              markerHeight="10"
              orient="auto-start-reverse"
            >
              <path d="M 1 2 L 11 6 L 1 10 z" fill="#f59e0b" fillOpacity="1" />
            </marker>
          </defs>

          <g
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: `${centerX}px ${centerY}px`,
              transition: 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* Directed Edges */}
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

              const padStart = source.type === 'WORKER' ? 32 : 46;
              const padEnd = target.type === 'WORKER' ? 36 : 50;

              const curveOffset = hasReverseEdge ? 26 : 0;
              const startX = source.x + ux * padStart + nx * (curveOffset * 0.25);
              const startY = source.y + uy * padStart + ny * (curveOffset * 0.25);
              const endX = target.x - ux * padEnd + nx * (curveOffset * 0.25);
              const endY = target.y - uy * padEnd + ny * (curveOffset * 0.25);

              const ctrlX = (startX + endX) / 2 + nx * curveOffset;
              const ctrlY = (startY + endY) / 2 + ny * curveOffset;
              const labelX = (startX + 2 * ctrlX + endX) / 4;
              const labelY = (startY + 2 * ctrlY + endY) / 4 - 8;

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
                <g key={`${edge.from}->${edge.to}:${edge.relation}:${idx}`}>
                  {edge.inCycle && (
                    <path
                      d={pathData}
                      fill="none"
                      stroke="#f43f5e"
                      strokeWidth={6}
                      strokeOpacity={0.16}
                    />
                  )}
                  <path
                    d={pathData}
                    fill="none"
                    stroke={stroke}
                    strokeOpacity={1}
                    strokeWidth={edge.inCycle ? 2.5 : 2}
                    className={
                      edge.inCycle
                        ? 'animate-dash-flow'
                        : edge.relation === 'WAITS_FOR'
                          ? 'animate-wait-dash'
                          : undefined
                    }
                    markerEnd={markerEnd}
                  />
                  <g transform={`translate(${labelX}, ${labelY})`}>
                    <rect
                      x={-58}
                      y={-10}
                      width={116}
                      height={16}
                      rx={4}
                      fill="#090D16"
                      fillOpacity={0.92}
                      stroke={stroke}
                      strokeOpacity={0.45}
                      strokeWidth={1}
                    />
                    <text
                      y={1}
                      textAnchor="middle"
                      className="text-[9.5px] font-mono tabular-nums fill-slate-200 pointer-events-none"
                    >
                      {edge.relation} · {shortFile}:{edge.line}
                    </text>
                  </g>
                </g>
              );
            })}

            {/* Worker & Lock Nodes */}
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
                ? '#3b0718'
                : node.type === 'WORKER'
                  ? '#082f49'
                  : '#1e293b';

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  onClick={() => onSelectNode(isSelected ? null : node.id)}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId((prev) => (prev === node.id ? null : prev))}
                  className="cursor-pointer transition-opacity duration-200"
                >
                  {node.inCycle &&
                    (node.type === 'WORKER' ? (
                      <circle
                        r={37}
                        fill="none"
                        stroke="#f43f5e"
                        strokeWidth={1.75}
                        className="animate-node-ring pointer-events-none"
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
                        strokeWidth={1.75}
                        className="animate-node-ring pointer-events-none"
                      />
                    ))}

                  {node.type === 'WORKER' ? (
                    <circle
                      r={30}
                      fill={fillColor}
                      stroke={strokeColor}
                      strokeWidth={isHighlighted || node.inCycle ? 2.75 : 2}
                      filter={
                        node.inCycle
                          ? 'url(#glow-rose)'
                          : isHighlighted
                            ? 'url(#glow-cyan)'
                            : undefined
                      }
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
                      strokeWidth={isHighlighted || node.inCycle ? 2.75 : 2}
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
          </g>
        </svg>

        {/* Non-Clipping Floating Forensic Inspector Tooltip (pointer-events-none prevents hover loop) */}
        {activeNode && activeNodeDetails && (
          <div className="absolute top-3 left-3 z-20 w-72 max-w-[calc(100%-1.5rem)] p-3 rounded-xl bg-slate-900/95 border border-slate-700/90 shadow-2xl backdrop-blur-md text-xs font-mono space-y-2 pointer-events-none transition-all duration-200 ease-out">
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                {activeNode.type === 'WORKER' ? (
                  <Cpu className="w-4 h-4 text-cyan-400 shrink-0" />
                ) : (
                  <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                )}
                <span className="font-bold text-slate-100 truncate">{activeNode.label}</span>
              </div>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                  activeNode.inCycle
                    ? 'bg-rose-500/10 text-rose-400 border border-rose-500/40'
                    : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                }`}
              >
                {activeNode.inCycle ? 'IN SCC CYCLE' : 'ACYCLIC'}
              </span>
            </div>

            <div className="space-y-1 text-[11px] tabular-nums">
              <div className="text-slate-400">
                Connected Edges ({activeNodeDetails.connectedEdges.length}):
              </div>
              {activeNodeDetails.connectedEdges.length === 0 ? (
                <div className="text-slate-500">No active hold/wait edges</div>
              ) : (
                activeNodeDetails.connectedEdges.map((edge, i) => (
                  <div key={i} className="text-slate-200 truncate">
                    • {edge.from}{' '}
                    <span
                      className={
                        edge.inCycle
                          ? 'text-rose-400'
                          : edge.relation === 'HOLDS'
                            ? 'text-emerald-400'
                            : 'text-amber-400'
                      }
                    >
                      [{edge.relation}]
                    </span>{' '}
                    → {edge.to} ({edge.file.split('/').pop()}:{edge.line})
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Bottom Legend & Counter Bar */}
        <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 rounded-lg bg-slate-900/90 border border-slate-800/80 backdrop-blur-md text-[11px] font-mono tabular-nums text-slate-300 pointer-events-none">
          <div className="flex flex-wrap items-center gap-3.5">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block" />
              Worker
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-2.5 rounded-xs bg-amber-400 inline-block" />
              Lock Resource
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-0.5 bg-emerald-400 inline-block" />
              HOLDS (#10b981)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-0.5 border-b-2 border-dashed border-amber-400 inline-block" />
              WAITS_FOR (#f59e0b)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-0.5 bg-rose-500 inline-block" />
              SCC Cycle (#f43f5e)
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-400">
            <Info className="w-4 h-4 text-cyan-400" />
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
