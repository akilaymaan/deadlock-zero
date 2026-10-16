import React, { useMemo, useState } from 'react';
import { Maximize2, Network, ZoomIn, ZoomOut } from 'lucide-react';
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
  cycles,
  selectedNodeId,
  onSelectNode,
}) => {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);

  const width = 860;
  const height = 520;
  const centerX = width / 2;
  const centerY = height / 2 - 6;

  // Space nodes generously so labels and edges never crowd each other
  const positionedNodes: PositionedNode[] = useMemo(() => {
    const count = Math.max(nodes.length, 1);
    const radiusX = Math.min(285, 165 + count * 22);
    const radiusY = Math.min(175, 115 + count * 14);
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

  const hasDeadlock = cycles.length > 0;

  return (
    <div className="flex flex-col h-full min-h-[520px] bg-slate-900/50 border border-slate-800/60 rounded-2xl shadow-xl overflow-hidden">
      {/* Clean Header Bar */}
      <div className="px-6 py-4 flex items-center justify-between gap-4 border-b border-slate-800/60 bg-slate-950/40">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shrink-0">
            <Network className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100">
              Visual Lock Map
            </h2>
            <p className="text-xs text-slate-400">
              Click any worker or lock resource to highlight its connections
            </p>
          </div>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1.5 bg-slate-950/80 border border-slate-800/60 rounded-xl p-1">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.12).toFixed(2))))}
            disabled={zoom <= 0.75}
            title="Zoom Out"
            aria-label="Zoom Out"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all cursor-pointer"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="px-2 text-xs font-mono tabular-nums text-slate-300">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(1.35, Number((z + 0.12).toFixed(2))))}
            disabled={zoom >= 1.35}
            title="Zoom In"
            aria-label="Zoom In"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all cursor-pointer"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              onSelectNode(null);
            }}
            title="Reset View"
            aria-label="Reset View"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] transition-all cursor-pointer"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Spacious SVG Viewport */}
      <div className="relative flex-1 min-h-[460px] sre-dot-matrix flex items-center justify-center overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-full select-none"
          aria-label="Wait-For Graph SVG Canvas"
        >
          <defs>
            <filter id="glow-rose" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <filter id="glow-cyan" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <marker
              id="arrow-cycle"
              markerUnits="userSpaceOnUse"
              viewBox="0 0 12 12"
              refX="10"
              refY="6"
              markerWidth="12"
              markerHeight="12"
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
              markerWidth="11"
              markerHeight="11"
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
              markerWidth="11"
              markerHeight="11"
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

              const padStart = source.type === 'WORKER' ? 42 : 58;
              const padEnd = target.type === 'WORKER' ? 46 : 62;

              const curveOffset = hasReverseEdge ? 32 : 0;
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
              const friendlyRelation =
                edge.relation === 'HOLDS' ? 'holds lock' : 'waiting for';

              return (
                <g key={`${edge.from}->${edge.to}:${edge.relation}:${idx}`}>
                  {edge.inCycle && (
                    <path
                      d={pathData}
                      fill="none"
                      stroke="#f43f5e"
                      strokeWidth={7}
                      strokeOpacity={0.14}
                    />
                  )}
                  <path
                    d={pathData}
                    fill="none"
                    stroke={stroke}
                    strokeOpacity={1}
                    strokeWidth={edge.inCycle ? 3 : 2.25}
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
                      x={-52}
                      y={-11}
                      width={104}
                      height={19}
                      rx={6}
                      fill="#090D16"
                      fillOpacity={0.94}
                      stroke={stroke}
                      strokeOpacity={0.45}
                      strokeWidth={1}
                    />
                    <text
                      y={2}
                      textAnchor="middle"
                      className="text-[10.5px] font-sans font-medium fill-slate-200 pointer-events-none"
                    >
                      {friendlyRelation} (L{edge.line})
                    </text>
                  </g>
                </g>
              );
            })}

            {/* Large, Spacious Worker & Lock Nodes */}
            {positionedNodes.map((node) => {
              const isSelected = selectedNodeId === node.id;
              const isHovered = hoveredNodeId === node.id;
              const isHighlighted = isSelected || isHovered;

              const strokeColor = node.inCycle
                ? '#f43f5e'
                : node.type === 'WORKER'
                  ? '#38bdf8'
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
                        r={46}
                        fill="none"
                        stroke="#f43f5e"
                        strokeWidth={2}
                        className="animate-node-ring pointer-events-none"
                      />
                    ) : (
                      <rect
                        x={-70}
                        y={-34}
                        width={140}
                        height={68}
                        rx={14}
                        fill="none"
                        stroke="#f43f5e"
                        strokeWidth={2}
                        className="animate-node-ring pointer-events-none"
                      />
                    ))}

                  {node.type === 'WORKER' ? (
                    <circle
                      r={38}
                      fill={fillColor}
                      stroke={strokeColor}
                      strokeWidth={isHighlighted || node.inCycle ? 3 : 2.25}
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
                      x={-62}
                      y={-27}
                      width={124}
                      height={54}
                      rx={12}
                      fill={fillColor}
                      stroke={strokeColor}
                      strokeWidth={isHighlighted || node.inCycle ? 3 : 2.25}
                      filter={node.inCycle ? 'url(#glow-rose)' : undefined}
                    />
                  )}

                  <text
                    y={-2}
                    textAnchor="middle"
                    className="text-xs font-mono font-bold fill-slate-100 pointer-events-none"
                  >
                    {node.label}
                  </text>
                  <text
                    y={13}
                    textAnchor="middle"
                    className="text-[10px] font-sans font-medium fill-slate-400 pointer-events-none"
                  >
                    {node.type === 'WORKER' ? 'Worker' : 'Shared Lock'}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Subtle Hover Pill (Top-Left, non-clipping & pointer-events-none) */}
        {activeNode && (
          <div className="absolute top-4 left-4 z-20 px-3.5 py-2 rounded-xl bg-slate-900/95 border border-slate-700/80 shadow-xl backdrop-blur-md text-xs pointer-events-none flex items-center gap-2.5">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                activeNode.inCycle
                  ? 'bg-rose-500'
                  : activeNode.type === 'WORKER'
                    ? 'bg-sky-400'
                    : 'bg-amber-400'
              }`}
            />
            <span className="font-mono font-bold text-slate-100">{activeNode.label}</span>
            <span className="text-slate-400">•</span>
            <span className={activeNode.inCycle ? 'text-rose-400 font-semibold' : 'text-emerald-400'}>
              {activeNode.inCycle ? 'Stuck in Deadlock Loop' : 'Healthy / Acyclic'}
            </span>
          </div>
        )}

        {/* Simple 3-Item Legend in the Bottom-Left Corner */}
        <div className="absolute bottom-4 left-4 flex flex-wrap items-center gap-4 px-4 py-2.5 rounded-xl bg-slate-900/90 border border-slate-800/70 backdrop-blur-md text-xs text-slate-200 pointer-events-none shadow-lg">
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-sky-400 inline-block" />
            Worker / Service
          </span>
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-xs bg-amber-400 inline-block" />
            Shared Resource / Lock
          </span>
          <span className="flex items-center gap-2">
            <span
              className={`w-3 h-3 rounded-full inline-block ${
                hasDeadlock ? 'bg-rose-500 animate-pulse' : 'bg-rose-500/70'
              }`}
            />
            Deadlock Loop
          </span>
        </div>
      </div>
    </div>
  );
};

export default LockGraphCanvas;
