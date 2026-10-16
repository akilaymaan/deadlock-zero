export type LockAction = 'ACQUIRE' | 'WAIT' | 'RELEASE' | 'READ' | 'WRITE';

export const LOCK_ACTIONS: readonly LockAction[] = ['ACQUIRE', 'WAIT', 'RELEASE', 'READ', 'WRITE'];

export interface LockEvent {
  id: string;
  workerId: string;
  resourceId: string;
  action: LockAction;
  timestamp: number;
  vectorClock: Record<string, number>;
  file: string;
  line: number;
  codeSnippet: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type: 'WORKER' | 'RESOURCE';
  inCycle: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  relation: 'HOLDS' | 'WAITS_FOR';
  file: string;
  line: number;
  inCycle: boolean;
  resourceId?: string;
  codeSnippet?: string;
}

export interface OffendingLine {
  file: string;
  line: number;
  snippet: string;
  workerId?: string;
  resourceId?: string;
  action?: LockAction;
}

export interface DeadlockCycle {
  id?: string;
  cycle: string[];
  cycleNodes: string[];
  offendingLines: OffendingLine[];
  explanation: string;
}

export interface RaceConflict {
  resourceId: string;
  location?: string;
  workerA: string;
  workerB: string;
  eventA: LockEvent;
  eventB: LockEvent;
  vectorClockA: Record<string, number>;
  vectorClockB: Record<string, number>;
  explanation: string;
}

export interface StarvationAlert {
  resourceId: string;
  blockedWorkers: string[];
  totalWorkers: number;
  blockedRatio: number;
  file: string;
  line: number;
  explanation: string;
}

/** Parameters of one virtual-time simulation run. All durations are virtual milliseconds. */
export interface SimulationConfig {
  workers: number;
  requestsPerWorker: number;
  seed: number;
  lockTimeoutMs: number;
  deadlockDetectionMs: number;
  workMs: number;
  maxVirtualMs: number;
}

export interface SimulationMetrics {
  /** True when the run hit its virtual-time or CPU budget before every request finished. */
  truncated: boolean;
  workers: number;
  totalRequests: number;
  completedRequests: number;
  failedRequests: number;
  /** Deadlock cycles detected and broken by aborting a victim request. */
  deadlocksTriggered: number;
  /** Unsynchronized conflicting accesses (at least one write) between in-flight requests. */
  raceConditionsTriggered: number;
  lockTimeouts: number;
  /** Requests still in flight when the virtual time budget ran out. */
  unfinishedRequests: number;
  throughputReqPerSec: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  successRatePct: number;
  virtualDurationMs: number;
}

export interface ChaosBenchmarkResult {
  config: SimulationConfig;
  canonicalLockOrder: string[];
  before: SimulationMetrics;
  after: SimulationMetrics;
  /** after.throughput / before.throughput, or null when the unpatched run completed nothing. */
  improvementFactor: number | null;
}

export type RemediationStrategy =
  | 'canonical-lock-order'
  | 'guard-shared-state'
  | 'shorten-lock-hold-time'
  | 'none-required';

/**
 * Generated remediation guidance. `patchedCode` is a suggested template derived from the
 * trace, not a verified patch of the user's real source tree.
 */
export interface RemediationPlan {
  strategy: RemediationStrategy;
  rationale: string;
  canonicalLockOrder: string[];
  sourceFile: string;
  brokenCode: string;
  patchedCode: string;
  unifiedDiff: string;
  runbookMarkdown: string;
  generated: true;
}

export interface WaitForAdjacencyHop {
  fromWorker: string;
  toWorker: string;
  resourceId: string;
  waitEvent: LockEvent;
  holdEvent?: LockEvent;
}

export interface BuiltWaitForGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  adjacency: Record<string, string[]>;
  hops: WaitForAdjacencyHop[];
  events: LockEvent[];
}
