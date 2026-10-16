import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../src/engine/analyze';
import { detectDeadlocks } from '../src/engine/deadlockDetector';
import { buildWaitForGraph } from '../src/engine/graph';
import { detectRaces, detectStarvation } from '../src/engine/raceDetector';
import { buildUnifiedDiff, generateRemediationPlan, observedLockOrders } from '../src/engine/remediator';
import {
  ABBA_DEADLOCK_TRACE,
  CANONICAL_SAFE_TRACE,
  POOL_STARVATION_TRACE,
  THREE_NODE_DEADLOCK_TRACE,
  VECTOR_CLOCK_RACE_TRACE,
} from './fixtures/traces';

describe('deadlock detection on traces', () => {
  it('finds the 2-node AB-BA cycle and marks every node and edge in it', () => {
    const graph = buildWaitForGraph(ABBA_DEADLOCK_TRACE);
    const cycles = detectDeadlocks(graph);

    expect(cycles).toHaveLength(1);
    expect(cycles[0].cycle).toEqual(['Worker_1', 'Worker_2']);
    expect(cycles[0].cycleNodes).toEqual(['Worker_1', 'Account_B', 'Worker_2', 'Account_A', 'Worker_1']);
    expect(cycles[0].offendingLines.map((line) => line.line).sort()).toEqual([41, 42, 48, 49]);
    expect(graph.nodes.every((node) => node.inCycle)).toBe(true);
    expect(graph.edges.every((edge) => edge.inCycle)).toBe(true);
  });

  it('finds a 3-node circular wait', () => {
    const cycles = detectDeadlocks(buildWaitForGraph(THREE_NODE_DEADLOCK_TRACE));
    expect(cycles).toHaveLength(1);
    expect([...cycles[0].cycle].sort()).toEqual(['BillingService', 'InventoryService', 'OrderService']);
    expect(cycles[0].cycleNodes).toEqual(expect.arrayContaining(['OrderMutex', 'StockMutex', 'InvoiceMutex']));
  });

  it('reports no cycle for a canonically ordered trace', () => {
    const graph = buildWaitForGraph(CANONICAL_SAFE_TRACE);
    expect(detectDeadlocks(graph)).toHaveLength(0);
    expect(graph.nodes.some((node) => node.inCycle)).toBe(false);
  });

  it('orders events by timestamp, not array position', () => {
    const shuffled = [...ABBA_DEADLOCK_TRACE].reverse();
    expect(detectDeadlocks(buildWaitForGraph(shuffled))).toHaveLength(1);
  });
});

describe('race and starvation detection on traces', () => {
  it('reports the concurrent write/write conflict with both vector clocks', () => {
    const race = detectRaces(VECTOR_CLOCK_RACE_TRACE).find(
      (finding) => finding.eventA.action === 'WRITE' && finding.eventB.action === 'WRITE',
    );
    expect(race).toBeDefined();
    expect(race?.resourceId).toBe('sku_99_stock');
    expect(race?.vectorClockA).toEqual({ w1: 2, w2: 1 });
    expect(race?.vectorClockB).toEqual({ w1: 1, w2: 2 });
  });

  it('does not report races when one access happens-before the other', () => {
    const ordered = VECTOR_CLOCK_RACE_TRACE.map((event) =>
      event.workerId === 'w2'
        ? { ...event, vectorClock: { w1: 5, w2: event.vectorClock.w2 + 5 } }
        : event,
    );
    expect(detectRaces(ordered)).toHaveLength(0);
  });

  it('finds the same race when events arrive out of order', () => {
    expect(analyzeTrace([...VECTOR_CLOCK_RACE_TRACE].reverse()).races.length).toBe(detectRaces(VECTOR_CLOCK_RACE_TRACE).length);
  });

  it('flags starvation when more than 80% of workers wait on one resource', () => {
    const findings = detectStarvation(POOL_STARVATION_TRACE);
    expect(findings).toHaveLength(1);
    expect(findings[0].poolId).toBe('pg_tx_pool');
  });
});

describe('remediation guidance', () => {
  it('derives the canonical order and each worker\'s observed order from the trace', () => {
    expect(Object.fromEntries(observedLockOrders(ABBA_DEADLOCK_TRACE))).toEqual({
      Worker_1: ['Account_A', 'Account_B'],
      Worker_2: ['Account_B', 'Account_A'],
    });
    const { remediation } = analyzeTrace(ABBA_DEADLOCK_TRACE);
    expect(remediation.strategy).toBe('canonical-lock-order');
    expect(remediation.canonicalLockOrder).toEqual(['Account_A', 'Account_B']);
    expect(remediation.patchedCode).toContain('Worker_2: observed Account_B -> Account_A ; must become Account_A -> Account_B');
    expect(remediation.patchedCode).toContain('Worker_1: observed Account_A -> Account_B (already canonical)');
    expect(remediation.brokenCode).toContain('src/services/ledger.ts:48');
    expect(remediation.generated).toBe(true);
  });

  it('chooses a strategy matching the finding', () => {
    expect(analyzeTrace(VECTOR_CLOCK_RACE_TRACE).remediation.strategy).toBe('guard-shared-state');
    expect(analyzeTrace(POOL_STARVATION_TRACE).remediation.strategy).toBe('shorten-lock-hold-time');
    expect(analyzeTrace(CANONICAL_SAFE_TRACE).remediation.strategy).toBe('none-required');
  });

  it('uses user-supplied source code as the before side when given', () => {
    const plan = generateRemediationPlan({ events: ABBA_DEADLOCK_TRACE, sourceCode: 'lock(a); lock(b);' });
    expect(plan.brokenCode).toBe('lock(a); lock(b);');
  });

  it('emits a well-formed unified diff with correct hunk counts', () => {
    const diff = buildUnifiedDiff('src/a.ts', 'one\ntwo', 'three');
    expect(diff.split('\n')).toEqual(['--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,2 +1,1 @@', '-one', '-two', '+three']);
  });

  it('produces a checklist runbook', () => {
    const { remediation } = analyzeTrace(ABBA_DEADLOCK_TRACE);
    expect(remediation.runbookMarkdown).toMatch(/^# Incident Runbook Checklist/);
    expect(remediation.runbookMarkdown).toContain('Account_A -> Account_B');
  });
});
