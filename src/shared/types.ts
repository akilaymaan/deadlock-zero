export type LockAction = 'ACQUIRE' | 'WAIT' | 'RELEASE' | 'READ' | 'WRITE';

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

export interface SimulationMetrics {
  workers: number;
  deadlocksTriggered: number;
  raceConditionsTriggered: number;
  throughputReqPerSec: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  successRatePct: number;
}

export interface ChaosBenchmarkResult {
  before: SimulationMetrics;
  after: SimulationMetrics;
  improvementFactor: number;
}

export interface RemediationPlan {
  strategy: string;
  brokenCode: string;
  patchedCode: string;
  unifiedDiff: string;
  runbookMarkdown: string;
}

export interface ScenarioPreset {
  id: string;
  title: string;
  category: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  description: string;
  events: LockEvent[];
  brokenCode: string;
  patchedCode: string;
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
