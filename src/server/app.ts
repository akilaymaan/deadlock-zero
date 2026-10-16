import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectDeadlocks,
  type DeadlockFinding,
} from '../engine/deadlockDetector';
import {
  WaitForGraph,
  type ExecutionNode,
  type ResourceNode,
  type SourceCodeReference,
  type WaitForGraphSnapshot,
} from '../engine/graph';
import {
  analyzeRaceTrace,
  type RaceAnalysis,
  type RaceAnalysisInput,
} from '../engine/raceDetector';
import {
  remediateScenario,
  type RemediationResult,
} from '../engine/remediator';
import {
  DEFAULT_WORKER_COUNT,
  simulateScenario,
  type SimulationResult,
} from '../engine/simulator';
import {
  getScenarioPreset,
  INCIDENT_PRESETS,
  type IncidentScenario,
} from '../scenarios/presets';

const SERVER_VERSION = '0.1.0';
const JSON_BODY_LIMIT = '2mb';

type JsonRecord = Record<string, unknown>;
type TraceOperation =
  | 'acquire'
  | 'release'
  | 'wait'
  | 'access'
  | 'fork'
  | 'join'
  | 'sync'
  | 'pool'
  | undefined;

export interface ServerOptions {
  /** Override the frontend build directory, primarily useful for integration tests. */
  readonly staticDir?: string;
}

export interface StartServerOptions extends ServerOptions {
  readonly port?: number;
  readonly host?: string;
}

interface ParsedTraceEvent {
  readonly operation: Exclude<TraceOperation, undefined>;
  readonly threadId?: string;
  readonly holderId?: string;
  readonly resourceId?: string;
  readonly eventId: string;
  readonly observedAt: number;
  readonly source?: SourceCodeReference;
  readonly raw: JsonRecord;
}

interface AnalysisSource {
  readonly kind: 'preset' | 'custom';
  readonly scenarioId: string;
  readonly scenarioName: string;
}

interface AnalysisResponse {
  readonly source: AnalysisSource;
  readonly scenario: unknown;
  readonly graph: WaitForGraphSnapshot & {
    readonly nodes: readonly (ExecutionNode | ResourceNode)[];
    readonly edges: WaitForGraphSnapshot['waitForEdges'];
  };
  readonly nodes: readonly (ExecutionNode | ResourceNode)[];
  readonly edges: WaitForGraphSnapshot['waitForEdges'];
  readonly deadlocks: readonly DeadlockFinding[];
  readonly detectedCycles: readonly (readonly string[])[];
  readonly cycles: readonly (readonly string[])[];
  readonly raceAnalysis: RaceAnalysis;
  readonly races: RaceAnalysis['races'];
  readonly dataRaces: RaceAnalysis['dataRaces'];
  readonly poolStarvation: RaceAnalysis['poolStarvation'];
  readonly offendingCodeLines: readonly SourceCodeReference[];
  readonly offendingLines: readonly SourceCodeReference[];
  readonly patch: string;
  readonly patchDiff: string;
  readonly diff: string;
  readonly remediation: RemediationResult;
  readonly incidentChecklist: string;
  readonly checklist: string;
  readonly runbook: string;
}

interface BenchmarkComparison {
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly workerCount: number;
  readonly workers: number;
  readonly before: SimulationResult;
  readonly after: SimulationResult;
  readonly comparison: {
    readonly throughputRps: MetricComparison;
    readonly latencyMs: {
      readonly p50: MetricComparison;
      readonly p95: MetricComparison;
      readonly p99: MetricComparison;
    };
    readonly deadlocks: MetricComparison;
    readonly droppedRequests: MetricComparison;
  };
  readonly metrics: BenchmarkComparison['comparison'];
}

interface MetricComparison {
  readonly before: number;
  readonly after: number;
  readonly delta: number;
  readonly improvementFactor: number | null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstDefined(record: JsonRecord, names: readonly string[]): unknown {
  for (const name of names) {
    if (record[name] !== undefined) return record[name];
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function identifierValue(value: unknown): string | undefined {
  if (isRecord(value)) {
    return stringValue(firstDefined(value, ['id', 'name', 'key', 'label', 'threadId', 'resourceId']));
  }
  return stringValue(value);
}

function requiredIdentifier(record: JsonRecord, names: readonly string[], context: string): string {
  const value = identifierValue(firstDefined(record, names));
  if (value === undefined) throw new Error(`${context} is required`);
  return value;
}

function normalizeToken(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s_-]+/g, '') : '';
}

function sourceFromRecord(record: JsonRecord, context: string): SourceCodeReference | undefined {
  const sourceValue = firstDefined(record, ['source', 'sourceLocation']);
  if (sourceValue !== undefined) {
    if (!isRecord(sourceValue)) throw new Error(`${context}.source must be an object`);
    const file = stringValue(sourceValue.file);
    const line = sourceValue.line;
    const column = sourceValue.column;
    if (file === undefined || !Number.isInteger(line) || (line as number) < 1) {
      throw new Error(`${context}.source requires a file and positive line`);
    }
    if (column !== undefined && (!Number.isInteger(column) || (column as number) < 1)) {
      throw new Error(`${context}.source.column must be a positive integer`);
    }
    return {
      file,
      line: line as number,
      ...(column === undefined ? {} : { column: column as number }),
    };
  }

  const file = stringValue(firstDefined(record, ['file', 'sourceFile']));
  const line = firstDefined(record, ['line', 'sourceLine']);
  const column = firstDefined(record, ['column', 'sourceColumn']);
  if (file === undefined && line === undefined && column === undefined) return undefined;
  if (file === undefined || !Number.isInteger(line) || (line as number) < 1) {
    throw new Error(`${context} requires a file and positive line`);
  }
  if (column !== undefined && (!Number.isInteger(column) || (column as number) < 1)) {
    throw new Error(`${context}.column must be a positive integer`);
  }
  return {
    file,
    line: line as number,
    ...(column === undefined ? {} : { column: column as number }),
  };
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function eventTimestamp(record: JsonRecord, index: number): number {
  return numberValue(
    firstDefined(record, ['observedAt', 'timestamp', 'time', 'logicalTimestamp', 'logicalTime']),
    index,
  );
}

function eventIdentifier(record: JsonRecord, index: number): string {
  return identifierValue(firstDefined(record, ['id', 'eventId', 'name'])) ?? String(index);
}

function operationForRecord(record: JsonRecord): TraceOperation {
  const mode = normalizeToken(
    firstDefined(record, ['mode', 'access', 'accessType', 'operation', 'op', 'kind', 'type']),
  );
  if (mode === 'read' || mode === 'write' || mode === 'load' || mode === 'store') return 'access';

  const candidates = [
    firstDefined(record, ['event', 'eventType', 'kind', 'type', 'action', 'operation', 'op']),
  ];
  for (const candidate of candidates) {
    const token = normalizeToken(candidate);
    if (
      [
        'acquire',
        'lockacquire',
        'acquired',
        'lockacquired',
        'acquiredlock',
        'lockacquisition',
        'hold',
        'lockhold',
        'lockheld',
      ].includes(token)
    ) {
      return 'acquire';
    }
    if (['release', 'lockrelease', 'released', 'lockreleased', 'unlock', 'unlocked'].includes(token)) {
      return 'release';
    }
    if (
      [
        'wait',
        'waitfor',
        'lockwait',
        'waiting',
        'waitingfor',
        'blocked',
        'lockblocked',
        'lockrequest',
        'request',
        'contended',
      ].includes(token)
    ) {
      return 'wait';
    }
    if (['fork', 'spawn'].includes(token)) return 'fork';
    if (token === 'join') return 'join';
    if (['sync', 'synchronize', 'happensbefore', 'hb', 'barrier'].includes(token)) return 'sync';
    if (['pool', 'poolsample', 'connectionpool', 'connectionpoolsample'].includes(token)) return 'pool';
  }

  if (
    firstDefined(record, ['location', 'address', 'resourceKey', 'memoryAddress']) !== undefined &&
    firstDefined(record, ['mode', 'access', 'accessType', 'operation', 'op', 'kind', 'type']) !== undefined
  ) {
    return 'access';
  }
  if (
    firstDefined(record, ['capacity']) !== undefined &&
    firstDefined(record, ['inUse', 'used', 'active']) !== undefined
  ) {
    return 'pool';
  }
  return undefined;
}

function parseLogLine(line: string, index: number): JsonRecord | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    // A production log often has one lock event per line rather than JSON.
  }

  const actionMatch = trimmed.match(/\b(acquire|acquired|release|released|unlock|wait|waiting|blocked|request|contended)\b/i);
  if (!actionMatch) return undefined;
  const action = actionMatch[1].toLowerCase();
  const threadMatch = trimmed.match(/\b(?:thread|worker|execution|tid)\s*[=:]\s*([\w.:-]+)/i);
  const resourceMatch = trimmed.match(/\b(?:lock|mutex|resource|key)\s*[=:]\s*([\w.:-]+)/i);
  const holderMatch = trimmed.match(/\b(?:holder|owner|heldby|held-by|by)\s*[=:]\s*([\w.:-]+)/i);
  const timestampMatch = trimmed.match(/^\[?(\d+(?:\.\d+)?)\]?/);
  const sourceMatch = trimmed.match(/([\w./\\-]+\.(?:ts|tsx|js|jsx|java|go|py)):(\d+)/i);
  const event: JsonRecord = {
    id: `log-${index}`,
    kind: action,
    ...(threadMatch ? { threadId: threadMatch[1] } : {}),
    ...(resourceMatch ? { lockId: resourceMatch[1] } : {}),
    ...(holderMatch ? { holderId: holderMatch[1] } : {}),
    ...(timestampMatch ? { observedAt: Number(timestampMatch[1]) } : {}),
    ...(sourceMatch
      ? { source: { file: sourceMatch[1], line: Number(sourceMatch[2]) } }
      : {}),
  };
  return event;
}

function parseSerializedTrace(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed.length === 0) return [];
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed
      .split(/\r?\n/)
      .map((line, index) => parseLogLine(line, index))
      .filter((event): event is JsonRecord => event !== undefined);
  }
}

function arrayValue(record: JsonRecord, names: readonly string[]): readonly unknown[] | undefined {
  const value = firstDefined(record, names);
  return Array.isArray(value) ? value : undefined;
}

function eventListFrom(value: unknown): unknown[] {
  const parsed = parseSerializedTrace(value);
  if (Array.isArray(parsed)) return [...parsed];
  if (!isRecord(parsed)) return [];

  const result: unknown[] = [];
  const seen = new Set<readonly unknown[]>();
  const append = (names: readonly string[]): void => {
    const events = arrayValue(parsed, names);
    if (events === undefined || seen.has(events)) return;
    seen.add(events);
    result.push(...events);
  };
  append(['events', 'traceEvents']);
  append(['lockEvents', 'lockTrace', 'logs']);
  append(['accesses', 'memoryAccesses']);
  append(['synchronization', 'synchronizationEvents', 'syncEvents']);
  append(['poolSamples', 'poolEvents']);
  if (result.length === 0) result.push(parsed);
  return result;
}

function graphCandidateFromBody(body: unknown): unknown | undefined {
  if (!isRecord(body)) return undefined;
  const explicit = firstDefined(body, ['graph', 'waitForGraph', 'graphSnapshot']);
  if (explicit !== undefined) return explicit;
  if (isGraphSnapshotLike(body)) return body;
  const trace = firstDefined(body, ['trace', 'logTrace', 'lockEventTrace', 'events', 'lockEvents']);
  return isGraphSnapshotLike(trace) ? trace : undefined;
}

function isGraphSnapshotLike(value: unknown): value is JsonRecord {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.executionNodes) ||
    Array.isArray(value.resourceNodes) ||
    Array.isArray(value.acquisitions) ||
    Array.isArray(value.waitForEdges) ||
    (Array.isArray(value.nodes) && Array.isArray(value.edges))
  );
}

function normalizeNodeName(record: JsonRecord, id: string): string {
  return stringValue(firstDefined(record, ['name', 'label', 'title'])) ?? id;
}

function addExecutionDefinition(
  definitions: Map<string, ExecutionNode>,
  raw: unknown,
  index: number,
): void {
  if (!isRecord(raw)) throw new Error(`execution node ${index} must be an object`);
  const id = requiredIdentifier(raw, ['id', 'threadId', 'executionId', 'serviceId'], `execution node ${index}.id`);
  const kind = normalizeToken(firstDefined(raw, ['kind', 'type']));
  const source = sourceFromRecord(raw, `execution node ${index}`);
  if (kind === 'service') {
    definitions.set(id, {
      id,
      name: normalizeNodeName(raw, id),
      kind: 'service',
      ...(source ? { source } : {}),
    });
    return;
  }
  const serviceId = identifierValue(firstDefined(raw, ['serviceId', 'service']));
  definitions.set(id, {
    id,
    name: normalizeNodeName(raw, id),
    kind: 'thread',
    ...(serviceId ? { serviceId } : {}),
    ...(source ? { source } : {}),
  });
}

function addResourceDefinition(
  definitions: Map<string, ResourceNode>,
  raw: unknown,
  index: number,
): void {
  if (!isRecord(raw)) throw new Error(`resource node ${index} must be an object`);
  const id = requiredIdentifier(raw, ['id', 'resourceId', 'lockId', 'name'], `resource node ${index}.id`);
  const kind = normalizeToken(firstDefined(raw, ['kind', 'type']));
  const source = sourceFromRecord(raw, `resource node ${index}`);
  const isLock = kind.includes('lock') || kind.includes('mutex') || kind === 'rwlock';
  definitions.set(id, {
    id,
    name: normalizeNodeName(raw, id),
    kind: isLock ? 'lock' : 'resource',
    ...(source ? { source } : {}),
  });
}

function snapshotFromGraphCandidate(candidate: unknown): WaitForGraphSnapshot {
  if (!isRecord(candidate)) throw new Error('graph must be an object');

  const executionDefinitions = new Map<string, ExecutionNode>();
  const resourceDefinitions = new Map<string, ResourceNode>();
  const nodeList = arrayValue(candidate, ['nodes']) ?? [];
  const executionList = arrayValue(candidate, ['executionNodes', 'executions', 'threads', 'services']) ?? [];
  const resourceList = arrayValue(candidate, ['resourceNodes', 'resources', 'locks']) ?? [];

  for (let index = 0; index < executionList.length; index += 1) {
    addExecutionDefinition(executionDefinitions, executionList[index], index);
  }
  for (let index = 0; index < resourceList.length; index += 1) {
    addResourceDefinition(resourceDefinitions, resourceList[index], index);
  }
  for (let index = 0; index < nodeList.length; index += 1) {
    const node = nodeList[index];
    if (!isRecord(node)) throw new Error(`graph node ${index} must be an object`);
    const kind = normalizeToken(firstDefined(node, ['kind', 'type']));
    if (kind.includes('lock') || kind.includes('mutex') || kind === 'resource' || kind === 'rwlock') {
      addResourceDefinition(resourceDefinitions, node, index);
    } else {
      addExecutionDefinition(executionDefinitions, node, index);
    }
  }

  const acquisitions = arrayValue(candidate, ['acquisitions', 'heldResources', 'holds']) ?? [];
  const edges = arrayValue(candidate, ['waitForEdges', 'waits', 'edges']) ?? [];

  const ensureExecution = (id: string): void => {
    if (!executionDefinitions.has(id)) {
      executionDefinitions.set(id, { id, name: id, kind: 'thread' });
    }
  };
  const ensureResource = (id: string): void => {
    if (!resourceDefinitions.has(id)) {
      resourceDefinitions.set(id, { id, name: id, kind: 'lock' });
    }
  };

  const normalizedAcquisitions = acquisitions.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`acquisition ${index} must be an object`);
    const resourceId = requiredIdentifier(raw, ['resourceId', 'lockId', 'resource', 'lock'], `acquisition ${index}.resourceId`);
    const holderId = requiredIdentifier(raw, ['holderId', 'ownerId', 'threadId', 'executionId', 'holder'], `acquisition ${index}.holderId`);
    ensureResource(resourceId);
    ensureExecution(holderId);
    const source = sourceFromRecord(raw, `acquisition ${index}`);
    return {
      resourceId,
      holderId,
      acquiredAt: eventTimestamp(raw, index),
      ...(source ? { source } : {}),
    };
  });

  const normalizedEdges = edges.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`wait-for edge ${index} must be an object`);
    const waiterId = requiredIdentifier(raw, ['waiterId', 'waiter', 'threadId', 'executionId'], `wait-for edge ${index}.waiterId`);
    const holderId = requiredIdentifier(raw, ['holderId', 'holder', 'ownerId', 'owner'], `wait-for edge ${index}.holderId`);
    const resourceId = requiredIdentifier(raw, ['resourceId', 'lockId', 'resource', 'lock'], `wait-for edge ${index}.resourceId`);
    ensureExecution(waiterId);
    ensureExecution(holderId);
    ensureResource(resourceId);
    const source = sourceFromRecord(raw, `wait-for edge ${index}`);
    const id = identifierValue(raw.id) ?? `${waiterId}->${holderId}:${resourceId}:${index}`;
    return {
      id,
      waiterId,
      holderId,
      resourceId,
      observedAt: eventTimestamp(raw, index),
      ...(source ? { source } : {}),
    };
  });

  const graph = new WaitForGraph();
  for (const node of executionDefinitions.values()) graph.addExecutionNode(node);
  for (const node of resourceDefinitions.values()) {
    if (node.kind === 'lock') graph.addLock(node);
    else graph.addResource(node);
  }
  for (const acquisition of normalizedAcquisitions) graph.recordAcquisition(acquisition);
  for (const edge of normalizedEdges) graph.addWaitFor(edge);
  return graph.toJSON();
}

function recordIdentifier(record: JsonRecord, names: readonly string[]): string | undefined {
  return identifierValue(firstDefined(record, names));
}

function parseTraceEvents(value: unknown): ParsedTraceEvent[] {
  return eventListFrom(value).flatMap((raw, index): ParsedTraceEvent[] => {
    if (!isRecord(raw)) return [];
    const operation = operationForRecord(raw);
    if (operation === undefined) return [];
    const source = sourceFromRecord(raw, `event ${index}`);
    const threadId = recordIdentifier(raw, ['threadId', 'executionId', 'thread', 'worker', 'waiterId', 'waiter']);
    const holderId = recordIdentifier(raw, ['holderId', 'ownerId', 'holder', 'owner', 'heldBy', 'otherThreadId']);
    const resourceId = recordIdentifier(raw, [
      'lockId',
      'lock',
      'resourceId',
      'resource',
      'resourceKey',
      'mutex',
      'address',
    ]);
    return [
      {
        operation,
        threadId,
        holderId,
        resourceId,
        eventId: eventIdentifier(raw, index),
        observedAt: eventTimestamp(raw, index),
        source,
        raw,
      },
    ];
  });
}

function snapshotFromTraceEvents(events: readonly ParsedTraceEvent[]): WaitForGraphSnapshot {
  const executionDefinitions = new Map<string, ExecutionNode>();
  const resourceDefinitions = new Map<string, ResourceNode>();
  const currentHolders = new Map<string, string>();
  const acquisitions = new Map<string, {
    readonly resourceId: string;
    readonly holderId: string;
    readonly acquiredAt: number;
    readonly source?: SourceCodeReference;
  }>();
  const edges: Array<{
    readonly id: string;
    readonly waiterId: string;
    readonly holderId: string;
    readonly resourceId: string;
    readonly observedAt: number;
    readonly source?: SourceCodeReference;
  }> = [];

  const addExecution = (id: string, source?: SourceCodeReference): void => {
    if (!executionDefinitions.has(id)) {
      executionDefinitions.set(id, {
        id,
        name: id,
        kind: 'thread',
        ...(source ? { source } : {}),
      });
    }
  };
  const addResource = (id: string, source?: SourceCodeReference): void => {
    if (!resourceDefinitions.has(id)) {
      resourceDefinitions.set(id, {
        id,
        name: id,
        kind: 'lock',
        ...(source ? { source } : {}),
      });
    }
  };

  for (const event of events) {
    const { operation, threadId, holderId, resourceId, source } = event;
    if (threadId !== undefined) addExecution(threadId, source);
    if (holderId !== undefined && ['wait', 'acquire'].includes(operation)) addExecution(holderId, source);
    if (resourceId !== undefined && ['wait', 'acquire', 'release'].includes(operation)) addResource(resourceId, source);

    if (operation === 'acquire') {
      if (threadId === undefined || resourceId === undefined) {
        throw new Error(`event ${event.eventId} acquire requires threadId and lockId`);
      }
      currentHolders.set(resourceId, threadId);
      acquisitions.set(resourceId, {
        resourceId,
        holderId: threadId,
        acquiredAt: event.observedAt,
        ...(source ? { source } : {}),
      });
      continue;
    }

    if (operation === 'release') {
      if (resourceId === undefined) throw new Error(`event ${event.eventId} release requires lockId`);
      if (threadId === undefined || currentHolders.get(resourceId) === threadId) {
        currentHolders.delete(resourceId);
        acquisitions.delete(resourceId);
      }
      continue;
    }

    if (operation === 'wait') {
      if (threadId === undefined || resourceId === undefined) {
        throw new Error(`event ${event.eventId} wait requires threadId and lockId`);
      }
      const effectiveHolder = holderId ?? currentHolders.get(resourceId);
      if (effectiveHolder === undefined) continue;
      addExecution(effectiveHolder, source);
      addResource(resourceId, source);
      edges.push({
        id: `${event.eventId}:${threadId}->${effectiveHolder}:${resourceId}`,
        waiterId: threadId,
        holderId: effectiveHolder,
        resourceId,
        observedAt: event.observedAt,
        ...(source ? { source } : {}),
      });
    }
  }

  const graph = new WaitForGraph();
  for (const node of executionDefinitions.values()) graph.addExecutionNode(node);
  for (const node of resourceDefinitions.values()) graph.addLock(node);
  for (const acquisition of acquisitions.values()) graph.recordAcquisition(acquisition);
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    let id = edge.id;
    let suffix = 1;
    while (edgeIds.has(id)) id = `${edge.id}:${suffix++}`;
    edgeIds.add(id);
    graph.addWaitFor({ ...edge, id });
  }
  return graph.toJSON();
}

function raceInputFromEvents(events: readonly ParsedTraceEvent[]): RaceAnalysisInput {
  const raceEvents = events.flatMap((event): JsonRecord[] => {
    if (event.operation === 'access') return [event.raw];
    if (event.operation === 'pool') return [event.raw];
    if (event.operation === 'acquire' || event.operation === 'release') {
      if (event.threadId === undefined || event.resourceId === undefined) return [];
      return [
        {
          ...event.raw,
          kind: event.operation,
          threadId: event.threadId,
          lockId: event.resourceId,
          ...(event.source ? { source: event.source } : {}),
        },
      ];
    }
    if (event.operation === 'fork' || event.operation === 'join' || event.operation === 'sync') {
      return [{ ...event.raw, kind: event.operation, ...(event.source ? { source: event.source } : {}) }];
    }
    return [];
  });
  return raceEvents as RaceAnalysisInput;
}

function sourceFromScenarioId(scenarioId: string, line: number): SourceCodeReference {
  return { file: `src/scenarios/${scenarioId}.ts`, line };
}

function snapshotForPreset(scenario: IncidentScenario): WaitForGraphSnapshot {
  const resourceIds = scenario.contention.resourceOrder.length > 0
    ? scenario.contention.resourceOrder
    : scenario.contention.resources.map((resource) => resource.id);
  const isLockCycle =
    scenario.category === 'deadlock' ||
    scenario.category === 'distributed-deadlock' ||
    scenario.contention.mode === 'ordered-locks' ||
    scenario.contention.mode === 'circular-rpc';
  const graph = new WaitForGraph();
  for (const [index, resourceId] of resourceIds.entries()) {
    const resource = scenario.contention.resources.find((candidate) => candidate.id === resourceId);
    const source = sourceFromScenarioId(scenario.id, 20 + index);
    const node: ResourceNode = {
      id: resourceId,
      name: resource?.description ?? resourceId,
      kind: isLockCycle ? 'lock' : 'resource',
      source,
    };
    if (node.kind === 'lock') graph.addLock(node);
    else graph.addResource(node);
  }

  if (isLockCycle && resourceIds.length >= 2) {
    for (let index = 0; index < resourceIds.length; index += 1) {
      const workerId = `${scenario.id}:worker-${index + 1}`;
      graph.addThread({
        id: workerId,
        name: `preset worker ${index + 1}`,
        source: sourceFromScenarioId(scenario.id, 40 + index),
      });
    }
    for (let index = 0; index < resourceIds.length; index += 1) {
      const workerId = `${scenario.id}:worker-${index + 1}`;
      const nextWorkerId = `${scenario.id}:worker-${(index + 1) % resourceIds.length + 1}`;
      const heldResourceId = resourceIds[index];
      const waitedResourceId = resourceIds[(index + 1) % resourceIds.length];
      graph.recordAcquisition({
        resourceId: heldResourceId,
        holderId: workerId,
        acquiredAt: 50 + index,
        source: sourceFromScenarioId(scenario.id, 50 + index),
      });
      graph.addWaitFor({
        id: `${scenario.id}:wait-${index + 1}`,
        waiterId: workerId,
        holderId: nextWorkerId,
        resourceId: waitedResourceId,
        observedAt: 60 + index,
        source: sourceFromScenarioId(scenario.id, 60 + index),
      });
    }
  } else if (resourceIds.length > 0) {
    graph.addThread({
      id: `${scenario.id}:worker-1`,
      name: 'preset worker',
      source: sourceFromScenarioId(scenario.id, 40),
    });
  }
  return graph.toJSON();
}

function raceInputForPreset(scenario: IncidentScenario): RaceAnalysisInput {
  if (scenario.category === 'data-race') {
    return [
      {
        id: `${scenario.id}:reservation-write`,
        threadId: `${scenario.id}:reservation-worker`,
        location: 'inventory.available',
        mode: 'write',
        clock: { [`${scenario.id}:reservation-worker`]: 1 },
        source: sourceFromScenarioId(scenario.id, 88),
      },
      {
        id: `${scenario.id}:cancellation-write`,
        threadId: `${scenario.id}:cancellation-worker`,
        location: 'inventory.available',
        mode: 'write',
        clock: { [`${scenario.id}:cancellation-worker`]: 1 },
        source: sourceFromScenarioId(scenario.id, 104),
      },
    ];
  }
  if (scenario.category === 'resource-starvation') {
    const pool = scenario.contention.resources.find((resource) => resource.kind === 'connection-pool');
    if (pool !== undefined) {
      return [
        {
          type: 'pool',
          id: `${scenario.id}:pool-1`,
          poolId: pool.id,
          capacity: pool.capacity,
          inUse: pool.capacity,
          queued: 12,
          observedAt: 1_000,
          source: sourceFromScenarioId(scenario.id, 72),
        },
        {
          type: 'pool',
          id: `${scenario.id}:pool-2`,
          poolId: pool.id,
          capacity: pool.capacity,
          inUse: pool.capacity,
          queued: 28,
          observedAt: 2_000,
          source: sourceFromScenarioId(scenario.id, 80),
        },
      ];
    }
  }
  return [];
}

function customScenario(
  body: unknown,
  graph: WaitForGraphSnapshot,
  sourceEvents: readonly ParsedTraceEvent[],
  raceAnalysis: RaceAnalysis,
): JsonRecord {
  const record = isRecord(body) ? body : {};
  const graphResources = graph.resourceNodes.map((resource) => resource.id);
  const sourceFile = sourceEvents.find((event) => event.source !== undefined)?.source?.file;
  const name = stringValue(firstDefined(record, ['name', 'title', 'label'])) ?? 'Custom lock-event trace';
  const id = stringValue(firstDefined(record, ['id', 'traceId', 'scenarioId'])) ?? 'custom-lock-event-trace';
  const category = graphResources.length > 0 || graph.waitForEdges.length > 0
    ? 'deadlock'
    : raceAnalysis.races.length > 0
      ? 'data-race'
      : 'contention';
  return {
    id,
    title: name,
    category,
    sourceFile: sourceFile ?? 'src/concurrency/locks.ts',
    locks: graphResources,
    resourceOrder: graphResources,
    contention: {
      mode: category === 'deadlock' ? 'ordered-locks' : 'optimistic-race',
      resourceOrder: graphResources,
      observedOrderings: graphResources.length > 0 ? [graphResources] : [],
      resources: graph.resourceNodes.map((resource) => ({
        id: resource.id,
        kind: resource.kind === 'lock' ? 'mutex' : 'worker-slot',
        capacity: 1,
        pressure: 'high',
        description: resource.name,
      })),
    },
  };
}

function graphWithAliases(snapshot: WaitForGraphSnapshot): AnalysisResponse['graph'] {
  const nodes = [...snapshot.executionNodes, ...snapshot.resourceNodes];
  return {
    ...snapshot,
    nodes,
    edges: snapshot.waitForEdges,
  };
}

function sourceKey(source: SourceCodeReference): string {
  return `${source.file}:${source.line}:${source.column ?? ''}`;
}

function collectOffendingCodeLines(
  deadlocks: readonly DeadlockFinding[],
  raceAnalysis: RaceAnalysis,
): SourceCodeReference[] {
  const sources: SourceCodeReference[] = [];
  for (const finding of deadlocks) {
    sources.push(...finding.waitSources.filter((source): source is SourceCodeReference => source !== undefined));
    sources.push(...finding.acquisitionSources.filter((source): source is SourceCodeReference => source !== undefined));
  }
  for (const finding of raceAnalysis.races) {
    sources.push(...finding.sourceLocations.filter((source): source is SourceCodeReference => source !== undefined));
  }
  for (const finding of raceAnalysis.poolStarvation) {
    sources.push(...finding.sourceLocations.filter((source): source is SourceCodeReference => source !== undefined));
  }
  const unique = new Map<string, SourceCodeReference>();
  for (const source of sources) unique.set(sourceKey(source), { ...source });
  return [...unique.values()].sort(
    (left, right) => left.file.localeCompare(right.file) || left.line - right.line || (left.column ?? 0) - (right.column ?? 0),
  );
}

function presetIdFromRequest(body: unknown, request: Request): string | undefined {
  const queryValue = stringValue(request.query.presetId) ?? stringValue(request.query.scenarioId);
  if (queryValue !== undefined) return queryValue;
  if (typeof body === 'string' && getScenarioPreset(body) !== undefined) return body;
  if (!isRecord(body)) return undefined;
  const explicit = stringValue(firstDefined(body, ['presetId', 'scenarioId', 'preset']));
  if (explicit !== undefined) return explicit;
  const shorthand = stringValue(body.id);
  return shorthand !== undefined && getScenarioPreset(shorthand) !== undefined ? shorthand : undefined;
}

function racePayloadFromBody(body: unknown): unknown {
  if (!isRecord(body)) return body;
  return firstDefined(body, ['raceTrace', 'raceEvents', 'vectorClockTrace']) ?? body;
}

function tracePayloadFromBody(body: unknown): unknown {
  if (!isRecord(body)) return body;
  return firstDefined(body, ['trace', 'logTrace', 'lockEventTrace', 'events', 'lockEvents']) ?? body;
}

function analyzeBody(body: unknown, request: Request): AnalysisResponse {
  const presetId = presetIdFromRequest(body, request);
  let scenario: IncidentScenario | JsonRecord;
  let graphSnapshot: WaitForGraphSnapshot;
  let parsedEvents: ParsedTraceEvent[] = [];
  let source: AnalysisSource;
  let raceInput: RaceAnalysisInput;

  if (presetId !== undefined) {
    const preset = getScenarioPreset(presetId);
    if (preset === undefined) throw new HttpError(404, `Unknown scenario preset "${presetId}"`, 'SCENARIO_NOT_FOUND');
    scenario = preset;
    graphSnapshot = snapshotForPreset(preset);
    raceInput = raceInputForPreset(preset);
    source = { kind: 'preset', scenarioId: preset.id, scenarioName: preset.title };
  } else {
    const graphCandidate = graphCandidateFromBody(body);
    if (graphCandidate !== undefined) {
      graphSnapshot = snapshotFromGraphCandidate(graphCandidate);
      parsedEvents = parseTraceEvents(racePayloadFromBody(body));
    } else {
      parsedEvents = parseTraceEvents(tracePayloadFromBody(body));
      if (parsedEvents.length === 0) throw new HttpError(400, 'Request must contain a preset ID, graph, or lock-event trace', 'INVALID_ANALYZE_REQUEST');
      graphSnapshot = snapshotFromTraceEvents(parsedEvents);
    }
    raceInput = parsedEvents.length > 0
      ? raceInputFromEvents(parsedEvents)
      : raceInputFromEvents(parseTraceEvents(racePayloadFromBody(body)));
    const preliminaryRaceAnalysis = analyzeRaceTrace(raceInput);
    scenario = customScenario(body, graphSnapshot, parsedEvents, preliminaryRaceAnalysis);
    source = {
      kind: 'custom',
      scenarioId: String(scenario.id),
      scenarioName: String(scenario.title),
    };
  }

  const deadlocks = detectDeadlocks(graphSnapshot);
  const raceAnalysis = analyzeRaceTrace(raceInput);
  const remediation = remediateScenario(scenario);
  const offendingCodeLines = collectOffendingCodeLines(deadlocks, raceAnalysis);
  const graph = graphWithAliases(graphSnapshot);
  const cycles = deadlocks.map((finding) => [...finding.cycle]);

  return {
    source,
    scenario,
    graph,
    nodes: graph.nodes,
    edges: graph.edges,
    deadlocks,
    detectedCycles: cycles,
    cycles,
    raceAnalysis,
    races: raceAnalysis.races,
    dataRaces: raceAnalysis.dataRaces,
    poolStarvation: raceAnalysis.poolStarvation,
    offendingCodeLines,
    offendingLines: offendingCodeLines,
    patch: remediation.patchText,
    patchDiff: remediation.diffText,
    diff: remediation.diffText,
    remediation,
    incidentChecklist: remediation.runbook,
    checklist: remediation.checklist,
    runbook: remediation.runbook,
  };
}

function metricComparison(before: number, after: number): MetricComparison {
  return {
    before,
    after,
    delta: after - before,
    improvementFactor: before === 0 ? null : after / before,
  };
}

function configuredWorkerCount(): number {
  const parsed = Number.parseInt(process.env.SIMULATION_WORKERS ?? String(DEFAULT_WORKER_COUNT), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WORKER_COUNT;
}

function benchmarkScenario(scenario: IncidentScenario): BenchmarkComparison {
  const workerCount = configuredWorkerCount();
  const options = { workerCount } as const;
  const before = simulateScenario(scenario, { ...options, patched: false });
  const after = simulateScenario(scenario, { ...options, patched: true });
  const comparison = {
    throughputRps: metricComparison(before.throughputRps, after.throughputRps),
    latencyMs: {
      p50: metricComparison(before.p50LatencyMs, after.p50LatencyMs),
      p95: metricComparison(before.p95LatencyMs, after.p95LatencyMs),
      p99: metricComparison(before.p99LatencyMs, after.p99LatencyMs),
    },
    deadlocks: metricComparison(before.deadlockCount, after.deadlockCount),
    droppedRequests: metricComparison(before.droppedRequests, after.droppedRequests),
  };
  return {
    scenarioId: scenario.id,
    scenarioName: scenario.title,
    workerCount,
    workers: workerCount,
    before,
    after,
    comparison,
    metrics: comparison,
  };
}

function benchmarkBody(body: unknown, request: Request): {
  readonly benchmarks: readonly BenchmarkComparison[];
  readonly selected?: BenchmarkComparison;
} {
  const id = presetIdFromRequest(body, request);
  if (id !== undefined) {
    const scenario = getScenarioPreset(id);
    if (scenario === undefined) throw new HttpError(404, `Unknown scenario preset "${id}"`, 'SCENARIO_NOT_FOUND');
    const selected = benchmarkScenario(scenario);
    return { benchmarks: [selected], selected };
  }
  return { benchmarks: INCIDENT_PRESETS.map(benchmarkScenario) };
}

function configuredPort(): number {
  const parsed = Number.parseInt(process.env.PORT ?? String(3000), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 3000;
}

function configuredHost(): string {
  const raw = process.env.HOST?.trim();
  return raw !== undefined && raw.length > 0 ? raw : '0.0.0.0';
}

function frontendDirectory(options: ServerOptions): string {
  if (options.staticDir !== undefined) return resolve(options.staticDir);
  const currentDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
  return resolve(currentDirectory, '../../dist');
}

function fallbackIndexHtmlPath(): string {
  const currentDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
  return resolve(currentDirectory, '../../index.html');
}

class HttpError extends Error {
  public constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function sendError(response: Response, error: unknown): void {
  if (error instanceof HttpError) {
    response.status(error.statusCode).json({ error: error.message, code: error.code });
    return;
  }
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  response.status(400).json({ error: message, code: 'INVALID_REQUEST' });
}

function healthPayload(staticDir: string): JsonRecord {
  const workerCount = configuredWorkerCount();
  const metrics = {
    presetScenarios: INCIDENT_PRESETS.length,
    scenarioCount: INCIDENT_PRESETS.length,
    defaultWorkerCount: workerCount,
    detectorCount: 2,
    detectors: ['deadlock-cycles', 'vector-clock-races'],
    staticFrontendAvailable: existsSync(staticDir) || existsSync(fallbackIndexHtmlPath()),
  };
  return {
    status: 'ok',
    service: 'deadlockzero-api',
    version: SERVER_VERSION,
    engine: 'ready',
    metrics,
    engineMetrics: metrics,
  };
}

/** Create an import-safe Express application for the REST API and frontend. */
export function createApp(options: ServerOptions = {}): Express {
  const app = express();
  const staticDir = frontendDirectory(options);

  app.disable('x-powered-by');
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(express.text({ type: ['text/plain', 'text/*'], limit: JSON_BODY_LIMIT }));

  app.get('/api/health', (_request, response) => {
    response.status(200).json(healthPayload(staticDir));
  });

  app.get('/api/scenarios', (_request, response) => {
    response.status(200).json({
      scenarios: INCIDENT_PRESETS,
      presets: INCIDENT_PRESETS,
      length: INCIDENT_PRESETS.length,
      count: INCIDENT_PRESETS.length,
    });
  });

  app.post('/api/analyze', (request, response) => {
    try {
      response.status(200).json(analyzeBody(request.body, request));
    } catch (error) {
      sendError(response, error);
    }
  });

  app.post('/api/benchmark', (request, response) => {
    try {
      const result = benchmarkBody(request.body, request);
      if (result.selected !== undefined) {
        response.status(200).json({
          ...result.selected,
          benchmark: result.selected,
          comparisons: [result.selected],
        });
        return;
      }
      const workerCount = configuredWorkerCount();
      response.status(200).json({
        benchmarks: result.benchmarks,
        comparisons: result.benchmarks,
        count: result.benchmarks.length,
        workerCount,
        workers: workerCount,
      });
    } catch (error) {
      sendError(response, error);
    }
  });

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  });

  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));
  }

  const indexHtmlPath = existsSync(resolve(staticDir, 'index.html'))
    ? resolve(staticDir, 'index.html')
    : fallbackIndexHtmlPath();

  if (existsSync(indexHtmlPath)) {
    app.use((request, response, next) => {
      if (request.method !== 'GET' || request.path.startsWith('/api/')) {
        next();
        return;
      }
      response.sendFile(indexHtmlPath, (error) => {
        if (error && !response.headersSent) next(error);
      });
    });
  }

  app.use((_request, response) => {
    response.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  });

  const errorHandler = ((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (response.headersSent) return;
    if (isRecord(error) && error.type === 'entity.parse.failed') {
      response.status(400).json({ error: 'Request body contains invalid JSON', code: 'INVALID_JSON' });
      return;
    }
    response.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }) satisfies (error: unknown, request: Request, response: Response, next: NextFunction) => void;
  app.use(errorHandler);

  return app;
}

/** Start the HTTP server on PORT or 3000. */
export function startServer(options: StartServerOptions = {}): Server {
  const port = options.port ?? configuredPort();
  const host = options.host ?? configuredHost();
  const app = createApp(options);
  const server = createServer(app);
  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address !== null ? address.port : port;
    console.log(`DeadlockZero server listening on http://${host}:${actualPort}`);
  });
  return server;
}
