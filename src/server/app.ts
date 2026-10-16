import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeTrace } from '../engine/analyze';
import type { DeadlockFinding } from '../engine/deadlockDetector';
import type { RaceFinding } from '../engine/raceDetector';
import { runChaosBenchmark, SimulationInputError } from '../engine/simulator';
import {
  RequestValidationError,
  validateEventsPayload,
  validateSimulationParameters,
} from '../shared/traceValidation';
import type { DeadlockCycle, RaceConflict } from '../shared/types';
import { loadConfig, type ServerConfig } from './config';
import { createLogger, errorFields, type Logger } from './logger';

export const SERVER_VERSION = '0.2.0';

export interface AppOptions {
  readonly config?: ServerConfig;
  readonly logger?: Logger;
  /** Directory containing the built frontend (index.html + assets). */
  readonly staticDir?: string;
}

export function defaultStaticDir(): string {
  // Resolves to <repo>/dist/client from both src/server (tsx) and dist/server (built bundle).
  return resolve(fileURLToPath(new URL('.', import.meta.url)), '../../dist/client');
}

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
    "connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function toCycle(finding: DeadlockFinding): DeadlockCycle {
  return {
    id: finding.id,
    cycle: [...finding.cycle],
    cycleNodes: [...finding.cycleNodes],
    offendingLines: finding.offendingLines.map((line) => ({ ...line })),
    explanation: finding.explanation,
  };
}

function toRace(finding: RaceFinding): RaceConflict {
  return {
    resourceId: finding.resourceId,
    workerA: finding.workerA,
    workerB: finding.workerB,
    eventA: finding.eventA,
    eventB: finding.eventB,
    vectorClockA: finding.vectorClockA,
    vectorClockB: finding.vectorClockB,
    explanation: finding.explanation,
  };
}

/** Fixed-window, per-client rate limiter held in memory (per process). */
function rateLimiter(windowMs: number, max: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  let nextPrune = Date.now() + windowMs;
  return (request: Request, response: Response, next: NextFunction): void => {
    const now = Date.now();
    if (now >= nextPrune) {
      for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
      nextPrune = now + windowMs;
    }
    const key = request.ip ?? 'unknown';
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    response.setHeader('RateLimit-Limit', String(max));
    response.setHeader('RateLimit-Remaining', String(remaining));
    response.setHeader('RateLimit-Reset', String(Math.ceil((entry.resetAt - now) / 1_000)));
    if (entry.count > max) {
      response.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1_000)));
      response.status(429).json({ error: 'Too many requests; retry later.', code: 'RATE_LIMITED' });
      return;
    }
    next();
  };
}

function requireJson(request: Request, response: Response, next: NextFunction): void {
  if (!request.is('application/json')) {
    response.status(415).json({ error: 'Content-Type must be application/json.', code: 'UNSUPPORTED_MEDIA_TYPE' });
    return;
  }
  next();
}

/** Create an import-safe Express application. No module-level side effects. */
export function createApp(options: AppOptions = {}): Express {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? createLogger(config.logLevel);
  const staticDir = options.staticDir ?? defaultStaticDir();
  const indexHtml = resolve(staticDir, 'index.html');
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use((request, response, next) => {
    const started = process.hrtime.bigint();
    const requestId = randomUUID();
    response.locals.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
    response.on('finish', () => {
      logger.info('request', {
        requestId,
        method: request.method,
        // originalUrl keeps the mount prefix (e.g. /api); drop the query string from logs.
        path: request.originalUrl.split('?')[0],
        status: response.statusCode,
        durationMs: Number(process.hrtime.bigint() - started) / 1e6,
      });
    });
    next();
  });

  if (config.corsOrigins.length > 0) {
    app.use('/api', cors({ origin: [...config.corsOrigins], methods: ['GET', 'POST'], maxAge: 600 }));
  }

  app.get('/api/health', (_request, response) => {
    response.status(200).json({ status: 'ok', service: 'deadlockzero', version: SERVER_VERSION });
  });

  app.get('/api/ready', (_request, response) => {
    const frontend = existsSync(indexHtml);
    response.status(200).json({ status: 'ready', checks: { api: 'ok', frontendAssets: frontend ? 'ok' : 'missing' } });
  });

  const limited = rateLimiter(config.rateLimitWindowMs, config.rateLimitMax);
  const json = express.json({ limit: config.bodyLimitBytes });

  app.post('/api/analyze', limited, requireJson, json, (request, response) => {
    const { events, sourceCode } = validateEventsPayload(request.body, config.maxTraceEvents);
    const analysis = analyzeTrace(events, { sourceCode });
    response.status(200).json({
      summary: {
        eventCount: events.length,
        workerCount: analysis.graph.nodes.filter((node) => node.type === 'WORKER').length,
        resourceCount: analysis.graph.nodes.filter((node) => node.type === 'RESOURCE').length,
        cycleCount: analysis.cycles.length,
        raceCount: analysis.races.length,
        starvationCount: analysis.starvation.length,
      },
      graph: { nodes: analysis.graph.nodes, edges: analysis.graph.edges, adjacency: analysis.graph.adjacency },
      cycles: analysis.cycles.map(toCycle),
      races: analysis.races.map(toRace),
      starvation: analysis.starvation,
      remediation: analysis.remediation,
    });
  });

  app.post('/api/benchmark', limited, requireJson, json, (request, response) => {
    const { events } = validateEventsPayload(request.body, config.maxTraceEvents);
    const parameters = validateSimulationParameters(request.body, config.maxSimulationWorkers);
    const result = runChaosBenchmark(events, {
      workers: parameters.workers ?? config.defaultSimulationWorkers,
      requestsPerWorker: parameters.requestsPerWorker,
      seed: parameters.seed,
    });
    response.status(200).json(result);
  });

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  });

  app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api\/).*/, (_request, response, next) => {
    if (!existsSync(indexHtml)) {
      response
        .status(503)
        .json({ error: 'Frontend assets are not built. Run "npm run build" first.', code: 'FRONTEND_NOT_BUILT' });
      return;
    }
    response.setHeader('Cache-Control', 'no-cache');
    response.sendFile(indexHtml, (error) => {
      if (error && !response.headersSent) next(error);
    });
  });

  app.use((_request, response) => {
    response.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const requestId = String(response.locals.requestId ?? '');
    if (response.headersSent) return;
    if (error instanceof RequestValidationError) {
      response.status(error.statusCode).json({ error: error.message, code: error.code, details: error.details, requestId });
      return;
    }
    if (error instanceof SimulationInputError) {
      response.status(422).json({ error: error.message, code: 'UNSIMULATABLE_TRACE', requestId });
      return;
    }
    const type = typeof error === 'object' && error !== null ? (error as { type?: unknown }).type : undefined;
    if (type === 'entity.parse.failed') {
      response.status(400).json({ error: 'Request body contains invalid JSON.', code: 'INVALID_JSON', requestId });
      return;
    }
    if (type === 'entity.too.large') {
      response.status(413).json({ error: `Request body exceeds ${config.bodyLimitBytes} bytes.`, code: 'PAYLOAD_TOO_LARGE', requestId });
      return;
    }
    logger.error('unhandled request error', { requestId, ...errorFields(error) });
    response.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR', requestId });
  });

  return app;
}

export interface RunningServer {
  readonly server: Server;
  close(): Promise<void>;
}

/** Start the HTTP server with bounded timeouts and a graceful close helper. */
export function startServer(options: AppOptions = {}): RunningServer {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? createLogger(config.logLevel);
  const server = createServer(createApp({ ...options, config, logger }));
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.listen(config.port, config.host, () => {
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : config.port;
    logger.info('server listening', { host: config.host, port, nodeEnv: config.nodeEnv, version: SERVER_VERSION });
  });
  return {
    server,
    close: () =>
      new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
        server.closeIdleConnections();
      }),
  };
}
