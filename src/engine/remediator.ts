/**
 * Trace-driven remediation guidance.
 *
 * Everything here is derived from the ingested trace: the offending source lines,
 * each worker's observed lock acquisition order, and the canonical order that
 * removes circular waits. The "patched" code is a generated template meant for
 * human review; this module never reads or modifies the user's source tree.
 */

import type {
  DeadlockCycle,
  LockEvent,
  RaceConflict,
  RemediationPlan,
  RemediationStrategy,
  StarvationAlert,
} from '../shared/types';

export type { RemediationPlan, RemediationStrategy } from '../shared/types';

export interface RemediationInput {
  readonly events: readonly LockEvent[];
  readonly cycles?: readonly DeadlockCycle[];
  readonly races?: readonly RaceConflict[];
  readonly starvation?: readonly Pick<StarvationAlert, 'resourceId'>[];
  /** Optional user-supplied source excerpt shown as the "before" side of the diff. */
  readonly sourceCode?: string;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function sortedByTime(events: readonly LockEvent[]): LockEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => left.event.timestamp - right.event.timestamp || left.index - right.index)
    .map(({ event }) => event);
}

/** Each worker's lock acquisition order as observed in the trace (ACQUIRE and WAIT). */
export function observedLockOrders(events: readonly LockEvent[]): Map<string, string[]> {
  const orders = new Map<string, string[]>();
  for (const event of sortedByTime(events)) {
    if (event.action !== 'ACQUIRE' && event.action !== 'WAIT') continue;
    const order = orders.get(event.workerId) ?? [];
    if (!order.includes(event.resourceId)) order.push(event.resourceId);
    orders.set(event.workerId, order);
  }
  return orders;
}

function lockResources(events: readonly LockEvent[]): string[] {
  return [
    ...new Set(
      events
        .filter((event) => event.action === 'ACQUIRE' || event.action === 'WAIT')
        .map((event) => event.resourceId),
    ),
  ].sort(compareStrings);
}

function chooseStrategy(input: RemediationInput): RemediationStrategy {
  if ((input.cycles?.length ?? 0) > 0) return 'canonical-lock-order';
  if ((input.races?.length ?? 0) > 0) return 'guard-shared-state';
  if ((input.starvation?.length ?? 0) > 0) return 'shorten-lock-hold-time';
  return 'none-required';
}

/** Events whose source lines are implicated by the findings, in trace order. */
function implicatedEvents(input: RemediationInput, strategy: RemediationStrategy): LockEvent[] {
  const events = sortedByTime(input.events);
  if (strategy === 'canonical-lock-order') {
    const members = new Set((input.cycles ?? []).flatMap((cycle) => cycle.cycleNodes));
    return events.filter(
      (event) =>
        (event.action === 'ACQUIRE' || event.action === 'WAIT') &&
        members.has(event.workerId) &&
        members.has(event.resourceId),
    );
  }
  if (strategy === 'guard-shared-state') {
    const resources = new Set((input.races ?? []).map((race) => race.resourceId));
    return events.filter(
      (event) => (event.action === 'READ' || event.action === 'WRITE') && resources.has(event.resourceId),
    );
  }
  if (strategy === 'shorten-lock-hold-time') {
    const resources = new Set((input.starvation ?? []).map((alert) => alert.resourceId));
    return events.filter((event) => resources.has(event.resourceId));
  }
  return events.filter((event) => event.action === 'ACQUIRE' || event.action === 'WAIT');
}

function excerptFromEvents(events: readonly LockEvent[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const event of events) {
    const key = `${event.file}:${event.line}:${event.workerId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`// ${event.file}:${event.line} (${event.workerId} ${event.action} ${event.resourceId})`);
    lines.push(event.codeSnippet);
  }
  return lines.join('\n');
}

function patchedTemplate(
  strategy: RemediationStrategy,
  order: readonly string[],
  observed: ReadonlyMap<string, string[]>,
  guarded: readonly string[],
  starved: readonly string[],
): string {
  if (strategy === 'canonical-lock-order') {
    const lines = [
      '// Generated suggestion: acquire every lock set in one global order.',
      `const LOCK_ORDER = [${order.map(quote).join(', ')}] as const;`,
      '',
    ];
    for (const [workerId, locks] of [...observed].sort(([left], [right]) => compareStrings(left, right))) {
      const sorted = [...locks].sort((left, right) => order.indexOf(left) - order.indexOf(right));
      const changed = sorted.some((lock, index) => lock !== locks[index]);
      lines.push(
        `// ${workerId}: observed ${locks.join(' -> ')}${changed ? ` ; must become ${sorted.join(' -> ')}` : ' (already canonical)'}`,
      );
    }
    lines.push(
      '',
      'const ordered = [...requestedLocks].sort((a, b) => LOCK_ORDER.indexOf(a) - LOCK_ORDER.indexOf(b));',
      'for (const lock of ordered) await acquire(lock);',
      'try {',
      '  // critical section',
      '} finally {',
      '  for (const lock of [...ordered].reverse()) await release(lock);',
      '}',
    );
    return lines.join('\n');
  }
  if (strategy === 'guard-shared-state') {
    return [
      '// Generated suggestion: make each read-modify-write atomic under one lock per resource.',
      `// Unsynchronized resources found in the trace: ${guarded.join(', ')}`,
      'await withLock(`guard:${resourceId}`, async () => {',
      '  const { value, version } = await store.readVersioned(resourceId);',
      '  await store.compareAndSwap(resourceId, nextValue(value), version);',
      '});',
    ].join('\n');
  }
  if (strategy === 'shorten-lock-hold-time') {
    return [
      `// Generated suggestion: most workers are blocked on ${starved.join(', ')}.`,
      '// Hold the resource only for the critical section and never across external I/O.',
      'const resource = await pool.acquire({ timeoutMs: ACQUIRE_TIMEOUT_MS });',
      'try {',
      '  await doCriticalWork(resource);',
      '} finally {',
      '  resource.release();',
      '}',
      'await callExternalService(); // after release',
    ].join('\n');
  }
  return [
    '// No deadlock cycle, race, or starvation was detected in this trace.',
    `// Keep acquiring locks in this order to stay cycle-free: ${order.join(' -> ') || '(no locks)'}`,
  ].join('\n');
}

/** Build a well-formed unified diff that replaces `before` with `after`. */
export function buildUnifiedDiff(file: string, before: string, after: string): string {
  const removed = before.split(/\r?\n/);
  const added = after.split(/\r?\n/);
  return [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${removed.length} +1,${added.length} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ].join('\n');
}

function rationaleFor(strategy: RemediationStrategy, order: readonly string[], input: RemediationInput): string {
  switch (strategy) {
    case 'canonical-lock-order':
      return (
        `${input.cycles?.length ?? 0} wait-for cycle(s) exist because workers acquire the same locks in different orders. ` +
        `If every worker acquires locks in the single order ${order.join(' -> ')}, no circular wait can form.`
      );
    case 'guard-shared-state':
      return (
        `${input.races?.length ?? 0} pair(s) of conflicting accesses have concurrent vector clocks and no common lock. ` +
        'Serializing each read-modify-write under a per-resource lock (or a versioned compare-and-swap) removes the race.'
      );
    case 'shorten-lock-hold-time':
      return (
        'More than 80% of workers are blocked waiting on the same resource. Lock ordering cannot fix this; ' +
        'shorten how long the resource is held and bound how long callers wait for it.'
      );
    default:
      return 'No concurrency defect was detected in this trace. The canonical order is listed for reference.';
  }
}

function runbookFor(strategy: RemediationStrategy, order: readonly string[], sourceFile: string): string {
  const specific: Record<RemediationStrategy, string[]> = {
    'canonical-lock-order': [
      `- [ ] Confirm every code path that takes these locks uses the order: ${order.join(' -> ')}.`,
      '- [ ] As a stopgap, set a lock wait timeout so blocked requests fail fast instead of hanging.',
      '- [ ] Re-capture a trace after the fix and verify DeadlockZero reports zero cycles.',
    ],
    'guard-shared-state': [
      '- [ ] Identify every writer of the affected resources and wrap the read-modify-write in one lock or CAS.',
      '- [ ] Check for corrupted or lost updates written while the race was live and plan a data repair.',
      '- [ ] Re-capture a trace after the fix and verify DeadlockZero reports zero races.',
    ],
    'shorten-lock-hold-time': [
      '- [ ] Find code that holds the resource across network calls, sleeps, or retries.',
      '- [ ] Add acquire timeouts and alert on pool wait time and queue depth.',
      '- [ ] Re-capture a trace and verify fewer than 80% of workers are blocked on one resource.',
    ],
    'none-required': [
      '- [ ] No action required for this trace. Keep the lock order documented for future changes.',
    ],
  };
  return [
    '# Incident Runbook Checklist',
    '',
    `Strategy: **${strategy}** (primary file: \`${sourceFile}\`)`,
    '',
    '## Stabilize',
    '- [ ] Declare the incident, assign an owner, and record the start time.',
    '- [ ] Capture logs, the lock trace, worker count, queue depth, and error rate before restarting anything.',
    '',
    '## Fix and verify',
    ...specific[strategy],
    '- [ ] Review the generated patch suggestion; it is a template, not a tested change to your code.',
    '- [ ] Canary the change on one instance and watch error rate, saturation, and latency.',
    '',
    '## Close',
    '- [ ] Add a regression test that reproduces the trace.',
    '- [ ] Record the root cause and the trace in the post-incident review.',
    '',
  ].join('\n');
}

/** Generate remediation guidance for an analyzed trace. */
export function generateRemediationPlan(input: RemediationInput): RemediationPlan {
  const strategy = chooseStrategy(input);
  const canonicalLockOrder = lockResources(input.events);
  const implicated = implicatedEvents(input, strategy);
  const sourceFile = implicated[0]?.file ?? input.events[0]?.file ?? 'trace';
  const brokenCode =
    input.sourceCode?.trim() ? input.sourceCode : excerptFromEvents(implicated.length > 0 ? implicated : input.events);
  const patchedCode = patchedTemplate(
    strategy,
    canonicalLockOrder,
    observedLockOrders(input.events),
    [...new Set((input.races ?? []).map((race) => race.resourceId))].sort(compareStrings),
    [...new Set((input.starvation ?? []).map((alert) => alert.resourceId))].sort(compareStrings),
  );
  return {
    strategy,
    rationale: rationaleFor(strategy, canonicalLockOrder, input),
    canonicalLockOrder,
    sourceFile,
    brokenCode,
    patchedCode,
    unifiedDiff: buildUnifiedDiff(sourceFile, brokenCode, patchedCode),
    runbookMarkdown: runbookFor(strategy, canonicalLockOrder, sourceFile),
    generated: true,
  };
}
