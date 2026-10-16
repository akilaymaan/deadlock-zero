import { describe, expect, it } from 'vitest';
import {
  calculatePercentile,
  deriveWorkerPrograms,
  patchProgram,
  runChaosBenchmark,
  SimulationInputError,
} from '../src/engine/simulator';
import type { LockEvent } from '../src/shared/types';
import {
  ABBA_DEADLOCK_TRACE,
  CANONICAL_SAFE_TRACE,
  THREE_NODE_DEADLOCK_TRACE,
  VECTOR_CLOCK_RACE_TRACE,
} from './fixtures/traces';

const SMALL = { workers: 50, requestsPerWorker: 2 } as const;

describe('virtual-time simulator', () => {
  it('derives per-worker lock programs from the trace in timestamp order', () => {
    const programs = deriveWorkerPrograms(ABBA_DEADLOCK_TRACE);
    expect(programs.get('Worker_1')?.map((step) => step.resource)).toEqual(['Account_A', 'Account_B']);
    expect(programs.get('Worker_2')?.map((step) => step.resource)).toEqual(['Account_B', 'Account_A']);
  });

  it('patches programs into canonical order and guards unprotected accesses', () => {
    const programs = deriveWorkerPrograms(VECTOR_CLOCK_RACE_TRACE);
    expect(patchProgram(programs.get('w1')!)).toEqual([
      { kind: 'lock', resource: 'sku_99_stock' },
      { kind: 'access', resource: 'sku_99_stock', write: false },
      { kind: 'access', resource: 'sku_99_stock', write: true },
    ]);
  });

  it('produces real deadlocks for the recorded AB-BA order and none after the canonical fix', () => {
    const result = runChaosBenchmark(ABBA_DEADLOCK_TRACE, SMALL);
    expect(result.before.deadlocksTriggered).toBeGreaterThan(0);
    expect(result.before.failedRequests).toBeGreaterThan(0);
    expect(result.after.deadlocksTriggered).toBe(0);
    expect(result.after.lockTimeouts).toBe(0);
    expect(result.after.completedRequests).toBe(result.after.totalRequests);
    expect(result.canonicalLockOrder).toEqual(['Account_A', 'Account_B']);
  });

  it('handles 3-node cycles the same way', () => {
    const result = runChaosBenchmark(THREE_NODE_DEADLOCK_TRACE, SMALL);
    expect(result.before.deadlocksTriggered).toBeGreaterThan(0);
    expect(result.after.deadlocksTriggered).toBe(0);
    expect(result.after.successRatePct).toBe(100);
  });

  it('counts races for unsynchronized writes and removes them with guard locks', () => {
    const result = runChaosBenchmark(VECTOR_CLOCK_RACE_TRACE, SMALL);
    expect(result.before.raceConditionsTriggered).toBeGreaterThan(0);
    expect(result.after.raceConditionsTriggered).toBe(0);
    expect(result.after.completedRequests).toBe(result.after.totalRequests);
  });

  it('reports identical results when the trace is already safe (no invented improvement)', () => {
    const result = runChaosBenchmark(CANONICAL_SAFE_TRACE, SMALL);
    expect(result.before).toEqual(result.after);
    expect(result.improvementFactor).toBe(1);
  });

  it('is deterministic for the same trace and seed, and sensitive to the seed', () => {
    expect(runChaosBenchmark(ABBA_DEADLOCK_TRACE, SMALL)).toEqual(runChaosBenchmark(ABBA_DEADLOCK_TRACE, SMALL));
    const a = runChaosBenchmark(ABBA_DEADLOCK_TRACE, { ...SMALL, seed: 1 });
    const b = runChaosBenchmark(ABBA_DEADLOCK_TRACE, { ...SMALL, seed: 2 });
    expect(a.config.seed).toBe(1);
    expect(b.config.seed).toBe(2);
  });

  it('keeps its accounting consistent', () => {
    for (const trace of [ABBA_DEADLOCK_TRACE, VECTOR_CLOCK_RACE_TRACE]) {
      const { before } = runChaosBenchmark(trace, SMALL);
      expect(before.totalRequests).toBe(SMALL.workers * SMALL.requestsPerWorker);
      expect(before.completedRequests + before.failedRequests).toBe(before.totalRequests);
      expect(before.p50Ms).toBeLessThanOrEqual(before.p95Ms);
      expect(before.p95Ms).toBeLessThanOrEqual(before.p99Ms);
    }
  });

  it('stops at the virtual time budget and says so', () => {
    const result = runChaosBenchmark(ABBA_DEADLOCK_TRACE, { ...SMALL, maxVirtualMs: 200 });
    expect(result.before.truncated).toBe(true);
    expect(result.before.unfinishedRequests).toBeGreaterThan(0);
  });

  it('rejects out-of-range options and traces with nothing to simulate', () => {
    expect(() => runChaosBenchmark(ABBA_DEADLOCK_TRACE, { workers: 0 })).toThrow(SimulationInputError);
    expect(() => runChaosBenchmark(ABBA_DEADLOCK_TRACE, { workers: 5_001 })).toThrow(SimulationInputError);
    const releasesOnly: LockEvent[] = [{ ...ABBA_DEADLOCK_TRACE[0], action: 'RELEASE' }];
    expect(() => runChaosBenchmark(releasesOnly)).toThrow(/no ACQUIRE, WAIT, READ, or WRITE/);
  });

  it('computes percentiles with linear interpolation', () => {
    expect(calculatePercentile([], 0.5)).toBe(0);
    expect(calculatePercentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(calculatePercentile([10, 20], 100)).toBe(20);
  });
});
