import { describe, expect, it } from 'vitest';
import {
  getScenarioPreset,
  INCIDENT_PRESETS,
} from '../src/scenarios/presets';
import { remediateScenario } from '../src/engine/remediator';
import { simulateScenario } from '../src/engine/simulator';

const PAYMENT_SCENARIO_ID = 'payment-ledger-ab-ba-lock-deadlock' as const;

describe('scenario simulator', () => {
  it('shows the 500-worker payment deadlock before the patch and full recovery after it', () => {
    const scenario = getScenarioPreset(PAYMENT_SCENARIO_ID);
    const before = simulateScenario(scenario, { patched: false });
    const after = simulateScenario(scenario, { patched: true });

    expect(before.workerCount).toBe(500);
    expect(after.workerCount).toBe(500);

    expect(before.deadlockCount).toBeGreaterThan(0);
    expect(before.droppedRequests).toBeGreaterThan(0);
    expect(before.throughput).toBeLessThan(scenario.simulation.healthy.throughputRps);

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
    expect(after.throughput).toBe(scenario.simulation.healthy.throughputRps);
  });

  it('can simulate every one of the five shipped scenario presets', () => {
    expect(INCIDENT_PRESETS).toHaveLength(5);

    for (const preset of INCIDENT_PRESETS) {
      const scenario = getScenarioPreset(preset.id);
      const before = simulateScenario(scenario, { patched: false });
      const after = simulateScenario(scenario, { patched: true });

      expect(before.scenarioId).toBe(preset.id);
      expect(after.scenarioId).toBe(preset.id);
      expect(Number.isFinite(before.throughput)).toBe(true);
      expect(Number.isFinite(after.throughput)).toBe(true);
      expect(after.deadlockCount).toBe(0);
      expect(after.droppedRequests).toBe(0);
      expect(after.completedRequests).toBe(after.totalRequests);
    }
  });

  it('emits the canonical payment lock-ordering patch and the 3 a.m. runbook', () => {
    const scenario = getScenarioPreset(PAYMENT_SCENARIO_ID);
    const remediation = remediateScenario(scenario);

    expect(remediation.hasLocks).toBe(true);
    expect(remediation.strategy).toBe('canonical-lock-order');
    expect(remediation.canonicalLockOrder).toEqual(scenario.contention.resourceOrder);
    expect(remediation.patchText).toContain(
      'DeadlockZero canonical ordering; never acquire in request-dependent order.',
    );
    expect(remediation.patchText).toContain('CANONICAL_LOCK_ORDER');
    expect(remediation.patchText).toContain('"ledger-entry", "account-balance"');
    expect(remediation.runbook).toContain('3 a.m. Outage Runbook Checklist');
    expect(remediation.runbook).toContain('# 3 a.m. Outage Runbook Checklist');
  });
});
