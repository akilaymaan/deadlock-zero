import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/server/app';
import { ABBA_DEADLOCK_TRACE, VECTOR_CLOCK_RACE_TRACE } from './fixtures/traces';

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
      defaultWorkerCount: 500,
      detectorCount: 2,
    });
  });

  it('POST /api/analyze analyzes an events: LockEvent[] payload and returns WFG nodes, cycles, diff, and runbook', async () => {
    const response = await request(app)
      .post('/api/analyze')
      .send({
        events: [...ABBA_DEADLOCK_TRACE, ...VECTOR_CLOCK_RACE_TRACE],
        sourceCode: 'await tx.acquireRowLock(fromAccountId);\nawait tx.acquireRowLock(toAccountId);',
      });

    expect(response.status).toBe(200);
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
    expect(response.body.races.length).toBeGreaterThan(0);
    expect(response.body.patchDiff).toContain('--- a/');
    expect(response.body.incidentChecklist).toContain('3 a.m. Outage Runbook Checklist');
  });

  it('POST /api/analyze returns 400 Bad Request with schema validation details when events is missing or malformed', async () => {
    const emptyResponse = await request(app).post('/api/analyze').send({});
    expect(emptyResponse.status).toBe(400);
    expect(emptyResponse.body.code).toBe('INVALID_EVENTS_PAYLOAD');
    expect(Array.isArray(emptyResponse.body.details)).toBe(true);

    const malformedResponse = await request(app)
      .post('/api/analyze')
      .send({
        events: [{ workerId: '', resourceId: 'Lock_A', action: 'INVALID_ACTION' }],
      });
    expect(malformedResponse.status).toBe(400);
    expect(malformedResponse.body.code).toBe('INVALID_EVENTS_PAYLOAD');
    expect(malformedResponse.body.details.length).toBeGreaterThanOrEqual(2);
  });

  it('POST /api/benchmark runs the 500-worker chaos simulation on events: LockEvent[] and validates schema', async () => {
    const response = await request(app)
      .post('/api/benchmark')
      .send({ events: ABBA_DEADLOCK_TRACE, workers: 500 });

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

    const badBenchmark = await request(app).post('/api/benchmark').send({ workers: 500 });
    expect(badBenchmark.status).toBe(400);
    expect(badBenchmark.body.code).toBe('INVALID_EVENTS_PAYLOAD');
  });

  it('GET / serves the frontend HTML entrypoint', async () => {
    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('<title>DeadlockZero');
  });
});
