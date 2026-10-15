import { describe, expect, it } from 'vitest';
import { WaitForGraph } from '../src/engine/graph';

describe('WaitForGraph', () => {
  it('represents services, threads, locks, and generic resources', () => {
    const graph = new WaitForGraph();

    graph
      .addService({
        id: 'payments',
        name: 'Payments API',
        source: { file: 'services/payments.ts', line: 12 },
      })
      .addThread({
        id: 'payments-worker-7',
        name: 'worker-7',
        serviceId: 'payments',
        source: { file: 'workers/payments.ts', line: 48, column: 9 },
      })
      .addLock({
        id: 'ledger-lock',
        name: 'ledger mutex',
        source: { file: 'lib/ledger.ts', line: 21 },
      })
      .addResource({ id: 'database-connection', name: 'database connection' });

    expect(graph.getService('payments')).toMatchObject({
      id: 'payments',
      kind: 'service',
    });
    expect(graph.getThread('payments-worker-7')).toMatchObject({
      id: 'payments-worker-7',
      kind: 'thread',
      serviceId: 'payments',
      source: { file: 'workers/payments.ts', line: 48, column: 9 },
    });
    expect(graph.getResourceNodes()).toEqual([
      {
        id: 'ledger-lock',
        kind: 'lock',
        name: 'ledger mutex',
        source: { file: 'lib/ledger.ts', line: 21 },
      },
      { id: 'database-connection', kind: 'resource', name: 'database connection' },
    ]);
  });

  it('records acquisition ownership, timestamps, and source references', () => {
    const graph = new WaitForGraph()
      .addThread({ id: 'worker-1', name: 'worker-1' })
      .addLock({ id: 'lock-a', name: 'lock A' });

    graph.recordAcquisition({
      resourceId: 'lock-a',
      holderId: 'worker-1',
      acquiredAt: 1_735_680_000_000,
      source: { file: 'src/checkout.ts', line: 93 },
    });

    expect(graph.getCurrentHolder('lock-a')).toBe('worker-1');
    expect(graph.getAcquisition('lock-a')).toEqual({
      resourceId: 'lock-a',
      holderId: 'worker-1',
      acquiredAt: 1_735_680_000_000,
      source: { file: 'src/checkout.ts', line: 93 },
    });
  });

  it('connects a waiter to the holder of the resource it needs', () => {
    const graph = new WaitForGraph()
      .addThread({ id: 'worker-1', name: 'worker-1' })
      .addThread({ id: 'worker-2', name: 'worker-2' })
      .addLock({ id: 'lock-a', name: 'lock A' });

    graph.recordAcquisition({
      resourceId: 'lock-a',
      holderId: 'worker-2',
      acquiredAt: 100,
    });
    graph.addWaitFor({
      id: 'worker-1-waits-for-worker-2',
      waiterId: 'worker-1',
      holderId: 'worker-2',
      resourceId: 'lock-a',
      observedAt: 200,
      source: { file: 'src/worker.ts', line: 117 },
    });

    expect(graph.getWaitForEdgesFrom('worker-1')).toEqual([
      {
        id: 'worker-1-waits-for-worker-2',
        waiterId: 'worker-1',
        holderId: 'worker-2',
        resourceId: 'lock-a',
        observedAt: 200,
        source: { file: 'src/worker.ts', line: 117 },
      },
    ]);
  });

  it('rejects duplicate nodes and relationships to unknown entities', () => {
    const graph = new WaitForGraph().addThread({ id: 'worker-1', name: 'worker-1' });

    expect(() => graph.addService({ id: 'worker-1', name: 'same id' })).toThrow(
      'already exists',
    );
    expect(() =>
      graph.recordAcquisition({
        resourceId: 'missing-lock',
        holderId: 'worker-1',
        acquiredAt: 100,
      }),
    ).toThrow('Unknown resource node');
    expect(() =>
      graph.addWaitFor({
        waiterId: 'worker-1',
        holderId: 'missing-worker',
        resourceId: 'missing-lock',
        observedAt: 100,
      }),
    ).toThrow('Unknown execution node');
  });

  it('returns defensive snapshots of graph state', () => {
    const graph = new WaitForGraph()
      .addThread({ id: 'worker-1', name: 'worker-1' })
      .addLock({ id: 'lock-a', name: 'lock A' });

    const snapshot = graph.toJSON();
    snapshot.executionNodes[0].name = 'mutated outside graph';
    snapshot.resourceNodes[0].name = 'mutated outside graph';

    expect(graph.getThread('worker-1')?.name).toBe('worker-1');
    expect(graph.getResourceNode('lock-a')?.name).toBe('lock A');
  });
});
