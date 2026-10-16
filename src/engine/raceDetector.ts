import type { SourceCodeReference } from './graph';
import type { LockEvent, RaceConflict } from '../shared/types';

export type { SourceCodeReference } from './graph';
export type { RaceConflict, StarvationAlert } from '../shared/types';

/** A source location is copied into every finding so callers can inspect it safely. */
export type SourceLocation = SourceCodeReference;
export type EventIdentifier = string | number;
export type MemoryAccessMode = 'read' | 'write';

export type VectorClockSnapshot = Readonly<Record<string, number>>;
export type VectorClockRelation =
  | 'before'
  | 'after'
  | 'equal'
  | 'concurrent';

/** Inputs accepted by VectorClock. Plain objects are convenient in tests and traces. */
export type VectorClockInput =
  | VectorClock
  | ReadonlyMap<string, number>
  | Readonly<Record<string, number>>;

export interface MemoryAccessEvent {
  readonly id?: EventIdentifier;
  readonly eventId?: EventIdentifier;
  readonly threadId?: EventIdentifier;
  readonly executionId?: EventIdentifier;
  readonly thread?: EventIdentifier;
  readonly location?: string | number;
  readonly address?: string | number;
  readonly resourceKey?: string | number;
  readonly resource?: string | number;
  readonly memoryAddress?: string | number;
  readonly mode?: string;
  readonly kind?: string;
  readonly access?: string;
  readonly accessType?: string;
  readonly operation?: string;
  readonly op?: string;
  readonly type?: string;
  readonly clock?: VectorClockInput;
  readonly vectorClock?: VectorClockInput;
  readonly logicalTimestamp?: number;
  readonly logicalTime?: number;
  readonly timestamp?: number;
  readonly lockIds?: readonly EventIdentifier[] | ReadonlySet<EventIdentifier>;
  readonly lockSet?: readonly EventIdentifier[] | ReadonlySet<EventIdentifier>;
  readonly locks?: readonly EventIdentifier[] | ReadonlySet<EventIdentifier>;
  readonly source?: SourceCodeReference;
  readonly sourceLocation?: SourceCodeReference;
  readonly file?: string;
  readonly sourceFile?: string;
  readonly line?: number;
  readonly sourceLine?: number;
  readonly column?: number;
  readonly sourceColumn?: number;
}

export interface SynchronizationEvent {
  readonly id?: EventIdentifier;
  readonly eventId?: EventIdentifier;
  readonly kind?: string;
  readonly type?: string;
  readonly event?: string;
  readonly threadId?: EventIdentifier;
  readonly executionId?: EventIdentifier;
  readonly thread?: EventIdentifier;
  readonly otherThreadId?: EventIdentifier;
  readonly fromThreadId?: EventIdentifier;
  readonly toThreadId?: EventIdentifier;
  readonly sourceThreadId?: EventIdentifier;
  readonly targetThreadId?: EventIdentifier;
  readonly from?: EventIdentifier | Readonly<Record<string, unknown>>;
  readonly to?: EventIdentifier | Readonly<Record<string, unknown>>;
  readonly lockId?: EventIdentifier;
  readonly lock?: EventIdentifier;
  readonly resourceKey?: EventIdentifier;
  readonly resource?: EventIdentifier;
  readonly syncId?: EventIdentifier;
  readonly clock?: VectorClockInput;
  readonly vectorClock?: VectorClockInput;
  readonly logicalTimestamp?: number;
  readonly logicalTime?: number;
  readonly timestamp?: number;
  readonly source?: SourceCodeReference;
  readonly sourceLocation?: SourceCodeReference;
  readonly file?: string;
  readonly sourceFile?: string;
  readonly line?: number;
  readonly sourceLine?: number;
  readonly column?: number;
  readonly sourceColumn?: number;
}

/** A pool sample is also accepted as an event in a mixed trace. */
export interface ConnectionPoolSample {
  readonly id?: EventIdentifier;
  readonly poolId?: EventIdentifier;
  readonly pool?: EventIdentifier;
  readonly capacity: number;
  readonly inUse: number;
  readonly queued?: number;
  readonly queuedWaiters?: number;
  readonly waiters?: number;
  readonly observedAt?: number;
  readonly observedTime?: number;
  readonly timestamp?: number;
  readonly source?: SourceCodeReference;
  readonly sourceLocation?: SourceCodeReference;
  readonly file?: string;
  readonly sourceFile?: string;
  readonly line?: number;
  readonly sourceLine?: number;
  readonly column?: number;
  readonly sourceColumn?: number;
  readonly type?: string;
  readonly kind?: string;
}

export type MemoryAccess = MemoryAccessEvent;
export type SyncEvent = SynchronizationEvent;
export type PoolSnapshot = ConnectionPoolSample;
export type PoolSample = ConnectionPoolSample;
export type PoolEvent = ConnectionPoolSample;
export type RaceEvent = MemoryAccessEvent | SynchronizationEvent | ConnectionPoolSample;

export interface RaceTrace {
  readonly events?: readonly RaceEvent[];
  readonly traceEvents?: readonly RaceEvent[];
  readonly accesses?: readonly MemoryAccessEvent[];
  readonly memoryAccesses?: readonly MemoryAccessEvent[];
  readonly synchronization?: readonly SynchronizationEvent[];
  readonly synchronizationEvents?: readonly SynchronizationEvent[];
  readonly syncEvents?: readonly SynchronizationEvent[];
  readonly poolSamples?: readonly ConnectionPoolSample[];
  readonly poolEvents?: readonly ConnectionPoolSample[];
}

export type RaceAnalysisInput =
  | readonly RaceEvent[]
  | readonly LockEvent[]
  | readonly ConnectionPoolSample[]
  | RaceTrace
  | MemoryAccessEvent
  | SynchronizationEvent
  | ConnectionPoolSample;

/**
 * Mutable vector clock with value semantics at its public boundaries. The
 * detector clones clocks when attaching them to findings.
 */
export class VectorClock {
  private readonly values = new Map<string, number>();

  public constructor(initial?: VectorClockInput) {
    if (initial !== undefined) {
      for (const [threadId, value] of vectorClockEntries(initial)) {
        this.set(threadId, value);
      }
    }
  }

  public get(threadId: string): number {
    validateIdentifier(threadId, 'threadId');
    return this.values.get(threadId) ?? 0;
  }

  public value(threadId: string): number {
    return this.get(threadId);
  }

  public set(threadId: string, value: number): this {
    validateIdentifier(threadId, 'threadId');
    validateClockValue(value, `clock[${threadId}]`);
    this.values.set(threadId, value);
    return this;
  }

  public increment(threadId: string): this {
    return this.set(threadId, this.get(threadId) + 1);
  }

  public tick(threadId: string): this {
    return this.increment(threadId);
  }

  public advance(threadId: string): this {
    return this.increment(threadId);
  }

  public merge(other: VectorClockInput): this {
    for (const [threadId, value] of vectorClockEntries(other)) {
      this.set(threadId, Math.max(this.get(threadId), value));
    }
    return this;
  }

  public clone(): VectorClock {
    return new VectorClock(this);
  }

  public entries(): Array<[string, number]> {
    return [...this.values.entries()].sort(([left], [right]) => compareStrings(left, right));
  }

  public toJSON(): Record<string, number> {
    const snapshot: Record<string, number> = {};
    for (const [threadId, value] of this.entries()) {
      snapshot[threadId] = value;
    }
    return snapshot;
  }

  public toObject(): Record<string, number> {
    return this.toJSON();
  }

  public compare(other: VectorClockInput): VectorClockRelation {
    return compareVectorClocks(this, other);
  }

  public happensBefore(other: VectorClockInput): boolean {
    return this.compare(other) === 'before';
  }

  public isConcurrentWith(other: VectorClockInput): boolean {
    return this.compare(other) === 'concurrent';
  }

  public equals(other: VectorClockInput): boolean {
    return this.compare(other) === 'equal';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateIdentifier(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must not be empty`);
  }
}

function validateClockValue(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 0 || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
}

function vectorClockEntries(clock: VectorClockInput): Array<[string, number]> {
  if (clock instanceof VectorClock) {
    return clock.entries();
  }

  if (clock instanceof Map) {
    return [...clock.entries()].map(([threadId, value]) => [threadId, value]);
  }

  if (!isRecord(clock)) {
    throw new Error('vector clock must be a VectorClock, Map, or object');
  }

  return Object.entries(clock).map(([threadId, value]) => [threadId, value as number]);
}

function cloneVectorClock(clock: VectorClockInput): VectorClockSnapshot {
  return new VectorClock(clock).toJSON();
}

export function compareVectorClocks(
  left: VectorClockInput,
  right: VectorClockInput,
): VectorClockRelation {
  const leftClock = new VectorClock(left);
  const rightClock = new VectorClock(right);
  const threadIds = new Set<string>();
  for (const [threadId] of leftClock.entries()) threadIds.add(threadId);
  for (const [threadId] of rightClock.entries()) threadIds.add(threadId);

  let leftLess = false;
  let rightLess = false;
  for (const threadId of threadIds) {
    const leftValue = leftClock.get(threadId);
    const rightValue = rightClock.get(threadId);
    if (leftValue < rightValue) leftLess = true;
    if (leftValue > rightValue) rightLess = true;
  }

  if (leftLess && !rightLess) return 'before';
  if (rightLess && !leftLess) return 'after';
  if (!leftLess && !rightLess) return 'equal';
  return 'concurrent';
}

export function vectorClockHappensBefore(
  left: VectorClockInput,
  right: VectorClockInput,
): boolean {
  return compareVectorClocks(left, right) === 'before';
}

export function vectorClocksConcurrent(
  left: VectorClockInput,
  right: VectorClockInput,
): boolean {
  return compareVectorClocks(left, right) === 'concurrent';
}

export function mergeVectorClocks(
  left: VectorClockInput,
  right: VectorClockInput,
): VectorClock {
  return new VectorClock(left).merge(right);
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function firstDefined(record: Record<string, unknown>, names: readonly string[]): unknown {
  for (const name of names) {
    if (record[name] !== undefined) return record[name];
  }
  return undefined;
}

function normalizeIdentifierValue(value: unknown, fieldName: string): string {
  if (typeof value === 'string') {
    validateIdentifier(value, fieldName);
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  throw new Error(`${fieldName} must be a non-empty string or finite number`);
}

function optionalIdentifier(
  record: Record<string, unknown>,
  names: readonly string[],
  fieldName: string,
): string | undefined {
  const value = firstDefined(record, names);
  return value === undefined ? undefined : normalizeIdentifierValue(value, fieldName);
}

function requiredIdentifier(
  record: Record<string, unknown>,
  names: readonly string[],
  fieldName: string,
): string {
  const value = firstDefined(record, names);
  if (value === undefined) throw new Error(`${fieldName} is required`);
  return normalizeIdentifierValue(value, fieldName);
}

function normalizeSource(
  record: Record<string, unknown>,
  context: string,
): SourceCodeReference | undefined {
  const candidate = firstDefined(record, ['source', 'sourceLocation']);
  if (candidate !== undefined) {
    if (!isRecord(candidate)) throw new Error(`${context}.source must be an object`);
    const file = candidate.file;
    const line = candidate.line;
    const column = candidate.column;
    if (typeof file !== 'string' || file.trim().length === 0) {
      throw new Error(`${context}.source.file must be a non-empty string`);
    }
    if (!Number.isInteger(line) || (line as number) < 1) {
      throw new Error(`${context}.source.line must be a positive integer`);
    }
    if (
      column !== undefined &&
      (!Number.isInteger(column) || (column as number) < 1)
    ) {
      throw new Error(`${context}.source.column must be a positive integer`);
    }
    return {
      file,
      line: line as number,
      ...(column === undefined ? {} : { column: column as number }),
    };
  }

  const file = firstDefined(record, ['file', 'sourceFile']);
  const line = firstDefined(record, ['line', 'sourceLine']);
  const column = firstDefined(record, ['column', 'sourceColumn']);
  if (file === undefined && line === undefined && column === undefined) return undefined;
  if (typeof file !== 'string' || file.trim().length === 0) {
    throw new Error(`${context}.file must be a non-empty string`);
  }
  if (!Number.isInteger(line) || (line as number) < 1) {
    throw new Error(`${context}.line must be a positive integer`);
  }
  if (
    column !== undefined &&
    (!Number.isInteger(column) || (column as number) < 1)
  ) {
    throw new Error(`${context}.column must be a positive integer`);
  }
  return {
    file,
    line: line as number,
    ...(column === undefined ? {} : { column: column as number }),
  };
}

function cloneSource(source: SourceCodeReference | undefined): SourceCodeReference | undefined {
  return source === undefined ? undefined : { ...source };
}

function optionalNonNegativeNumber(
  record: Record<string, unknown>,
  names: readonly string[],
  fieldName: string,
): number | undefined {
  const value = firstDefined(record, names);
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative finite number`);
  }
  return value;
}

function requiredCount(
  record: Record<string, unknown>,
  names: readonly string[],
  fieldName: string,
): number {
  const value = firstDefined(record, names);
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return value;
}

function normalizeLockIds(
  record: Record<string, unknown>,
  context: string,
): string[] | undefined {
  const value = firstDefined(record, ['lockIds', 'lockSet', 'locks']);
  if (value === undefined) return undefined;
  if (!(Array.isArray(value) || value instanceof Set)) {
    throw new Error(`${context}.lockIds must be an array or Set`);
  }
  const result = new Set<string>();
  for (const lock of value as Iterable<unknown>) {
    result.add(normalizeIdentifierValue(lock, `${context}.lockId`));
  }
  return [...result].sort(compareStrings);
}

function normalizeClock(
  record: Record<string, unknown>,
  context: string,
): VectorClock | undefined {
  const value = firstDefined(record, ['clock', 'vectorClock']);
  if (value === undefined) return undefined;
  try {
    return new VectorClock(value as VectorClockInput);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${context}.clock is invalid: ${message}`);
  }
}

function normalizeMode(record: Record<string, unknown>): MemoryAccessMode | undefined {
  const candidates = [
    record.mode,
    record.action,
    record.kind,
    record.access,
    record.accessType,
    record.operation,
    record.op,
    record.type,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const mode = candidate.trim().toLowerCase().replace(/[_\s-]/g, '');
    if (mode === 'read' || mode === 'load') return 'read';
    if (mode === 'write' || mode === 'store') return 'write';
  }
  return undefined;
}

type SyncKind = 'acquire' | 'release' | 'fork' | 'join' | 'sync';

function isWaitAction(record: Record<string, unknown>): boolean {
  const candidates = [record.action, record.kind, record.type, record.eventType, record.event];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const token = candidate.trim().toLowerCase().replace(/[_\s-]/g, '');
    if (token === 'wait' || token === 'waitfor' || token === 'lockwait' || token === 'waiting') {
      return true;
    }
  }
  return false;
}

function normalizeSyncKind(record: Record<string, unknown>): SyncKind | undefined {
  const candidates = [record.action, record.kind, record.type, record.eventType, record.event];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const kind = candidate.trim().toLowerCase().replace(/[_\s-]/g, '');
    if (kind === 'acquire' || kind === 'lockacquire') return 'acquire';
    if (kind === 'release' || kind === 'lockrelease') return 'release';
    if (kind === 'fork' || kind === 'spawn') return 'fork';
    if (kind === 'join') return 'join';
    if (
      kind === 'sync' ||
      kind === 'synchronize' ||
      kind === 'happensbefore' ||
      kind === 'hb' ||
      kind === 'barrier'
    ) {
      return 'sync';
    }
  }
  if (
    firstDefined(record, [
      'fromThreadId',
      'toThreadId',
      'sourceThreadId',
      'targetThreadId',
      'from',
      'to',
    ]) !== undefined
  ) {
    return 'sync';
  }
  return undefined;
}

function normalizeKey(record: Record<string, unknown>, context: string): string {
  return requiredIdentifier(
    record,
    ['location', 'address', 'resourceKey', 'resource', 'resourceId', 'memoryAddress'],
    `${context}.location`,
  );
}

interface NormalizedAccess {
  readonly index: number;
  readonly id: string;
  readonly threadId: string;
  readonly location: string;
  readonly mode: MemoryAccessMode;
  readonly source?: SourceCodeReference;
  readonly lockIds: readonly string[];
  readonly logicalTimestamp?: number;
  readonly clock: VectorClockSnapshot;
  readonly codeSnippet?: string;
}

interface NormalizedSync {
  readonly index: number;
  readonly id: string;
  readonly kind: SyncKind;
  readonly threadId: string;
  readonly otherThreadId?: string;
  readonly fromThreadId?: string;
  readonly toThreadId?: string;
  readonly lockId?: string;
  readonly syncId?: string;
  readonly source?: SourceCodeReference;
  readonly logicalTimestamp?: number;
  readonly clock?: VectorClock;
}

function eventId(record: Record<string, unknown>, index: number): string {
  const value = firstDefined(record, ['id', 'eventId']);
  return value === undefined ? String(index) : normalizeIdentifierValue(value, 'event.id');
}

function normalizeAccess(record: Record<string, unknown>, index: number): Omit<NormalizedAccess, 'clock'> & {
  readonly providedClock?: VectorClock;
} {
  const context = `access event ${index}`;
  const threadId = requiredIdentifier(
    record,
    ['threadId', 'workerId', 'executionId', 'thread'],
    `${context}.threadId`,
  );
  const location = normalizeKey(record, context);
  const mode = normalizeMode(record);
  if (mode === undefined) throw new Error(`${context}.mode must be read or write`);
  const source = normalizeSource(record, context);
  const locks = normalizeLockIds(record, context) ?? [];
  const logicalTimestamp = optionalNonNegativeNumber(
    record,
    ['logicalTimestamp', 'logicalTime', 'timestamp'],
    `${context}.logicalTimestamp`,
  );
  const codeSnippet = typeof record.codeSnippet === 'string' ? record.codeSnippet : undefined;
  return {
    index,
    id: eventId(record, index),
    threadId,
    location,
    mode,
    source,
    lockIds: locks,
    logicalTimestamp,
    providedClock: normalizeClock(record, context),
    codeSnippet,
  };
}

function endpointIdentifier(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  if (isRecord(value)) {
    return optionalIdentifier(value, ['threadId', 'workerId', 'executionId', 'id', 'name'], fieldName);
  }
  return normalizeIdentifierValue(value, fieldName);
}

function normalizeSync(record: Record<string, unknown>, index: number): NormalizedSync {
  const context = `synchronization event ${index}`;
  const kind = normalizeSyncKind(record);
  if (kind === undefined) throw new Error(`${context}.kind is not a supported synchronization kind`);
  const threadValue = firstDefined(record, ['threadId', 'workerId', 'executionId', 'thread']);
  const threadId =
    threadValue === undefined
      ? undefined
      : normalizeIdentifierValue(threadValue, `${context}.threadId`);
  const source = normalizeSource(record, context);
  const logicalTimestamp = optionalNonNegativeNumber(
    record,
    ['logicalTimestamp', 'logicalTime', 'timestamp'],
    `${context}.logicalTimestamp`,
  );
  const lockValue = firstDefined(record, ['lockId', 'lock', 'resourceKey', 'resource', 'resourceId']);
  const lockId = lockValue === undefined ? undefined : normalizeIdentifierValue(lockValue, `${context}.lockId`);
  const otherValue = firstDefined(record, ['otherThreadId']);
  const otherThreadId = endpointIdentifier(otherValue, `${context}.otherThreadId`);
  const fromThreadId = endpointIdentifier(
    firstDefined(record, ['fromThreadId', 'sourceThreadId', 'from']),
    `${context}.fromThreadId`,
  );
  const toThreadId = endpointIdentifier(
    firstDefined(record, ['toThreadId', 'targetThreadId', 'to']),
    `${context}.toThreadId`,
  );

  if ((kind === 'acquire' || kind === 'release') && lockId === undefined) {
    throw new Error(`${context}.${kind} requires lockId`);
  }
  if ((kind === 'fork' || kind === 'join') && otherThreadId === undefined) {
    throw new Error(`${context}.${kind} requires otherThreadId`);
  }
  if (kind === 'sync' && threadId === undefined && fromThreadId === undefined && toThreadId === undefined) {
    throw new Error(`${context}.sync requires a threadId or synchronization endpoints`);
  }

  const effectiveThreadId = threadId ?? fromThreadId ?? toThreadId;
  if (effectiveThreadId === undefined) {
    throw new Error(`${context}.threadId is required`);
  }

  return {
    index,
    id: eventId(record, index),
    kind,
    threadId: effectiveThreadId,
    otherThreadId,
    fromThreadId,
    toThreadId,
    lockId,
    syncId: optionalIdentifier(record, ['syncId'], `${context}.syncId`),
    source,
    logicalTimestamp,
    clock: normalizeClock(record, context),
  };
}

interface NormalizedPoolSample {
  readonly index: number;
  readonly id: string;
  readonly poolId: string;
  readonly capacity: number;
  readonly inUse: number;
  readonly queued: number;
  readonly observedAt: number;
  readonly source?: SourceCodeReference;
}

function looksLikePool(record: Record<string, unknown>): boolean {
  const type = firstDefined(record, ['type', 'kind']);
  const normalizedType =
    typeof type === 'string' ? type.toLowerCase().replace(/[_\s-]/g, '') : '';
  return (
    normalizedType === 'pool' ||
    normalizedType === 'poolsample' ||
    normalizedType === 'connectionpool' ||
    (firstDefined(record, ['poolId', 'pool', 'id']) !== undefined &&
      firstDefined(record, ['capacity', 'inUse', 'queued', 'queuedWaiters', 'waiters']) !== undefined)
  );
}

function normalizePoolSample(record: Record<string, unknown>, index: number): NormalizedPoolSample {
  const context = `pool sample ${index}`;
  const poolId = requiredIdentifier(record, ['poolId', 'id', 'pool'], `${context}.poolId`);
  const capacity = requiredCount(record, ['capacity'], `${context}.capacity`);
  const inUse = requiredCount(record, ['inUse', 'used', 'active'], `${context}.inUse`);
  const queued = requiredCount(
    record,
    ['queuedWaiters', 'queued', 'waiters', 'waiting'],
    `${context}.queuedWaiters`,
  );
  const observedAt =
    optionalNonNegativeNumber(record, ['observedAt', 'observedTime', 'timestamp'], `${context}.observedAt`) ??
    index;
  return {
    index,
    id: eventId(record, index),
    poolId,
    capacity,
    inUse,
    queued,
    observedAt,
    source: normalizeSource(record, context),
  };
}

function isTraceObject(record: Record<string, unknown>): boolean {
  return [
    'events',
    'traceEvents',
    'accesses',
    'memoryAccesses',
    'synchronization',
    'synchronizationEvents',
    'syncEvents',
    'poolSamples',
    'poolEvents',
  ].some((key) => record[key] !== undefined);
}

function rawEvents(input: RaceAnalysisInput | undefined): unknown[] {
  if (input === undefined) return [];
  if (Array.isArray(input)) return [...input];
  if (!isRecord(input)) throw new Error('race detector input must be an event array or trace object');
  if (!isTraceObject(input)) return [input];

  const result: unknown[] = [];
  const seenArrays = new Set<readonly unknown[]>();
  const append = (name: string): void => {
    const value = input[name];
    if (value === undefined) return;
    if (!Array.isArray(value)) throw new Error(`trace.${name} must be an array`);
    if (seenArrays.has(value)) return;
    seenArrays.add(value);
    result.push(...value);
  };

  // `events` is the preferred already-interleaved representation. The other
  // fields make separate access/synchronization arrays ergonomic as well.
  append('events');
  append('traceEvents');
  if (result.length === 0) {
    append('accesses');
    append('memoryAccesses');
    append('synchronization');
    append('synchronizationEvents');
    append('syncEvents');
  } else {
    append('synchronization');
    append('synchronizationEvents');
    append('syncEvents');
  }
  append('poolSamples');
  append('poolEvents');
  return result;
}

interface RuntimeState {
  readonly clocks: Map<string, VectorClock>;
  readonly heldLocks: Map<string, Map<string, number>>;
  readonly releasedLocks: Map<string, VectorClock>;
  readonly syncChannels: Map<string, VectorClock>;
}

function newRuntimeState(): RuntimeState {
  return {
    clocks: new Map(),
    heldLocks: new Map(),
    releasedLocks: new Map(),
    syncChannels: new Map(),
  };
}

function clockFor(state: RuntimeState, threadId: string): VectorClock {
  let clock = state.clocks.get(threadId);
  if (clock === undefined) {
    clock = new VectorClock().set(threadId, 0);
    state.clocks.set(threadId, clock);
  }
  return clock;
}

function tick(
  state: RuntimeState,
  threadId: string,
  logicalTimestamp?: number,
): VectorClockSnapshot {
  const clock = clockFor(state, threadId);
  if (logicalTimestamp !== undefined) {
    const desiredPrevious = Math.max(0, Math.ceil(logicalTimestamp) - 1);
    clock.set(threadId, Math.max(clock.get(threadId), desiredPrevious));
  }
  clock.increment(threadId);
  return cloneVectorClock(clock);
}

function applyExplicitClock(
  state: RuntimeState,
  threadId: string,
  provided: VectorClock,
): VectorClockSnapshot {
  const current = clockFor(state, threadId);
  current.merge(provided);
  // An explicit snapshot can omit components that were already established by
  // the same thread. Keep the merged state so later accesses retain the full
  // happens-before history instead of accidentally moving the clock backward.
  return cloneVectorClock(current);
}

function heldLockIds(state: RuntimeState, threadId: string): string[] {
  const locks = state.heldLocks.get(threadId);
  if (locks === undefined) return [];
  return [...locks.entries()]
    .filter(([, count]) => count > 0)
    .map(([lockId]) => lockId)
    .sort(compareStrings);
}

function addHeldLock(state: RuntimeState, threadId: string, lockId: string): void {
  const locks = state.heldLocks.get(threadId) ?? new Map<string, number>();
  locks.set(lockId, (locks.get(lockId) ?? 0) + 1);
  state.heldLocks.set(threadId, locks);
}

function removeHeldLock(state: RuntimeState, threadId: string, lockId: string): void {
  const locks = state.heldLocks.get(threadId);
  if (locks === undefined) return;
  const count = locks.get(lockId) ?? 0;
  if (count <= 1) locks.delete(lockId);
  else locks.set(lockId, count - 1);
}

function commonLocks(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((lockId) => rightSet.has(lockId)).sort(compareStrings);
}

function syncClocks(state: RuntimeState, event: NormalizedSync): void {
  const threadClock = clockFor(state, event.threadId);

  if (event.kind === 'acquire') {
    const releaseClock = state.releasedLocks.get(event.lockId as string);
    if (releaseClock !== undefined) threadClock.merge(releaseClock);
    const eventClock =
      event.clock === undefined
        ? new VectorClock(tick(state, event.threadId, event.logicalTimestamp))
        : new VectorClock(applyExplicitClock(state, event.threadId, event.clock));
    addHeldLock(state, event.threadId, event.lockId as string);
    // Retain a channel clock for explicit acquire/release traces that omit a
    // matching release event but still provide a full clock snapshot.
    state.releasedLocks.set(`acquire:${event.lockId}`, eventClock.clone());
    return;
  }

  if (event.kind === 'release') {
    const eventClock =
      event.clock === undefined
        ? new VectorClock(tick(state, event.threadId, event.logicalTimestamp))
        : new VectorClock(applyExplicitClock(state, event.threadId, event.clock));
    state.releasedLocks.set(event.lockId as string, eventClock.clone());
    removeHeldLock(state, event.threadId, event.lockId as string);
    return;
  }

  if (event.kind === 'fork') {
    const parentClock =
      event.clock === undefined
        ? new VectorClock(tick(state, event.threadId, event.logicalTimestamp))
        : new VectorClock(applyExplicitClock(state, event.threadId, event.clock));
    const child = clockFor(state, event.otherThreadId as string);
    child.merge(parentClock);
    return;
  }

  if (event.kind === 'join') {
    const joined = clockFor(state, event.otherThreadId as string);
    threadClock.merge(joined);
    if (event.clock === undefined) {
      tick(state, event.threadId, event.logicalTimestamp);
    } else {
      applyExplicitClock(state, event.threadId, event.clock);
    }
    return;
  }

  const from = event.fromThreadId ?? event.threadId;
  const to = event.toThreadId ?? (event.fromThreadId === undefined ? event.otherThreadId : event.threadId);
  if (event.fromThreadId === undefined && event.toThreadId === undefined && event.otherThreadId === undefined) {
    const localClock =
      event.clock === undefined
        ? new VectorClock(tick(state, event.threadId, event.logicalTimestamp))
        : new VectorClock(applyExplicitClock(state, event.threadId, event.clock));
    if (event.syncId !== undefined) {
      const rememberedClock = state.syncChannels.get(event.syncId);
      if (rememberedClock !== undefined) {
        // A repeated token on another thread is a receive: merge the sender's
        // clock before recording the receiver's local event.
        localClock.merge(rememberedClock);
        localClock.increment(event.threadId);
        state.clocks.set(event.threadId, localClock);
      }
      state.syncChannels.set(event.syncId, localClock.clone());
    }
    return;
  }
  if (from === undefined && to === undefined) return;
  if (from === undefined || to === undefined) {
    throw new Error(`synchronization event ${event.index}.sync requires both endpoints`);
  }
  const sourceClock = clockFor(state, from);
  const targetClock = clockFor(state, to);
  if (event.clock !== undefined) {
    targetClock.merge(event.clock);
  } else {
    sourceClock.increment(from);
    targetClock.merge(sourceClock);
    targetClock.increment(to);
  }
  if (event.syncId !== undefined) state.syncChannels.set(event.syncId, targetClock.clone());
}

function normalizeInput(input: RaceAnalysisInput | undefined): {
  readonly accesses: NormalizedAccess[];
  readonly pools: NormalizedPoolSample[];
} {
  const accesses: NormalizedAccess[] = [];
  const pools: NormalizedPoolSample[] = [];
  const state = newRuntimeState();
  const records = rawEvents(input);
  const allWorkers = new Set<string>();
  const waitingWorkersByResource = new Map<string, Set<string>>();
  const waitSourcesByResource = new Map<string, SourceCodeReference | undefined>();
  const waitTimestampByResource = new Map<string, number>();

  records.forEach((value, index) => {
    if (!isRecord(value)) throw new Error(`event ${index} must be an object`);
    if (looksLikePool(value)) {
      pools.push(normalizePoolSample(value, index));
      return;
    }

    const workerIdCandidate = firstDefined(value, ['workerId', 'threadId', 'executionId', 'thread']);
    if (typeof workerIdCandidate === 'string' && workerIdCandidate.trim().length > 0) {
      allWorkers.add(workerIdCandidate.trim());
    }

    if (isWaitAction(value)) {
      const worker = typeof workerIdCandidate === 'string' ? workerIdCandidate.trim() : undefined;
      const resource = firstDefined(value, ['resourceId', 'lockId', 'resource', 'lock']);
      if (worker && typeof resource === 'string' && resource.trim().length > 0) {
        const resId = resource.trim();
        const waiters = waitingWorkersByResource.get(resId) ?? new Set<string>();
        waiters.add(worker);
        waitingWorkersByResource.set(resId, waiters);
        if (!waitSourcesByResource.has(resId)) {
          waitSourcesByResource.set(resId, normalizeSource(value, `wait event ${index}`));
        }
        const ts = optionalNonNegativeNumber(value, ['timestamp', 'observedAt', 'logicalTimestamp'], `wait event ${index}.timestamp`) ?? index;
        waitTimestampByResource.set(resId, ts);
      }
      return;
    }

    const mode = normalizeMode(value);
    const syncKind = normalizeSyncKind(value);
    if (
      syncKind === undefined &&
      (mode !== undefined || firstDefined(value, ['location', 'address', 'resourceKey', 'resource', 'resourceId']) !== undefined)
    ) {
      const normalized = normalizeAccess(value, index);
      const clock =
        normalized.providedClock === undefined
          ? tick(state, normalized.threadId, normalized.logicalTimestamp)
          : applyExplicitClock(state, normalized.threadId, normalized.providedClock);
      const explicitLocks = normalized.lockIds;
      const locks =
        explicitLocks.length > 0 || firstDefined(value, ['lockIds', 'lockSet', 'locks']) !== undefined
          ? explicitLocks
          : heldLockIds(state, normalized.threadId);
      accesses.push({
        index: normalized.index,
        id: normalized.id,
        threadId: normalized.threadId,
        location: normalized.location,
        mode: normalized.mode,
        source: normalized.source,
        lockIds: locks,
        logicalTimestamp: normalized.logicalTimestamp,
        clock,
        codeSnippet: normalized.codeSnippet,
      });
      return;
    }

    if (syncKind !== undefined) {
      const syncEvent = normalizeSync(value, index);
      if (syncEvent.kind === 'release' && syncEvent.lockId) {
        waitingWorkersByResource.delete(syncEvent.lockId);
      }
      syncClocks(state, syncEvent);
      return;
    }

    // Trace metadata unrelated to races is harmless; a partially specified
    // access is not, and should fail with an actionable message.
    if (
      firstDefined(value, ['threadId', 'executionId', 'thread', 'mode', 'kind', 'accessType']) !== undefined
    ) {
      throw new Error(`event ${index} is not a valid memory or synchronization event`);
    }
  });

  // Detect Connection Pool / Resource Starvation when >80% of workers are blocked in WAIT on the same resource
  if (allWorkers.size >= 2) {
    for (const [resourceId, waiters] of waitingWorkersByResource.entries()) {
      const ratio = waiters.size / allWorkers.size;
      if (ratio > 0.8 && waiters.size >= 2) {
        const capacity = Math.max(1, allWorkers.size - waiters.size);
        const ts = waitTimestampByResource.get(resourceId) ?? 1000;
        pools.push({
          index: pools.length,
          id: `starvation:${resourceId}`,
          poolId: resourceId,
          capacity,
          inUse: capacity,
          queued: waiters.size,
          observedAt: ts,
          source: waitSourcesByResource.get(resourceId),
        });
      }
    }
  }

  return { accesses, pools };
}

export interface RaceAccessEvidence {
  readonly id: string;
  readonly eventId: string;
  readonly eventIndex: number;
  readonly threadId: string;
  readonly executionId: string;
  readonly location: string;
  readonly address: string;
  readonly mode: MemoryAccessMode;
  readonly kind: MemoryAccessMode;
  readonly source?: SourceCodeReference;
  readonly locationSource?: SourceCodeReference;
  readonly lockIds: readonly string[];
  readonly clock: VectorClockSnapshot;
  readonly vectorClock: VectorClockSnapshot;
  readonly logicalTimestamp?: number;
}

export type RaceConflictKind = 'read-write' | 'write-write';
export type RaceAccessPattern = 'read-write' | 'write-read' | 'write-write';

export interface RaceFinding extends RaceConflict {
  readonly id: string;
  readonly kind: 'data-race';
  readonly conflictKind: RaceConflictKind;
  readonly raceType: RaceConflictKind;
  readonly accessPattern: RaceAccessPattern;
  readonly location: string;
  readonly address: string;
  readonly resourceKey: string;
  readonly resourceId: string;
  readonly workerA: string;
  readonly workerB: string;
  readonly eventA: LockEvent;
  readonly eventB: LockEvent;
  readonly vectorClockA: Record<string, number>;
  readonly vectorClockB: Record<string, number>;
  readonly accessIds: readonly [string, string];
  readonly threadIds: readonly [string, string];
  readonly executionIds: readonly [string, string];
  readonly sourceLocations: readonly [
    SourceCodeReference | undefined,
    SourceCodeReference | undefined,
  ];
  readonly locations: readonly [
    SourceCodeReference | undefined,
    SourceCodeReference | undefined,
  ];
  readonly first: RaceAccessEvidence;
  readonly second: RaceAccessEvidence;
  readonly firstAccess: RaceAccessEvidence;
  readonly secondAccess: RaceAccessEvidence;
  readonly accesses: readonly [RaceAccessEvidence, RaceAccessEvidence];
  readonly clocks: readonly [VectorClockSnapshot, VectorClockSnapshot];
  readonly clockRelation: 'concurrent';
  readonly vectorClockRelation: VectorClockRelation;
  readonly commonLocks: readonly string[];
  readonly explanation: string;
  readonly clockExplanation: string;
}

function toLockEvent(access: NormalizedAccess): LockEvent {
  return {
    id: access.id,
    workerId: access.threadId,
    resourceId: access.location,
    action: access.mode === 'write' ? 'WRITE' : 'READ',
    timestamp: access.logicalTimestamp ?? access.index,
    vectorClock: { ...access.clock },
    file: access.source?.file ?? 'unknown',
    line: access.source?.line ?? 1,
    codeSnippet: access.codeSnippet ?? `${access.mode.toUpperCase()} ${access.location}`,
  };
}

function evidence(access: NormalizedAccess): RaceAccessEvidence {
  const source = cloneSource(access.source);
  const clock = { ...access.clock };
  return {
    id: access.id,
    eventId: access.id,
    eventIndex: access.index,
    threadId: access.threadId,
    executionId: access.threadId,
    location: access.location,
    address: access.location,
    mode: access.mode,
    kind: access.mode,
    source,
    locationSource: cloneSource(source),
    lockIds: [...access.lockIds],
    clock,
    vectorClock: { ...clock },
    logicalTimestamp: access.logicalTimestamp,
  };
}

function formatClock(clock: VectorClockSnapshot): string {
  const entries = Object.entries(clock).sort(([left], [right]) => compareStrings(left, right));
  return `{${entries.map(([threadId, value]) => `${threadId}:${value}`).join(',')}}`;
}

function buildRaceFinding(left: NormalizedAccess, right: NormalizedAccess): RaceFinding {
  const first = evidence(left);
  const second = evidence(right);
  const vectorClockRelation = compareVectorClocks(left.clock, right.clock);
  const accessPattern: RaceAccessPattern =
    left.mode === 'write' && right.mode === 'write'
      ? 'write-write'
      : left.mode === 'read'
        ? 'read-write'
        : 'write-read';
  const conflictKind: RaceConflictKind = accessPattern === 'write-write' ? 'write-write' : 'read-write';
  const sourceLocations: [SourceCodeReference | undefined, SourceCodeReference | undefined] = [
    cloneSource(left.source),
    cloneSource(right.source),
  ];
  const explanation =
    `Concurrent ${conflictKind} access to ${JSON.stringify(left.location)} by ` +
    `${left.threadId} (event ${left.id}, clock ${formatClock(left.clock)}) and ` +
    `${right.threadId} (event ${right.id}, clock ${formatClock(right.clock)}): ` +
    'neither vector clock happens-before the other and no common lock protects both accesses.';
  const id = JSON.stringify(['data-race', left.location, left.index, right.index, accessPattern]);
  return {
    id,
    kind: 'data-race',
    conflictKind,
    raceType: conflictKind,
    accessPattern,
    location: left.location,
    address: left.location,
    resourceKey: left.location,
    resourceId: left.location,
    workerA: left.threadId,
    workerB: right.threadId,
    eventA: toLockEvent(left),
    eventB: toLockEvent(right),
    vectorClockA: { ...left.clock },
    vectorClockB: { ...right.clock },
    accessIds: [left.id, right.id],
    threadIds: [left.threadId, right.threadId],
    executionIds: [left.threadId, right.threadId],
    sourceLocations,
    locations: [cloneSource(sourceLocations[0]), cloneSource(sourceLocations[1])],
    first,
    second,
    firstAccess: first,
    secondAccess: second,
    accesses: [first, second],
    clocks: [{ ...left.clock }, { ...right.clock }],
    clockRelation: 'concurrent',
    vectorClockRelation,
    commonLocks: [],
    explanation,
    clockExplanation: explanation,
  };
}

function compareFindings(left: RaceFinding, right: RaceFinding): number {
  return (
    compareStrings(left.location, right.location) ||
    compareNumbers(left.first.eventIndex, right.first.eventIndex) ||
    compareNumbers(left.second.eventIndex, right.second.eventIndex) ||
    compareStrings(left.accessPattern, right.accessPattern) ||
    compareStrings(left.id, right.id)
  );
}

function findRaces(accesses: readonly NormalizedAccess[]): RaceFinding[] {
  const byLocation = new Map<string, NormalizedAccess[]>();
  for (const access of accesses) {
    const list = byLocation.get(access.location) ?? [];
    list.push(access);
    byLocation.set(access.location, list);
  }
  const findings: RaceFinding[] = [];
  for (const list of byLocation.values()) {
    const sorted = [...list].sort((left, right) => left.index - right.index);
    for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
        const left = sorted[leftIndex];
        const right = sorted[rightIndex];
        if (left.threadId === right.threadId) continue;
        if (left.mode === 'read' && right.mode === 'read') continue;
        if (commonLocks(left.lockIds, right.lockIds).length > 0) continue;
        const clockRelation = compareVectorClocks(left.clock, right.clock);
        if (clockRelation !== 'concurrent') continue;
        findings.push(buildRaceFinding(left, right));
      }
    }
  }
  return findings.sort(compareFindings);
}

export interface PoolStarvationFinding {
  readonly id: string;
  readonly kind: 'connection-pool-starvation';
  readonly poolId: string;
  readonly capacity: number;
  readonly inUse: number;
  readonly queued: number;
  readonly queuedWaiters: number;
  readonly exhausted: true;
  readonly observedAt: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly duration: number;
  readonly durationMs: number;
  readonly peakQueue: number;
  readonly sampleCount: number;
  readonly source?: SourceCodeReference;
  readonly sourceLocations: readonly (SourceCodeReference | undefined)[];
  readonly samples: readonly ConnectionPoolSample[];
  readonly explanation: string;
}

function clonePoolSample(sample: NormalizedPoolSample): ConnectionPoolSample {
  return {
    id: sample.id,
    poolId: sample.poolId,
    capacity: sample.capacity,
    inUse: sample.inUse,
    queued: sample.queued,
    queuedWaiters: sample.queued,
    observedAt: sample.observedAt,
    source: cloneSource(sample.source),
  };
}

function comparePoolSamples(left: NormalizedPoolSample, right: NormalizedPoolSample): number {
  return (
    compareStrings(left.poolId, right.poolId) ||
    compareNumbers(left.observedAt, right.observedAt) ||
    compareNumbers(left.index, right.index) ||
    compareStrings(left.id, right.id)
  );
}

function analyzePoolStarvation(samples: readonly NormalizedPoolSample[]): PoolStarvationFinding[] {
  const byPool = new Map<string, NormalizedPoolSample[]>();
  for (const sample of samples) {
    const list = byPool.get(sample.poolId) ?? [];
    list.push(sample);
    byPool.set(sample.poolId, list);
  }
  const findings: PoolStarvationFinding[] = [];
  for (const [poolId, poolSamples] of byPool.entries()) {
    const sorted = [...poolSamples].sort(comparePoolSamples);
    let episode: NormalizedPoolSample[] = [];
    const closeEpisode = (): void => {
      if (episode.length === 0) return;
      const first = episode[0];
      const last = episode[episode.length - 1];
      const peakQueue = Math.max(...episode.map((sample) => sample.queued));
      const sourceLocations = episode.map((sample) => cloneSource(sample.source));
      const explanation =
        `Pool ${poolId} was exhausted (in use at or above capacity) while ` +
        `queued demand remained; peak queue ${peakQueue} across ${episode.length} sample(s).`;
      findings.push({
        id: JSON.stringify(['connection-pool-starvation', poolId, first.index, last.index]),
        kind: 'connection-pool-starvation',
        poolId,
        capacity: first.capacity,
        inUse: last.inUse,
        queued: last.queued,
        queuedWaiters: last.queued,
        exhausted: true,
        observedAt: first.observedAt,
        startTime: first.observedAt,
        endTime: last.observedAt,
        duration: Math.max(0, last.observedAt - first.observedAt),
        durationMs: Math.max(0, last.observedAt - first.observedAt),
        peakQueue,
        sampleCount: episode.length,
        source: cloneSource(first.source),
        sourceLocations,
        samples: episode.map(clonePoolSample),
        explanation,
      });
      episode = [];
    };

    for (const sample of sorted) {
      if (sample.inUse >= sample.capacity && sample.queued > 0) episode.push(sample);
      else closeEpisode();
    }
    closeEpisode();
  }
  return findings.sort(
    (left, right) =>
      compareStrings(left.poolId, right.poolId) ||
      compareNumbers(left.startTime, right.startTime) ||
      compareStrings(left.id, right.id),
  );
}

export interface RaceAnalysis {
  readonly races: readonly RaceFinding[];
  readonly dataRaces: readonly RaceFinding[];
  readonly poolStarvation: readonly PoolStarvationFinding[];
  readonly poolStarvationFindings: readonly PoolStarvationFinding[];
}

function analyze(input: RaceAnalysisInput | undefined): RaceAnalysis {
  const normalized = normalizeInput(input);
  const races = findRaces(normalized.accesses);
  const poolStarvation = analyzePoolStarvation(normalized.pools);
  return {
    races,
    dataRaces: races,
    poolStarvation,
    poolStarvationFindings: poolStarvation,
  };
}

/** Detect unordered conflicting accesses. The returned value is always an array. */
export function detectRaces(input: RaceAnalysisInput = []): RaceFinding[] {
  return [...analyze(input).races];
}

export function detectDataRaces(input: RaceAnalysisInput = []): RaceFinding[] {
  return detectRaces(input);
}

export function findDataRaces(input: RaceAnalysisInput = []): RaceFinding[] {
  return detectRaces(input);
}

/** Analyze both memory races and connection-pool starvation in one trace. */
export function analyzeRaceTrace(input: RaceAnalysisInput = []): RaceAnalysis {
  return analyze(input);
}

export function analyzeTrace(input: RaceAnalysisInput = []): RaceAnalysis {
  return analyzeRaceTrace(input);
}

export function detectPoolStarvation(input: RaceAnalysisInput = []): PoolStarvationFinding[] {
  return [...analyze(input).poolStarvation];
}

export function detectStarvation(input: RaceAnalysisInput = []): PoolStarvationFinding[] {
  return detectPoolStarvation(input);
}

export function findPoolStarvation(input: RaceAnalysisInput = []): PoolStarvationFinding[] {
  return detectPoolStarvation(input);
}

/** Convenience wrapper mirroring the existing deadlock detector API. */
export class RaceDetector {
  public constructor(private readonly input: RaceAnalysisInput = []) {}

  public detectRaces(input?: RaceAnalysisInput): RaceFinding[] {
    return detectRaces(input ?? this.input);
  }

  public detectDataRaces(input?: RaceAnalysisInput): RaceFinding[] {
    return this.detectRaces(input);
  }

  public findDataRaces(input?: RaceAnalysisInput): RaceFinding[] {
    return this.detectRaces(input);
  }

  public detect(input?: RaceAnalysisInput): RaceFinding[] {
    return this.detectRaces(input);
  }

  public detectPoolStarvation(input?: RaceAnalysisInput): PoolStarvationFinding[] {
    return detectPoolStarvation(input ?? this.input);
  }

  public detectStarvation(input?: RaceAnalysisInput): PoolStarvationFinding[] {
    return this.detectPoolStarvation(input);
  }

  public findPoolStarvation(input?: RaceAnalysisInput): PoolStarvationFinding[] {
    return this.detectPoolStarvation(input);
  }

  public analyze(input?: RaceAnalysisInput): RaceAnalysis {
    return analyzeRaceTrace(input ?? this.input);
  }

  public analyzeTrace(input?: RaceAnalysisInput): RaceAnalysis {
    return this.analyze(input);
  }
}
