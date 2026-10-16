import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Server } from 'node:http';
import { resolve } from 'node:path';
import { createApp } from '../src/server/index';

const PAYMENT_SCENARIO_ID = 'payment-ledger-ab-ba-lock-deadlock';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createApp({ staticDir: resolve(process.cwd(), 'dist') }).listen(0);
  await new Promise<void>((resolveReady, reject) => {
    server.once('listening', resolveReady);
    server.once('error', reject);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Test server did not expose a TCP address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolveClosed, reject) => {
    server.close((error) => (error ? reject(error) : resolveClosed()));
  });
});

async function get(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('DeadlockZero Express API', () => {
  it('reports engine health and detector metrics', async () => {
    const response = await get('/api/health');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: 'ok', engine: 'ready' });
    expect(body.metrics).toMatchObject({
      scenarioCount: 5,
      defaultWorkerCount: 500,
      detectorCount: 2,
    });
  });

  it('lists all five production outage presets', async () => {
    const response = await get('/api/scenarios');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.count).toBe(5);
    expect(body.scenarios).toHaveLength(5);
    expect(body.scenarios.map((scenario: { id: string }) => scenario.id)).toContain(PAYMENT_SCENARIO_ID);
  });

  it('analyzes a preset and returns the graph, cycles, patch, and runbook', async () => {
    const response = await post('/api/analyze', { presetId: PAYMENT_SCENARIO_ID });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toMatchObject({ kind: 'preset', scenarioId: PAYMENT_SCENARIO_ID });
    expect(body.graph.nodes.length).toBeGreaterThan(0);
    expect(body.graph.edges.length).toBeGreaterThan(0);
    expect(body.deadlocks.length).toBeGreaterThan(0);
    expect(body.cycles.length).toBeGreaterThan(0);
    expect(body.offendingCodeLines.length).toBeGreaterThan(0);
    expect(body.patchDiff).toContain('DeadlockZero canonical ordering');
    expect(body.incidentChecklist).toContain('3 a.m. Outage Runbook Checklist');
  });

  it('analyzes a custom lock trace and vector-clock race together', async () => {
    const response = await post('/api/analyze', {
      trace: [
        {
          kind: 'acquire',
          threadId: 'worker-a',
          lockId: 'lock-a',
          source: { file: 'src/a.ts', line: 10 },
        },
        {
          kind: 'acquire',
          threadId: 'worker-b',
          lockId: 'lock-b',
          source: { file: 'src/b.ts', line: 20 },
        },
        {
          kind: 'wait',
          threadId: 'worker-a',
          holderId: 'worker-b',
          lockId: 'lock-b',
          source: { file: 'src/a.ts', line: 11 },
        },
        {
          kind: 'wait',
          threadId: 'worker-b',
          holderId: 'worker-a',
          lockId: 'lock-a',
          source: { file: 'src/b.ts', line: 21 },
        },
        {
          id: 'inventory-write-a',
          threadId: 'worker-a',
          location: 'inventory.available',
          mode: 'write',
          clock: { 'worker-a': 1 },
          source: { file: 'src/inventory.ts', line: 88 },
        },
        {
          id: 'inventory-write-b',
          threadId: 'worker-b',
          location: 'inventory.available',
          mode: 'write',
          clock: { 'worker-b': 1 },
          source: { file: 'src/inventory.ts', line: 104 },
        },
      ],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source.kind).toBe('custom');
    expect(body.cycles).toHaveLength(1);
    expect(body.races).toHaveLength(1);
    expect(body.offendingCodeLines).toEqual(
      expect.arrayContaining([
        { file: 'src/a.ts', line: 10 },
        { file: 'src/a.ts', line: 11 },
        { file: 'src/b.ts', line: 20 },
        { file: 'src/b.ts', line: 21 },
        { file: 'src/inventory.ts', line: 88 },
        { file: 'src/inventory.ts', line: 104 },
      ]),
    );
    expect(body.patchDiff).toContain('--- a/src/a.ts');
    expect(body.checklist).toContain('## Patch and verify');
  });

  it('accepts newline-delimited lock logs as a custom trace', async () => {
    const response = await post('/api/analyze', {
      trace: [
        '1 acquire thread=worker-a lock=lock-a src/a.ts:10',
        '2 acquire thread=worker-b lock=lock-b src/b.ts:20',
        '3 wait thread=worker-a lock=lock-b holder=worker-b src/a.ts:11',
        '4 wait thread=worker-b lock=lock-a holder=worker-a src/b.ts:21',
      ].join('\n'),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.cycles).toHaveLength(1);
    expect(body.offendingCodeLines).toEqual(
      expect.arrayContaining([
        { file: 'src/a.ts', line: 10 },
        { file: 'src/a.ts', line: 11 },
      ]),
    );
  });

  it('runs the 500-worker before/after replay with comparative metrics', async () => {
    const response = await post('/api/benchmark', { scenarioId: PAYMENT_SCENARIO_ID });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workerCount).toBe(500);
    expect(body.before.workerCount).toBe(500);
    expect(body.after.workerCount).toBe(500);
    expect(body.before.throughputRps).toBeLessThan(body.after.throughputRps);
    expect(body.before.p95LatencyMs).toBeGreaterThan(body.after.p95LatencyMs);
    expect(body.comparison.throughputRps.delta).toBeGreaterThan(0);
    expect(body.comparison.latencyMs.p95.delta).toBeLessThan(0);
  });

  it('serves the production frontend at the root route', async () => {
    const response = await get('/');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('<title>DeadlockZero</title>');
  });

  it('returns a useful validation error for an empty analysis request', async () => {
    const response = await post('/api/analyze', {});
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ code: 'INVALID_ANALYZE_REQUEST' });
  });
});
