import { describe, expect, it } from 'vitest';
import { remediateScenario } from '../src/engine/remediator';
import { simulateScenario } from '../src/engine/simulator';
import { SIMULATOR_FIXTURE_SCENARIO } from './fixtures/traces';

describe('scenario simulator', () => {
  it('shows the 500-worker deadlock before the patch and full recovery after it', () => {
    const before = simulateScenario(SIMULATOR_FIXTURE_SCENARIO, { patched: false });
    const after = simulateScenario(SIMULATOR_FIXTURE_SCENARIO, { patched: true });

    expect(before.workerCount).toBe(500);
    expect(after.workerCount).toBe(500);

    expect(before.deadlockCount).toBeGreaterThan(0);
    expect(before.droppedRequests).toBeGreaterThan(0);
    expect(before.throughput).toBeLessThan(
      SIMULATOR_FIXTURE_SCENARIO.simulation.healthy.throughputRps,
    );

    for (const latency of [before.p50LatencyMs, before.p95LatencyMs, before.p99LatencyMs]) {
      expect(Number.isFinite(latency)).toBe(true);
      expect(latency).toBeGreaterThanOrEqual(0);
    }
    expect(before.p50LatencyMs).toBeLessThanOrEqual(before.p95LatencyMs);
    expect(before.p95LatencyMs).toBeLessThanOrEqual(before.p99LatencyMs);

    expect(after.deadlockCount).toBe(0);
    expect(after.droppedRequests).toBe(0);
    expect(after.completedRequests).toBe(after.totalRequests);
    expect(after.throughput).toBeGreaterThan(before.throughput);
    expect(after.throughput).toBe(
      SIMULATOR_FIXTURE_SCENARIO.simulation.healthy.throughputRps,
    );
  });

  it('emits the canonical lock-ordering patch and the 3 a.m. runbook', () => {
    const remediation = remediateScenario(SIMULATOR_FIXTURE_SCENARIO);

    expect(remediation.hasLocks).toBe(true);
    expect(remediation.strategy).toBe('canonical-lock-order');
    expect(remediation.canonicalLockOrder).toEqual(
      SIMULATOR_FIXTURE_SCENARIO.contention.resourceOrder,
    );
    expect(remediation.patchText).toContain(
      'DeadlockZero canonical ordering; never acquire in request-dependent order.',
    );
    expect(remediation.patchText).toContain('CANONICAL_LOCK_ORDER');
    expect(remediation.patchText).toContain('"ledger-entry", "account-balance"');
    expect(remediation.runbook).toContain('# 3 a.m. Outage Runbook Checklist');
  });
});
