/**
 * Deterministic virtual-time lock scheduling simulator.
 *
 * Each worker that appears in an ingested trace becomes a "program": the ordered
 * list of lock acquisitions (ACQUIRE / WAIT) and memory accesses (READ / WRITE) it
 * performed. N virtual workers replay those programs round-robin under a seeded
 * random scheduler with real lock ownership semantics:
 *
 * - A lock step succeeds only if the resource is free (or already held by the worker).
 * - A worker blocked for at least `deadlockDetectionMs` triggers wait-for cycle
 *   detection (like PostgreSQL's `deadlock_timeout`); one victim per cycle is aborted.
 * - A worker blocked for `lockTimeoutMs` aborts its request.
 * - An access to a resource the worker does not hold a lock on is "unprotected";
 *   two in-flight requests touching the same resource unprotected, where at least
 *   one writes, is counted as a race and both requests fail.
 *
 * The "after" run applies the remediation the tool recommends: every lock set is
 * acquired in one canonical (sorted) order and every unprotected resource gets a
 * guard lock. The model captures ordering and synchronization only; it does not know
 * real I/O or critical-section durations, so it is not a substitute for a load test.
 */

import type {
  ChaosBenchmarkResult,
  LockEvent,
  SimulationConfig,
  SimulationMetrics,
} from '../shared/types';

export type { ChaosBenchmarkResult, SimulationConfig, SimulationMetrics } from '../shared/types';

export const DEFAULT_WORKER_COUNT = 500;

export const SIMULATION_DEFAULTS = {
  requestsPerWorker: 3,
  lockTimeoutMs: 10_000,
  deadlockDetectionMs: 1_000,
  workMs: 2,
  maxVirtualMs: 60_000,
} as const;

export const SIMULATION_LIMITS = {
  maxWorkers: 5_000,
  maxRequestsPerWorker: 20,
  maxVirtualMs: 600_000,
  /**
   * Hard CPU budget per run, counted in worker scheduling steps (~0.5 s on a modern core).
   * Runs that exceed it stop early and report `truncated: true`.
   */
  maxWorkerSteps: 15_000_000,
} as const;

export interface SimulationOptions {
  workers?: number;
  requestsPerWorker?: number;
  seed?: number;
  lockTimeoutMs?: number;
  deadlockDetectionMs?: number;
  workMs?: number;
  maxVirtualMs?: number;
}

export class SimulationInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SimulationInputError';
  }
}

type Step =
  | { readonly kind: 'lock'; readonly resource: string }
  | { readonly kind: 'access'; readonly resource: string; readonly write: boolean };

type Program = readonly Step[];

/**
 * Calculate a percentile using linear interpolation between closest ranks.
 * `percentile` accepts either a fraction (0..1) or a percentage (0..100).
 */
export function calculatePercentile(samples: readonly number[], percentile: number): number {
  if (samples.length === 0) return 0;
  if (!Number.isFinite(percentile) || percentile < 0 || percentile > 100) {
    throw new RangeError('percentile must be between 0 and 1 (or 0 and 100)');
  }
  const fraction = percentile > 1 ? percentile / 100 : percentile;
  const sorted = [...samples].sort((left, right) => left - right);
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** Stable 32-bit FNV-1a hash used to derive a default seed from the trace contents. */
export function hashTraceSeed(events: readonly LockEvent[]): number {
  let hash = 0x811c9dc5;
  for (const event of events) {
    const token = `${event.workerId}|${event.action}|${event.resourceId};`;
    for (let index = 0; index < token.length; index += 1) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return hash >>> 0;
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Derive one program per trace worker, ordered by timestamp (ties keep trace order). */
export function deriveWorkerPrograms(events: readonly LockEvent[]): Map<string, Program> {
  const ordered = events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => left.event.timestamp - right.event.timestamp || left.index - right.index);
  const programs = new Map<string, Step[]>();
  const lockedByWorker = new Map<string, Set<string>>();

  for (const { event } of ordered) {
    const program = programs.get(event.workerId) ?? [];
    const locked = lockedByWorker.get(event.workerId) ?? new Set<string>();
    if (event.action === 'ACQUIRE' || event.action === 'WAIT') {
      if (!locked.has(event.resourceId)) {
        program.push({ kind: 'lock', resource: event.resourceId });
        locked.add(event.resourceId);
      }
    } else if (event.action === 'READ' || event.action === 'WRITE') {
      program.push({ kind: 'access', resource: event.resourceId, write: event.action === 'WRITE' });
    }
    programs.set(event.workerId, program);
    lockedByWorker.set(event.workerId, locked);
  }

  for (const [workerId, program] of programs) {
    if (program.length === 0) programs.delete(workerId);
  }
  return programs;
}

function compareResources(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The canonical order: every lock resource, plus every resource accessed without a lock. */
export function canonicalLockOrderFor(programs: ReadonlyMap<string, Program>): string[] {
  const resources = new Set<string>();
  for (const program of programs.values()) {
    for (const step of program) resources.add(step.resource);
  }
  return [...resources].sort(compareResources);
}

/** Apply the recommended remediation: sorted lock acquisition plus guard locks for accesses. */
export function patchProgram(program: Program): Program {
  const locks = new Set<string>();
  const accesses: Step[] = [];
  for (const step of program) {
    locks.add(step.resource);
    if (step.kind === 'access') accesses.push(step);
  }
  const sortedLocks: Step[] = [...locks]
    .sort(compareResources)
    .map((resource) => ({ kind: 'lock', resource }));
  return [...sortedLocks, ...accesses];
}

interface VirtualWorker {
  readonly program: Program;
  stepIndex: number;
  held: Set<string>;
  waitingOn: string | null;
  waitStart: number;
  /** Whether this wait has already run its one deadlock check (as in PostgreSQL's deadlock_timeout). */
  deadlockChecked: boolean;
  requestStart: number;
  requestsStarted: number;
  workRemaining: number;
  corrupted: boolean;
  serial: number;
  touched: Set<string>;
  done: boolean;
}

interface UnprotectedAccess {
  readonly serial: number;
  readonly write: boolean;
}

function runSimulation(templates: readonly Program[], config: SimulationConfig): SimulationMetrics {
  const random = createRandom(config.seed);
  const workers: VirtualWorker[] = Array.from({ length: config.workers }, (_, index) => ({
    program: templates[index % templates.length],
    stepIndex: 0,
    held: new Set<string>(),
    waitingOn: null,
    waitStart: 0,
    deadlockChecked: false,
    requestStart: 0,
    requestsStarted: 1,
    workRemaining: -1,
    corrupted: false,
    serial: 0,
    touched: new Set<string>(),
    done: false,
  }));
  const holders = new Map<string, number>();
  const unprotected = new Map<string, Map<number, UnprotectedAccess>>();
  const latencies: number[] = [];
  const order = workers.map((_, index) => index);

  let completed = 0;
  let deadlocks = 0;
  let races = 0;
  let timeouts = 0;
  let aborted = 0;
  let corruptedFailures = 0;
  let finishedWorkers = 0;
  let tick = 0;
  let workerSteps = 0;
  let truncated = false;

  const releaseAll = (index: number): void => {
    const worker = workers[index];
    for (const resource of worker.held) {
      if (holders.get(resource) === index) holders.delete(resource);
    }
    worker.held.clear();
    for (const resource of worker.touched) unprotected.get(resource)?.delete(index);
    worker.touched.clear();
  };

  const startNextRequest = (index: number, now: number): void => {
    const worker = workers[index];
    worker.stepIndex = 0;
    worker.waitingOn = null;
    worker.workRemaining = -1;
    worker.corrupted = false;
    worker.serial += 1;
    if (worker.requestsStarted >= config.requestsPerWorker) {
      worker.done = true;
      finishedWorkers += 1;
      return;
    }
    worker.requestsStarted += 1;
    worker.requestStart = now + 1;
  };

  const finishRequest = (index: number, now: number): void => {
    const worker = workers[index];
    if (worker.corrupted) corruptedFailures += 1;
    else {
      completed += 1;
      latencies.push(now - worker.requestStart + 1);
    }
    releaseAll(index);
    startNextRequest(index, now);
  };

  const abortRequest = (index: number, now: number): void => {
    aborted += 1;
    releaseAll(index);
    startNextRequest(index, now);
  };

  const recordAccess = (index: number, resource: string, write: boolean): void => {
    const worker = workers[index];
    if (worker.held.has(resource)) return;
    const accessors = unprotected.get(resource) ?? new Map<number, UnprotectedAccess>();
    let conflicted = false;
    for (const [other, access] of accessors) {
      if (other === index || workers[other].serial !== access.serial) continue;
      if (write || access.write) {
        conflicted = true;
        workers[other].corrupted = true;
      }
    }
    if (conflicted) {
      races += 1;
      worker.corrupted = true;
    }
    const previous = accessors.get(index);
    accessors.set(index, { serial: worker.serial, write: write || (previous?.write ?? false) });
    unprotected.set(resource, accessors);
    worker.touched.add(resource);
  };

  /**
   * Follow the wait-for chain from a worker whose wait just reached the detection delay.
   * Each blocked worker waits on exactly one holder, so the chain either ends or loops.
   * If the starting worker is on a cycle, abort one victim (the highest index) to break it.
   */
  const checkForDeadlock = (start: number, now: number): void => {
    const visited = new Set<number>();
    let current: number | undefined = start;
    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      const waitingOn: string | null = workers[current].waitingOn;
      current = waitingOn === null ? undefined : holders.get(waitingOn);
    }
    if (current !== start) return;
    const cycle: number[] = [];
    let member = start;
    do {
      cycle.push(member);
      member = holders.get(workers[member].waitingOn as string) as number;
    } while (member !== start);
    deadlocks += 1;
    abortRequest(Math.max(...cycle), now);
  };

  while (finishedWorkers < workers.length && tick < config.maxVirtualMs) {
    workerSteps += workers.length;
    if (workerSteps > SIMULATION_LIMITS.maxWorkerSteps) {
      truncated = true;
      break;
    }
    for (let index = order.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [order[index], order[swap]] = [order[swap], order[index]];
    }

    let progressed = false;
    const dueForCheck: number[] = [];

    for (const index of order) {
      const worker = workers[index];
      if (worker.done || worker.requestStart > tick) continue;

      if (worker.workRemaining > 0) {
        worker.workRemaining -= 1;
        progressed = true;
        if (worker.workRemaining === 0) finishRequest(index, tick);
        continue;
      }

      const step = worker.program[worker.stepIndex];
      if (step === undefined) {
        progressed = true;
        if (config.workMs <= 1) finishRequest(index, tick);
        else worker.workRemaining = config.workMs - 1;
        continue;
      }

      if (step.kind === 'access') {
        recordAccess(index, step.resource, step.write);
        worker.stepIndex += 1;
        progressed = true;
        continue;
      }

      const holder = holders.get(step.resource);
      if (holder === undefined || holder === index) {
        holders.set(step.resource, index);
        worker.held.add(step.resource);
        worker.waitingOn = null;
        worker.stepIndex += 1;
        progressed = true;
        continue;
      }

      if (worker.waitingOn !== step.resource) {
        worker.waitingOn = step.resource;
        worker.waitStart = tick;
        worker.deadlockChecked = false;
      }
      const waited = tick - worker.waitStart;
      if (waited >= config.lockTimeoutMs) {
        timeouts += 1;
        abortRequest(index, tick);
        progressed = true;
      } else if (waited >= config.deadlockDetectionMs && !worker.deadlockChecked) {
        worker.deadlockChecked = true;
        dueForCheck.push(index);
      }
    }

    for (const index of dueForCheck) {
      // A previous check this tick may already have aborted this worker's request.
      if (workers[index].waitingOn !== null) checkForDeadlock(index, tick);
    }

    if (!progressed && dueForCheck.length === 0) {
      // Every runnable worker is blocked: jump straight to the next timeout or detection point.
      let next = config.maxVirtualMs;
      for (const worker of workers) {
        if (worker.done) continue;
        if (worker.requestStart > tick) next = Math.min(next, worker.requestStart);
        else if (worker.waitingOn !== null) {
          next = Math.min(
            next,
            worker.deadlockChecked
              ? worker.waitStart + config.lockTimeoutMs
              : worker.waitStart + config.deadlockDetectionMs,
          );
        }
      }
      tick = Math.max(tick + 1, next);
      continue;
    }
    tick += 1;
  }

  const totalRequests = config.workers * config.requestsPerWorker;
  const unfinished = totalRequests - completed - corruptedFailures - aborted;
  const durationMs = Math.max(1, tick);
  if (tick >= config.maxVirtualMs && unfinished > 0) truncated = true;
  return {
    truncated,
    workers: config.workers,
    totalRequests,
    completedRequests: completed,
    failedRequests: totalRequests - completed,
    deadlocksTriggered: deadlocks,
    raceConditionsTriggered: races,
    lockTimeouts: timeouts,
    unfinishedRequests: unfinished,
    throughputReqPerSec: Math.round((completed / durationMs) * 100_000) / 100,
    p50Ms: Math.round(calculatePercentile(latencies, 0.5)),
    p95Ms: Math.round(calculatePercentile(latencies, 0.95)),
    p99Ms: Math.round(calculatePercentile(latencies, 0.99)),
    successRatePct: Math.round((completed / totalRequests) * 1_000) / 10,
    virtualDurationMs: tick,
  };
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new SimulationInputError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function resolveSimulationConfig(events: readonly LockEvent[], options: SimulationOptions = {}): SimulationConfig {
  const maxVirtualMs = boundedInteger(options.maxVirtualMs, SIMULATION_DEFAULTS.maxVirtualMs, 100, SIMULATION_LIMITS.maxVirtualMs, 'maxVirtualMs');
  return {
    workers: boundedInteger(options.workers, DEFAULT_WORKER_COUNT, 1, SIMULATION_LIMITS.maxWorkers, 'workers'),
    requestsPerWorker: boundedInteger(options.requestsPerWorker, SIMULATION_DEFAULTS.requestsPerWorker, 1, SIMULATION_LIMITS.maxRequestsPerWorker, 'requestsPerWorker'),
    seed: boundedInteger(options.seed, hashTraceSeed(events), 0, 0xffffffff, 'seed'),
    lockTimeoutMs: boundedInteger(options.lockTimeoutMs, SIMULATION_DEFAULTS.lockTimeoutMs, 1, maxVirtualMs, 'lockTimeoutMs'),
    deadlockDetectionMs: boundedInteger(options.deadlockDetectionMs, SIMULATION_DEFAULTS.deadlockDetectionMs, 1, maxVirtualMs, 'deadlockDetectionMs'),
    workMs: boundedInteger(options.workMs, SIMULATION_DEFAULTS.workMs, 1, 1_000, 'workMs'),
    maxVirtualMs,
  };
}

/**
 * Replay a trace's lock programs across many virtual workers, once as recorded and once
 * with the canonical lock-order remediation applied, and report measured metrics.
 */
export function runChaosBenchmark(events: readonly LockEvent[], options: SimulationOptions = {}): ChaosBenchmarkResult {
  const programs = deriveWorkerPrograms(events);
  if (programs.size === 0) {
    throw new SimulationInputError(
      'Trace contains no ACQUIRE, WAIT, READ, or WRITE steps to simulate.',
    );
  }
  const config = resolveSimulationConfig(events, options);
  const templates = [...programs.keys()].sort(compareResources).map((workerId) => programs.get(workerId)!);
  const before = runSimulation(templates, config);
  const after = runSimulation(templates.map(patchProgram), config);
  return {
    config,
    canonicalLockOrder: canonicalLockOrderFor(programs),
    before,
    after,
    improvementFactor:
      before.completedRequests > 0
        ? Math.round(
            ((after.completedRequests / Math.max(1, after.virtualDurationMs)) /
              (before.completedRequests / Math.max(1, before.virtualDurationMs))) *
              100,
          ) / 100
        : null,
  };
}
