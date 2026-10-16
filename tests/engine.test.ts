import { describe, expect, it } from 'vitest';
import { buildWaitForGraph } from '../src/engine/graph';
import { detectDeadlocks } from '../src/engine/deadlockDetector';
import { detectRaces, detectStarvation } from '../src/engine/raceDetector';
import { generateRemediationPlan } from '../src/engine/remediator';
import { runChaosBenchmark } from '../src/engine/simulator';
import {
  ABBA_DEADLOCK_TRACE,
  CANONICAL_SAFE_TRACE,
  POOL_STARVATION_TRACE,
  THREE_NODE_DEADLOCK_TRACE,
  VECTOR_CLOCK_RACE_TRACE,
} from './fixtures/traces';

describe('DeadlockZero Engine — Tarjan SCC, Vector Clocks & 500-Worker Chaos Simulator', () => {
  it('detects a 2-node AB-BA deadlock cycle using Tarjan SCC', () => {
    const graph = buildWaitForGraph(ABBA_DEADLOCK_TRACE);
    const cycles = detectDeadlocks(graph);

    expect(cycles).toHaveLength(1);
    expect(cycles[0].cycle).toEqual(['Worker_1', 'Worker_2']);
    expect(cycles[0].cycleNodes).toEqual([
      'Worker_1',
      'Account_B',
      'Worker_2',
      'Account_A',
      'Worker_1',
    ]);
    expect(cycles[0].offendingLines.length).toBeGreaterThanOrEqual(2);
    expect(graph.nodes.every((n) => n.inCycle)).toBe(true);
    expect(graph.edges.every((e) => e.inCycle)).toBe(true);
  });

  it('detects a 3-node circular RPC deadlock cycle', () => {
    const graph = buildWaitForGraph(THREE_NODE_DEADLOCK_TRACE);
    const cycles = detectDeadlocks(graph);

    expect(cycles).toHaveLength(1);
    expect(cycles[0].cycle).toHaveLength(3);
    expect(cycles[0].cycle).toEqual(
      expect.arrayContaining(['OrderService', 'InventoryService', 'BillingService']),
    );
    expect(cycles[0].cycleNodes).toContain('OrderMutex');
    expect(cycles[0].cycleNodes).toContain('StockMutex');
    expect(cycles[0].cycleNodes).toContain('InvoiceMutex');
  });

  it('verifies cycle-free canonical lock hierarchies produce zero deadlocks', () => {
    const graph = buildWaitForGraph(CANONICAL_SAFE_TRACE);
    const cycles = detectDeadlocks(graph);

    expect(cycles).toHaveLength(0);
    expect(graph.nodes.some((n) => n.inCycle)).toBe(false);
  });

  it('detects concurrent Lamport vector-clock conflicts', () => {
    const races = detectRaces(VECTOR_CLOCK_RACE_TRACE);

    expect(races.length).toBeGreaterThan(0);
    const writeWriteRace = races.find(
      (r) => r.eventA.action === 'WRITE' && r.eventB.action === 'WRITE',
    );
    expect(writeWriteRace).toBeDefined();
    expect(writeWriteRace?.resourceId).toBe('sku_99_stock');
    expect(writeWriteRace?.vectorClockA).toEqual({ w1: 2, w2: 1 });
    expect(writeWriteRace?.vectorClockB).toEqual({ w1: 1, w2: 2 });
  });

  it('detects connection pool starvation when >80% of workers block in WAIT', () => {
    const starvation = detectStarvation(POOL_STARVATION_TRACE);

    expect(starvation.length).toBeGreaterThan(0);
    expect(starvation[0].poolId).toBe('pg_tx_pool');
    expect(starvation[0].queued).toBeGreaterThanOrEqual(5);
  });

  it('runs deterministic 500-worker chaos simulations and generates remediation plans', () => {
    const traces = [
      ABBA_DEADLOCK_TRACE,
      THREE_NODE_DEADLOCK_TRACE,
      VECTOR_CLOCK_RACE_TRACE,
      POOL_STARVATION_TRACE,
    ];

    for (const trace of traces) {
      const run1 = runChaosBenchmark(trace, 500);
      const run2 = runChaosBenchmark(trace, 500);

      expect(run1).toEqual(run2);
      expect(run1.before.workers).toBe(500);
      expect(run1.after.workers).toBe(500);
      expect(run1.before.throughputReqPerSec).toBeLessThan(run1.after.throughputReqPerSec);
      expect(run1.before.p99Ms).toBeGreaterThan(4000);
      expect(run1.after.deadlocksTriggered).toBe(0);
      expect(run1.after.raceConditionsTriggered).toBe(0);
      expect(run1.after.successRatePct).toBe(100);
      expect(run1.improvementFactor).toBeGreaterThan(10);

      const plan = generateRemediationPlan(trace);
      expect(plan.unifiedDiff).toContain('--- a/');
      expect(plan.unifiedDiff).toContain('+++ b/');
      expect(plan.runbookMarkdown).toContain('3 a.m. Outage Runbook Checklist');
    }
  });
});
