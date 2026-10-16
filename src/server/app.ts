import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectDeadlocks,
  type DeadlockFinding,
} from '../engine/deadlockDetector';
import {
  buildWaitForGraph,
  type LockEvent,
  type SourceCodeReference,
  type WaitForGraphSnapshot,
} from '../engine/graph';
import {
  detectRaces,
  detectStarvation,
  type RaceAnalysis,
} from '../engine/raceDetector';
import {
  generateRemediationPlan,
  type RemediationResult,
} from '../engine/remediator';
import {
  DEFAULT_WORKER_COUNT,
  runChaosBenchmark,
  type SimulationMetrics,
} from '../engine/simulator';

const SERVER_VERSION = '1.0.0';
const JSON_BODY_LIMIT = '5mb';

const VALID_ACTIONS = new Set(['ACQUIRE', 'WAIT', 'RELEASE', 'READ', 'WRITE']);

type JsonRecord = Record<string, unknown>;

export interface ServerOptions {
  /** Override the frontend build directory, primarily useful for integration tests. */
  readonly staticDir?: string;
}

export interface StartServerOptions extends ServerOptions {
  readonly port?: number;
  readonly host?: string;
}

export interface ValidationIssue {
  readonly index?: number;
  readonly field: string;
  readonly message: string;
}

interface AnalysisResponse {
  readonly events: readonly LockEvent[];
  readonly sourceCode?: string;
  readonly graph: WaitForGraphSnapshot & {
    readonly nodes: readonly unknown[];
    readonly edges: readonly unknown[];
  };
  readonly nodes: readonly unknown[];
  readonly edges: readonly unknown[];
  readonly deadlocks: readonly DeadlockFinding[];
  readonly detectedCycles: readonly (readonly string[])[];
  readonly cycles: readonly DeadlockFinding[];
  readonly raceAnalysis: RaceAnalysis;
  readonly races: RaceAnalysis['races'];
  readonly dataRaces: RaceAnalysis['dataRaces'];
  readonly poolStarvation: RaceAnalysis['poolStarvation'];
  readonly starvation: RaceAnalysis['poolStarvation'];
  readonly offendingCodeLines: readonly SourceCodeReference[];
  readonly offendingLines: readonly SourceCodeReference[];
  readonly patch: string;
  readonly patchDiff: string;
  readonly diff: string;
  readonly unifiedDiff: string;
  readonly remediation: RemediationResult;
  readonly remediationPlan: RemediationResult;
  readonly incidentChecklist: string;
  readonly checklist: string;
  readonly runbook: string;
  readonly runbookMarkdown: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class HttpValidationError extends Error {
  public constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string,
    public readonly details: readonly ValidationIssue[],
  ) {
    super(message);
    this.name = 'HttpValidationError';
  }
}

export function validateLockEventsPayload(body: unknown): {
  readonly events: LockEvent[];
  readonly sourceCode?: string;
  readonly workers?: number;
} {
  if (!isRecord(body)) {
    throw new HttpValidationError(
      400,
      'Request body must be a JSON object containing an "events" array of LockEvent records.',
      'INVALID_EVENTS_PAYLOAD',
      [{ field: 'body', message: 'Expected a JSON object with an "events" array.' }],
    );
  }

  const rawEvents = body.events;
  if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
    throw new HttpValidationError(
      400,
      'Field "events" is required and must be a non-empty array of LockEvent objects.',
      'INVALID_EVENTS_PAYLOAD',
      [{ field: 'events', message: 'Must be a non-empty array of LockEvent objects.' }],
    );
  }

  const issues: ValidationIssue[] = [];
  const validatedEvents: LockEvent[] = [];

  rawEvents.forEach((item, index) => {
    if (!isRecord(item)) {
      issues.push({ index, field: `events[${index}]`, message: 'Event must be a JSON object.' });
      return;
    }

    const workerId = typeof item.workerId === 'string' ? item.workerId.trim() : '';
    const resourceId = typeof item.resourceId === 'string' ? item.resourceId.trim() : '';
    const action = typeof item.action === 'string' ? item.action.trim().toUpperCase() : '';
    const timestamp = typeof item.timestamp === 'number' && Number.isFinite(item.timestamp) ? item.timestamp : index;
    const file = typeof item.file === 'string' && item.file.trim().length > 0 ? item.file.trim() : 'trace.ts';
    const line = typeof item.line === 'number' && Number.isInteger(item.line) && item.line >= 1 ? item.line : 1;
    const codeSnippet =
      typeof item.codeSnippet === 'string' && item.codeSnippet.trim().length > 0
        ? item.codeSnippet
        : `${action} ${resourceId}`;
    const id = typeof item.id === 'string' && item.id.trim().length > 0 ? item.id.trim() : `evt-${index + 1}`;

    if (!workerId) {
      issues.push({ index, field: `events[${index}].workerId`, message: 'workerId must be a non-empty string.' });
    }
    if (!resourceId) {
      issues.push({ index, field: `events[${index}].resourceId`, message: 'resourceId must be a non-empty string.' });
    }
    if (!VALID_ACTIONS.has(action)) {
      issues.push({
        index,
        field: `events[${index}].action`,
        message: 'action must be one of ACQUIRE, WAIT, RELEASE, READ, or WRITE.',
      });
    }

    const vectorClock: Record<string, number> = {};
    if (item.vectorClock !== undefined) {
      if (!isRecord(item.vectorClock)) {
        issues.push({
          index,
          field: `events[${index}].vectorClock`,
          message: 'vectorClock must be an object mapping worker IDs to non-negative integers.',
        });
      } else {
        for (const [k, v] of Object.entries(item.vectorClock)) {
          if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
            issues.push({
              index,
              field: `events[${index}].vectorClock.${k}`,
              message: 'Clock value must be a non-negative integer.',
            });
          } else {
            vectorClock[k] = v;
          }
        }
      }
    }

    if (issues.length === 0) {
      validatedEvents.push({
        id,
        workerId,
        resourceId,
        action: action as LockEvent['action'],
        timestamp,
        vectorClock,
        file,
        line,
        codeSnippet,
      });
    }
  });

  if (issues.length > 0) {
    throw new HttpValidationError(
      400,
      `Invalid LockEvent payload: ${issues[0].field} — ${issues[0].message}`,
      'INVALID_EVENTS_PAYLOAD',
      issues,
    );
  }

  let workers: number | undefined;
  if (body.workers !== undefined) {
    if (typeof body.workers !== 'number' || !Number.isInteger(body.workers) || body.workers < 1) {
      throw new HttpValidationError(
        400,
        'Field "workers" must be a positive integer.',
        'INVALID_EVENTS_PAYLOAD',
        [{ field: 'workers', message: 'Must be a positive integer.' }],
      );
    }
    workers = body.workers;
  }

  const sourceCode = typeof body.sourceCode === 'string' && body.sourceCode.trim().length > 0
    ? body.sourceCode
    : undefined;

  return { events: validatedEvents, sourceCode, workers };
}

function collectOffendingCodeLines(
  deadlocks: readonly DeadlockFinding[],
  raceAnalysis: RaceAnalysis,
  events: readonly LockEvent[],
): SourceCodeReference[] {
  const sources: SourceCodeReference[] = [];
  for (const finding of deadlocks) {
    sources.push(...finding.waitSources.filter((s): s is SourceCodeReference => s !== undefined));
    sources.push(...finding.acquisitionSources.filter((s): s is SourceCodeReference => s !== undefined));
  }
  for (const finding of raceAnalysis.races) {
    sources.push(...finding.sourceLocations.filter((s): s is SourceCodeReference => s !== undefined));
  }
  for (const finding of raceAnalysis.poolStarvation) {
    sources.push(...finding.sourceLocations.filter((s): s is SourceCodeReference => s !== undefined));
  }
  for (const ev of events) {
    if (ev.file && Number.isInteger(ev.line) && ev.line >= 1) {
      sources.push({ file: ev.file, line: ev.line });
    }
  }
  const unique = new Map<string, SourceCodeReference>();
  for (const source of sources) {
    unique.set(`${source.file}:${source.line}:${source.column ?? ''}`, { ...source });
  }
  return [...unique.values()].sort(
    (left, right) => left.file.localeCompare(right.file) || left.line - right.line,
  );
}

function analyzeEvents(body: unknown): AnalysisResponse {
  const { events, sourceCode } = validateLockEventsPayload(body);
  const wfg = buildWaitForGraph(events);
  const deadlocks = detectDeadlocks(wfg);
  const races = detectRaces(events);
  const poolStarvation = detectStarvation(events);
  const raceAnalysis: RaceAnalysis = {
    races,
    dataRaces: races,
    poolStarvation,
    poolStarvationFindings: poolStarvation,
  };

  const remediation = sourceCode
    ? generateRemediationPlan(
        {
          id: 'trace-analysis',
          title: 'Lock Trace Forensics',
          sourceFile: events[0]?.file ?? 'src/concurrency/locks.ts',
          locks: wfg.resourceNodes.map((r) => r.id),
          brokenCode: sourceCode,
        },
        deadlocks,
        races,
      )
    : generateRemediationPlan(events, deadlocks, races);

  const offendingCodeLines = collectOffendingCodeLines(deadlocks, raceAnalysis, events);

  return {
    events,
    ...(sourceCode ? { sourceCode } : {}),
    graph: {
      executionNodes: wfg.executionNodes,
      resourceNodes: wfg.resourceNodes,
      acquisitions: wfg.acquisitions,
      waitForEdges: wfg.waitForEdges,
      nodes: wfg.nodes,
      edges: wfg.edges,
    },
    nodes: wfg.nodes,
    edges: wfg.edges,
    deadlocks,
    detectedCycles: deadlocks.map((d) => [...d.cycle]),
    cycles: deadlocks,
    raceAnalysis,
    races,
    dataRaces: races,
    poolStarvation,
    starvation: poolStarvation,
    offendingCodeLines,
    offendingLines: offendingCodeLines,
    patch: remediation.unifiedDiff,
    patchDiff: remediation.unifiedDiff,
    diff: remediation.unifiedDiff,
    unifiedDiff: remediation.unifiedDiff,
    remediation,
    remediationPlan: remediation,
    incidentChecklist: remediation.runbookMarkdown,
    checklist: remediation.runbookMarkdown,
    runbook: remediation.runbookMarkdown,
    runbookMarkdown: remediation.runbookMarkdown,
  };
}

function benchmarkEvents(body: unknown): {
  readonly workers: number;
  readonly workerCount: number;
  readonly before: SimulationMetrics;
  readonly after: SimulationMetrics;
  readonly improvementFactor: number;
} {
  const { events, workers } = validateLockEventsPayload(body);
  const effectiveWorkers = workers ?? configuredWorkerCount();
  const chaos = runChaosBenchmark(events, effectiveWorkers);
  return {
    workers: effectiveWorkers,
    workerCount: effectiveWorkers,
    before: chaos.before,
    after: chaos.after,
    improvementFactor: chaos.improvementFactor,
  };
}

function configuredWorkerCount(): number {
  const parsed = Number.parseInt(process.env.SIMULATION_WORKERS ?? String(DEFAULT_WORKER_COUNT), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WORKER_COUNT;
}

function configuredPort(): number {
  const parsed = Number.parseInt(process.env.PORT ?? String(3000), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 3000;
}

function configuredHost(): string {
  const raw = process.env.HOST?.trim();
  return raw !== undefined && raw.length > 0 ? raw : '0.0.0.0';
}

function frontendDirectory(options: ServerOptions): string {
  if (options.staticDir !== undefined) return resolve(options.staticDir);
  const currentDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
  const distClient = resolve(currentDirectory, '../../dist/client');
  if (existsSync(resolve(distClient, 'index.html'))) {
    return distClient;
  }
  return resolve(currentDirectory, '../../dist');
}

function fallbackIndexHtmlPath(): string {
  const currentDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
  return resolve(currentDirectory, '../../index.html');
}

function sendError(response: Response, error: unknown): void {
  if (error instanceof HttpValidationError) {
    response.status(error.statusCode).json({
      error: error.message,
      code: error.code,
      details: error.details,
    });
    return;
  }
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  response.status(400).json({ error: message, code: 'INVALID_REQUEST' });
}

function healthPayload(staticDir: string): JsonRecord {
  const workerCount = configuredWorkerCount();
  const metrics = {
    defaultWorkerCount: workerCount,
    detectorCount: 2,
    detectors: ['deadlock-cycles', 'vector-clock-races'],
    staticFrontendAvailable: existsSync(staticDir) || existsSync(fallbackIndexHtmlPath()),
  };
  return {
    status: 'ok',
    engine: 'DeadlockZero-SCC-v1',
    offlineReady: true,
    service: 'deadlockzero-api',
    version: SERVER_VERSION,
    metrics,
    engineMetrics: metrics,
  };
}

/** Create an import-safe Express application for the REST API and frontend. */
export function createApp(options: ServerOptions = {}): Express {
  const app = express();
  const staticDir = frontendDirectory(options);

  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.get('/api/health', (_request, response) => {
    response.status(200).json(healthPayload(staticDir));
  });

  app.post('/api/analyze', (request, response) => {
    try {
      response.status(200).json(analyzeEvents(request.body));
    } catch (error) {
      sendError(response, error);
    }
  });

  app.post('/api/benchmark', (request, response) => {
    try {
      response.status(200).json(benchmarkEvents(request.body));
    } catch (error) {
      sendError(response, error);
    }
  });

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  });

  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));
  }

  const indexHtmlPath = existsSync(resolve(staticDir, 'index.html'))
    ? resolve(staticDir, 'index.html')
    : fallbackIndexHtmlPath();

  if (existsSync(indexHtmlPath)) {
    app.use((request, response, next) => {
      if (request.method !== 'GET' || request.path.startsWith('/api/')) {
        next();
        return;
      }
      response.sendFile(indexHtmlPath, (error) => {
        if (error && !response.headersSent) next(error);
      });
    });
  }

  app.use((_request, response) => {
    response.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  });

  const errorHandler = ((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (response.headersSent) return;
    if (isRecord(error) && error.type === 'entity.parse.failed') {
      response.status(400).json({ error: 'Request body contains invalid JSON', code: 'INVALID_JSON' });
      return;
    }
    response.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }) satisfies (error: unknown, request: Request, response: Response, next: NextFunction) => void;
  app.use(errorHandler);

  return app;
}

/** Start the HTTP server on PORT or 3000. */
export function startServer(options: StartServerOptions = {}): Server {
  const port = options.port ?? configuredPort();
  const host = options.host ?? configuredHost();
  const app = createApp(options);
  const server = createServer(app);
  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address !== null ? address.port : port;
    console.log(`DeadlockZero server listening on http://${host}:${actualPort}`);
  });
  return server;
}

export const app = createApp();
export default app;
