import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app';
import { loadConfig } from '../src/server/config';
import { createLogger } from '../src/server/logger';
import { ABBA_DEADLOCK_TRACE, CANONICAL_SAFE_TRACE, VECTOR_CLOCK_RACE_TRACE } from './fixtures/traces';

const silent = createLogger('silent');
const builtDir = mkdtempSync(join(tmpdir(), 'deadlockzero-static-'));
writeFileSync(join(builtDir, 'index.html'), '<!doctype html><title>DeadlockZero</title>');
const missingDir = join(builtDir, 'does-not-exist');

afterAll(() => rmSync(builtDir, { recursive: true, force: true }));

function makeApp(env: Record<string, string> = {}, staticDir = builtDir) {
  return createApp({ config: loadConfig(env), logger: silent, staticDir });
}

const app = makeApp();

describe('health and readiness', () => {
  it('GET /api/health reports liveness', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', service: 'deadlockzero' });
  });

  it('GET /api/ready reports whether frontend assets are present', async () => {
    expect((await request(app).get('/api/ready')).body.checks.frontendAssets).toBe('ok');
    expect((await request(makeApp({}, missingDir)).get('/api/ready')).body.checks.frontendAssets).toBe('missing');
  });
});

describe('POST /api/analyze', () => {
  it('analyzes a trace and returns graph, cycles, races, and remediation', async () => {
    const response = await request(app)
      .post('/api/analyze')
      .send({ events: [...ABBA_DEADLOCK_TRACE, ...VECTOR_CLOCK_RACE_TRACE] });

    expect(response.status).toBe(200);
    expect(response.body.summary).toMatchObject({ eventCount: 8, cycleCount: 1 });
    expect(response.body.summary.raceCount).toBeGreaterThan(0);
    expect(response.body.cycles[0].cycleNodes).toEqual(['Worker_1', 'Account_B', 'Worker_2', 'Account_A', 'Worker_1']);
    expect(response.body.graph.nodes.length).toBeGreaterThan(0);
    expect(response.body.remediation).toMatchObject({ strategy: 'canonical-lock-order', generated: true });
    expect(response.body.remediation.unifiedDiff).toMatch(/^--- a\//);
  });

  it('reports a clean trace as clean', async () => {
    const response = await request(app).post('/api/analyze').send({ events: CANONICAL_SAFE_TRACE });
    expect(response.status).toBe(200);
    expect(response.body.summary).toMatchObject({ cycleCount: 0, raceCount: 0, starvationCount: 0 });
    expect(response.body.remediation.strategy).toBe('none-required');
  });

  it('rejects missing or malformed events with field-level details', async () => {
    const empty = await request(app).post('/api/analyze').send({});
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe('INVALID_EVENTS_PAYLOAD');

    const malformed = await request(app)
      .post('/api/analyze')
      .send({ events: [{ workerId: '', resourceId: 'lock', action: 'EXPLODE', vectorClock: { a: -1 } }] });
    expect(malformed.status).toBe(400);
    expect(malformed.body.details.map((issue: { field: string }) => issue.field)).toEqual([
      'events[0].workerId',
      'events[0].action',
      'events[0].vectorClock.a',
    ]);
  });

  it('rejects invalid JSON, wrong content types, and oversized traces', async () => {
    const badJson = await request(app).post('/api/analyze').set('content-type', 'application/json').send('{"events": [');
    expect(badJson.status).toBe(400);
    expect(badJson.body.code).toBe('INVALID_JSON');

    const text = await request(app).post('/api/analyze').set('content-type', 'text/plain').send('hello');
    expect(text.status).toBe(415);

    const limited = makeApp({ MAX_TRACE_EVENTS: '2' });
    const tooMany = await request(limited).post('/api/analyze').send({ events: ABBA_DEADLOCK_TRACE });
    expect(tooMany.status).toBe(413);
    expect(tooMany.body.code).toBe('TRACE_TOO_LARGE');

    const smallBody = makeApp({ BODY_LIMIT_BYTES: '1024' });
    const huge = await request(smallBody).post('/api/analyze').send({ events: ABBA_DEADLOCK_TRACE, sourceCode: 'x'.repeat(4_000) });
    expect(huge.status).toBe(413);
    expect(huge.body.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('POST /api/benchmark', () => {
  it('runs the simulation on the submitted trace', async () => {
    const response = await request(app).post('/api/benchmark').send({ events: ABBA_DEADLOCK_TRACE, workers: 40, requestsPerWorker: 2 });
    expect(response.status).toBe(200);
    expect(response.body.config).toMatchObject({ workers: 40, requestsPerWorker: 2 });
    expect(response.body.before.deadlocksTriggered).toBeGreaterThan(0);
    expect(response.body.after.deadlocksTriggered).toBe(0);
    expect(response.body.after.completedRequests).toBe(80);
  });

  it('validates simulation parameters against configured limits', async () => {
    const tooMany = await request(makeApp({ MAX_SIMULATION_WORKERS: '100', SIMULATION_WORKERS: '50' }))
      .post('/api/benchmark')
      .send({ events: ABBA_DEADLOCK_TRACE, workers: 101 });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.details[0].field).toBe('workers');

    const missing = await request(app).post('/api/benchmark').send({ workers: 10 });
    expect(missing.status).toBe(400);
  });

  it('returns 422 for traces with nothing to simulate instead of inventing numbers', async () => {
    const response = await request(app)
      .post('/api/benchmark')
      .send({ events: [{ workerId: 'w', resourceId: 'r', action: 'RELEASE' }] });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('UNSIMULATABLE_TRACE');
  });
});

describe('security and operations', () => {
  it('sets security headers and a request id on every response', async () => {
    const response = await request(app).get('/api/health');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('rate limits analysis endpoints per client', async () => {
    const limited = makeApp({ RATE_LIMIT_MAX: '2' });
    const send = () => request(limited).post('/api/analyze').send({ events: CANONICAL_SAFE_TRACE });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const blocked = await send();
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('does not send CORS headers unless origins are configured', async () => {
    const closed = await request(app).get('/api/health').set('Origin', 'https://example.com');
    expect(closed.headers['access-control-allow-origin']).toBeUndefined();

    const open = await request(makeApp({ CORS_ORIGIN: 'https://example.com' })).get('/api/health').set('Origin', 'https://example.com');
    expect(open.headers['access-control-allow-origin']).toBe('https://example.com');
  });

  it('has no demo or preset endpoints', async () => {
    expect((await request(app).get('/api/scenarios')).status).toBe(404);
  });
});

describe('frontend serving', () => {
  it('serves the built index.html for app routes', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    expect(response.text).toContain('<title>DeadlockZero</title>');
  });

  it('returns an explicit 503 instead of a broken page when assets are not built', async () => {
    const response = await request(makeApp({}, missingDir)).get('/');
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('FRONTEND_NOT_BUILT');
  });
});
