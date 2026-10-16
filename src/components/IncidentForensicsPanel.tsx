import { useEffect, useMemo, useState } from 'react';

import './IncidentForensicsPanel.css';

type JsonRecord = Record<string, unknown>;

/**
 * The API intentionally has a few compatibility aliases (for example `diff`
 * and `patchDiff`). Keeping the response boundary loose lets this component be
 * dropped into callers that use either the REST response or a saved snapshot.
 */
export interface IncidentForensicsResponse {
  readonly graph?: unknown;
  readonly nodes?: unknown;
  readonly edges?: unknown;
  readonly acquisitions?: unknown;
  readonly waitForEdges?: unknown;
  readonly deadlocks?: unknown;
  readonly detectedCycles?: unknown;
  readonly cycles?: unknown;
  readonly raceAnalysis?: unknown;
  readonly races?: unknown;
  readonly dataRaces?: unknown;
  readonly poolStarvation?: unknown;
  readonly offendingCodeLines?: unknown;
  readonly offendingLines?: unknown;
  readonly patch?: unknown;
  readonly patchDiff?: unknown;
  readonly diff?: unknown;
  readonly remediation?: unknown;
  readonly incidentChecklist?: unknown;
  readonly checklist?: unknown;
  readonly runbook?: unknown;
  readonly trace?: unknown;
  readonly traceEvents?: unknown;
  readonly lockTrace?: unknown;
  readonly lockEvents?: unknown;
  readonly acquisitionTrace?: unknown;
  readonly lockAcquisitionTrace?: unknown;
  readonly events?: unknown;
  readonly [key: string]: unknown;
}

export interface IncidentForensicsPanelProps {
  /** A complete `/api/analyze` response or a saved response-shaped snapshot. */
  readonly data?: IncidentForensicsResponse | null;
  /** `analysis` is a convenient alias for integrations that name the response that way. */
  readonly analysis?: IncidentForensicsResponse | null;
  readonly className?: string;
  readonly title?: string;
}

interface DisplaySource {
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
}

type TraceSignal = 'observed' | 'offending' | 'deadlock';

interface TraceRow {
  readonly id: string;
  readonly source?: DisplaySource;
  readonly operation: string;
  readonly threadId?: string;
  readonly lockId?: string;
  readonly thread: string;
  readonly lock: string;
  readonly holder?: string;
  readonly holderId?: string;
  readonly observedAt?: number;
  readonly signal: TraceSignal;
  readonly demo?: boolean;
}

interface GraphView {
  readonly executionNames: ReadonlyMap<string, string>;
  readonly resourceNames: ReadonlyMap<string, string>;
  readonly executionSources: ReadonlyMap<string, DisplaySource>;
  readonly resourceSources: ReadonlyMap<string, DisplaySource>;
  readonly acquisitions: readonly JsonRecord[];
  readonly waits: readonly JsonRecord[];
}

interface DiffView {
  readonly before: readonly string[];
  readonly after: readonly string[];
  readonly hasChanges: boolean;
  readonly isDemo: boolean;
}

const TRACE_FIELDS = [
  'trace',
  'traceEvents',
  'lockTrace',
  'lockEvents',
  'acquisitionTrace',
  'lockAcquisitionTrace',
  'events',
] as const;

const EVENT_COLLECTION_FIELDS = [
  'events',
  'traceEvents',
  'lockEvents',
  'lockTrace',
  'acquisitionTrace',
  'lockAcquisitionTrace',
  'accesses',
  'memoryAccesses',
  'synchronization',
  'synchronizationEvents',
  'syncEvents',
  'poolSamples',
  'poolEvents',
] as const;

const DEMO_TRACE_ROWS: readonly TraceRow[] = [
  {
    id: 'demo-acquire-account',
    source: { file: 'src/payments/transferWorker.ts', line: 118 },
    operation: 'acquire',
    threadId: 'TransferWorker#7',
    lockId: 'account:acct-8842',
    thread: 'TransferWorker#7',
    lock: 'account:acct-8842',
    observedAt: 101,
    signal: 'observed',
    demo: true,
  },
  {
    id: 'demo-acquire-ledger',
    source: { file: 'src/payments/reconciliationWorker.ts', line: 94 },
    operation: 'acquire',
    threadId: 'ReconciliationWorker#3',
    lockId: 'ledger:entry-7f31',
    thread: 'ReconciliationWorker#3',
    lock: 'ledger:entry-7f31',
    observedAt: 102,
    signal: 'observed',
    demo: true,
  },
  {
    id: 'demo-wait-ledger',
    source: { file: 'src/payments/transferWorker.ts', line: 121 },
    operation: 'wait',
    threadId: 'TransferWorker#7',
    lockId: 'ledger:entry-7f31',
    thread: 'TransferWorker#7',
    lock: 'ledger:entry-7f31',
    holder: 'ReconciliationWorker#3',
    holderId: 'ReconciliationWorker#3',
    observedAt: 103,
    signal: 'deadlock',
    demo: true,
  },
  {
    id: 'demo-wait-account',
    source: { file: 'src/payments/reconciliationWorker.ts', line: 97 },
    operation: 'wait',
    threadId: 'ReconciliationWorker#3',
    lockId: 'account:acct-8842',
    thread: 'ReconciliationWorker#3',
    lock: 'account:acct-8842',
    holder: 'TransferWorker#7',
    holderId: 'TransferWorker#7',
    observedAt: 104,
    signal: 'deadlock',
    demo: true,
  },
];

const DEMO_BROKEN_PATCH = [
  'const account = await locks.acquire(accountId);',
  'const ledger = await locks.acquire(ledgerId);',
  'return settle(account, ledger);',
].join('\n');

const DEMO_CANONICAL_PATCH = [
  'const ordered = sortByCanonicalOrder([ledgerId, accountId]);',
  'const locksHeld = await locks.acquireAll(ordered);',
  'try { return settle(...locksHeld); }',
  'finally { await locks.releaseAll([...locksHeld].reverse()); }',
].join('\n');

const DEMO_RUNBOOK = [
  '# 3 a.m. Incident Triage Checklist',
  '',
  'Incident: **Payment Ledger AB-BA Lock Deadlock** (deadlock)',
  '',
  '## Stabilize',
  '- [ ] Declare the incident, assign an incident commander, and record the start time.',
  '- [ ] Freeze unrelated deploys and capture logs, traces, worker count, queue depth, and error rate.',
  '- [ ] Stop the retry amplification path or enable traffic shedding before changing code.',
  '- [ ] Confirm every code path acquires `ledger-entry` before `account-balance`.',
  '',
  '## Patch and verify',
  '- [ ] Review the canonical lock-order patch and confirm the target file is correct.',
  '- [ ] Re-capture the wait-for graph and verify the cycle count is zero.',
  '- [ ] Canary the patch and watch error rate, saturation, and latency for one request window.',
  '',
  '## Recover and close',
  '- [ ] Drain queued work deliberately and preserve the graph, logs, and patch review.',
  '- [ ] File follow-up work for regression coverage, alerting, and a permanent runbook owner.',
].join('\n');

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function firstValue(record: JsonRecord | undefined, names: readonly string[]): unknown {
  if (!record) return undefined;
  for (const name of names) {
    if (record[name] !== undefined && record[name] !== null) return record[name];
  }
  return undefined;
}

function identifierValue(value: unknown): string | undefined {
  const direct = stringValue(value);
  if (direct !== undefined) return direct;
  if (!isRecord(value)) return undefined;
  return stringValue(firstValue(value, ['id', 'name', 'key', 'label', 'threadId', 'resourceId']));
}

function arrayValue(record: JsonRecord | undefined, names: readonly string[]): readonly unknown[] {
  const value = firstValue(record, names);
  return Array.isArray(value) ? value : [];
}

function sourceFrom(value: unknown): DisplaySource | undefined {
  if (!isRecord(value)) {
    const file = stringValue(value);
    return file === undefined ? undefined : { file };
  }

  const nested = firstValue(value, ['source', 'sourceLocation']);
  if (nested !== undefined && nested !== value) {
    const nestedSource = sourceFrom(nested);
    if (nestedSource !== undefined) return nestedSource;
  }

  const file =
    stringValue(firstValue(value, ['file', 'sourceFile', 'path', 'filename'])) ??
    (typeof nested === 'string' ? stringValue(nested) : undefined);
  const lineValue = firstValue(value, ['line', 'sourceLine', 'lineNumber']);
  const line = numberValue(lineValue);
  const column = numberValue(firstValue(value, ['column', 'sourceColumn']))
  if (file === undefined && line === undefined && column === undefined) return undefined;
  return {
    ...(file === undefined ? {} : { file }),
    ...(line === undefined || line < 1 ? {} : { line: Math.floor(line) }),
    ...(column === undefined || column < 1 ? {} : { column: Math.floor(column) }),
  };
}

function sourceKey(source: DisplaySource | undefined): string | undefined {
  if (!source?.file || source.line === undefined) return undefined;
  const file = source.file.replaceAll('\\', '/');
  return `${file}:${source.line}`;
}

function addSourceKey(keys: Set<string>, source: DisplaySource | undefined): void {
  const key = sourceKey(source);
  if (key !== undefined) keys.add(key);
}

function hasSourceKey(keys: ReadonlySet<string>, source: DisplaySource | undefined): boolean {
  const key = sourceKey(source);
  return key !== undefined && keys.has(key);
}

function sourceLabel(source: DisplaySource | undefined): string {
  if (!source) return 'not recorded';
  if (!source.file && source.line === undefined) return 'not recorded';
  const file = source.file ?? 'unknown file';
  const line = source.line === undefined ? '?' : String(source.line);
  return `${file}:${line}${source.column === undefined ? '' : `:${source.column}`}`;
}

function normalizeToken(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s_-]+/g, '') : '';
}

function operationFromRecord(record: JsonRecord): string | undefined {
  const candidates = [
    firstValue(record, ['operation', 'op', 'event', 'eventType', 'kind', 'type', 'action']),
    firstValue(record, ['mode', 'access', 'accessType']),
  ];
  for (const candidate of candidates) {
    const token = normalizeToken(candidate);
    if (['acquire', 'lockacquire', 'acquired', 'lockacquired', 'hold', 'lockhold'].includes(token)) {
      return 'acquire';
    }
    if (['release', 'lockrelease', 'released', 'lockreleased', 'unlock', 'unlocked'].includes(token)) {
      return 'release';
    }
    if (
      ['wait', 'waitfor', 'lockwait', 'waiting', 'waitingfor', 'blocked', 'lockblocked', 'request', 'contended'].includes(token)
    ) {
      return 'wait';
    }
    if (['read', 'write', 'load', 'store'].includes(token)) return 'access';
    if (['fork', 'spawn'].includes(token)) return 'fork';
    if (token === 'join') return 'join';
    if (['sync', 'synchronize', 'happensbefore', 'hb', 'barrier'].includes(token)) return 'sync';
    if (['pool', 'poolsample', 'connectionpool', 'connectionpoolsample'].includes(token)) return 'pool';
  }
  if (
    firstValue(record, ['acquiredAt', 'acquisitionTime']) !== undefined &&
    firstValue(record, ['lockId', 'resourceId', 'lock', 'resource']) !== undefined
  ) {
    return 'acquire';
  }
  return undefined;
}

function parseTraceString(value: string): readonly unknown[] {
  const trimmed = value.trim();
  if (trimmed.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return trimmed.split(/\r?\n/).map((line, index) => {
      const sourceMatch = line.match(/([\w./\\-]+\.(?:ts|tsx|js|jsx|java|go|py)):(\d+)/i);
      const operationMatch = line.match(/\b(acquire|acquired|release|released|unlock|wait|waiting|blocked|request)\b/i);
      return {
        id: `log-${index + 1}`,
        operation: operationMatch?.[1] ?? 'observe',
        raw: line,
        ...(sourceMatch
          ? { source: { file: sourceMatch[1], line: Number(sourceMatch[2]) } }
          : {}),
      };
    });
  }
}

function traceRecordsFromValue(value: unknown, seenArrays = new Set<readonly unknown[]>(), depth = 0): JsonRecord[] {
  if (depth > 4) return [];
  if (typeof value === 'string') {
    return traceRecordsFromValue(parseTraceString(value), seenArrays, depth + 1);
  }
  if (Array.isArray(value)) {
    if (seenArrays.has(value)) return [];
    seenArrays.add(value);
    return value.flatMap((entry) => traceRecordsFromValue(entry, seenArrays, depth + 1));
  }
  if (!isRecord(value)) return [];

  const nested: JsonRecord[] = [];
  let foundCollection = false;
  for (const field of EVENT_COLLECTION_FIELDS) {
    const candidate = value[field];
    if (candidate === undefined) continue;
    foundCollection = true;
    nested.push(...traceRecordsFromValue(candidate, seenArrays, depth + 1));
  }
  if (foundCollection) return nested;
  return [value];
}

function isTraceLike(record: JsonRecord): boolean {
  return (
    operationFromRecord(record) !== undefined ||
    firstValue(record, [
      'threadId',
      'executionId',
      'thread',
      'worker',
      'lockId',
      'resourceId',
      'lock',
      'resource',
      'source',
      'sourceLocation',
    ]) !== undefined
  );
}

function collectTraceRecords(data: IncidentForensicsResponse): JsonRecord[] {
  const records: JsonRecord[] = [];
  const seenArrays = new Set<readonly unknown[]>();
  for (const field of TRACE_FIELDS) {
    const value = data[field];
    if (value === undefined) continue;
    records.push(...traceRecordsFromValue(value, seenArrays).filter(isTraceLike));
  }
  return records;
}

function normalizeGraph(data: IncidentForensicsResponse): GraphView {
  const graph = isRecord(data.graph) ? data.graph : data;
  const executionNames = new Map<string, string>();
  const resourceNames = new Map<string, string>();
  const executionSources = new Map<string, DisplaySource>();
  const resourceSources = new Map<string, DisplaySource>();
  const addNode = (value: unknown, resource: boolean): void => {
    if (!isRecord(value)) return;
    const id = identifierValue(firstValue(value, ['id', 'threadId', 'executionId', 'resourceId', 'lockId', 'name']));
    if (id === undefined) return;
    const name = stringValue(firstValue(value, ['name', 'label', 'title'])) ?? id;
    (resource ? resourceNames : executionNames).set(id, name);
    const source = sourceFrom(value);
    if (source !== undefined) (resource ? resourceSources : executionSources).set(id, source);
  };

  for (const node of arrayValue(graph, ['executionNodes', 'executions', 'threads', 'services'])) addNode(node, false);
  for (const node of arrayValue(graph, ['resourceNodes', 'resources', 'locks'])) addNode(node, true);
  for (const node of arrayValue(graph, ['nodes'])) {
    const kind = normalizeToken(isRecord(node) ? firstValue(node, ['kind', 'type', 'category']) : undefined);
    addNode(node, kind.includes('lock') || kind.includes('mutex') || kind === 'resource' || kind === 'rwlock');
  }

  const acquisitions = arrayValue(graph, ['acquisitions', 'heldResources', 'holds'])
    .filter(isRecord);
  const waits = arrayValue(graph, ['waitForEdges', 'waits', 'edges']).filter(isRecord);
  return { executionNames, resourceNames, executionSources, resourceSources, acquisitions, waits };
}

function eventSource(
  record: JsonRecord,
  graph: GraphView,
  threadId?: string,
  lockId?: string,
): DisplaySource | undefined {
  return sourceFrom(record) ?? graph.executionSources.get(threadId ?? '') ?? graph.resourceSources.get(lockId ?? '');
}

function graphTraceRows(graph: GraphView): TraceRow[] {
  const rows: TraceRow[] = [];
  graph.acquisitions.forEach((record, index) => {
    const threadId = identifierValue(firstValue(record, ['holderId', 'ownerId', 'threadId', 'executionId', 'holder']));
    const lockId = identifierValue(firstValue(record, ['resourceId', 'lockId', 'resource', 'lock']));
    if (threadId === undefined && lockId === undefined) return;
    rows.push({
      id: `acquisition-${index}-${threadId ?? 'thread'}-${lockId ?? 'lock'}`,
      source: eventSource(record, graph, threadId, lockId),
      operation: 'acquire',
      threadId,
      lockId,
      thread: graph.executionNames.get(threadId ?? '') ?? threadId ?? 'unknown thread',
      lock: graph.resourceNames.get(lockId ?? '') ?? lockId ?? 'unknown lock',
      observedAt: numberValue(firstValue(record, ['acquiredAt', 'observedAt', 'timestamp', 'time'])),
      signal: 'observed',
    });
  });
  graph.waits.forEach((record, index) => {
    const threadId = identifierValue(firstValue(record, ['waiterId', 'waiter', 'threadId', 'executionId']));
    const holderId = identifierValue(firstValue(record, ['holderId', 'holder', 'ownerId', 'owner']));
    const lockId = identifierValue(firstValue(record, ['resourceId', 'lockId', 'resource', 'lock']));
    if (threadId === undefined && lockId === undefined) return;
    rows.push({
      id: `wait-${identifierValue(record.id) ?? index}`,
      source: eventSource(record, graph, threadId, lockId),
      operation: 'wait',
      threadId,
      lockId,
      thread: graph.executionNames.get(threadId ?? '') ?? threadId ?? 'unknown thread',
      lock: graph.resourceNames.get(lockId ?? '') ?? lockId ?? 'unknown lock',
      holder: graph.executionNames.get(holderId ?? '') ?? holderId,
      holderId,
      observedAt: numberValue(firstValue(record, ['observedAt', 'timestamp', 'time'])),
      signal: 'observed',
    });
  });
  return rows.sort((left, right) => (left.observedAt ?? Number.MAX_SAFE_INTEGER) - (right.observedAt ?? Number.MAX_SAFE_INTEGER));
}

function collectSources(value: unknown, keys: Set<string>, depth = 0, seen = new Set<object>()): void {
  if (depth > 6 || value === null || value === undefined) return;
  if (typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectSources(item, keys, depth + 1, seen);
    return;
  }
  const record = value as JsonRecord;
  addSourceKey(keys, sourceFrom(record));
  for (const child of Object.values(record)) collectSources(child, keys, depth + 1, seen);
}

function collectCycleThreads(data: IncidentForensicsResponse): Set<string> {
  const threads = new Set<string>();
  const addCycle = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    for (const id of value) {
      const identifier = identifierValue(id);
      if (identifier !== undefined) threads.add(identifier);
    }
  };
  for (const candidate of [data.cycles, data.detectedCycles]) {
    if (!Array.isArray(candidate)) continue;
    for (const cycle of candidate) addCycle(cycle);
  }
  const findings = Array.isArray(data.deadlocks) ? data.deadlocks : [];
  for (const finding of findings) {
    if (!isRecord(finding)) continue;
    for (const name of ['cycle', 'cycleNodeIds', 'executionIds', 'component', 'stronglyConnectedComponent']) {
      addCycle(finding[name]);
    }
  }
  return threads;
}

function hasDeadlockEvidence(data: IncidentForensicsResponse): boolean {
  return (
    (Array.isArray(data.deadlocks) && data.deadlocks.length > 0) ||
    (Array.isArray(data.cycles) && data.cycles.length > 0) ||
    (Array.isArray(data.detectedCycles) && data.detectedCycles.length > 0)
  );
}

function raceEvidenceRows(data: IncidentForensicsResponse, graph: GraphView): TraceRow[] {
  const raceAnalysis = isRecord(data.raceAnalysis) ? data.raceAnalysis : data;
  const races = arrayValue(raceAnalysis, ['races', 'dataRaces']);
  const rows: TraceRow[] = [];
  races.forEach((value, raceIndex) => {
    if (!isRecord(value)) return;
    const accesses = arrayValue(value, ['accesses']);
    const accessCandidates = accesses.length > 0
      ? accesses
      : [firstValue(value, ['firstAccess', 'first']), firstValue(value, ['secondAccess', 'second'])];
    accessCandidates.forEach((candidate, accessIndex) => {
      if (!isRecord(candidate)) return;
      const threadId = identifierValue(firstValue(candidate, ['threadId', 'executionId', 'thread']));
      const location = stringValue(firstValue(candidate, ['location', 'address', 'resourceKey', 'resource'])) ?? 'not recorded';
      const lockIds = arrayValue(candidate, ['lockIds', 'lockSet', 'locks']);
      const lockId = identifierValue(lockIds[0]) ?? location;
      const source = sourceFrom(candidate) ?? sourceFrom(value);
      rows.push({
        id: `race-${raceIndex}-${accessIndex}`,
        source,
        operation: stringValue(firstValue(candidate, ['mode', 'kind', 'accessType', 'operation'])) ?? 'access',
        threadId,
        lockId,
        thread: graph.executionNames.get(threadId ?? '') ?? threadId ?? 'unknown thread',
        lock: graph.resourceNames.get(lockId) ?? lockId,
        observedAt: numberValue(firstValue(candidate, ['logicalTimestamp', 'logicalTime', 'timestamp', 'eventIndex'])),
        signal: 'observed',
      });
    });
  });

  const poolFindings = arrayValue(raceAnalysis, ['poolStarvation', 'poolStarvationFindings']);
  poolFindings.forEach((value, findingIndex) => {
    if (!isRecord(value)) return;
    const samples = arrayValue(value, ['samples']);
    const records = samples.length > 0 ? samples : [value];
    records.forEach((sample, sampleIndex) => {
      if (!isRecord(sample)) return;
      const poolId = identifierValue(firstValue(sample, ['poolId', 'pool', 'id']));
      if (poolId === undefined) return;
      rows.push({
        id: `pool-${findingIndex}-${sampleIndex}`,
        source: sourceFrom(sample) ?? sourceFrom(value),
        operation: 'pool',
        lockId: poolId,
        thread: 'pool observer',
        lock: graph.resourceNames.get(poolId) ?? poolId,
        observedAt: numberValue(firstValue(sample, ['observedAt', 'observedTime', 'timestamp'])),
        signal: 'observed',
      });
    });
  });
  return rows;
}

function normalizedTraceRows(data: IncidentForensicsResponse, graph: GraphView): { rows: TraceRow[]; isDemo: boolean } {
  const offendingKeys = new Set<string>();
  const deadlockKeys = new Set<string>();
  collectSources(data.offendingCodeLines, offendingKeys);
  collectSources(data.offendingLines, offendingKeys);
  collectSources(data.deadlocks, deadlockKeys);
  const cycleThreads = collectCycleThreads(data);
  const hasDeadlock = hasDeadlockEvidence(data);
  const explicit = collectTraceRecords(data);
  const rows: TraceRow[] = explicit.map((record, index) => {
    const operation = operationFromRecord(record) ?? stringValue(firstValue(record, ['operation', 'kind', 'type'])) ?? 'observe';
    const threadId = identifierValue(firstValue(record, ['threadId', 'executionId', 'thread', 'worker', 'waiterId', 'waiter', 'holderId', 'ownerId']));
    const holderId = identifierValue(firstValue(record, ['holderId', 'ownerId', 'holder', 'owner', 'heldBy', 'otherThreadId']));
    const lockId = identifierValue(firstValue(record, ['lockId', 'lock', 'resourceId', 'resource', 'resourceKey', 'mutex', 'address']));
    const source = eventSource(record, graph, threadId, lockId);
    const isDeadlock =
      hasSourceKey(deadlockKeys, source) ||
      (hasDeadlock && operation === 'wait') ||
      (threadId !== undefined && cycleThreads.has(threadId) && (operation === 'acquire' || operation === 'wait'));
    const isOffending = isDeadlock || hasSourceKey(offendingKeys, source);
    return {
      id: identifierValue(firstValue(record, ['id', 'eventId', 'name'])) ?? `trace-${index + 1}`,
      source,
      operation,
      threadId,
      lockId,
      thread: graph.executionNames.get(threadId ?? '') ?? threadId ?? 'unknown thread',
      lock: graph.resourceNames.get(lockId ?? '') ?? lockId ?? 'not recorded',
      holder: graph.executionNames.get(holderId ?? '') ?? holderId,
      holderId,
      observedAt: numberValue(firstValue(record, ['observedAt', 'timestamp', 'time', 'logicalTimestamp', 'logicalTime'])),
      signal: isDeadlock ? 'deadlock' : isOffending ? 'offending' : 'observed',
    };
  });

  const graphRows = graphTraceRows(graph);
  const evidenceRows = explicit.length > 0 ? rows : graphRows.length > 0 ? graphRows : raceEvidenceRows(data, graph);
  const derived = evidenceRows.map((row) => {
    const isDeadlock =
      hasSourceKey(deadlockKeys, row.source) ||
      (hasDeadlock && row.operation === 'wait') ||
      (row.threadId !== undefined && cycleThreads.has(row.threadId) && (row.operation === 'acquire' || row.operation === 'wait'));
    const isOffending = isDeadlock || hasSourceKey(offendingKeys, row.source);
    const signal: TraceSignal = isDeadlock ? 'deadlock' : isOffending ? 'offending' : 'observed';
    return { ...row, signal };
  });

  if (derived.length === 0) return { rows: [...DEMO_TRACE_ROWS], isDemo: true };
  return {
    rows: derived.map((row, index) => ({ ...row, id: row.id || `trace-${index + 1}` })),
    isDemo: false,
  };
}

function firstText(values: readonly unknown[]): string | undefined {
  for (const value of values) {
    const text = stringValue(value);
    if (text !== undefined) return text;
  }
  return undefined;
}

function patchTextFrom(data: IncidentForensicsResponse): string | undefined {
  const remediation = isRecord(data.remediation) ? data.remediation : undefined;
  return firstText([
    data.patchDiff,
    data.diff,
    data.patch,
    remediation?.diffText,
    remediation?.diff,
    remediation?.patchText,
    remediation?.patch,
  ]);
}

function diffViewFrom(text: string | undefined): DiffView {
  if (text === undefined || text.trim().length === 0) {
    return {
      before: DEMO_BROKEN_PATCH.split('\n'),
      after: DEMO_CANONICAL_PATCH.split('\n'),
      hasChanges: true,
      isDemo: true,
    };
  }

  const before: string[] = [];
  const after: string[] = [];
  let hasChanges = false;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('@@')) continue;
    if (line.startsWith('-') && !line.startsWith('--')) {
      before.push(line.slice(1).replace(/^ /, ''));
      after.push('');
      hasChanges = true;
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('++')) {
      before.push('');
      after.push(line.slice(1).replace(/^ /, ''));
      hasChanges = true;
      continue;
    }
    const context = line.startsWith(' ') ? line.slice(1) : line;
    before.push(context);
    after.push(context);
  }

  if (!hasChanges) {
    return {
      before: DEMO_BROKEN_PATCH.split('\n'),
      after: text.replace(/\r\n/g, '\n').split('\n'),
      hasChanges: true,
      isDemo: false,
    };
  }
  return { before, after, hasChanges: true, isDemo: false };
}

function runbookFrom(data: IncidentForensicsResponse): string {
  const remediation = isRecord(data.remediation) ? data.remediation : undefined;
  return (
    firstText([
      data.incidentChecklist,
      data.runbook,
      data.checklist,
      remediation?.runbook,
      remediation?.runbookMarkdown,
      remediation?.runbookText,
      remediation?.checklist,
      remediation?.markdown,
    ]) ?? DEMO_RUNBOOK
  );
}

function scenarioNameFrom(data: IncidentForensicsResponse): string | undefined {
  const source = isRecord(data.source) ? data.source : undefined;
  const scenario = isRecord(data.scenario) ? data.scenario : undefined;
  return firstText([
    source?.scenarioName,
    scenario?.title,
    scenario?.name,
    source?.scenarioId,
  ]);
}

function operationLabel(operation: string): string {
  return operation.replace(/[\s_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function signalLabel(signal: TraceSignal): string {
  if (signal === 'deadlock') return 'Deadlock edge';
  if (signal === 'offending') return 'Offending';
  return 'Observed';
}

function formatTimestamp(value: number | undefined): string {
  return value === undefined ? '—' : Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function stripMarkdown(text: string): string {
  return text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`(.*?)`/g, '$1');
}

function downloadName(name: string | undefined): string {
  const base = (name ?? 'deadlockzero-incident-triage')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);
  return `${base || 'deadlockzero-incident-triage'}.md`;
}

function fallbackCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
  return copied;
}

function PatchCodePane({ title, lines, tone }: { readonly title: string; readonly lines: readonly string[]; readonly tone: 'broken' | 'canonical' }) {
  return (
    <article className={`incident-forensics__patch-pane incident-forensics__patch-pane--${tone}`}>
      <header className="incident-forensics__patch-pane-header">
        <span className="incident-forensics__patch-dot" aria-hidden="true" />
        <h4>{title}</h4>
        <span className="incident-forensics__patch-count">{lines.length} lines</span>
      </header>
      <ol className="incident-forensics__code-list" aria-label={`${title} code`}>
        {lines.map((line, index) => (
          <li key={`${title}-${index}-${line}`}>
            <span className="incident-forensics__line-number" aria-hidden="true">{index + 1}</span>
            <code>{line || ' '}</code>
          </li>
        ))}
      </ol>
    </article>
  );
}

function RunbookContent({ markdown }: { readonly markdown: string }) {
  return (
    <div className="incident-forensics__runbook-content">
      {markdown.replace(/\r\n/g, '\n').split('\n').map((line, index) => {
        const key = `${index}-${line}`;
        if (line.startsWith('# ')) return <h3 key={key}>{stripMarkdown(line.slice(2))}</h3>;
        if (line.startsWith('## ')) return <h4 key={key}>{stripMarkdown(line.slice(3))}</h4>;
        if (/^- \[ \] /.test(line)) {
          return (
            <div className="incident-forensics__check-item" key={key}>
              <span className="incident-forensics__check-box" aria-hidden="true">□</span>
              <span>{stripMarkdown(line.slice(6))}</span>
            </div>
          );
        }
        if (line.trim().length === 0) return <div className="incident-forensics__runbook-space" key={key} aria-hidden="true" />;
        return <p key={key}>{stripMarkdown(line)}</p>;
      })}
    </div>
  );
}

/**
 * Incident forensics surface: a source-aware lock trace, remediation diff, and
 * operator runbook. All three views are derived from an analyze response and
 * remain useful when only a subset of the response was persisted.
 */
export function IncidentForensicsPanel({ data, analysis, className, title = 'Incident forensics' }: IncidentForensicsPanelProps) {
  const response = data ?? analysis ?? {};
  const graph = useMemo(() => normalizeGraph(response), [response]);
  const trace = useMemo(() => normalizedTraceRows(response, graph), [graph, response]);
  const patch = useMemo(() => diffViewFrom(patchTextFrom(response)), [response]);
  const runbook = useMemo(() => runbookFrom(response), [response]);
  const scenarioName = useMemo(() => scenarioNameFrom(response), [response]);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (feedback === null) return undefined;
    const timeout = window.setTimeout(() => setFeedback(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  const copyRunbook = async (): Promise<void> => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(runbook);
      } else if (!fallbackCopy(runbook)) {
        throw new Error('Clipboard unavailable');
      }
      setFeedback('Checklist copied to clipboard');
    } catch {
      setFeedback('Copy unavailable — select the checklist text to copy it');
    }
  };

  const downloadRunbook = (): void => {
    if (typeof document === 'undefined') return;
    const blob = new Blob([runbook], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = downloadName(scenarioName);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setFeedback('Checklist download started');
  };

  const rootClassName = ['incident-forensics', className].filter(Boolean).join(' ');

  return (
    <section className={rootClassName} aria-label={title}>
      <header className="incident-forensics__header">
        <div>
          <p className="incident-forensics__eyebrow">Code trace · diff · runbook</p>
          <h2 className="incident-forensics__title">{title}</h2>
          <p className="incident-forensics__subtitle">
            Follow the lock acquisition order, review the smallest safe patch, and hand the next operator a runnable checklist.
            {scenarioName ? ` Snapshot: ${scenarioName}.` : ''}
          </p>
        </div>
        <span className={`incident-forensics__status${trace.isDemo || patch.isDemo ? ' incident-forensics__status--demo' : ''}`}>
          {trace.isDemo || patch.isDemo ? 'Demo evidence' : 'Analyze response'}
        </span>
      </header>

      <div className="incident-forensics__sections">
        <section className="incident-forensics__section" aria-labelledby="incident-forensics-trace-title">
          <div className="incident-forensics__section-heading">
            <div>
              <p className="incident-forensics__section-kicker">01 / execution evidence</p>
              <h3 id="incident-forensics-trace-title">Lock acquisition trace</h3>
            </div>
            <div className="incident-forensics__section-meta" aria-label="Trace summary">
              <span>{trace.rows.length} events</span>
              <span>{trace.rows.filter((row) => row.signal === 'deadlock').length} deadlock edges</span>
            </div>
          </div>
          <div className="incident-forensics__trace-scroll">
            <table className="incident-forensics__trace-table">
              <caption className="incident-forensics__sr-only">Line-by-line lock acquisition and wait trace</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Source</th>
                  <th scope="col">Operation</th>
                  <th scope="col">Thread</th>
                  <th scope="col">Lock</th>
                  <th scope="col">Observed</th>
                  <th scope="col">Signal</th>
                </tr>
              </thead>
              <tbody>
                {trace.rows.map((row, index) => (
                  <tr className={`incident-forensics__trace-row incident-forensics__trace-row--${row.signal}`} key={row.id}>
                    <td className="incident-forensics__trace-index">{String(index + 1).padStart(2, '0')}</td>
                    <td><code className="incident-forensics__source">{sourceLabel(row.source)}</code></td>
                    <td><span className={`incident-forensics__operation incident-forensics__operation--${row.operation}`}>{operationLabel(row.operation)}</span></td>
                    <td><strong>{row.thread}</strong></td>
                    <td><code>{row.lock}</code>{row.holder ? <small>held by {row.holder}</small> : null}</td>
                    <td className="incident-forensics__timestamp">{formatTimestamp(row.observedAt)}</td>
                    <td><span className="incident-forensics__signal">{signalLabel(row.signal)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="incident-forensics__trace-legend" aria-label="Trace legend">
            <span><i className="incident-forensics__legend-dot incident-forensics__legend-dot--observed" />Observed</span>
            <span><i className="incident-forensics__legend-dot incident-forensics__legend-dot--offending" />Offending source</span>
            <span><i className="incident-forensics__legend-dot incident-forensics__legend-dot--deadlock" />Deadlock edge</span>
          </div>
        </section>

        <section className="incident-forensics__section" aria-labelledby="incident-forensics-patch-title">
          <div className="incident-forensics__section-heading">
            <div>
              <p className="incident-forensics__section-kicker">02 / remediation review</p>
              <h3 id="incident-forensics-patch-title">Broken vs Canonical Lock-Order Patch</h3>
            </div>
            <span className="incident-forensics__section-meta">{patch.isDemo ? 'Demo patch' : 'Server diff'}</span>
          </div>
          <div className="incident-forensics__patch-grid">
            <PatchCodePane title="Broken" lines={patch.before} tone="broken" />
            <PatchCodePane title="Canonical" lines={patch.after} tone="canonical" />
          </div>
          <p className="incident-forensics__patch-note">
            The canonical side sorts every multi-lock request before acquisition and releases in reverse order. Review the target file and surrounding error paths before shipping.
          </p>
        </section>

        <section className="incident-forensics__section incident-forensics__section--runbook" aria-labelledby="incident-forensics-runbook-title">
          <div className="incident-forensics__section-heading">
            <div>
              <p className="incident-forensics__section-kicker">03 / operator handoff</p>
              <h3 id="incident-forensics-runbook-title">3 a.m. Incident Triage Checklist</h3>
            </div>
            <div className="incident-forensics__runbook-actions">
              <button type="button" className="incident-forensics__button incident-forensics__button--quiet" onClick={() => void copyRunbook()}>
                Copy checklist
              </button>
              <button type="button" className="incident-forensics__button" onClick={downloadRunbook}>
                Download .md
              </button>
            </div>
          </div>
          <div className="incident-forensics__feedback" aria-live="polite" role="status">
            {feedback ?? 'Copy or download the markdown checklist for the incident channel.'}
          </div>
          <RunbookContent markdown={runbook} />
        </section>
      </div>
    </section>
  );
}

export default IncidentForensicsPanel;
