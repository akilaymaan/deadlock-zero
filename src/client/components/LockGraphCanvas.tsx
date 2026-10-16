import React from 'react';
import { AlertTriangle, Cpu, Lock, ShieldCheck } from 'lucide-react';
import type { DeadlockCycle, GraphEdge, GraphNode, RaceConflict, StarvationAlert } from '../../shared/types';

interface LockGraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
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
  races,
  starvation,
  selectedNodeId,
  onSelectNode,
}) => {
  const width = 760;
  const height = 430;
  const centerX = width / 2;
  const centerY = height / 2 + 10;

  const positionedNodes: PositionedNode[] = React.useMemo(() => {
    const count = Math.max(nodes.length, 1);
    const radiusX = Math.min(250, 110 + count * 22);
    const radiusY = Math.min(145, 80 + count * 14);
    return nodes.map((node, index) => {
      const angle = (2 * Math.PI * index) / count - Math.PI / 2;
      return {
        ...node,
        x: Math.round(centerX + radiusX * Math.cos(angle)),
        y: Math.round(centerY + radiusY * Math.sin(angle)),
      };
    });
  }, [nodes, centerX, centerY]);

  const nodeMap = React.useMemo(() => {
    const map = new Map<string, PositionedNode>();
    for (const node of positionedNodes) {
      map.set(node.id, node);
    }
    return map;
  }, [positionedNodes]);

  const primaryCyclePath = cycles[0]?.cycleNodes?.join(' -> ');

  return (
    <div className="flex flex-col h-full bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950/60">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-semibold tracking-wide uppercase text-slate-200">
            Interactive Wait-For Graph (WFG) // Tarjan SCC Topology
          </h2>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block" /> Worker Node
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-amber-400 inline-block" /> Lock / Resource
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" /> HOLDS
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> SCC Cycle
          </span>
        </div>
      </div>

      {primaryCyclePath ? (
        <div
          role="alert"
          className="flex items-center gap-2.5 px-4 py-2.5 bg-red-950/80 border-b border-red-800/80 text-red-200 text-xs font-mono"
        >
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="font-bold uppercase tracking-wider text-red-400">
            Tarjan SCC Deadlock Cycle Detected:
          </span>
          <span className="truncate">{primaryCyclePath}</span>
        </div>
      ) : races.length > 0 ? (
        <div
          role="alert"
          className="flex items-center gap-2.5 px-4 py-2.5 bg-amber-950/80 border-b border-amber-800/80 text-amber-200 text-xs font-mono"
        >
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="font-bold uppercase tracking-wider text-amber-400">
            Lamport Vector-Clock Causal Conflict:
          </span>
          <span className="truncate">
            {races[0].workerA} || {races[0].workerB} on {races[0].resourceId}
          </span>
        </div>
      ) : starvation.length > 0 ? (
        <div
          role="alert"
          className="flex items-center gap-2.5 px-4 py-2.5 bg-orange-950/80 border-b border-orange-800/80 text-orange-200 text-xs font-mono"
        >
          <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0" />
          <span className="font-bold uppercase tracking-wider text-orange-400">
            Pool Starvation (&gt;80% Blocked):
          </span>
          <span className="truncate">{starvation[0].explanation}</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-4 py-2 bg-emerald-950/50 border-b border-emerald-800/60 text-emerald-300 text-xs font-mono">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>Cycle-Free Canonical Lock Hierarchy Verified (0 SCC Cycles)</span>
        </div>
      )}

      <div className="relative flex-1 min-h-[340px] bg-slate-950 flex items-center justify-center">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-full select-none"
          aria-label="Wait-For Graph SVG Canvas"
        >
          <defs>
            <marker
              id="arrow-cycle"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#ef4444" />
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

          {edges.map((edge, idx) => {
            const source = nodeMap.get(edge.from);
            const target = nodeMap.get(edge.to);
            if (!source || !target) return null;

            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const dist = Math.hypot(dx, dy) || 1;
            const padStart = source.type === 'WORKER' ? 30 : 38;
            const padEnd = target.type === 'WORKER' ? 34 : 42;
            const x1 = source.x + (dx / dist) * padStart;
            const y1 = source.y + (dy / dist) * padStart;
            const x2 = target.x - (dx / dist) * padEnd;
            const y2 = target.y - (dy / dist) * padEnd;
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2 - 8;

            const stroke = edge.inCycle
              ? '#ef4444'
              : edge.relation === 'HOLDS'
                ? '#10b981'
                : '#f59e0b';
            const markerEnd = edge.inCycle
              ? 'url(#arrow-cycle)'
              : edge.relation === 'HOLDS'
                ? 'url(#arrow-holds)'
                : 'url(#arrow-waits)';

            return (
              <g key={`${edge.from}->${edge.to}:${idx}`}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={stroke}
                  strokeWidth={edge.inCycle ? 3 : 2}
                  strokeDasharray={edge.relation === 'WAITS_FOR' && !edge.inCycle ? '6 4' : undefined}
                  markerEnd={markerEnd}
                />
                <text
                  x={midX}
                  y={midY}
                  textAnchor="middle"
                  className="text-[10px] font-mono fill-slate-300"
                >
                  {edge.relation} ({edge.file.split('/').pop()}:{edge.line})
                </text>
              </g>
            );
          })}

          {positionedNodes.map((node) => {
            const isSelected = selectedNodeId === node.id;
            const strokeColor = node.inCycle
              ? '#ef4444'
              : node.type === 'WORKER'
                ? '#22d3ee'
                : '#f59e0b';
            const fillColor = node.inCycle
              ? '#450a0a'
              : node.type === 'WORKER'
                ? '#083344'
                : '#1e293b';

            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                onClick={() => onSelectNode(isSelected ? null : node.id)}
                className="cursor-pointer"
              >
                {node.type === 'WORKER' ? (
                  <circle
                    r={28}
                    fill={fillColor}
                    stroke={strokeColor}
                    strokeWidth={isSelected || node.inCycle ? 3 : 2}
                  />
                ) : (
                  <rect
                    x={-48}
                    y={-22}
                    width={96}
                    height={44}
                    rx={8}
                    fill={fillColor}
                    stroke={strokeColor}
                    strokeWidth={isSelected || node.inCycle ? 3 : 2}
                  />
                )}
                <text
                  y={4}
                  textAnchor="middle"
                  className="text-[11px] font-mono font-semibold fill-slate-100"
                >
                  {node.label}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="absolute bottom-2.5 right-3 flex items-center gap-2 text-[11px] text-slate-400 font-mono">
          <Lock className="w-3.5 h-3.5 text-slate-400" />
          <span>
            Nodes: {nodes.length} | Edges: {edges.length} | Cycles: {cycles.length}
          </span>
        </div>
      </div>
    </div>
  );
};

export default LockGraphCanvas;
