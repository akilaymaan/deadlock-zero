import { describe, expect, it } from 'vitest';
import {
  DeadlockDetector,
  detectDeadlocks,
  findCyclicStronglyConnectedComponents,
  findElementaryCycles,
  findStronglyConnectedComponents,
} from '../src/engine/deadlockDetector';
import { WaitForGraph } from '../src/engine/graph';
import {
  detectDataRaces,
  detectPoolStarvation,
  type ConnectionPoolSample,
  type MemoryAccessEvent,
  type RaceAnalysisInput,
  type SynchronizationEvent,
  VectorClock,
} from '../src/engine/raceDetector';

type Source = { file: string; line: number; column?: number };

function addCycleEdge(
  graph: WaitForGraph,
  waiterId: string,
  holderId: string,
  resourceId: string,
  waitLine: number,
  acquisitionLine: number,
): void {
  graph.recordAcquisition({
    resourceId,
    holderId,
    acquiredAt: acquisitionLine,
    source: { file: 'src/locks.ts', line: acquisitionLine, column: 5 },
  });
  graph.addWaitFor({
    id: `${waiterId}-waits-${holderId}-${resourceId}`,
    waiterId,
    holderId,
    resourceId,
    observedAt: waitLine,
    source: { file: 'src/workers.ts', line: waitLine, column: 11 },
  });
}

function makeCycleGraph(executionIds: readonly string[]): WaitForGraph {
  const graph = new WaitForGraph();
  for (const executionId of executionIds) {
    graph.addThread({ id: executionId, name: `worker-${executionId}` });
  }

  for (let index = 0; index < executionIds.length; index += 1) {
    const waiterId = executionIds[index];
    const holderId = executionIds[(index + 1) % executionIds.length];
    const resourceId = `lock-${waiterId}-${holderId}`;
    graph.addLock({ id: resourceId, name: resourceId });
    addCycleEdge(
      graph,
      waiterId,
      holderId,
      resourceId,
      100 + index,
      200 + index,
    );
  }

  return graph;
}

describe('deadlock detector', () => {
  it('does not report a one-resource wait without a cycle', () => {
    const graph = new WaitForGraph()
      .addThread({ id: 'holder', name: 'holder' })
      .addThread({ id: 'waiter', name: 'waiter' })
      .addLock({ id: 'mutex', name: 'mutex' });

    graph.recordAcquisition({
      resourceId: 'mutex',
      holderId: 'holder',
      acquiredAt: 10,
      source: { file: 'src/lock.ts', line: 10 },
    });
    graph.addWaitFor({
      waiterId: 'waiter',
      holderId: 'holder',
      resourceId: 'mutex',
      observedAt: 20,
      source: { file: 'src/lock.ts', line: 20 },
    });

    expect(findStronglyConnectedComponents(graph)).toEqual([
      ['holder'],
      ['waiter'],
    ]);
    expect(findCyclicStronglyConnectedComponents(graph)).toEqual([]);
    expect(findElementaryCycles(graph)).toEqual([]);
    expect(detectDeadlocks(graph)).toEqual([]);
    expect(new DeadlockDetector(graph).detect()).toEqual([]);
  });

  it('treats an explicit self-loop as a one-node cycle and preserves its evidence', () => {
    const graph = new WaitForGraph()
      .addThread({ id: 'worker', name: 'worker' })
      .addLock({ id: 'mutex', name: 'mutex' });

    const acquisitionSource: Source = {
      file: 'src/reentrant-lock.ts',
      line: 41,
      column: 7,
    };
    const waitSource: Source = {
      file: 'src/reentrant-lock.ts',
      line: 59,
      column: 13,
    };
    graph.recordAcquisition({
      resourceId: 'mutex',
      holderId: 'worker',
      acquiredAt: 41,
      source: acquisitionSource,
    });
    graph.addWaitFor({
      id: 'worker-waits-for-itself',
      waiterId: 'worker',
      holderId: 'worker',
      resourceId: 'mutex',
      observedAt: 59,
      source: waitSource,
    });

    expect(findStronglyConnectedComponents(graph)).toEqual([['worker']]);
    expect(findCyclicStronglyConnectedComponents(graph)).toEqual([['worker']]);
    expect(findElementaryCycles(graph)).toEqual([['worker']]);

    const [finding] = detectDeadlocks(graph);
    expect(finding).toBeDefined();
    expect(finding.cycle).toEqual(['worker']);
    expect(finding.stronglyConnectedComponent).toEqual(['worker']);
    expect(finding.edges).toHaveLength(1);
    expect(finding.edges[0]).toMatchObject({
      id: 'worker-waits-for-itself',
      waiterId: 'worker',
      holderId: 'worker',
      resourceId: 'mutex',
      source: waitSource,
    });
    expect(finding.holdAndWaitChain).toHaveLength(1);
    expect(finding.holdAndWaitChain[0]).toMatchObject({
      waiterId: 'worker',
      holderId: 'worker',
      resourceId: 'mutex',
      waitSource,
      acquisitionSource,
      heldById: 'worker',
      sourceLocations: { wait: waitSource, acquisition: acquisitionSource },
    });
    expect(finding.waitSources).toEqual([waitSource]);
    expect(finding.acquisitionSources).toEqual([acquisitionSource]);
  });

  it('reports the classic AB-BA deadlock with exact wait/acquisition sources and a hold-and-wait chain', () => {
    const graph = new WaitForGraph()
      .addThread({ id: 'A', name: 'worker A' })
      .addThread({ id: 'B', name: 'worker B' })
      .addLock({ id: 'lock-a', name: 'lock A' })
      .addLock({ id: 'lock-b', name: 'lock B' });

    const acquisitionA: Source = {
      file: 'src/worker-a.ts',
      line: 101,
      column: 3,
    };
    const acquisitionB: Source = {
      file: 'src/worker-b.ts',
      line: 202,
      column: 3,
    };
    const waitA: Source = { file: 'src/worker-a.ts', line: 115, column: 9 };
    const waitB: Source = { file: 'src/worker-b.ts', line: 216, column: 9 };

    graph.recordAcquisition({
      resourceId: 'lock-a',
      holderId: 'B',
      acquiredAt: 2,
      source: acquisitionB,
    });
    graph.recordAcquisition({
      resourceId: 'lock-b',
      holderId: 'A',
      acquiredAt: 1,
      source: acquisitionA,
    });
    graph.addWaitFor({
      id: 'A-waits-lock-a',
      waiterId: 'A',
      holderId: 'B',
      resourceId: 'lock-a',
      observedAt: 3,
      source: waitA,
    });
    graph.addWaitFor({
      id: 'B-waits-lock-b',
      waiterId: 'B',
      holderId: 'A',
      resourceId: 'lock-b',
      observedAt: 4,
      source: waitB,
    });

    const findings = detectDeadlocks(graph);
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding.cycle).toEqual(['A', 'B']);
    expect(finding.executionIds).toEqual(['A', 'B']);
    expect(finding.edges.map((edge) => edge.id)).toEqual([
      'A-waits-lock-a',
      'B-waits-lock-b',
    ]);
    expect(finding.waitSources).toEqual([waitA, waitB]);
    expect(finding.acquisitionSources).toEqual([acquisitionB, acquisitionA]);
    expect(finding.sourceLocations).toEqual([
      { wait: waitA, acquisition: acquisitionB },
      { wait: waitB, acquisition: acquisitionA },
    ]);

    expect(
      finding.holdAndWaitChain.map((link) => ({
        waiterId: link.waiterId,
        holderId: link.holderId,
        resourceId: link.resourceId,
        waitEdgeId: link.waitEdge.id,
        waitLine: link.waitSource?.line,
        acquisitionHolderId: link.acquisitionHolderId,
        acquisitionLine: link.acquisitionSource?.line,
      })),
    ).toEqual([
      {
        waiterId: 'A',
        holderId: 'B',
        resourceId: 'lock-a',
        waitEdgeId: 'A-waits-lock-a',
        waitLine: 115,
        acquisitionHolderId: 'B',
        acquisitionLine: 202,
      },
      {
        waiterId: 'B',
        holderId: 'A',
        resourceId: 'lock-b',
        waitEdgeId: 'B-waits-lock-b',
        waitLine: 216,
        acquisitionHolderId: 'A',
        acquisitionLine: 101,
      },
    ]);
    expect(finding.chain).toEqual(finding.holdAndWaitChain);
    expect(finding.holdAndWait).toEqual(finding.holdAndWaitChain);
  });

  it('finds a four-node circular deadlock and attaches one hold-and-wait link per hop', () => {
    const graph = makeCycleGraph(['A', 'B', 'C', 'D']);

    const [finding] = detectDeadlocks(graph);
    expect(finding.cycle).toEqual(['A', 'B', 'C', 'D']);
    expect(finding.stronglyConnectedComponent).toEqual(['A', 'B', 'C', 'D']);
    expect(finding.holdAndWaitChain.map((link) => [link.waiterId, link.holderId])).toEqual([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D'],
      ['D', 'A'],
    ]);
    expect(finding.holdAndWaitChain.map((link) => link.resourceId)).toEqual([
      'lock-A-B',
      'lock-B-C',
      'lock-C-D',
      'lock-D-A',
    ]);
    expect(finding.waitSources.map((source) => source?.line)).toEqual([
      100,
      101,
      102,
      103,
    ]);
    expect(finding.acquisitionSources.map((source) => source?.line)).toEqual([
      200,
      201,
      202,
      203,
    ]);
  });

  it('keeps disconnected wait-for components separate from a real cycle', () => {
    const graph = makeCycleGraph(['A', 'B'])
      .addThread({ id: 'C', name: 'worker-C' })
      .addThread({ id: 'D', name: 'worker-D' })
      .addThread({ id: 'E', name: 'worker-E' })
      .addLock({ id: 'lock-c-d', name: 'lock C-D' });
    addCycleEdge(graph, 'C', 'D', 'lock-c-d', 301, 401);

    expect(findStronglyConnectedComponents(graph)).toEqual([
      ['A', 'B'],
      ['C'],
      ['D'],
      ['E'],
    ]);
    expect(findCyclicStronglyConnectedComponents(graph)).toEqual([['A', 'B']]);
    expect(findElementaryCycles(graph)).toEqual([['A', 'B']]);
    expect(detectDeadlocks(graph).map((finding) => finding.cycle)).toEqual([
      ['A', 'B'],
    ]);
  });

  it('enumerates multiple elementary cycles in one strongly connected component', () => {
    const graph = new WaitForGraph()
      .addThread({ id: 'A', name: 'worker-A' })
      .addThread({ id: 'B', name: 'worker-B' })
      .addThread({ id: 'C', name: 'worker-C' });

    const edges: Array<[string, string, string, number]> = [
      ['A', 'B', 'lock-ab', 10],
      ['B', 'A', 'lock-ba', 20],
      ['A', 'C', 'lock-ac', 30],
      ['C', 'A', 'lock-ca', 40],
      ['B', 'C', 'lock-bc', 50],
      ['C', 'B', 'lock-cb', 60],
    ];
    for (const [waiterId, holderId, resourceId, line] of edges) {
      graph.addLock({ id: resourceId, name: resourceId });
      addCycleEdge(graph, waiterId, holderId, resourceId, line, line + 100);
    }

    const expectedCycles = [
      ['A', 'B'],
      ['A', 'B', 'C'],
      ['A', 'C'],
      ['A', 'C', 'B'],
      ['B', 'C'],
    ];
    expect(findCyclicStronglyConnectedComponents(graph)).toEqual([
      ['A', 'B', 'C'],
    ]);
    expect(findElementaryCycles(graph)).toEqual(expectedCycles);
    expect(detectDeadlocks(graph).map((finding) => finding.cycle)).toEqual(
      expectedCycles,
    );
  });
});

function raceInput(
  accesses: readonly MemoryAccessEvent[],
  synchronization: readonly SynchronizationEvent[] = [],
): RaceAnalysisInput {
  return { accesses, synchronization };
}

describe('vector-clock race detector', () => {
  it('reports a concurrent write/read race across threads with both source locations', () => {
    const findings = detectDataRaces(
      raceInput([
        {
          id: 'write-1',
          threadId: 'thread-a',
          location: 'account.balance',
          mode: 'write',
          clock: { 'thread-a': 1 },
          source: { file: 'src/account.ts', line: 41, column: 5 },
        },
        {
          id: 'read-1',
          threadId: 'thread-b',
          location: 'account.balance',
          mode: 'read',
          clock: { 'thread-b': 1 },
          source: { file: 'src/account.ts', line: 58, column: 9 },
        },
      ]),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'data-race',
      location: 'account.balance',
      accessIds: ['write-1', 'read-1'],
      sourceLocations: [
        { file: 'src/account.ts', line: 41, column: 5 },
        { file: 'src/account.ts', line: 58, column: 9 },
      ],
    });
  });

  it('reports a concurrent write/write race and does not conflate unrelated locations', () => {
    const findings = detectDataRaces(
      raceInput([
        {
          id: 'write-a',
          threadId: 'thread-a',
          location: 'cache.value',
          mode: 'write',
          clock: { 'thread-a': 4 },
          source: { file: 'src/cache.ts', line: 17 },
        },
        {
          id: 'write-b',
          threadId: 'thread-b',
          location: 'cache.value',
          mode: 'write',
          clock: { 'thread-b': 9 },
          source: { file: 'src/cache.ts', line: 33 },
        },
        {
          id: 'write-other',
          threadId: 'thread-b',
          location: 'cache.metadata',
          mode: 'write',
          clock: { 'thread-b': 10 },
          source: { file: 'src/cache.ts', line: 34 },
        },
      ]),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'data-race',
      location: 'cache.value',
      accessIds: ['write-a', 'write-b'],
    });
  });

  it('does not report read/read accesses or accesses protected by one common lock', () => {
    const findings = detectDataRaces(
      raceInput([
        {
          id: 'read-a',
          threadId: 'thread-a',
          location: 'state.value',
          mode: 'read',
          clock: { 'thread-a': 1 },
          source: { file: 'src/state.ts', line: 10 },
        },
        {
          id: 'read-b',
          threadId: 'thread-b',
          location: 'state.value',
          mode: 'read',
          clock: { 'thread-b': 1 },
          source: { file: 'src/state.ts', line: 20 },
        },
        {
          id: 'sync-write-a',
          threadId: 'thread-a',
          location: 'sync.value',
          mode: 'write',
          clock: { 'thread-a': 3 },
          lockIds: ['mutex'],
          source: { file: 'src/sync.ts', line: 31 },
        },
        {
          id: 'sync-read-b',
          threadId: 'thread-b',
          location: 'sync.value',
          mode: 'read',
          clock: { 'thread-b': 3 },
          lockIds: ['mutex'],
          source: { file: 'src/sync.ts', line: 44 },
        },
      ]),
    );

    expect(findings).toEqual([]);
  });

  it('uses Lamport vector-clock ordering and lock acquire/release synchronization', () => {
    const findings = detectDataRaces({
      events: [
        { kind: 'acquire', threadId: 'thread-a', lockId: 'mutex' },
        {
          id: 'ordered-write',
          threadId: 'thread-a',
          location: 'ordered.value',
          mode: 'write',
          source: { file: 'src/ordered.ts', line: 11 },
        },
        { kind: 'release', threadId: 'thread-a', lockId: 'mutex' },
        { kind: 'acquire', threadId: 'thread-b', lockId: 'mutex' },
        {
          id: 'ordered-read',
          threadId: 'thread-b',
          location: 'ordered.value',
          mode: 'read',
          source: { file: 'src/ordered.ts', line: 22 },
        },
        { kind: 'release', threadId: 'thread-b', lockId: 'mutex' },
      ],
    });

    expect(findings).toEqual([]);
  });

  it('generates clocks for unsynchronized events and honors a shared synchronization token', () => {
    const unsynchronized = detectDataRaces([
      { id: 'write', threadId: 'thread-a', location: 'counter', mode: 'write' },
      { id: 'read', threadId: 'thread-b', location: 'counter', mode: 'read' },
    ]);
    expect(unsynchronized).toHaveLength(1);

    const synchronized = detectDataRaces({
      events: [
        { id: 'ordered-write', threadId: 'thread-a', location: 'counter', mode: 'write' },
        { kind: 'sync', threadId: 'thread-a', syncId: 'counter-ready' },
        { kind: 'sync', threadId: 'thread-b', syncId: 'counter-ready' },
        { id: 'ordered-read', threadId: 'thread-b', location: 'counter', mode: 'read' },
      ],
    });
    expect(synchronized).toEqual([]);
  });

  it('exposes vector-clock comparisons for concurrent and ordered events', () => {
    const first = new VectorClock().increment('thread-a');
    const ordered = new VectorClock(first).increment('thread-b');
    const concurrent = new VectorClock().increment('thread-b');

    expect(first.happensBefore(ordered)).toBe(true);
    expect(first.isConcurrentWith(concurrent)).toBe(true);
    expect(first.compare(first)).toBe('equal');
  });
});

describe('connection-pool starvation detector', () => {
  it('reports starvation when a pool is exhausted and demand is queued', () => {
    const findings = detectPoolStarvation({
      poolId: 'orders-db',
      capacity: 8,
      inUse: 8,
      queued: 3,
      source: { file: 'src/db/pool.ts', line: 72 },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'connection-pool-starvation',
      poolId: 'orders-db',
      capacity: 8,
      inUse: 8,
      queued: 3,
      exhausted: true,
      source: { file: 'src/db/pool.ts', line: 72 },
    });
  });

  it('reports the duration and peak queue for a sustained starvation episode', () => {
    const samples: ConnectionPoolSample[] = [
      {
        id: 'orders-1',
        poolId: 'orders-db',
        capacity: 2,
        inUse: 2,
        queuedWaiters: 1,
        observedAt: 100,
      },
      {
        id: 'orders-2',
        poolId: 'orders-db',
        capacity: 2,
        inUse: 2,
        queuedWaiters: 4,
        observedAt: 250,
      },
      {
        id: 'orders-3',
        poolId: 'orders-db',
        capacity: 2,
        inUse: 1,
        queuedWaiters: 0,
        observedAt: 300,
      },
    ];

    const [finding] = detectPoolStarvation(samples);
    expect(finding).toMatchObject({
      poolId: 'orders-db',
      startTime: 100,
      endTime: 250,
      duration: 150,
      peakQueue: 4,
      sampleCount: 2,
    });
  });

  it('does not report a healthy pool with available capacity or no queued demand', () => {
    const findings = detectPoolStarvation([
      {
        id: 'healthy-with-capacity',
        capacity: 8,
        inUse: 7,
        queued: 4,
      },
      {
        id: 'healthy-no-demand',
        capacity: 8,
        inUse: 8,
        queued: 0,
      },
    ]);

    expect(findings).toEqual([]);
  });
});
