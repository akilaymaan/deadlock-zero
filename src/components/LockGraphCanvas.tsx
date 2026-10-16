import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import type {
  AcquisitionRecord,
  ExecutionNode,
  GraphId,
  ResourceNode,
  SourceCodeReference,
  WaitForEdge,
} from '../engine/graph';

import './LockGraphCanvas.css';

type GraphNode = ExecutionNode | ResourceNode;

/** The graph aliases returned by `/api/analyze` are accepted as well as the engine snapshot. */
export interface LockGraphSnapshotInput {
  readonly executionNodes?: readonly ExecutionNode[];
  readonly resourceNodes?: readonly ResourceNode[];
  readonly acquisitions?: readonly AcquisitionRecord[];
  readonly waitForEdges?: readonly WaitForEdge[];
  readonly nodes?: readonly GraphNode[];
  readonly edges?: readonly WaitForEdge[];
  readonly cycles?: readonly LockGraphCycleInput[];
  readonly detectedCycles?: readonly LockGraphCycleInput[];
  readonly deadlocks?: readonly LockGraphCycleFinding[];
}

/** A small structural subset of a detector finding, useful for passing API `deadlocks`. */
export interface LockGraphCycleFinding {
  readonly cycle?: readonly GraphId[];
  readonly cycleNodeIds?: readonly GraphId[];
  readonly edges?: readonly Pick<WaitForEdge, 'id' | 'waiterId' | 'holderId'>[];
}

export type LockGraphCycleInput = readonly GraphId[] | LockGraphCycleFinding;

/** Full API payload shape. The nested `graph` form mirrors the server response. */
export interface LockGraphPayload extends LockGraphSnapshotInput {
  readonly graph?: LockGraphSnapshotInput | null;
}

export interface LockGraphSelection {
  readonly kind: 'node' | 'holding' | 'wait';
  readonly id: GraphId;
  readonly resourceId?: GraphId;
  readonly waiterId?: GraphId;
  readonly holderId?: GraphId;
}

export interface LockGraphCanvasProps {
  /** A graph snapshot or the complete `/api/analyze` response. */
  readonly data?: LockGraphPayload | null;
  /** Optional direct graph prop for callers that already extracted `response.graph`. */
  readonly graph?: LockGraphSnapshotInput | null;
  /** Overrides cycle information when it is kept outside the graph payload. */
  readonly cycles?: readonly LockGraphCycleInput[] | null;
  readonly title?: string;
  readonly className?: string;
  readonly onSelectionChange?: (selection: LockGraphSelection | null) => void;
}

/** A deterministic, typed first-render snapshot for an empty workbench. */
export const DEMO_LOCK_GRAPH: LockGraphPayload = {
  executionNodes: [
    { id: 'thread-checkout', name: 'checkout-worker', kind: 'thread' },
    { id: 'thread-ledger', name: 'ledger-worker', kind: 'thread' },
    { id: 'thread-inventory', name: 'inventory-worker', kind: 'thread' },
  ],
  resourceNodes: [
    { id: 'lock-inventory', name: 'inventory mutex', kind: 'lock' },
    { id: 'lock-ledger', name: 'ledger mutex', kind: 'lock' },
    { id: 'lock-checkout', name: 'checkout mutex', kind: 'lock' },
  ],
  acquisitions: [
    { resourceId: 'lock-inventory', holderId: 'thread-checkout', acquiredAt: 1 },
    { resourceId: 'lock-ledger', holderId: 'thread-ledger', acquiredAt: 2 },
    { resourceId: 'lock-checkout', holderId: 'thread-inventory', acquiredAt: 3 },
  ],
  waitForEdges: [
    {
      id: 'demo-checkout-waits-ledger',
      waiterId: 'thread-checkout',
      holderId: 'thread-ledger',
      resourceId: 'lock-ledger',
      observedAt: 4,
    },
    {
      id: 'demo-ledger-waits-inventory',
      waiterId: 'thread-ledger',
      holderId: 'thread-inventory',
      resourceId: 'lock-checkout',
      observedAt: 5,
    },
    {
      id: 'demo-inventory-waits-checkout',
      waiterId: 'thread-inventory',
      holderId: 'thread-checkout',
      resourceId: 'lock-inventory',
      observedAt: 6,
    },
  ],
  cycles: [
    ['thread-checkout', 'thread-ledger', 'thread-inventory'],
  ],
};

interface NormalizedCycle {
  readonly nodeIds: readonly GraphId[];
  readonly edgeIds: ReadonlySet<GraphId>;
}

interface NormalizedGraph {
  readonly executionNodes: readonly ExecutionNode[];
  readonly resourceNodes: readonly ResourceNode[];
  readonly acquisitions: readonly AcquisitionRecord[];
  readonly waitForEdges: readonly WaitForEdge[];
  readonly cycles: readonly NormalizedCycle[];
  readonly isDemo: boolean;
}

interface PositionedNode {
  readonly node: GraphNode;
  readonly x: number;
  readonly y: number;
}

type RenderEdgeKind = 'holding' | 'wait';

interface RenderEdge {
  readonly key: string;
  readonly kind: RenderEdgeKind;
  readonly sourceId: GraphId;
  readonly targetId: GraphId;
  readonly resourceId: GraphId;
  readonly source: PositionedNode;
  readonly target: PositionedNode;
  readonly path: string;
  readonly labelPath: string;
  readonly isCycle: boolean;
  readonly selection: LockGraphSelection;
}

interface GraphLayout {
  readonly width: number;
  readonly height: number;
  readonly threadX: number;
  readonly resourceX: number;
  readonly positions: ReadonlyMap<GraphId, PositionedNode>;
  readonly edges: readonly RenderEdge[];
  readonly cycleNodeIds: ReadonlySet<GraphId>;
}

type InternalSelection = LockGraphSelection & { readonly key: string };

const GRAPH_WIDTH = 1_040;
const THREAD_WIDTH = 184;
const THREAD_HEIGHT = 58;
const LOCK_RADIUS_X = 82;
const LOCK_RADIUS_Y = 36;
const ROW_GAP = 90;

function isExecutionNode(node: GraphNode): node is ExecutionNode {
  return node.kind === 'thread' || node.kind === 'service';
}

function isResourceNode(node: GraphNode): node is ResourceNode {
  return node.kind === 'lock' || node.kind === 'resource';
}

function uniqueById<T extends { readonly id: GraphId }>(items: readonly T[]): T[] {
  const unique = new Map<GraphId, T>();
  for (const item of items) {
    if (!unique.has(item.id)) unique.set(item.id, item);
  }
  return [...unique.values()];
}

function isCycleFinding(input: LockGraphCycleInput): input is LockGraphCycleFinding {
  return !Array.isArray(input) && typeof input === 'object' && input !== null;
}

function asCycleIds(input: LockGraphCycleInput): readonly GraphId[] {
  if (!isCycleFinding(input)) {
    return input.filter((id): id is GraphId => typeof id === 'string' && id.length > 0);
  }
  const ids = input.cycle ?? input.cycleNodeIds ?? [];
  return ids.filter((id): id is GraphId => typeof id === 'string' && id.length > 0);
}

function asCycleEdgeIds(input: LockGraphCycleInput): readonly GraphId[] {
  if (!isCycleFinding(input)) return [];
  return (input.edges ?? [])
    .map((edge) => edge.id)
    .filter((id): id is GraphId => typeof id === 'string' && id.length > 0);
}

function cycleKey(nodeIds: readonly GraphId[], edgeIds: readonly GraphId[]): string {
  return `${nodeIds.join('\u0000')}|${edgeIds.join('\u0000')}`;
}

function normalizeCycles(inputs: readonly LockGraphCycleInput[]): NormalizedCycle[] {
  const seen = new Set<string>();
  const cycles: NormalizedCycle[] = [];

  for (const input of inputs) {
    const nodeIds = asCycleIds(input);
    const edgeIds = asCycleEdgeIds(input);
    if (nodeIds.length === 0 && edgeIds.length === 0) continue;
    const key = cycleKey(nodeIds, edgeIds);
    if (seen.has(key)) continue;
    seen.add(key);
    cycles.push({ nodeIds, edgeIds: new Set(edgeIds) });
  }

  return cycles;
}

function normalizeGraph(
  data: LockGraphPayload | null | undefined,
  graph: LockGraphSnapshotInput | null | undefined,
  cyclesOverride: readonly LockGraphCycleInput[] | null | undefined,
  allowDemoFallback = true,
): NormalizedGraph {
  const snapshot = data?.graph ?? graph ?? data ?? {};
  const executionNodes = uniqueById([
    ...(snapshot.executionNodes ?? []),
    ...(snapshot.nodes ?? []).filter(isExecutionNode),
  ]);
  const resourceNodes = uniqueById([
    ...(snapshot.resourceNodes ?? []),
    ...(snapshot.nodes ?? []).filter(isResourceNode),
  ]);
  const acquisitions = [...(snapshot.acquisitions ?? [])];
  const waitForEdges = [...(snapshot.waitForEdges ?? snapshot.edges ?? [])];

  const cycleInputs =
    cyclesOverride ??
    data?.cycles ??
    data?.detectedCycles ??
    data?.deadlocks ??
    snapshot.cycles ??
    snapshot.detectedCycles ??
    snapshot.deadlocks ??
    [];
  const cycles = normalizeCycles(cycleInputs);

  const executionById = new Map(executionNodes.map((node) => [node.id, node]));
  const resourceById = new Map(resourceNodes.map((node) => [node.id, node]));
  const addImplicitExecution = (id: GraphId): void => {
    if (!executionById.has(id)) {
      const node: ExecutionNode = { id, name: id, kind: 'thread' };
      executionById.set(id, node);
    }
  };
  const addImplicitResource = (id: GraphId): void => {
    if (!resourceById.has(id)) {
      const node: ResourceNode = { id, name: id, kind: 'lock' };
      resourceById.set(id, node);
    }
  };

  for (const acquisition of acquisitions) {
    addImplicitExecution(acquisition.holderId);
    addImplicitResource(acquisition.resourceId);
  }
  for (const edge of waitForEdges) {
    addImplicitExecution(edge.waiterId);
    addImplicitExecution(edge.holderId);
    addImplicitResource(edge.resourceId);
  }
  for (const cycle of cycles) {
    for (const nodeId of cycle.nodeIds) addImplicitExecution(nodeId);
  }

  const hasContent =
    executionNodes.length > 0 ||
    resourceNodes.length > 0 ||
    acquisitions.length > 0 ||
    waitForEdges.length > 0;
  if (!hasContent && allowDemoFallback) {
    return {
      ...normalizeGraph(DEMO_LOCK_GRAPH, undefined, undefined, false),
      isDemo: true,
    };
  }

  return {
    executionNodes: [...executionById.values()],
    resourceNodes: [...resourceById.values()],
    acquisitions,
    waitForEdges,
    cycles,
    isDemo: false,
  };
}

function abbreviated(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, Math.max(1, limit - 1))}…` : value;
}

function sourceLabel(source: SourceCodeReference | undefined): string | undefined {
  if (!source) return undefined;
  return `${source.file}:${source.line}${source.column === undefined ? '' : `:${source.column}`}`;
}

function pairKey(sourceId: GraphId, targetId: GraphId): string {
  return `${sourceId}\u0000${targetId}`;
}

function hexagonPoints(x: number, y: number): string {
  const points = [
    [x - LOCK_RADIUS_X, y - LOCK_RADIUS_Y * 0.55],
    [x, y - LOCK_RADIUS_Y],
    [x + LOCK_RADIUS_X, y - LOCK_RADIUS_Y * 0.55],
    [x + LOCK_RADIUS_X, y + LOCK_RADIUS_Y * 0.55],
    [x, y + LOCK_RADIUS_Y],
    [x - LOCK_RADIUS_X, y + LOCK_RADIUS_Y * 0.55],
  ];
  return points.map(([pointX, pointY]) => `${pointX},${pointY}`).join(' ');
}

function edgeAnchors(
  kind: RenderEdgeKind,
  source: PositionedNode,
  target: PositionedNode,
): { readonly startX: number; readonly endX: number } {
  if (kind === 'holding') {
    return {
      startX: source.x - LOCK_RADIUS_X,
      endX: target.x + THREAD_WIDTH / 2,
    };
  }
  return {
    startX: source.x + THREAD_WIDTH / 2,
    endX: target.x - LOCK_RADIUS_X,
  };
}

function makeEdgePath(
  kind: RenderEdgeKind,
  source: PositionedNode,
  target: PositionedNode,
  index: number,
): { readonly path: string; readonly labelPath: string } {
  const { startX, endX } = edgeAnchors(kind, source, target);
  const midpoint = (startX + endX) / 2;
  const spread = ((index % 5) - 2) * 13;
  const baseBend = kind === 'holding' ? -38 : 38;
  const bend = baseBend + spread;
  const path = `M ${startX} ${source.y} C ${midpoint} ${source.y + bend}, ${midpoint} ${target.y + bend}, ${endX} ${target.y}`;
  return {
    path,
    labelPath: `M ${midpoint} ${((source.y + target.y) / 2) + bend * 0.72}`,
  };
}

function buildLayout(graph: NormalizedGraph): GraphLayout {
  const maxRows = Math.max(graph.executionNodes.length, graph.resourceNodes.length, 1);
  const height = Math.max(420, 168 + (maxRows - 1) * ROW_GAP);
  const threadX = 194;
  const resourceX = GRAPH_WIDTH - 194;
  const positions = new Map<GraphId, PositionedNode>();
  const top = 112;

  graph.executionNodes.forEach((node, index) => {
    positions.set(node.id, {
      node,
      x: threadX,
      y: top + index * ROW_GAP,
    });
  });
  graph.resourceNodes.forEach((node, index) => {
    positions.set(node.id, {
      node,
      x: resourceX,
      y: top + index * ROW_GAP,
    });
  });

  const cycleNodeIds = new Set<GraphId>();
  const cyclePairs = new Set<string>();
  const cycleEdgeIds = new Set<GraphId>();
  for (const cycle of graph.cycles) {
    for (const nodeId of cycle.nodeIds) cycleNodeIds.add(nodeId);
    for (const edgeId of cycle.edgeIds) cycleEdgeIds.add(edgeId);
    for (let index = 0; index < cycle.nodeIds.length; index += 1) {
      const sourceId = cycle.nodeIds[index];
      const targetId = cycle.nodeIds[(index + 1) % cycle.nodeIds.length];
      if (sourceId !== undefined && targetId !== undefined) {
        cyclePairs.add(pairKey(sourceId, targetId));
      }
    }
  }

  const edges: RenderEdge[] = [];
  graph.acquisitions.forEach((acquisition, index) => {
    const source = positions.get(acquisition.resourceId);
    const target = positions.get(acquisition.holderId);
    if (!source || !target) return;
    const geometry = makeEdgePath('holding', source, target, index);
    const selectionId = `${acquisition.resourceId}:${acquisition.holderId}`;
    edges.push({
      key: `holding:${selectionId}:${index}`,
      kind: 'holding',
      sourceId: acquisition.resourceId,
      targetId: acquisition.holderId,
      resourceId: acquisition.resourceId,
      source,
      target,
      path: geometry.path,
      labelPath: geometry.labelPath,
      isCycle: false,
      selection: {
        kind: 'holding',
        id: selectionId,
        resourceId: acquisition.resourceId,
        holderId: acquisition.holderId,
      },
    });
  });
  graph.waitForEdges.forEach((edge, index) => {
    const source = positions.get(edge.waiterId);
    const target = positions.get(edge.resourceId);
    if (!source || !target) return;
    const geometry = makeEdgePath('wait', source, target, index + graph.acquisitions.length);
    const isCycle = cycleEdgeIds.has(edge.id) || cyclePairs.has(pairKey(edge.waiterId, edge.holderId));
    edges.push({
      key: `wait:${edge.id}:${index}`,
      kind: 'wait',
      sourceId: edge.waiterId,
      targetId: edge.resourceId,
      resourceId: edge.resourceId,
      source,
      target,
      path: geometry.path,
      labelPath: geometry.labelPath,
      isCycle,
      selection: {
        kind: 'wait',
        id: edge.id,
        resourceId: edge.resourceId,
        waiterId: edge.waiterId,
        holderId: edge.holderId,
      },
    });
  });

  return {
    width: GRAPH_WIDTH,
    height,
    threadX,
    resourceX,
    positions,
    edges,
    cycleNodeIds,
  };
}

function selectionKey(selection: LockGraphSelection): string {
  return `${selection.kind}:${selection.id}`;
}

function itemTouchesNode(edge: RenderEdge, nodeId: GraphId): boolean {
  if (edge.sourceId === nodeId || edge.targetId === nodeId) return true;
  return edge.kind === 'wait' && edge.selection.holderId === nodeId;
}

function nodeDescription(node: GraphNode): string {
  const type = isExecutionNode(node)
    ? node.kind === 'service'
      ? 'service'
      : 'thread'
    : node.kind === 'lock'
      ? 'lock'
      : 'resource';
  const source = sourceLabel(node.source);
  return `${type} ${node.name} (${node.id})${source ? `, observed at ${source}` : ''}`;
}

function edgeDescription(edge: RenderEdge): string {
  const resourceName = edge.kind === 'holding' ? edge.source.node.name : edge.target.node.name;
  if (edge.kind === 'holding') {
    return `Safe holding: ${resourceName} is held by ${edge.target.node.name}. Direction ${edge.source.node.name} to ${edge.target.node.name}.`;
  }
  const holderName = edge.selection.holderId ?? 'the current holder';
  return `${edge.isCycle ? 'Cycle edge' : 'Wait edge'}: ${edge.source.node.name} waits for ${resourceName}, held by ${holderName}. Arrow direction is from waiter to requested lock.`;
}

function keyActivates(
  event: ReactKeyboardEvent<SVGGElement>,
  activate: () => void,
): void {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  activate();
}

function sourceDetails(source: SourceCodeReference | undefined): string {
  return sourceLabel(source) ?? 'No source location recorded';
}

export function LockGraphCanvas({
  data,
  graph,
  cycles,
  title = 'Wait-for graph',
  className,
  onSelectionChange,
}: LockGraphCanvasProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const graphData = useMemo(
    () => normalizeGraph(data, graph, cycles),
    [cycles, data, graph],
  );
  const layout = useMemo(() => buildLayout(graphData), [graphData]);
  const [selection, setSelection] = useState<InternalSelection | null>(null);
  const [hovered, setHovered] = useState<InternalSelection | null>(null);

  const active = hovered ?? selection;
  const activeKey = active ? active.key : undefined;
  const cycleEdgeCount = layout.edges.filter((edge) => edge.isCycle).length;
  const holdingCount = layout.edges.filter((edge) => edge.kind === 'holding').length;
  const svgTitleId = `${id}-title`;
  const svgDescriptionId = `${id}-description`;
  const rootClassName = ['lock-graph', className].filter(Boolean).join(' ');

  const select = (next: LockGraphSelection | null): void => {
    const internal = next ? { ...next, key: selectionKey(next) } : null;
    setSelection(internal);
    onSelectionChange?.(next);
  };

  const getNode = (nodeId: GraphId): GraphNode | undefined => layout.positions.get(nodeId)?.node;
  const selectedNode = selection?.kind === 'node' ? getNode(selection.id) : undefined;
  const selectedEdge = selection?.kind === 'holding' || selection?.kind === 'wait'
    ? layout.edges.find((edge) => edge.selection.kind === selection.kind && edge.selection.id === selection.id)
    : undefined;

  return (
    <section className={rootClassName} aria-label={`${title} visualization`}>
      <header className="lock-graph__header">
        <div>
          <p className="lock-graph__eyebrow">Concurrency topology</p>
          <h2 className="lock-graph__title">{title}</h2>
          <p className="lock-graph__subtitle">
            Requests flow toward locks; green assignments show current holders.
            {cycleEdgeCount > 0 ? ' Crimson motion marks a detected cycle.' : ''}
          </p>
        </div>
        <span className={`lock-graph__status${graphData.isDemo ? ' lock-graph__status--demo' : ''}`}>
          {graphData.isDemo
            ? 'Demo snapshot'
            : cycleEdgeCount > 0
              ? `${graphData.cycles.length} cycle${graphData.cycles.length === 1 ? '' : 's'} detected`
              : 'No cycles detected'}
        </span>
      </header>

      <div className="lock-graph__stats" aria-label="Graph summary">
        <span><strong>{graphData.executionNodes.length}</strong> threads</span>
        <span><strong>{graphData.resourceNodes.length}</strong> locks/resources</span>
        <span><strong>{holdingCount}</strong> holdings</span>
        <span><strong>{cycleEdgeCount}</strong> cycle edges</span>
      </div>

      <div className="lock-graph__legend" aria-label="Graph legend">
        <span><i className="lock-graph__legend-swatch lock-graph__legend-swatch--thread" />Thread</span>
        <span><i className="lock-graph__legend-swatch lock-graph__legend-swatch--lock" />Lock / resource</span>
        <span><i className="lock-graph__legend-swatch lock-graph__legend-swatch--holding" />Safe holding</span>
        <span><i className="lock-graph__legend-swatch lock-graph__legend-swatch--cycle" />Detected cycle</span>
      </div>

      <div className="lock-graph__canvas">
        <svg
          className="lock-graph__svg"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="group"
          aria-labelledby={`${svgTitleId} ${svgDescriptionId}`}
          onClick={() => select(null)}
          onMouseLeave={() => setHovered(null)}
        >
          <title id={svgTitleId}>{title}</title>
          <desc id={svgDescriptionId}>
            Interactive wait-for graph with {graphData.executionNodes.length} execution nodes,{' '}
            {graphData.resourceNodes.length} lock or resource nodes, {holdingCount} current holdings,
            and {cycleEdgeCount} detected cycle edges.
          </desc>
          <defs>
            <pattern id={`${id}-grid`} width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" className="lock-graph__grid" />
            </pattern>
            <filter id={`${id}-cycle-glow`} x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <marker
              id={`${id}-holding-arrow`}
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 8 4 L 0 8 Z" fill="#4fdb9c" />
            </marker>
            <marker
              id={`${id}-wait-arrow`}
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 8 4 L 0 8 Z" fill="#8498b4" />
            </marker>
            <marker
              id={`${id}-cycle-arrow`}
              markerWidth="9"
              markerHeight="9"
              refX="8"
              refY="4.5"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 9 4.5 L 0 9 Z" fill="#ff4f6f" />
            </marker>
          </defs>

          <rect
            className="lock-graph__backdrop"
            x="0"
            y="0"
            width={layout.width}
            height={layout.height}
            fill={`url(#${id}-grid)`}
            aria-hidden="true"
          />
          <line className="lock-graph__column-rule" x1={layout.threadX} x2={layout.threadX} y1="56" y2={layout.height - 34} />
          <line className="lock-graph__column-rule" x1={layout.resourceX} x2={layout.resourceX} y1="56" y2={layout.height - 34} />
          <text className="lock-graph__column-label" x={layout.threadX} y="34" textAnchor="middle">EXECUTION NODES</text>
          <text className="lock-graph__column-label" x={layout.resourceX} y="34" textAnchor="middle">LOCKS / RESOURCES</text>

          <g className="lock-graph__edges" aria-label="Graph relationships">
            {layout.edges.map((edge) => {
              const edgeKey = selectionKey(edge.selection);
              const isActive = activeKey === edgeKey || (active?.kind === 'node' && itemTouchesNode(edge, active.id));
              const isDimmed = active !== null && !isActive;
              const edgeClasses = [
                'lock-graph__edge-group',
                edge.kind === 'holding' ? 'lock-graph__edge-group--holding' : 'lock-graph__edge-group--wait',
                edge.isCycle ? 'lock-graph__edge-group--cycle' : '',
                isActive ? 'lock-graph__edge-group--active' : '',
                isDimmed ? 'lock-graph__edge-group--dimmed' : '',
              ].filter(Boolean).join(' ');
              const edgeLabel = edgeDescription(edge);
              return (
                <g
                  key={edge.key}
                  className={edgeClasses}
                  role="button"
                  tabIndex={0}
                  aria-label={edgeLabel}
                  aria-pressed={selection?.key === edgeKey}
                  onClick={(event) => {
                    event.stopPropagation();
                    select(edge.selection);
                  }}
                  onKeyDown={(event) => keyActivates(event, () => select(edge.selection))}
                  onMouseEnter={() => setHovered({ ...edge.selection, key: edgeKey })}
                  onFocus={() => setHovered({ ...edge.selection, key: edgeKey })}
                  onBlur={() => setHovered(null)}
                >
                  <title>{edgeLabel}</title>
                  {edge.isCycle && (
                    <path
                      className="lock-graph__edge-glow lock-graph__edge-glow--cycle"
                      d={edge.path}
                      filter={`url(#${id}-cycle-glow)`}
                      aria-hidden="true"
                    />
                  )}
                  <path
                    className={`lock-graph__edge ${edge.isCycle ? 'lock-graph__edge--cycle' : edge.kind === 'holding' ? 'lock-graph__edge--holding' : 'lock-graph__edge--wait'}`}
                    d={edge.path}
                    markerEnd={`url(#${id}-${edge.isCycle ? 'cycle' : edge.kind === 'holding' ? 'holding' : 'wait'}-arrow)`}
                    aria-hidden="true"
                  />
                  <path className="lock-graph__edge-hit" d={edge.path} aria-hidden="true" />
                </g>
              );
            })}
          </g>

          <g className="lock-graph__nodes" aria-label="Graph nodes">
            {graphData.executionNodes.map((node) => {
              const position = layout.positions.get(node.id);
              if (!position) return null;
              const nodeKey = `node:${node.id}`;
              const isActive = activeKey === nodeKey || (active?.kind !== 'node' && active !== null && layout.edges.some((edge) => edgeKeyFromSelection(edge.selection) === activeKey && itemTouchesNode(edge, node.id)));
              const isDimmed = active !== null && !isActive;
              const isCycleNode = layout.cycleNodeIds.has(node.id);
              const classes = [
                'lock-graph__node',
                'lock-graph__node--thread',
                isCycleNode ? 'lock-graph__node--cycle' : '',
                isActive ? 'lock-graph__node--active' : '',
                isDimmed ? 'lock-graph__node--dimmed' : '',
              ].filter(Boolean).join(' ');
              const label = nodeDescription(node);
              const nodeSelection: LockGraphSelection = { kind: 'node', id: node.id };
              return (
                <g
                  key={node.id}
                  className={classes}
                  role="button"
                  tabIndex={0}
                  aria-label={label}
                  aria-pressed={selection?.key === nodeKey}
                  onClick={(event) => {
                    event.stopPropagation();
                    select(nodeSelection);
                  }}
                  onKeyDown={(event) => keyActivates(event, () => select(nodeSelection))}
                  onMouseEnter={() => setHovered({ ...nodeSelection, key: nodeKey })}
                  onFocus={() => setHovered({ ...nodeSelection, key: nodeKey })}
                  onBlur={() => setHovered(null)}
                >
                  <title>{label}</title>
                  <rect
                    className="lock-graph__thread-shape"
                    x={position.x - THREAD_WIDTH / 2}
                    y={position.y - THREAD_HEIGHT / 2}
                    width={THREAD_WIDTH}
                    height={THREAD_HEIGHT}
                    rx="14"
                  />
                  <circle className="lock-graph__thread-dot" cx={position.x - THREAD_WIDTH / 2 + 20} cy={position.y - 5} r="5" />
                  <text className="lock-graph__node-name" x={position.x - THREAD_WIDTH / 2 + 34} y={position.y - 4}>
                    {abbreviated(node.name, 20)}
                  </text>
                  <text className="lock-graph__node-id" x={position.x - THREAD_WIDTH / 2 + 34} y={position.y + 15}>
                    {abbreviated(node.id, 24)}
                  </text>
                </g>
              );
            })}
            {graphData.resourceNodes.map((node) => {
              const position = layout.positions.get(node.id);
              if (!position) return null;
              const nodeKey = `node:${node.id}`;
              const isActive = activeKey === nodeKey || (active?.kind !== 'node' && active !== null && layout.edges.some((edge) => edgeKeyFromSelection(edge.selection) === activeKey && itemTouchesNode(edge, node.id)));
              const isDimmed = active !== null && !isActive;
              const isCycleNode = layout.cycleNodeIds.has(node.id);
              const classes = [
                'lock-graph__node',
                'lock-graph__node--lock',
                isCycleNode ? 'lock-graph__node--cycle' : '',
                isActive ? 'lock-graph__node--active' : '',
                isDimmed ? 'lock-graph__node--dimmed' : '',
              ].filter(Boolean).join(' ');
              const label = nodeDescription(node);
              const nodeSelection: LockGraphSelection = { kind: 'node', id: node.id };
              return (
                <g
                  key={node.id}
                  className={classes}
                  role="button"
                  tabIndex={0}
                  aria-label={label}
                  aria-pressed={selection?.key === nodeKey}
                  onClick={(event) => {
                    event.stopPropagation();
                    select(nodeSelection);
                  }}
                  onKeyDown={(event) => keyActivates(event, () => select(nodeSelection))}
                  onMouseEnter={() => setHovered({ ...nodeSelection, key: nodeKey })}
                  onFocus={() => setHovered({ ...nodeSelection, key: nodeKey })}
                  onBlur={() => setHovered(null)}
                >
                  <title>{label}</title>
                  <polygon className="lock-graph__lock-shape" points={hexagonPoints(position.x, position.y)} />
                  <path
                    className="lock-graph__lock-icon"
                    d={`M ${position.x - 8} ${position.y + 2} v -6 a 8 8 0 0 1 16 0 v 6 M ${position.x - 12} ${position.y + 2} h 24 v 12 h -24 z`}
                  />
                  <text className="lock-graph__node-name" x={position.x} y={position.y + 27} textAnchor="middle">
                    {abbreviated(node.name, 22)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <div className="lock-graph__inspector" aria-live="polite">
        <span className="lock-graph__inspector-label">Inspector</span>
        {selectedNode && (
          <span>
            <strong>{isExecutionNode(selectedNode) ? 'Thread' : 'Lock'}</strong>{' '}
            {selectedNode.name} <em>{selectedNode.id}</em> · source {sourceDetails(selectedNode.source)}
          </span>
        )}
        {!selectedNode && selectedEdge?.kind === 'holding' && (
          <span>
            <strong>Safe holding</strong> · {selectedEdge.source.node.name} → {selectedEdge.target.node.name}
            <em>{selectedEdge.resourceId}</em>
          </span>
        )}
        {!selectedNode && selectedEdge?.kind === 'wait' && (
          <span>
            <strong>{selectedEdge.isCycle ? 'Detected cycle edge' : 'Wait edge'}</strong> · {selectedEdge.source.node.name} waits for {selectedEdge.target.node.name}
            <em>{selectedEdge.selection.holderId ?? 'unknown holder'}</em>
          </span>
        )}
        {!selectedNode && !selectedEdge && (
          <span className="lock-graph__inspector-empty">Hover or select a node or edge for details.</span>
        )}
      </div>
    </section>
  );
}

function edgeKeyFromSelection(selection: LockGraphSelection): string {
  return selectionKey(selection);
}

export default LockGraphCanvas;
