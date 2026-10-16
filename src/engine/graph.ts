import type {
  BuiltWaitForGraph,
  GraphEdge,
  GraphNode,
  LockEvent,
  WaitForAdjacencyHop,
} from '../shared/types';

export type {
  BuiltWaitForGraph,
  GraphEdge,
  GraphNode,
  LockEvent,
  WaitForAdjacencyHop,
} from '../shared/types';

export type GraphId = string;
export type AcquisitionTimestamp = number;

export interface SourceCodeReference {
  file: string;
  line: number;
  column?: number;
}

export type SourceLocation = SourceCodeReference;

interface BaseExecutionNode {
  id: GraphId;
  name: string;
  source?: SourceCodeReference;
}

export interface ThreadNode extends BaseExecutionNode {
  kind: 'thread';
  serviceId?: GraphId;
}

export interface ServiceNode extends BaseExecutionNode {
  kind: 'service';
}

export type ExecutionNode = ThreadNode | ServiceNode;

interface BaseResourceNode {
  id: GraphId;
  name: string;
  source?: SourceCodeReference;
}

export interface LockNode extends BaseResourceNode {
  kind: 'lock';
}

export interface GenericResourceNode extends BaseResourceNode {
  kind: 'resource';
}

export type ResourceNode = LockNode | GenericResourceNode;

export interface AcquisitionRecord {
  resourceId: GraphId;
  holderId: GraphId;
  acquiredAt: AcquisitionTimestamp;
  source?: SourceCodeReference;
}

export type Acquisition = AcquisitionRecord;

export interface WaitForEdge {
  id: GraphId;
  waiterId: GraphId;
  holderId: GraphId;
  resourceId: GraphId;
  observedAt: AcquisitionTimestamp;
  source?: SourceCodeReference;
}

export type WaitDependency = WaitForEdge;

export type ThreadNodeInput = Omit<ThreadNode, 'kind'>;
export type ServiceNodeInput = Omit<ServiceNode, 'kind'>;
export type LockNodeInput = Omit<LockNode, 'kind'>;
export type ResourceNodeInput = Omit<GenericResourceNode, 'kind'>;
export type WaitForEdgeInput = Omit<WaitForEdge, 'id'> & { id?: GraphId };

export interface WaitForGraphSnapshot {
  executionNodes: ExecutionNode[];
  resourceNodes: ResourceNode[];
  acquisitions: AcquisitionRecord[];
  waitForEdges: WaitForEdge[];
}

function assertNonEmpty(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must not be empty`);
  }
}

function validateTimestamp(timestamp: number, fieldName: string): void {
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new Error(`${fieldName} must be a non-negative finite number`);
  }
}

function cloneSource(source?: SourceCodeReference): SourceCodeReference | undefined {
  if (!source) {
    return undefined;
  }

  return { ...source };
}

function validateSource(source?: SourceCodeReference): void {
  if (!source) {
    return;
  }

  assertNonEmpty(source.file, 'source.file');
  if (!Number.isInteger(source.line) || source.line < 1) {
    throw new Error('source.line must be a positive integer');
  }
  if (
    source.column !== undefined &&
    (!Number.isInteger(source.column) || source.column < 1)
  ) {
    throw new Error('source.column must be a positive integer');
  }
}

function cloneExecutionNode<T extends ExecutionNode>(node: T): T {
  return { ...node, source: cloneSource(node.source) } as T;
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

/**
 * In-memory representation of the execution/resource relationships needed to
 * investigate a distributed deadlock. Resources retain their current holder,
 * while wait-for edges connect a blocked execution to the holder it depends on.
 */
export class WaitForGraph {
  private readonly executionNodes = new Map<GraphId, ExecutionNode>();
  private readonly resourceNodes = new Map<GraphId, ResourceNode>();
  private readonly acquisitionsByResource = new Map<GraphId, AcquisitionRecord>();
  private readonly waitForEdges = new Map<GraphId, WaitForEdge>();

  addExecutionNode(node: ExecutionNode): this {
    this.validateNode(node);
    this.assertIdAvailable(node.id);
    this.executionNodes.set(node.id, cloneExecutionNode(node));
    return this;
  }

  addThread(node: ThreadNodeInput): this {
    return this.addExecutionNode({ ...node, kind: 'thread' });
  }

  addService(node: ServiceNodeInput): this {
    return this.addExecutionNode({ ...node, kind: 'service' });
  }

  addResourceNode(node: ResourceNode): this {
    this.validateNode(node);
    this.assertIdAvailable(node.id);
    this.resourceNodes.set(node.id, cloneResourceNode(node));
    return this;
  }

  addLock(node: LockNodeInput): this {
    return this.addResourceNode({ ...node, kind: 'lock' });
  }

  addResource(node: ResourceNodeInput): this {
    return this.addResourceNode({ ...node, kind: 'resource' });
  }

  /** Record or replace the current holder of a resource. */
  recordAcquisition(acquisition: AcquisitionRecord): this {
    this.requireExecution(acquisition.holderId);
    this.requireResource(acquisition.resourceId);
    validateTimestamp(acquisition.acquiredAt, 'acquiredAt');
    validateSource(acquisition.source);
    this.acquisitionsByResource.set(
      acquisition.resourceId,
      cloneAcquisition(acquisition),
    );
    return this;
  }

  addWaitForEdge(edge: WaitForEdgeInput): this {
    this.requireExecution(edge.waiterId);
    this.requireExecution(edge.holderId);
    this.requireResource(edge.resourceId);
    validateTimestamp(edge.observedAt, 'observedAt');
    validateSource(edge.source);

    const id = edge.id ?? `${edge.waiterId}->${edge.holderId}:${edge.resourceId}`;
    assertNonEmpty(id, 'edge.id');
    if (this.waitForEdges.has(id)) {
      throw new Error(`A wait-for edge with id "${id}" already exists`);
    }

    this.waitForEdges.set(id, cloneWaitForEdge({ ...edge, id }));
    return this;
  }

  addWaitFor(edge: WaitForEdgeInput): this {
    return this.addWaitForEdge(edge);
  }

  getExecutionNode(id: GraphId): ExecutionNode | undefined {
    const node = this.executionNodes.get(id);
    return node ? cloneExecutionNode(node) : undefined;
  }

  getThread(id: GraphId): ThreadNode | undefined {
    const node = this.executionNodes.get(id);
    return node?.kind === 'thread' ? cloneExecutionNode(node) : undefined;
  }

  getService(id: GraphId): ServiceNode | undefined {
    const node = this.executionNodes.get(id);
    return node?.kind === 'service' ? cloneExecutionNode(node) : undefined;
  }

  getResourceNode(id: GraphId): ResourceNode | undefined {
    const node = this.resourceNodes.get(id);
    return node ? cloneResourceNode(node) : undefined;
  }

  getAcquisition(resourceId: GraphId): AcquisitionRecord | undefined {
    const acquisition = this.acquisitionsByResource.get(resourceId);
    return acquisition ? cloneAcquisition(acquisition) : undefined;
  }

  getCurrentHolder(resourceId: GraphId): GraphId | undefined {
    return this.acquisitionsByResource.get(resourceId)?.holderId;
  }

  getWaitForEdge(id: GraphId): WaitForEdge | undefined {
    const edge = this.waitForEdges.get(id);
    return edge ? cloneWaitForEdge(edge) : undefined;
  }

  getExecutionNodes(): ExecutionNode[] {
    return [...this.executionNodes.values()].map(cloneExecutionNode);
  }

  getResourceNodes(): ResourceNode[] {
    return [...this.resourceNodes.values()].map(cloneResourceNode);
  }

  getAcquisitions(): AcquisitionRecord[] {
    return [...this.acquisitionsByResource.values()].map(cloneAcquisition);
  }

  getWaitForEdges(): WaitForEdge[] {
    return [...this.waitForEdges.values()].map(cloneWaitForEdge);
  }

  getWaitForEdgesFrom(waiterId: GraphId): WaitForEdge[] {
    return this.getWaitForEdges().filter((edge) => edge.waiterId === waiterId);
  }

  toJSON(): WaitForGraphSnapshot {
    return {
      executionNodes: this.getExecutionNodes(),
      resourceNodes: this.getResourceNodes(),
      acquisitions: this.getAcquisitions(),
      waitForEdges: this.getWaitForEdges(),
    };
  }

  private validateNode(node: ExecutionNode | ResourceNode): void {
    assertNonEmpty(node.id, 'node.id');
    assertNonEmpty(node.name, 'node.name');
    validateSource(node.source);
  }

  private assertIdAvailable(id: GraphId): void {
    if (this.executionNodes.has(id) || this.resourceNodes.has(id)) {
      throw new Error(`A graph node with id "${id}" already exists`);
    }
  }

  private requireExecution(id: GraphId): void {
    if (!this.executionNodes.has(id)) {
      throw new Error(`Unknown execution node "${id}"`);
    }
  }

  private requireResource(id: GraphId): void {
    if (!this.resourceNodes.has(id)) {
      throw new Error(`Unknown resource node "${id}"`);
    }
  }
}

export interface WaitForGraphBuildResult extends BuiltWaitForGraph, WaitForGraphSnapshot {}

/**
 * Build a Wait-For Graph (WFG) from a sequence of LockEvent records.
 * Produces GraphNode[], GraphEdge[] (HOLDS and WAITS_FOR), and worker-to-worker
 * Wait-For adjacency lists alongside a WaitForGraphSnapshot.
 */
export function buildWaitForGraph(events: readonly LockEvent[]): WaitForGraphBuildResult {
  const workerSet = new Set<string>();
  const resourceSet = new Set<string>();
  const currentHolderByResource = new Map<string, LockEvent>();
  const activeWaits: LockEvent[] = [];

  for (const event of events) {
    if (event.workerId) workerSet.add(event.workerId);
    if (event.resourceId && (event.action === 'ACQUIRE' || event.action === 'WAIT' || event.action === 'RELEASE')) {
      resourceSet.add(event.resourceId);
    }

    if (event.action === 'ACQUIRE') {
      currentHolderByResource.set(event.resourceId, event);
      // If this worker was previously waiting on this resource, clear that wait
      for (let i = activeWaits.length - 1; i >= 0; i -= 1) {
        if (activeWaits[i].workerId === event.workerId && activeWaits[i].resourceId === event.resourceId) {
          activeWaits.splice(i, 1);
        }
      }
    } else if (event.action === 'RELEASE') {
      const holder = currentHolderByResource.get(event.resourceId);
      if (!holder || holder.workerId === event.workerId) {
        currentHolderByResource.delete(event.resourceId);
      }
    } else if (event.action === 'WAIT') {
      activeWaits.push(event);
    }
  }

  // Ensure any resource referenced only in READ/WRITE is also represented if no lock events exist
  if (resourceSet.size === 0) {
    for (const event of events) {
      if (event.resourceId) resourceSet.add(event.resourceId);
    }
  }

  const nodes: GraphNode[] = [
    ...[...workerSet].map(
      (id): GraphNode => ({
        id,
        label: id,
        type: 'WORKER',
        inCycle: false,
      }),
    ),
    ...[...resourceSet].map(
      (id): GraphNode => ({
        id,
        label: id,
        type: 'RESOURCE',
        inCycle: false,
      }),
    ),
  ];

  const edges: GraphEdge[] = [];
  for (const [resourceId, holdEvent] of currentHolderByResource.entries()) {
    edges.push({
      from: resourceId,
      to: holdEvent.workerId,
      relation: 'HOLDS',
      file: holdEvent.file,
      line: holdEvent.line,
      inCycle: false,
      resourceId,
      codeSnippet: holdEvent.codeSnippet,
    });
  }

  const adjacency: Record<string, string[]> = {};
  for (const workerId of workerSet) {
    adjacency[workerId] = [];
  }

  const hops: WaitForAdjacencyHop[] = [];
  const wfg = new WaitForGraph();
  for (const workerId of workerSet) {
    wfg.addThread({ id: workerId, name: workerId });
  }
  for (const resourceId of resourceSet) {
    wfg.addLock({ id: resourceId, name: resourceId });
  }
  for (const [resourceId, holdEvent] of currentHolderByResource.entries()) {
    wfg.recordAcquisition({
      resourceId,
      holderId: holdEvent.workerId,
      acquiredAt: Math.max(0, holdEvent.timestamp),
      source: holdEvent.file && holdEvent.line >= 1 ? { file: holdEvent.file, line: holdEvent.line } : undefined,
    });
  }

  let waitIdx = 0;
  for (const waitEvent of activeWaits) {
    edges.push({
      from: waitEvent.workerId,
      to: waitEvent.resourceId,
      relation: 'WAITS_FOR',
      file: waitEvent.file,
      line: waitEvent.line,
      inCycle: false,
      resourceId: waitEvent.resourceId,
      codeSnippet: waitEvent.codeSnippet,
    });

    const holdEvent = currentHolderByResource.get(waitEvent.resourceId);
    if (holdEvent && holdEvent.workerId !== waitEvent.workerId) {
      const list = adjacency[waitEvent.workerId] ?? [];
      if (!list.includes(holdEvent.workerId)) {
        list.push(holdEvent.workerId);
      }
      adjacency[waitEvent.workerId] = list;
      hops.push({
        fromWorker: waitEvent.workerId,
        toWorker: holdEvent.workerId,
        resourceId: waitEvent.resourceId,
        waitEvent,
        holdEvent,
      });

      wfg.addWaitForEdge({
        id: `${waitEvent.id || 'wait'}-${waitIdx++}:${waitEvent.workerId}->${holdEvent.workerId}:${waitEvent.resourceId}`,
        waiterId: waitEvent.workerId,
        holderId: holdEvent.workerId,
        resourceId: waitEvent.resourceId,
        observedAt: Math.max(0, waitEvent.timestamp),
        source: waitEvent.file && waitEvent.line >= 1 ? { file: waitEvent.file, line: waitEvent.line } : undefined,
      });
    }
  }

  const snapshot = wfg.toJSON();
  return {
    nodes,
    edges,
    adjacency,
    hops,
    events: [...events],
    ...snapshot,
  };
}

