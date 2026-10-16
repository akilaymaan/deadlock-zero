import type {
  BuiltWaitForGraph,
  LockEvent,
  RemediationPlan,
  StarvationAlert,
} from '../shared/types';
import { detectDeadlocks, type DeadlockFinding } from './deadlockDetector';
import { buildWaitForGraph, type WaitForGraphSnapshot } from './graph';
import { detectRaces, detectStarvation, type RaceFinding } from './raceDetector';
import { generateRemediationPlan } from './remediator';

export interface TraceAnalysis {
  readonly graph: BuiltWaitForGraph & WaitForGraphSnapshot;
  readonly cycles: DeadlockFinding[];
  readonly races: RaceFinding[];
  readonly starvation: StarvationAlert[];
  readonly remediation: RemediationPlan;
}

function starvationAlerts(events: readonly LockEvent[]): StarvationAlert[] {
  const totalWorkers = new Set(events.map((event) => event.workerId)).size;
  return detectStarvation(events).map((finding) => {
    const blockedWorkers = [
      ...new Set(
        events
          .filter((event) => event.action === 'WAIT' && event.resourceId === finding.poolId)
          .map((event) => event.workerId),
      ),
    ].sort();
    return {
      resourceId: finding.poolId,
      blockedWorkers,
      totalWorkers,
      blockedRatio: totalWorkers > 0 ? blockedWorkers.length / totalWorkers : 0,
      file: finding.source?.file ?? events[0]?.file ?? 'trace',
      line: finding.source?.line ?? 1,
      explanation:
        `${blockedWorkers.length} of ${totalWorkers} workers are blocked waiting on ${finding.poolId} ` +
        'while it is held without release.',
    };
  });
}

/** Stable sort by timestamp; ties keep their original trace order. */
export function inTimestampOrder(events: readonly LockEvent[]): LockEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => left.event.timestamp - right.event.timestamp || left.index - right.index)
    .map(({ event }) => event);
}

/** Run every detector over a validated trace and derive remediation guidance. */
export function analyzeTrace(input: readonly LockEvent[], options: { sourceCode?: string } = {}): TraceAnalysis {
  const events = inTimestampOrder(input);
  const graph = buildWaitForGraph(events);
  const cycles = detectDeadlocks(graph);
  const races = detectRaces(events);
  const starvation = starvationAlerts(events);
  const remediation = generateRemediationPlan({
    events,
    cycles,
    races,
    starvation,
    sourceCode: options.sourceCode,
  });
  return { graph, cycles, races, starvation, remediation };
}
