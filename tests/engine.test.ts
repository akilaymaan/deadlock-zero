import { describe, expect, it } from 'vitest';
import { buildWaitForGraph } from '../src/engine/graph';
import { detectDeadlocks } from '../src/engine/deadlockDetector';
import { detectRaces, detectStarvation } from '../src/engine/raceDetector';
import { generateRemediationPlan } from '../src/engine/remediator';
import { runChaosBenchmark } from '../src/engine/simulator';
import { getScenarioPreset, INCIDENT_PRESETS } from '../src/scenarios/presets';
import type { LockEvent } from '../src/shared/types';

describe('DeadlockZero Engine — Tarjan SCC, Vector Clocks & 500-Worker Chaos Simulator', () => {
  it('detects a 2-node AB-BA deadlock cycle using Tarjan SCC on payment-abba-deadlock', () => {
    const preset = getScenarioPreset('payment-abba-deadlock');
    expect(preset).toBeDefined();

    const graph = buildWaitForGraph(preset.events);
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

  it('detects a 3-node circular RPC deadlock cycle on microservice-circular-rpc', () => {
    const preset = getScenarioPreset('microservice-circular-rpc');
    const graph = buildWaitForGraph(preset.events);
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
    const canonicalEvents: LockEvent[] = [
      {
        id: 'c1',
        workerId: 'Worker_1',
        resourceId: 'Account_A',
        action: 'ACQUIRE',
        timestamp: 10,
        vectorClock: { Worker_1: 1, Worker_2: 0 },
        file: 'src/services/ledger.ts',
        line: 41,
        codeSnippet: 'await tx.acquireRowLock("Account_A");',
      },
      {
        id: 'c2',
        workerId: 'Worker_1',
        resourceId: 'Account_B',
        action: 'ACQUIRE',
        timestamp: 12,
        vectorClock: { Worker_1: 2, Worker_2: 0 },
        file: 'src/services/ledger.ts',
        line: 42,
        codeSnippet: 'await tx.acquireRowLock("Account_B");',
      },
      {
        id: 'c3',
        workerId: 'Worker_2',
        resourceId: 'Account_A',
        action: 'WAIT',
        timestamp: 15,
        vectorClock: { Worker_1: 0, Worker_2: 1 },
        file: 'src/services/ledger.ts',
        line: 41,
        codeSnippet: 'await tx.acquireRowLock("Account_A");',
      },
    ];

    const graph = buildWaitForGraph(canonicalEvents);
    const cycles = detectDeadlocks(graph);

    expect(cycles).toHaveLength(0);
    expect(graph.nodes.some((n) => n.inCycle)).toBe(false);
  });

  it('detects concurrent Lamport vector-clock conflicts on inventory-double-spend', () => {
    const preset = getScenarioPreset('inventory-double-spend');
    const races = detectRaces(preset.events);

    expect(races.length).toBeGreaterThan(0);
    const writeWriteRace = races.find(
      (r) => r.eventA.action === 'WRITE' && r.eventB.action === 'WRITE',
    );
    expect(writeWriteRace).toBeDefined();
    expect(writeWriteRace?.resourceId).toBe('sku_99_stock');
    expect(writeWriteRace?.vectorClockA).toEqual({ w1: 2, w2: 1 });
    expect(writeWriteRace?.vectorClockB).toEqual({ w1: 1, w2: 2 });
  });

  it('detects connection pool starvation when >80% of workers block in WAIT on db-pool-starvation', () => {
    const preset = getScenarioPreset('db-pool-starvation');
    const starvation = detectStarvation(preset.events);

    expect(starvation.length).toBeGreaterThan(0);
    expect(starvation[0].poolId).toBe('pg_tx_pool');
    expect(starvation[0].queued).toBeGreaterThanOrEqual(5);
  });

  it('runs deterministic 500-worker chaos simulations and generates remediation plans across all 5 presets', () => {
    expect(INCIDENT_PRESETS).toHaveLength(5);

    for (const preset of INCIDENT_PRESETS) {
      const run1 = runChaosBenchmark(preset.events, 500);
      const run2 = runChaosBenchmark(preset.events, 500);

      expect(run1).toEqual(run2);
      expect(run1.before.workers).toBe(500);
      expect(run1.after.workers).toBe(500);
      expect(run1.before.throughputReqPerSec).toBeLessThan(run1.after.throughputReqPerSec);
      expect(run1.before.p99Ms).toBeGreaterThan(4000);
      expect(run1.after.deadlocksTriggered).toBe(0);
      expect(run1.after.raceConditionsTriggered).toBe(0);
      expect(run1.after.successRatePct).toBe(100);
      expect(run1.improvementFactor).toBeGreaterThan(10);

      const plan = generateRemediationPlan(preset);
      expect(plan.unifiedDiff).toContain('--- a/');
      expect(plan.unifiedDiff).toContain('+++ b/');
      expect(plan.runbookMarkdown).toContain('3 a.m. Outage Runbook Checklist');
    }
  });
});
