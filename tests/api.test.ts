import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/server/app';

describe('DeadlockZero Express API (Supertest)', () => {
  it('GET /api/health reports engine health, offline readiness, and detector metrics', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      engine: 'DeadlockZero-SCC-v1',
      offlineReady: true,
    });
    expect(response.body.metrics).toMatchObject({
      scenarioCount: 5,
      defaultWorkerCount: 500,
      detectorCount: 2,
    });
  });

  it('GET /api/scenarios lists all 5 production outage presets', async () => {
    const response = await request(app).get('/api/scenarios');

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(5);
    expect(response.body.scenarios).toHaveLength(5);
    const ids = response.body.scenarios.map((s: { id: string }) => s.id);
    expect(ids).toEqual([
      'payment-abba-deadlock',
      'microservice-circular-rpc',
      'db-pool-starvation',
      'inventory-double-spend',
      'cascading-retry-storm',
    ]);
  });

  it('POST /api/analyze analyzes a preset scenarioId and returns WFG nodes, cycles, diff, and runbook', async () => {
    const response = await request(app)
      .post('/api/analyze')
      .send({ scenarioId: 'payment-abba-deadlock' });

    expect(response.status).toBe(200);
    expect(response.body.source).toMatchObject({
      kind: 'preset',
      scenarioId: 'payment-abba-deadlock',
    });
    expect(response.body.graph.nodes.length).toBeGreaterThan(0);
    expect(response.body.graph.edges.length).toBeGreaterThan(0);
    expect(response.body.deadlocks.length).toBeGreaterThan(0);
    expect(response.body.cycles[0].cycleNodes).toEqual([
      'Worker_1',
      'Account_B',
      'Worker_2',
      'Account_A',
      'Worker_1',
    ]);
    expect(response.body.patchDiff).toContain('DeadlockZero canonical');
    expect(response.body.incidentChecklist).toContain('3 a.m. Outage Runbook Checklist');
  });

  it('POST /api/analyze accepts customEvents LockEvent[] and detects deadlocks and vector-clock races', async () => {
    const response = await request(app)
      .post('/api/analyze')
      .send({
        customEvents: [
          {
            id: 'e1',
            workerId: 'Worker_A',
            resourceId: 'Lock_1',
            action: 'ACQUIRE',
            timestamp: 100,
            vectorClock: { Worker_A: 1, Worker_B: 0 },
            file: 'src/services/ledger.ts',
            line: 10,
            codeSnippet: 'acquire(Lock_1)',
          },
          {
            id: 'e2',
            workerId: 'Worker_B',
            resourceId: 'Lock_2',
            action: 'ACQUIRE',
            timestamp: 105,
            vectorClock: { Worker_A: 0, Worker_B: 1 },
            file: 'src/services/ledger.ts',
            line: 20,
            codeSnippet: 'acquire(Lock_2)',
          },
          {
            id: 'e3',
            workerId: 'Worker_A',
            resourceId: 'Lock_2',
            action: 'WAIT',
            timestamp: 110,
            vectorClock: { Worker_A: 2, Worker_B: 0 },
            file: 'src/services/ledger.ts',
            line: 11,
            codeSnippet: 'wait(Lock_2)',
          },
          {
            id: 'e4',
            workerId: 'Worker_B',
            resourceId: 'Lock_1',
            action: 'WAIT',
            timestamp: 115,
            vectorClock: { Worker_A: 0, Worker_B: 2 },
            file: 'src/services/ledger.ts',
            line: 21,
            codeSnippet: 'wait(Lock_1)',
          },
          {
            id: 'e5',
            workerId: 'Worker_A',
            resourceId: 'sku_99_stock',
            action: 'WRITE',
            timestamp: 120,
            vectorClock: { Worker_A: 2, Worker_B: 1 },
            file: 'src/checkout/stockEngine.ts',
            line: 31,
            codeSnippet: 'write(sku_99_stock)',
          },
          {
            id: 'e6',
            workerId: 'Worker_B',
            resourceId: 'sku_99_stock',
            action: 'WRITE',
            timestamp: 121,
            vectorClock: { Worker_A: 1, Worker_B: 2 },
            file: 'src/checkout/stockEngine.ts',
            line: 32,
            codeSnippet: 'write(sku_99_stock)',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.source.kind).toBe('custom');
    expect(response.body.cycles).toHaveLength(1);
    expect(response.body.races).toHaveLength(1);
    expect(response.body.remediation.unifiedDiff).toContain('--- a/');
  });

  it('POST /api/benchmark runs the 500-worker chaos simulation and returns before/after metrics', async () => {
    const response = await request(app)
      .post('/api/benchmark')
      .send({ scenarioId: 'payment-abba-deadlock', workers: 500 });

    expect(response.status).toBe(200);
    expect(response.body.workers).toBe(500);
    expect(response.body.before.workers).toBe(500);
    expect(response.body.after.workers).toBe(500);
    expect(response.body.before.deadlocksTriggered).toBeGreaterThan(0);
    expect(response.body.after.deadlocksTriggered).toBe(0);
    expect(response.body.before.throughputReqPerSec).toBeLessThan(
      response.body.after.throughputReqPerSec,
    );
    expect(response.body.improvementFactor).toBeGreaterThan(10);
  });

  it('GET / serves the frontend HTML entrypoint', async () => {
    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('<title>DeadlockZero</title>');
  });
});
