/**
 * Incident remediation artifacts.
 *
 * This module produces reviewable text rather than mutating source files. The
 * generated patch is intentionally conservative: it states one canonical lock
 * order, and for incidents without mutexes it emits bounded-admission and
 * retry-budget controls instead of pretending that a lock exists.
 */

import type {
  DeadlockCycle,
  LockEvent,
  RaceConflict,
  RemediationPlan,
  ScenarioPreset,
} from '../shared/types';

export type { RemediationPlan } from '../shared/types';

type RecordLike = { readonly [key: string]: unknown };

export interface CanonicalLockOrderingPatch {
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly incidentKind: string;
  /** Sorted, stable order of the locks used by the patch. */
  readonly canonicalLockOrder: readonly string[];
  readonly canonicalOrder: readonly string[];
  readonly lockOrder: readonly string[];
  /** Safe phases for pool-starvation/retry-storm scenarios. */
  readonly safeControlOrder: readonly string[];
  readonly hasLocks: boolean;
  readonly strategy: string;
  readonly rationale: string;
  readonly brokenCode: string;
  readonly patchedCode: string;
  readonly unifiedDiff: string;
  readonly patchText: string;
  readonly patch: string;
  readonly diff: string;
  readonly diffText: string;
}

export interface RemediationResult extends CanonicalLockOrderingPatch {
  /** Markdown headed exactly as a 3 a.m. operator checklist. */
  readonly runbook: string;
  readonly runbookMarkdown: string;
  readonly runbookText: string;
  readonly markdown: string;
  readonly checklist: string;
}

export type RemediationScenario = unknown;

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function directValue(record: RecordLike, aliases: readonly string[]): unknown {
  const keys = new Map(Object.keys(record).map((key) => [normalizeKey(key), key]));
  for (const alias of aliases) {
    const key = keys.get(normalizeKey(alias));
    if (key !== undefined && record[key] !== undefined) return record[key];
  }
  return undefined;
}

function collectRecords(root: unknown): RecordLike[] {
  const records: RecordLike[] = [];
  const visited = new Set<object>();
  const visit = (value: unknown, depth: number): void => {
    if (!isRecord(value) || visited.has(value) || depth > 6) return;
    visited.add(value);
    records.push(value);
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (isRecord(child)) visit(child, depth + 1);
    }
  };
  visit(root, 0);
  return records;
}

function findValue(root: unknown, aliases: readonly string[]): unknown {
  for (const record of collectRecords(root)) {
    const value = directValue(record, aliases);
    if (value !== undefined) return value;
  }
  return undefined;
}

function findString(root: unknown, aliases: readonly string[]): string | undefined {
  return stringValue(findValue(root, aliases));
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort(compareStrings);
}

function uniqueInOrder(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function lockName(value: unknown): string | undefined {
  const direct = stringValue(value);
  if (direct !== undefined) return direct;
  if (!isRecord(value)) return undefined;
  for (const key of ['id', 'name', 'lockId', 'resourceId', 'key', 'label']) {
    const nested = stringValue(directValue(value, [key]));
    if (nested !== undefined) return nested;
  }
  return undefined;
}

interface LockDescriptor {
  readonly name: string;
  readonly order?: number;
}

function lockDescriptors(values: readonly unknown[]): LockDescriptor[] {
  return values
    .map((value): LockDescriptor | undefined => {
      const name = lockName(value);
      if (name === undefined) return undefined;
      if (!isRecord(value)) return { name };
      const orderValue = directValue(value, ['order', 'rank', 'sequence', 'index', 'priority']);
      return {
        name,
        order: typeof orderValue === 'number' && Number.isFinite(orderValue) ? orderValue : undefined,
      };
    })
    .filter((descriptor): descriptor is LockDescriptor => descriptor !== undefined);
}

function extractLocks(scenario: unknown): string[] {
  const explicit = findValue(scenario, [
    'canonicalLockOrder',
    'canonicalOrder',
    'lockOrder',
    'lockNames',
    'locks',
    'lockResources',
    'mutexes',
  ]);
  if (Array.isArray(explicit)) {
    const descriptors = lockDescriptors(explicit);
    descriptors.sort(
      (left, right) =>
      (left.order === undefined ? Number.POSITIVE_INFINITY : left.order) -
          (right.order === undefined ? Number.POSITIVE_INFINITY : right.order) ||
        compareStrings(left.name, right.name),
    );
    return uniqueInOrder(descriptors.map((descriptor) => descriptor.name));
  }

  const categoryText = ['id', 'name', 'title', 'type', 'kind', 'category']
    .map((key) => findString(scenario, [key]) ?? '')
    .join(' ')
    .toLowerCase();
  const contentionMode = findString(scenario, ['mode'])?.toLowerCase();
  if (
    categoryText.includes('deadlock') ||
    contentionMode === 'ordered-locks' ||
    contentionMode === 'circular-rpc'
  ) {
    const resourceOrder = findValue(scenario, ['resourceOrder']);
    if (Array.isArray(resourceOrder)) {
      const ordered = resourceOrder
        .map(lockName)
        .filter((value): value is string => value !== undefined);
      if (ordered.length > 0) return uniqueInOrder(ordered);
    }
  }

  const resources = findValue(scenario, ['resources', 'resourceNodes']);
  if (Array.isArray(resources)) {
    const descriptors = lockDescriptors(
      resources.filter((resource) => {
        if (!isRecord(resource)) return false;
        const kind = stringValue(directValue(resource, ['kind', 'type', 'category']))?.toLowerCase() ?? '';
        return kind.includes('lock') || kind.includes('mutex');
      }),
    );
    if (descriptors.length > 0) return uniqueSorted(descriptors.map((descriptor) => descriptor.name));
  }

  return [];
}

function incidentId(scenario: unknown): string {
  return findString(scenario, ['id', 'scenarioId', 'key', 'slug']) ??
    findString(scenario, ['name', 'title']) ??
    'incident-scenario';
}

function incidentName(scenario: unknown, id: string): string {
  return findString(scenario, ['name', 'title', 'label']) ?? id;
}

function incidentKind(scenario: unknown, hasLocks: boolean): string {
  const text = ['id', 'name', 'title', 'type', 'kind', 'category', 'description']
    .map((key) => findString(scenario, [key]) ?? '')
    .join(' ')
    .toLowerCase();
  if (text.includes('pool') || text.includes('starvation')) return 'pool-starvation';
  if (text.includes('retry') || text.includes('storm')) return 'retry-storm';
  if (text.includes('deadlock') || text.includes('lock') || hasLocks) return 'deadlock';
  return 'contention';
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function sourceFile(scenario: unknown): string {
  return findString(scenario, [
    'lockFile',
    'sourceFile',
    'file',
    'implementationFile',
  ]) ?? 'src/concurrency/locks.ts';
}

function lockPatch(
  scenario: unknown,
  id: string,
  name: string,
  locks: readonly string[],
): { readonly patchText: string; readonly rationale: string; readonly strategy: string } {
  const file = sourceFile(scenario);
  const list = locks.map(quote).join(', ');
  const rationale =
    `Every multi-lock request in ${name} must acquire resources in one canonical order ` +
    `(${locks.join(' → ')}). Sorting acquisition plans before the first acquire removes ` +
    `the circular wait edge while preserving the request's work. Releases remain reverse-order.`;
  const patchText = [
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@',
    '- // Acquire locks in the order requested by each worker.',
    '- await acquireAll(request.lockIds);',
    '+ // DeadlockZero canonical ordering; never acquire in request-dependent order.',
    `+ const CANONICAL_LOCK_ORDER = [${list}] as const;`,
    '+ const orderedLocks = sortByCanonicalOrder(request.lockIds, CANONICAL_LOCK_ORDER);',
    '+ await acquireAll(orderedLocks);',
    '+ // Release in reverse acquisition order, even when the handler fails.',
    '+ try {',
    '+   return await handleWithLocks(request);',
    '+ } finally {',
    '+   await releaseAll([...orderedLocks].reverse());',
    '+ }',
    '',
    `// Scenario: ${id}`,
  ].join('\n');
  return {
    patchText,
    rationale,
    strategy: 'canonical-lock-order',
  };
}

function controlPatch(
  scenario: unknown,
  id: string,
  name: string,
): { readonly patchText: string; readonly rationale: string; readonly strategy: string } {
  const file = sourceFile(scenario) === 'src/concurrency/locks.ts'
    ? 'src/concurrency/admission.ts'
    : sourceFile(scenario);
  const rationale =
    `No mutex resources were declared for ${name}, so a lock-order patch would be misleading. ` +
    'Apply a safe control order instead: admit a bounded number of requests, acquire a pool ' +
    'resource, perform work, release it, then spend a finite retry budget with exponential ' +
    'backoff and jitter. Never hold a connection while sleeping or retrying.';
  const patchText = [
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@',
    '+ const admission = createBoundedAdmission({ maxInFlight: pool.capacity });',
    '+ const retryBudget = createRetryBudget({ maxAttempts: 3, maxElapsedMs: 2_000 });',
    '+ return admission.run(async () => {',
    '+   const connection = await pool.acquire();',
    '+   try {',
    '+     return await retryBudget.run(() => performWork(connection));',
    '+   } finally {',
    '+     connection.release();',
    '+   }',
    '+ });',
    '+ // Back off with bounded jitter; do not retry immediately on every worker.',
    '',
    `// Scenario: ${id}`,
  ].join('\n');
  return {
    patchText,
    rationale,
    strategy: 'bounded-admission-then-resource-then-finite-retry-budget',
  };
}

function buildUnifiedDiffFromCode(
  file: string,
  brokenCode: string,
  patchedCode: string,
  fallbackDiff: string,
): string {
  const brokenLines = brokenCode.split(/\r?\n/).map((line) => `- ${line}`);
  const patchedLines = patchedCode.split(/\r?\n/).map((line) => `+ ${line}`);
  return [
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@ -1 +1 @@',
    ...brokenLines,
    ...patchedLines,
    '',
    fallbackDiff,
  ].join('\n');
}

/**
 * Generate a deterministic patch proposal. No files are changed by this
 * function; callers can display or review `patchText`/`diffText` first.
 */
export function generateCanonicalLockOrderingPatch(
  scenario: RemediationScenario,
): CanonicalLockOrderingPatch {
  const id = incidentId(scenario);
  const name = incidentName(scenario, id);
  const locks = extractLocks(scenario);
  const hasLocks = locks.length > 0;
  const kind = incidentKind(scenario, hasLocks);
  const generated = hasLocks
    ? lockPatch(scenario, id, name, locks)
    : controlPatch(scenario, id, name);
  const safeControlOrder = hasLocks
    ? [...locks]
    : ['admission-gate', 'resource-acquisition', 'work', 'resource-release', 'retry-budget'];
  const file = sourceFile(scenario);
  const defaultBroken = [
    `// ${file} (BROKEN: non-canonical lock / resource acquisition)`,
    'await acquireInRequestOrder(request.resources);',
  ].join('\n');
  const defaultPatched = [
    `// ${file} (PATCHED: DeadlockZero canonical lock ordering)`,
    `const CANONICAL_LOCK_ORDER = [${locks.map(quote).join(', ')}] as const;`,
    'await acquireAll(sortByCanonicalOrder(request.resources, CANONICAL_LOCK_ORDER));',
  ].join('\n');
  const brokenCode = findString(scenario, ['brokenCode']) ?? defaultBroken;
  const patchedCode = findString(scenario, ['patchedCode']) ?? defaultPatched;
  const unifiedDiff = buildUnifiedDiffFromCode(file, brokenCode, patchedCode, generated.patchText);

  return {
    scenarioId: id,
    scenarioName: name,
    incidentKind: kind,
    canonicalLockOrder: [...locks],
    canonicalOrder: [...locks],
    lockOrder: [...locks],
    safeControlOrder,
    hasLocks,
    strategy: generated.strategy,
    rationale: generated.rationale,
    brokenCode,
    patchedCode,
    unifiedDiff,
    patchText: unifiedDiff,
    patch: unifiedDiff,
    diff: unifiedDiff,
    diffText: unifiedDiff,
  };
}

/**
 * Produce the operator-facing checklist for a live incident. The wording is
 * stable so it can be snapshot-tested and pasted into an incident channel.
 */
export function generateOutageRunbook(
  scenario: RemediationScenario,
  patch?: CanonicalLockOrderingPatch,
): string {
  const generated = patch ?? generateCanonicalLockOrderingPatch(scenario);
  const kind = generated.incidentKind;
  const controlLine = generated.hasLocks
    ? `- [ ] Confirm every code path uses the canonical order: ${generated.canonicalLockOrder.join(' → ')}.`
    : '- [ ] Enable bounded admission, finite retry budgets, exponential backoff with jitter, and a circuit breaker; never sleep while holding a pool resource.';
  const verification = generated.hasLocks
    ? '- [ ] Re-capture the wait-for graph and verify the cycle count is zero.'
    : '- [ ] Re-check pool utilization, queue depth, retry rate, and circuit-breaker state; verify queue depth is draining.';
  return [
    '# 3 a.m. Outage Runbook Checklist',
    '',
    `Incident: **${generated.scenarioName}** (${kind})`,
    '',
    '## Stabilize',
    '- [ ] Declare the incident, assign an incident commander, and record the start time.',
    '- [ ] Freeze unrelated deploys and capture logs, traces, worker count, queue depth, and error rate.',
    '- [ ] Stop the retry amplification path or enable the existing traffic shedder before changing code.',
    controlLine,
    '',
    '## Patch and verify',
    `- [ ] Review the generated ${generated.strategy} patch and confirm the target file is correct.`,
    '- [ ] Run the deterministic simulator before and after the patch; record completed, dropped, deadlock, throughput, and p50/p95/p99 latency metrics.',
    '- [ ] Deploy to one canary worker or shard and watch error rate, saturation, and latency for one full request window.',
    verification,
    '- [ ] Roll out gradually; pause or roll back if any saturation or error budget signal regresses.',
    '',
    '## Recover and close',
    '- [ ] Drain queued work deliberately; do not release a retry storm all at once.',
    '- [ ] Confirm successful requests and user-visible recovery across the affected dependency.',
    '- [ ] Remove temporary traffic limits only after the queue and retry rate return to baseline.',
    '- [ ] Preserve the graph, logs, simulator results, and patch review for the post-incident review.',
    '- [ ] File follow-up work for regression coverage, alerting, and a permanent runbook owner.',
    '',
    '## Rollback',
    '- [ ] If the canary regresses, stop rollout, restore the last known-good build, and keep admission/retry controls enabled.',
    '- [ ] Re-check the original failure mode before declaring the incident resolved.',
    '',
  ].join('\n');
}

export const generateRunbook = generateOutageRunbook;
export const generateRunbookChecklist = generateOutageRunbook;
export const generateLockOrderingPatch = generateCanonicalLockOrderingPatch;

/** Generate all remediation artifacts in one deterministic value. */
export function remediateScenario(scenario: RemediationScenario): RemediationResult {
  const patch = generateCanonicalLockOrderingPatch(scenario);
  const runbook = generateOutageRunbook(scenario, patch);
  return {
    ...patch,
    runbook,
    runbookMarkdown: runbook,
    checklist: runbook,
    runbookText: runbook,
    markdown: runbook,
  };
}

export const generateRemediation = remediateScenario;
export const buildRemediation = remediateScenario;
export const generatePatch = generateCanonicalLockOrderingPatch;

/**
 * Generate a complete RemediationPlan from a scenario preset, custom LockEvent[],
 * or detected DeadlockCycle[] / RaceConflict[] findings.
 */
export function generateRemediationPlan(
  input?: ScenarioPreset | readonly LockEvent[] | unknown,
  cycles: readonly DeadlockCycle[] = [],
  races: readonly RaceConflict[] = [],
): RemediationResult {
  if (Array.isArray(input)) {
    const events = input as readonly LockEvent[];
    const resources = uniqueSorted(
      events
        .map((e) => e.resourceId)
        .filter((r): r is string => typeof r === 'string' && r.length > 0),
    );
    const firstFile = events.find((e) => typeof e.file === 'string')?.file ?? 'src/services/ledger.ts';
    const syntheticScenario = {
      id: 'custom-trace-remediation',
      title: 'Custom Lock Trace Analysis',
      category: cycles.length > 0 ? 'deadlock' : races.length > 0 ? 'data-race' : 'contention',
      sourceFile: firstFile,
      locks: resources,
      resourceOrder: resources,
      brokenCode: events.map((e) => `// ${e.file}:${e.line}\n${e.codeSnippet}`).join('\n'),
      patchedCode: [
        `// ${firstFile} (PATCHED: DeadlockZero canonical total lock order)`,
        `const CANONICAL_LOCK_ORDER = [${resources.map(quote).join(', ')}] as const;`,
        'const orderedLocks = [...requestedLocks].sort();',
        'await acquireLocksInOrder(orderedLocks);',
      ].join('\n'),
    };
    return remediateScenario(syntheticScenario);
  }
  return remediateScenario(input ?? {});
}
