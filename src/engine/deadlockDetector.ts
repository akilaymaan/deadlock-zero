import { buildWaitForGraph, WaitForGraph } from './graph';
import type {
  AcquisitionRecord,
  BuiltWaitForGraph,
  ExecutionNode,
  GraphId,
  LockEvent,
  ResourceNode,
  SourceCodeReference,
  WaitForEdge,
  WaitForGraphSnapshot,
} from './graph';
import type { DeadlockCycle, OffendingLine } from '../shared/types';

export type { DeadlockCycle, OffendingLine } from '../shared/types';

/** A snapshot is intentionally accepted as well as the mutable graph class. */
export type ReadonlyWaitForGraphSnapshot = {
  readonly executionNodes: readonly ExecutionNode[];
  readonly resourceNodes: readonly ResourceNode[];
  readonly acquisitions: readonly AcquisitionRecord[];
  readonly waitForEdges: readonly WaitForEdge[];
};

export type WaitForGraphInput =
  | WaitForGraph
  | WaitForGraphSnapshot
  | ReadonlyWaitForGraphSnapshot
  | BuiltWaitForGraph
  | readonly LockEvent[];

/** Vertex ids in one strongly connected component, in deterministic order. */
export type StronglyConnectedComponent = GraphId[];

/** Vertex ids in one elementary cycle, with no repeated closing vertex. */
export type ElementaryCycle = GraphId[];

export interface DeadlockSourceLocations {
  /** The source at which the waiter observed its wait. */
  wait?: SourceCodeReference;
  /** The source at which the resource was acquired/held. */
  acquisition?: SourceCodeReference;
}

/**
 * One explicit waiter -> holder -> resource link in a deadlock cycle.
 *
 * `waitEdge` is the deterministic representative when parallel wait edges
 * connect the same two executions. `waitEdges` retains all of those edges so
 * callers can still inspect every offending source location.
 */
export interface HoldAndWaitChainLink {
  waiterId: GraphId;
  holderId: GraphId;
  resourceId: GraphId;

  waiter?: ExecutionNode;
  holder?: ExecutionNode;
  resource?: ResourceNode;
  waiterName?: string;
  holderName?: string;
  resourceName?: string;

  waitEdge: WaitForEdge;
  edge: WaitForEdge;
  waitEdges: WaitForEdge[];
  waitSource?: SourceCodeReference;
  waitEdgeSource?: SourceCodeReference;

  /** The current acquisition for `resourceId`, when one is available. */
  acquisition?: AcquisitionRecord;
  /** Alias emphasizing that this is the held-resource record. */
  held?: AcquisitionRecord;
  acquisitionHolderId?: GraphId;
  heldById?: GraphId;
  acquisitionSource?: SourceCodeReference;
  heldSource?: SourceCodeReference;
  sourceLocations: DeadlockSourceLocations;
}

export interface DeadlockFinding extends DeadlockCycle {
  /** Stable id derived from the canonical cycle vertex sequence. */
  id: string;
  /** Canonical cycle vertex ids; the closing vertex is not repeated. */
  cycle: ElementaryCycle;
  cycleNodeIds: GraphId[];
  executionIds: GraphId[];
  /** Alternating Worker -> Resource -> Worker cycle path including closing node. */
  cycleNodes: GraphId[];
  offendingLines: OffendingLine[];
  explanation: string;

  /** Execution nodes are in the same order as `cycle`. */
  executionNodes: ExecutionNode[];
  executions: ExecutionNode[];
  nodes: ExecutionNode[];
  cycleNames: Array<string | undefined>;

  /** One deterministic wait edge for each cycle hop. */
  edges: WaitForEdge[];
  waitEdges: WaitForEdge[];
  /** All parallel edge candidates represented by the chain, de-duplicated. */
  allWaitEdges: WaitForEdge[];
  alternativeWaitEdges: WaitForEdge[];

  holdAndWaitChain: HoldAndWaitChainLink[];
  chain: HoldAndWaitChainLink[];
  holdAndWait: HoldAndWaitChainLink[];

  /** The complete SCC containing this cycle, when available. */
  stronglyConnectedComponent: GraphId[];
  component: GraphId[];
  waitSources: Array<SourceCodeReference | undefined>;
  acquisitionSources: Array<SourceCodeReference | undefined>;
  sourceLocations: DeadlockSourceLocations[];
}

interface AdjacencyEntry {
  target: GraphId;
  /** Sorted parallel edges between the same pair of executions. */
  edges: WaitForEdge[];
}

interface NormalizedGraph {
  executionNodes: ExecutionNode[];
  resourceNodes: ResourceNode[];
  acquisitions: AcquisitionRecord[];
  waitForEdges: WaitForEdge[];
  executionNodeById: Map<GraphId, ExecutionNode>;
  resourceNodeById: Map<GraphId, ResourceNode>;
  acquisitionByResource: Map<GraphId, AcquisitionRecord>;
  adjacency: Map<GraphId, AdjacencyEntry[]>;
  executionIds: GraphId[];
}

function cloneSource(
  source: SourceCodeReference | undefined,
): SourceCodeReference | undefined {
  return source ? { ...source } : undefined;
}

function cloneExecutionNode(node: ExecutionNode): ExecutionNode {
  return { ...node, source: cloneSource(node.source) };
}

function cloneResourceNode(node: ResourceNode): ResourceNode {
  return { ...node, source: cloneSource(node.source) };
}

function cloneAcquisition(acquisition: AcquisitionRecord): AcquisitionRecord {
  return { ...acquisition, source: cloneSource(acquisition.source) };
}

function cloneWaitForEdge(edge: WaitForEdge): WaitForEdge {
  return { ...edge, source: cloneSource(edge.source) };
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSources(
  left: SourceCodeReference | undefined,
  right: SourceCodeReference | undefined,
): number {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }

  return (
    compareStrings(left.file, right.file) ||
    compareNumbers(left.line, right.line) ||
    compareNumbers(left.column ?? 0, right.column ?? 0)
  );
}

function compareExecutionNodes(left: ExecutionNode, right: ExecutionNode): number {
  return (
    compareStrings(left.id, right.id) ||
    compareStrings(left.kind, right.kind) ||
    compareStrings(left.name, right.name) ||
    compareSources(left.source, right.source)
  );
}

function compareResourceNodes(left: ResourceNode, right: ResourceNode): number {
  return (
    compareStrings(left.id, right.id) ||
    compareStrings(left.kind, right.kind) ||
    compareStrings(left.name, right.name) ||
    compareSources(left.source, right.source)
  );
}

function compareAcquisitions(
  left: AcquisitionRecord,
  right: AcquisitionRecord,
): number {
  return (
    compareStrings(left.resourceId, right.resourceId) ||
    compareStrings(left.holderId, right.holderId) ||
    compareNumbers(left.acquiredAt, right.acquiredAt) ||
    compareSources(left.source, right.source)
  );
}

function compareWaitEdges(left: WaitForEdge, right: WaitForEdge): number {
  return (
    compareStrings(left.waiterId, right.waiterId) ||
    compareStrings(left.holderId, right.holderId) ||
    compareStrings(left.resourceId, right.resourceId) ||
    compareStrings(left.id, right.id) ||
    compareNumbers(left.observedAt, right.observedAt) ||
    compareSources(left.source, right.source)
  );
}

function isLockEventArray(graph: WaitForGraphInput): graph is readonly LockEvent[] {
  return Array.isArray(graph);
}

function isBuiltWaitForGraph(graph: WaitForGraphInput): graph is BuiltWaitForGraph {
  return (
    !Array.isArray(graph) &&
    !(graph instanceof WaitForGraph) &&
    'nodes' in graph &&
    'edges' in graph &&
    'hops' in graph
  );
}

function snapshotOf(graph: WaitForGraphInput): ReadonlyWaitForGraphSnapshot {
  if (isLockEventArray(graph)) {
    return buildWaitForGraph(graph);
  }
  if (graph instanceof WaitForGraph) {
    return graph.toJSON();
  }
  if (isBuiltWaitForGraph(graph) && !('executionNodes' in graph)) {
    return buildWaitForGraph(graph.events);
  }
  return graph as ReadonlyWaitForGraphSnapshot;
}

/**
 * Copy and index the graph. Sorting copies rather than graph-owned arrays keeps
 * detection side-effect free and makes all later traversals deterministic.
 */
function normalizeGraph(graph: WaitForGraphInput): NormalizedGraph {
  const snapshot = snapshotOf(graph);
  const executionNodes = snapshot.executionNodes
    .map(cloneExecutionNode)
    .sort(compareExecutionNodes);
  const resourceNodes = snapshot.resourceNodes
    .map(cloneResourceNode)
    .sort(compareResourceNodes);
  const acquisitions = snapshot.acquisitions
    .map(cloneAcquisition)
    .sort(compareAcquisitions);
  const waitForEdges = snapshot.waitForEdges
    .map(cloneWaitForEdge)
    .sort(compareWaitEdges);

  const executionNodeById = new Map<GraphId, ExecutionNode>();
  for (const node of executionNodes) {
    if (!executionNodeById.has(node.id)) {
      executionNodeById.set(node.id, node);
    }
  }

  const resourceNodeById = new Map<GraphId, ResourceNode>();
  for (const node of resourceNodes) {
    if (!resourceNodeById.has(node.id)) {
      resourceNodeById.set(node.id, node);
    }
  }

  const acquisitionByResource = new Map<GraphId, AcquisitionRecord>();
  for (const acquisition of acquisitions) {
    if (!acquisitionByResource.has(acquisition.resourceId)) {
      acquisitionByResource.set(acquisition.resourceId, acquisition);
    }
  }

  const executionIds = new Set<GraphId>(executionNodes.map((node) => node.id));
  const adjacency = new Map<GraphId, AdjacencyEntry[]>();
  for (const edge of waitForEdges) {
    // A snapshot may be hand-authored, so retain endpoints even if node records
    // are absent. This still lets the detector report the cycle with ids.
    executionIds.add(edge.waiterId);
    executionIds.add(edge.holderId);

    const outgoing = adjacency.get(edge.waiterId) ?? [];
    let entry = outgoing.find(({ target }) => target === edge.holderId);
    if (!entry) {
      entry = { target: edge.holderId, edges: [] };
      outgoing.push(entry);
    }
    entry.edges.push(edge);
    adjacency.set(edge.waiterId, outgoing);
  }

  for (const outgoing of adjacency.values()) {
    for (const entry of outgoing) {
      entry.edges.sort(compareWaitEdges);
    }
    outgoing.sort((left, right) => compareStrings(left.target, right.target));
  }

  const sortedExecutionIds = [...executionIds].sort(compareStrings);
  for (const executionId of sortedExecutionIds) {
    if (!adjacency.has(executionId)) {
      adjacency.set(executionId, []);
    }
  }

  return {
    executionNodes,
    resourceNodes,
    acquisitions,
    waitForEdges,
    executionNodeById,
    resourceNodeById,
    acquisitionByResource,
    adjacency,
    executionIds: sortedExecutionIds,
  };
}

function computeStronglyConnectedComponents(
  vertices: readonly GraphId[],
  adjacency: ReadonlyMap<GraphId, readonly AdjacencyEntry[]>,
  allowedVertices?: ReadonlySet<GraphId>,
): StronglyConnectedComponent[] {
  const activeVertices = vertices
    .filter((vertex) => !allowedVertices || allowedVertices.has(vertex))
    .slice()
    .sort(compareStrings);
  const activeSet = new Set(activeVertices);
  const indexByVertex = new Map<GraphId, number>();
  const lowLinkByVertex = new Map<GraphId, number>();
  const stack: GraphId[] = [];
  const onStack = new Set<GraphId>();
  const components: StronglyConnectedComponent[] = [];
  let nextIndex = 0;

  // Tarjan's algorithm assigns each vertex one DFS index and low-link value;
  // roots whose low-link equals their index close one complete SCC.
  const visit = (vertex: GraphId): void => {
    indexByVertex.set(vertex, nextIndex);
    lowLinkByVertex.set(vertex, nextIndex);
    nextIndex += 1;
    stack.push(vertex);
    onStack.add(vertex);

    for (const edge of adjacency.get(vertex) ?? []) {
      const target = edge.target;
      if (!activeSet.has(target)) {
        continue;
      }

      if (!indexByVertex.has(target)) {
        visit(target);
        lowLinkByVertex.set(
          vertex,
          Math.min(
            lowLinkByVertex.get(vertex) as number,
            lowLinkByVertex.get(target) as number,
          ),
        );
      } else if (onStack.has(target)) {
        lowLinkByVertex.set(
          vertex,
          Math.min(
            lowLinkByVertex.get(vertex) as number,
            indexByVertex.get(target) as number,
          ),
        );
      }
    }

    if (lowLinkByVertex.get(vertex) !== indexByVertex.get(vertex)) {
      return;
    }

    const component: GraphId[] = [];
    let member: GraphId | undefined;
    do {
      member = stack.pop();
      if (member === undefined) {
        break;
      }
      onStack.delete(member);
      component.push(member);
    } while (member !== vertex);

    component.sort(compareStrings);
    components.push(component);
  };

  for (const vertex of activeVertices) {
    if (!indexByVertex.has(vertex)) {
      visit(vertex);
    }
  }

  components.sort((left, right) => compareStrings(left[0] ?? '', right[0] ?? ''));
  return components;
}

function isCyclicComponent(
  component: readonly GraphId[],
  adjacency: ReadonlyMap<GraphId, readonly AdjacencyEntry[]>,
): boolean {
  if (component.length > 1) {
    return true;
  }
  const vertex = component[0];
  return (
    vertex !== undefined &&
    (adjacency.get(vertex) ?? []).some((edge) => edge.target === vertex)
  );
}

/**
 * Return every SCC, including acyclic singleton vertices. `detectDeadlocks`
 * filters those components to real cycles (self-loop or two-plus vertices).
 */
export function findStronglyConnectedComponents(
  graph: WaitForGraphInput,
): StronglyConnectedComponent[] {
  const normalized = normalizeGraph(graph);
  return computeStronglyConnectedComponents(
    normalized.executionIds,
    normalized.adjacency,
  );
}

/** Return only SCCs that can contain an actual directed cycle. */
export function findCyclicStronglyConnectedComponents(
  graph: WaitForGraphInput,
): StronglyConnectedComponent[] {
  const normalized = normalizeGraph(graph);
  return computeStronglyConnectedComponents(
    normalized.executionIds,
    normalized.adjacency,
  ).filter((component) => isCyclicComponent(component, normalized.adjacency));
}

function compareCycles(left: readonly GraphId[], right: readonly GraphId[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = compareStrings(left[index], right[index]);
    if (difference !== 0) {
      return difference;
    }
  }
  return compareNumbers(left.length, right.length);
}

function canonicalizeCycle(cycle: readonly GraphId[]): ElementaryCycle {
  if (cycle.length < 2) {
    return [...cycle];
  }

  let best = [...cycle];
  for (let offset = 1; offset < cycle.length; offset += 1) {
    const candidate = cycle
      .slice(offset)
      .concat(cycle.slice(0, offset));
    if (compareCycles(candidate, best) < 0) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Johnson's algorithm enumerates elementary cycles by repeatedly choosing the
 * least vertex in a cyclic SCC, then blocking/unblocking DFS paths from it.
 * Restricting each iteration to vertices at or after that start removes cycle
 * rotations without discarding a distinct directed cycle.
 */
export function findElementaryCycles(graph: WaitForGraphInput): ElementaryCycle[] {
  const normalized = normalizeGraph(graph);
  const vertices = normalized.executionIds;
  const cycles: ElementaryCycle[] = [];
  const seenCycles = new Set<string>();
  let minimumVertexIndex = 0;

  while (minimumVertexIndex < vertices.length) {
    const eligibleVertices = vertices.slice(minimumVertexIndex);
    const eligibleSet = new Set(eligibleVertices);
    const components = computeStronglyConnectedComponents(
      eligibleVertices,
      normalized.adjacency,
      eligibleSet,
    );
    const cyclicComponents = components.filter((component) =>
      isCyclicComponent(component, normalized.adjacency),
    );
    if (cyclicComponents.length === 0) {
      break;
    }

    const component = cyclicComponents[0];
    const start = component[0];
    if (start === undefined) {
      break;
    }
    const componentSet = new Set(component);
    const blocked = new Set<GraphId>();
    const blockedBy = new Map<GraphId, Set<GraphId>>();
    const path: GraphId[] = [];

    const unblock = (vertex: GraphId): void => {
      blocked.delete(vertex);
      const dependents = blockedBy.get(vertex);
      if (!dependents) {
        return;
      }
      blockedBy.delete(vertex);
      for (const dependent of [...dependents]) {
        if (blocked.has(dependent)) {
          unblock(dependent);
        }
      }
    };

    const circuit = (vertex: GraphId): boolean => {
      let foundCycle = false;
      path.push(vertex);
      blocked.add(vertex);

      for (const outgoing of normalized.adjacency.get(vertex) ?? []) {
        const target = outgoing.target;
        if (!componentSet.has(target)) {
          continue;
        }

        if (target === start) {
          const cycle = canonicalizeCycle(path);
          const key = JSON.stringify(cycle);
          if (!seenCycles.has(key)) {
            seenCycles.add(key);
            cycles.push(cycle);
          }
          foundCycle = true;
        } else if (!blocked.has(target) && circuit(target)) {
          foundCycle = true;
        }
      }

      if (foundCycle) {
        unblock(vertex);
      } else {
        for (const outgoing of normalized.adjacency.get(vertex) ?? []) {
          if (!componentSet.has(outgoing.target)) {
            continue;
          }
          const dependents = blockedBy.get(outgoing.target) ?? new Set<GraphId>();
          dependents.add(vertex);
          blockedBy.set(outgoing.target, dependents);
        }
      }

      path.pop();
      return foundCycle;
    };

    circuit(start);
    const startIndex = vertices.indexOf(start);
    minimumVertexIndex = startIndex < 0 ? vertices.length : startIndex + 1;
  }

  cycles.sort(compareCycles);
  return cycles.map((cycle) => [...cycle]);
}

function edgeEntryFor(
  normalized: NormalizedGraph,
  waiterId: GraphId,
  holderId: GraphId,
): AdjacencyEntry | undefined {
  return (normalized.adjacency.get(waiterId) ?? []).find(
    (entry) => entry.target === holderId,
  );
}

function cloneOptionalSource(source: SourceCodeReference | undefined):
  | SourceCodeReference
  | undefined {
  return cloneSource(source);
}

function buildChainLink(
  normalized: NormalizedGraph,
  waiterId: GraphId,
  holderId: GraphId,
): HoldAndWaitChainLink {
  const entry = edgeEntryFor(normalized, waiterId, holderId);
  // Every hop is produced from the adjacency built by the cycle algorithm.
  // Keep a defensive fallback for callers passing a malformed snapshot.
  const representative = entry?.edges[0] ?? {
    id: `${waiterId}->${holderId}`,
    waiterId,
    holderId,
    resourceId: '',
    observedAt: 0,
  };
  const waitEdges = (entry?.edges ?? [representative]).map(cloneWaitForEdge);
  const waitEdge = waitEdges[0];
  const acquisition = normalized.acquisitionByResource.get(waitEdge.resourceId);
  const waiter = normalized.executionNodeById.get(waiterId);
  const holder = normalized.executionNodeById.get(holderId);
  const resource = normalized.resourceNodeById.get(waitEdge.resourceId);
  const waitSource = cloneOptionalSource(waitEdge.source);
  const acquisitionSource = cloneOptionalSource(acquisition?.source);
  const acquisitionCopy = acquisition ? cloneAcquisition(acquisition) : undefined;

  return {
    waiterId,
    holderId,
    resourceId: waitEdge.resourceId,
    waiter: waiter ? cloneExecutionNode(waiter) : undefined,
    holder: holder ? cloneExecutionNode(holder) : undefined,
    resource: resource ? cloneResourceNode(resource) : undefined,
    waiterName: waiter?.name,
    holderName: holder?.name,
    resourceName: resource?.name,
    waitEdge,
    edge: waitEdge,
    waitEdges,
    waitSource,
    waitEdgeSource: cloneOptionalSource(waitEdge.source),
    acquisition: acquisitionCopy,
    held: acquisitionCopy ? cloneAcquisition(acquisitionCopy) : undefined,
    acquisitionHolderId: acquisition?.holderId,
    heldById: acquisition?.holderId ?? holderId,
    acquisitionSource,
    heldSource: cloneOptionalSource(acquisition?.source),
    sourceLocations: {
      wait: cloneOptionalSource(waitEdge.source),
      acquisition: cloneOptionalSource(acquisition?.source),
    },
  };
}

function edgeIdentity(edge: WaitForEdge): string {
  return JSON.stringify([
    edge.id,
    edge.waiterId,
    edge.holderId,
    edge.resourceId,
    edge.observedAt,
    edge.source,
  ]);
}

function buildFinding(
  normalized: NormalizedGraph,
  cycle: ElementaryCycle,
  component: StronglyConnectedComponent,
  builtGraph?: BuiltWaitForGraph,
): DeadlockFinding {
  const holdAndWaitChain = cycle.map((waiterId, index) =>
    buildChainLink(
      normalized,
      waiterId,
      cycle[(index + 1) % cycle.length],
    ),
  );
  const edges = holdAndWaitChain.map((link) => cloneWaitForEdge(link.waitEdge));
  const selectedEdgeIds = new Set(edges.map(edgeIdentity));
  const allWaitEdgesById = new Map<string, WaitForEdge>();
  for (const link of holdAndWaitChain) {
    for (const edge of link.waitEdges) {
      allWaitEdgesById.set(edgeIdentity(edge), cloneWaitForEdge(edge));
    }
  }
  const allWaitEdges = [...allWaitEdgesById.values()].sort(compareWaitEdges);
  const alternativeWaitEdges = allWaitEdges.filter(
    (edge) => !selectedEdgeIds.has(edgeIdentity(edge)),
  );
  const executionNodes = cycle
    .map((executionId) => normalized.executionNodeById.get(executionId))
    .filter((node): node is ExecutionNode => node !== undefined)
    .map(cloneExecutionNode);
  const cycleNames = cycle.map(
    (executionId) => normalized.executionNodeById.get(executionId)?.name,
  );
  const sourceLocations = holdAndWaitChain.map((link) => ({
    wait: cloneOptionalSource(link.waitSource),
    acquisition: cloneOptionalSource(link.acquisitionSource),
  }));
  const chain = holdAndWaitChain.map((link) => ({
    ...link,
    waitEdge: cloneWaitForEdge(link.waitEdge),
    edge: cloneWaitForEdge(link.edge),
    waitEdges: link.waitEdges.map(cloneWaitForEdge),
    waiter: link.waiter ? cloneExecutionNode(link.waiter) : undefined,
    holder: link.holder ? cloneExecutionNode(link.holder) : undefined,
    resource: link.resource ? cloneResourceNode(link.resource) : undefined,
    waitSource: cloneOptionalSource(link.waitSource),
    waitEdgeSource: cloneOptionalSource(link.waitEdgeSource),
    acquisition: link.acquisition
      ? cloneAcquisition(link.acquisition)
      : undefined,
    held: link.held ? cloneAcquisition(link.held) : undefined,
    acquisitionSource: cloneOptionalSource(link.acquisitionSource),
    heldSource: cloneOptionalSource(link.heldSource),
    sourceLocations: {
      wait: cloneOptionalSource(link.sourceLocations.wait),
      acquisition: cloneOptionalSource(link.sourceLocations.acquisition),
    },
  }));
  const executions = executionNodes.map(cloneExecutionNode);
  const nodes = executionNodes.map(cloneExecutionNode);

  const cycleNodes: GraphId[] = [];
  const offendingLines: OffendingLine[] = [];
  const seenOffending = new Set<string>();

  const pushOffending = (item: OffendingLine): void => {
    const key = `${item.file}:${item.line}:${item.workerId ?? ''}:${item.resourceId ?? ''}:${item.action ?? ''}`;
    if (!seenOffending.has(key)) {
      seenOffending.add(key);
      offendingLines.push(item);
    }
  };

  for (const link of chain) {
    cycleNodes.push(link.waiterId);
    if (link.resourceId) {
      cycleNodes.push(link.resourceId);
    }
    const matchingHop = builtGraph?.hops.find(
      (hop) =>
        hop.fromWorker === link.waiterId &&
        hop.toWorker === link.holderId &&
        hop.resourceId === link.resourceId,
    );
    if (matchingHop?.holdEvent) {
      pushOffending({
        file: matchingHop.holdEvent.file,
        line: matchingHop.holdEvent.line,
        snippet: matchingHop.holdEvent.codeSnippet,
        workerId: matchingHop.holdEvent.workerId,
        resourceId: matchingHop.holdEvent.resourceId,
        action: matchingHop.holdEvent.action,
      });
    } else if (link.acquisitionSource) {
      pushOffending({
        file: link.acquisitionSource.file,
        line: link.acquisitionSource.line,
        snippet: `${link.holderId} holds ${link.resourceId}`,
        workerId: link.holderId,
        resourceId: link.resourceId,
        action: 'ACQUIRE',
      });
    }

    if (matchingHop?.waitEvent) {
      pushOffending({
        file: matchingHop.waitEvent.file,
        line: matchingHop.waitEvent.line,
        snippet: matchingHop.waitEvent.codeSnippet,
        workerId: matchingHop.waitEvent.workerId,
        resourceId: matchingHop.waitEvent.resourceId,
        action: matchingHop.waitEvent.action,
      });
    } else if (link.waitSource) {
      pushOffending({
        file: link.waitSource.file,
        line: link.waitSource.line,
        snippet: `${link.waiterId} waits for ${link.resourceId} held by ${link.holderId}`,
        workerId: link.waiterId,
        resourceId: link.resourceId,
        action: 'WAIT',
      });
    }
  }
  if (cycle.length > 0) {
    cycleNodes.push(cycle[0]);
  }

  const explanation =
    `Tarjan's SCC & Johnson's cycle detector identified a circular wait across ${cycle.length} worker(s): ` +
    `${cycleNodes.join(' -> ')}.`;

  return {
    id: JSON.stringify(cycle),
    cycle: [...cycle],
    cycleNodeIds: [...cycle],
    executionIds: [...cycle],
    cycleNodes,
    offendingLines,
    explanation,
    executionNodes,
    executions,
    nodes,
    cycleNames,
    edges,
    waitEdges: edges.map(cloneWaitForEdge),
    allWaitEdges,
    alternativeWaitEdges,
    holdAndWaitChain: chain,
    chain: chain.map((link) => ({ ...link })),
    holdAndWait: chain.map((link) => ({ ...link })),
    stronglyConnectedComponent: [...component],
    component: [...component],
    waitSources: chain.map((link) => cloneOptionalSource(link.waitSource)),
    acquisitionSources: chain.map((link) =>
      cloneOptionalSource(link.acquisitionSource),
    ),
    sourceLocations,
  };
}

/**
 * Detect every simple directed deadlock cycle and attach its wait/hold source
 * evidence. The input graph is copied and is never mutated, except when a
 * BuiltWaitForGraph is passed, whose `inCycle` flags are updated in place.
 */
export function detectDeadlocks(graph: WaitForGraphInput): DeadlockFinding[] {
  const builtGraph = isLockEventArray(graph)
    ? buildWaitForGraph(graph)
    : isBuiltWaitForGraph(graph)
      ? graph
      : undefined;
  const effectiveInput = builtGraph && 'executionNodes' in builtGraph ? builtGraph : graph;
  const normalized = normalizeGraph(effectiveInput);
  const cycles = findElementaryCycles(effectiveInput);
  if (cycles.length === 0) {
    return [];
  }

  const components = computeStronglyConnectedComponents(
    normalized.executionIds,
    normalized.adjacency,
  );
  const findings = cycles
    .map((cycle) => {
      const component =
        components.find((candidate) =>
          cycle.every((vertex) => candidate.includes(vertex)),
        ) ?? cycle;
      return buildFinding(normalized, cycle, component, builtGraph);
    })
    .sort((left, right) => compareCycles(left.cycle, right.cycle));

  if (builtGraph && isBuiltWaitForGraph(graph)) {
    const cycleMemberIds = new Set<string>();
    const cycleHops = new Set<string>();
    for (const finding of findings) {
      for (const nodeId of finding.cycleNodes) {
        cycleMemberIds.add(nodeId);
      }
      for (const link of finding.holdAndWaitChain) {
        cycleHops.add(`WAIT:${link.waiterId}->${link.resourceId}`);
        cycleHops.add(`HOLD:${link.resourceId}->${link.holderId}`);
      }
    }
    for (const node of graph.nodes) {
      node.inCycle = cycleMemberIds.has(node.id);
    }
    for (const edge of graph.edges) {
      if (edge.relation === 'WAITS_FOR') {
        edge.inCycle = cycleHops.has(`WAIT:${edge.from}->${edge.to}`);
      } else if (edge.relation === 'HOLDS') {
        edge.inCycle = cycleHops.has(`HOLD:${edge.from}->${edge.to}`);
      }
    }
  }

  return findings;
}

/** Convenience wrapper for callers that prefer an object-oriented detector. */
export class DeadlockDetector {
  public constructor(private readonly graph: WaitForGraphInput) {}

  public detectDeadlocks(): DeadlockFinding[] {
    return detectDeadlocks(this.graph);
  }

  public detect(): DeadlockFinding[] {
    return this.detectDeadlocks();
  }

  public findStronglyConnectedComponents(): StronglyConnectedComponent[] {
    return findStronglyConnectedComponents(this.graph);
  }

  public findElementaryCycles(): ElementaryCycle[] {
    return findElementaryCycles(this.graph);
  }
}
