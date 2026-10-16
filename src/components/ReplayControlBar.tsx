import { useEffect, useId, useMemo, useRef, useState } from 'react';

import CustomTraceModal, {
  DEMO_TRACE_INPUT,
  type CustomTraceRequest,
} from './CustomTraceModal';

import './ReplayControlBar.css';

/** The request shape an integration can forward to `POST /api/benchmark`. */
export interface ReplayBenchmarkRequest {
  readonly scenarioId: string;
  readonly workerCount: number;
}

/** The fields used from one `/api/benchmark` before/after simulation result. */
export interface ReplaySimulationSnapshot {
  readonly throughputRps?: number;
  readonly throughputReqPerSec?: number;
  readonly throughput?: number;
  readonly deadlockCount?: number;
  readonly deadlocks?: number;
  readonly p99LatencyMs?: number;
  readonly p99Latency?: number;
  readonly p99?: number;
  readonly [key: string]: unknown;
}

/** A benchmark comparison with the server's stable before/after fields. */
export interface ReplayBenchmarkComparison {
  readonly before: ReplaySimulationSnapshot;
  readonly after: ReplaySimulationSnapshot;
  readonly workerCount?: number;
  readonly workers?: number;
  readonly scenarioId?: string;
  readonly scenarioName?: string;
  readonly [key: string]: unknown;
}

/**
 * The REST response is intentionally represented with compatibility aliases:
 * `/api/benchmark` returns a selected comparison directly for a scenario and a
 * `benchmarks` collection when no scenario is selected.
 */
export interface ReplayBenchmarkResponse {
  readonly before?: ReplaySimulationSnapshot;
  readonly after?: ReplaySimulationSnapshot;
  readonly benchmark?: ReplayBenchmarkComparison;
  readonly selected?: ReplayBenchmarkComparison;
  readonly benchmarks?: readonly ReplayBenchmarkComparison[];
  readonly comparisons?: readonly ReplayBenchmarkComparison[];
  readonly comparison?: Record<string, unknown>;
  readonly workerCount?: number;
  readonly workers?: number;
  readonly scenarioId?: string;
  readonly scenarioName?: string;
  readonly [key: string]: unknown;
}

/** An analyzer response is passed through untouched for graph/forensics views. */
export interface ReplayAnalyzeResponse {
  readonly [key: string]: unknown;
}

export type ReplayBenchmarkHandler = (
  request: ReplayBenchmarkRequest,
) => ReplayBenchmarkResponse | Promise<ReplayBenchmarkResponse>;

export type ReplayAnalyzeHandler = (
  request: CustomTraceRequest,
) => ReplayAnalyzeResponse | Promise<ReplayAnalyzeResponse>;

export interface ReplayControlBarProps {
  /** A response from `/api/benchmark`, or a saved response-shaped snapshot. */
  readonly benchmark?: ReplayBenchmarkResponse | null;
  /** Called when the user runs the replay; integration code can POST this request. */
  readonly onRunReplay?: ReplayBenchmarkHandler;
  /** Called after custom trace validation; integration code can POST this to `/api/analyze`. */
  readonly onAnalyzeTrace?: ReplayAnalyzeHandler;
  /** The preset identifier sent to `/api/benchmark` when no custom value is supplied. */
  readonly scenarioId?: string;
  readonly workerCount?: number;
  readonly initialTrace?: string;
  readonly onBenchmarkComplete?: (response: ReplayBenchmarkResponse) => void;
  readonly onTraceAnalyzed?: (response: ReplayAnalyzeResponse, request: CustomTraceRequest) => void;
  readonly onError?: (error: Error, operation: 'benchmark' | 'analyze') => void;
  readonly title?: string;
  readonly className?: string;
}

export interface NormalizedReplayMetrics {
  readonly before: {
    readonly throughputRps: number;
    readonly deadlockCount: number;
    readonly p99LatencyMs: number;
  };
  readonly after: {
    readonly throughputRps: number;
    readonly deadlockCount: number;
    readonly p99LatencyMs: number;
  };
  readonly workerCount: number;
  readonly scenarioName?: string;
}

export const DEFAULT_REPLAY_SCENARIO_ID = 'payment-ledger-ab-ba-lock-deadlock';
export const DEFAULT_REPLAY_WORKER_COUNT = 500;

/** A deterministic preview used before a live callback or response is wired in. */
export const DEMO_BENCHMARK_RESPONSE: ReplayBenchmarkResponse = {
  scenarioId: DEFAULT_REPLAY_SCENARIO_ID,
  scenarioName: 'Payment Ledger AB-BA Lock Deadlock',
  workerCount: DEFAULT_REPLAY_WORKER_COUNT,
  workers: DEFAULT_REPLAY_WORKER_COUNT,
  before: {
    workerCount: DEFAULT_REPLAY_WORKER_COUNT,
    throughputRps: 2_850,
    deadlockCount: 15,
    p99LatencyMs: 6_300,
  },
  after: {
    workerCount: DEFAULT_REPLAY_WORKER_COUNT,
    throughputRps: 9_200,
    deadlockCount: 0,
    p99LatencyMs: 121,
  },
};

const DEMO_ANALYZE_RESPONSE: ReplayAnalyzeResponse = {
  source: { kind: 'custom', scenarioName: 'Custom lock-event trace' },
  deadlocks: [{ cycle: ['worker-a', 'worker-b'] }],
  cycles: [['worker-a', 'worker-b']],
  events: [
    { kind: 'acquire', threadId: 'worker-a', lockId: 'ledger-entry' },
    { kind: 'acquire', threadId: 'worker-b', lockId: 'account-balance' },
    { kind: 'wait', threadId: 'worker-a', holderId: 'worker-b', lockId: 'account-balance' },
    { kind: 'wait', threadId: 'worker-b', holderId: 'worker-a', lockId: 'ledger-entry' },
  ],
};

type JsonRecord = Record<string, unknown>;

type MetricKey = 'throughput' | 'deadlocks' | 'p99';

interface MetricDefinition {
  readonly key: MetricKey;
  readonly label: string;
  readonly unit: string;
  readonly lowerIsBetter: boolean;
  readonly description: string;
}

interface MetricView extends MetricDefinition {
  readonly before: number;
  readonly after: number;
}

const METRICS: readonly MetricDefinition[] = [
  {
    key: 'throughput',
    label: 'Throughput',
    unit: 'req/s',
    lowerIsBetter: false,
    description: 'Completed requests per second',
  },
  {
    key: 'deadlocks',
    label: 'Deadlocks',
    unit: 'events',
    lowerIsBetter: true,
    description: 'Detected lock cycles during replay',
  },
  {
    key: 'p99',
    label: 'p99 latency',
    unit: 'ms',
    lowerIsBetter: true,
    description: 'Tail latency at the 99th percentile',
  },
];

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function firstValue(record: JsonRecord | undefined, names: readonly string[]): unknown {
  if (record === undefined) return undefined;
  for (const name of names) {
    if (record[name] !== undefined && record[name] !== null) return record[name];
  }
  return undefined;
}

function phaseFrom(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function snapshotFrom(value: unknown): NormalizedReplayMetrics['before'] | null {
  const record = phaseFrom(value);
  if (record === undefined) return null;

  const throughputRps = finiteNumber(firstValue(record, ['throughputRps', 'throughputReqPerSec', 'throughput']));
  const deadlockCount = finiteNumber(firstValue(record, ['deadlockCount', 'deadlocks']));
  const p99LatencyMs = finiteNumber(firstValue(record, ['p99LatencyMs', 'p99Latency', 'p99']));
  if (throughputRps === undefined || deadlockCount === undefined || p99LatencyMs === undefined) return null;

  return {
    throughputRps: Math.max(0, throughputRps),
    deadlockCount: Math.max(0, deadlockCount),
    p99LatencyMs: Math.max(0, p99LatencyMs),
  };
}

function comparisonFromMetricDeltas(value: unknown): NormalizedReplayMetrics | null {
  if (!isRecord(value)) return null;
  const beforeRecord = phaseFrom(value.before);
  const afterRecord = phaseFrom(value.after);
  const before = snapshotFrom(beforeRecord);
  const after = snapshotFrom(afterRecord);
  if (before !== null && after !== null) {
    return {
      before,
      after,
      workerCount: finiteNumber(firstValue(value, ['workerCount', 'workers'])) ?? DEFAULT_REPLAY_WORKER_COUNT,
      scenarioName: stringValue(value.scenarioName),
    };
  }
  return null;
}

/**
 * Normalize direct, selected, and collection benchmark response shapes into the
 * three metrics rendered by this component. Returns null for incomplete data so
 * an integration can surface a useful error instead of rendering zeros.
 */
export function normalizeReplayBenchmark(
  response: ReplayBenchmarkResponse | null | undefined,
): NormalizedReplayMetrics | null {
  if (response === null || response === undefined) return null;
  const root = response as unknown as JsonRecord;
  const candidates: unknown[] = [
    root,
    root.selected,
    root.benchmark,
    ...(Array.isArray(root.benchmarks) ? root.benchmarks : []),
    ...(Array.isArray(root.comparisons) ? root.comparisons : []),
  ];

  for (const candidate of candidates) {
    const direct = comparisonFromMetricDeltas(candidate);
    if (direct !== null) {
      const record = isRecord(candidate) ? candidate : undefined;
      return {
        ...direct,
        workerCount:
          finiteNumber(firstValue(record, ['workerCount', 'workers'])) ??
          finiteNumber(firstValue(root, ['workerCount', 'workers'])) ??
          DEFAULT_REPLAY_WORKER_COUNT,
        scenarioName: stringValue(firstValue(record, ['scenarioName'])) ?? stringValue(root.scenarioName),
      };
    }
  }

  return null;
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}

function useAnimatedNumber(target: number, duration = 850): number {
  const [display, setDisplay] = useState(target);
  const previous = useRef(target);

  useEffect(() => {
    const from = previous.current;
    previous.current = target;
    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (
      reduceMotion ||
      typeof window === 'undefined' ||
      typeof window.requestAnimationFrame !== 'function' ||
      from === target
    ) {
      setDisplay(target);
      return undefined;
    }

    let frame = 0;
    const startedAt = performance.now();
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / duration);
      setDisplay(from + (target - from) * easeOutCubic(progress));
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [duration, target]);

  return display;
}

function demoBenchmark(): Promise<ReplayBenchmarkResponse> {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(DEMO_BENCHMARK_RESPONSE), 1_050);
  });
}

function formatMetric(value: number, unit: string): string {
  const maximumFractionDigits = unit === 'events' ? 0 : value >= 100 ? 0 : 1;
  return `${value.toLocaleString(undefined, { maximumFractionDigits })} ${unit}`;
}

function formatDelta(value: number, unit: string): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±';
  return `${sign}${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: unit === 'events' ? 0 : 1 })} ${unit}`;
}

function errorFrom(error: unknown, fallback: string): Error {
  if (error instanceof Error && error.message.trim().length > 0) return error;
  return new Error(fallback);
}

function analysisEventCount(response: ReplayAnalyzeResponse): number | null {
  const root = response as unknown as JsonRecord;
  const candidates = [root.events, root.traceEvents, root.lockEvents, root.lockTrace, root.trace];
  for (const value of candidates) {
    if (Array.isArray(value)) return value.length;
  }
  return null;
}

function MetricCard({ metric }: { readonly metric: MetricView }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const before = useAnimatedNumber(metric.before);
  const after = useAnimatedNumber(metric.after);
  const max = Math.max(metric.before, metric.after, 1);
  const delta = metric.after - metric.before;
  const improved = metric.lowerIsBetter ? delta < 0 : delta > 0;
  const outcome = delta === 0 ? 'No change' : improved ? 'Improved' : 'Regressed';

  return (
    <article className="replay-control-bar__metric" aria-labelledby={`${id}-metric-title`}>
      <header className="replay-control-bar__metric-header">
        <div>
          <h3 id={`${id}-metric-title`}>{metric.label}</h3>
          <p>{metric.description}</p>
        </div>
        <span className={`replay-control-bar__metric-outcome replay-control-bar__metric-outcome--${delta === 0 ? 'steady' : improved ? 'good' : 'bad'}`}>
          {outcome}
        </span>
      </header>

      <div className="replay-control-bar__bars" role="img" aria-label={`${metric.label}: before ${formatMetric(metric.before, metric.unit)}, after ${formatMetric(metric.after, metric.unit)}`}>
        <div className="replay-control-bar__bar-row">
          <span className="replay-control-bar__bar-label">Before</span>
          <div className="replay-control-bar__bar-track" aria-hidden="true">
            <div className="replay-control-bar__bar replay-control-bar__bar--before" style={{ width: `${(metric.before / max) * 100}%` }} />
          </div>
          <strong>{formatMetric(before, metric.unit)}</strong>
        </div>
        <div className="replay-control-bar__bar-row">
          <span className="replay-control-bar__bar-label">After</span>
          <div className="replay-control-bar__bar-track" aria-hidden="true">
            <div className="replay-control-bar__bar replay-control-bar__bar--after" style={{ width: `${(metric.after / max) * 100}%` }} />
          </div>
          <strong>{formatMetric(after, metric.unit)}</strong>
        </div>
      </div>

      <footer className="replay-control-bar__metric-footer">
        <span>Delta</span>
        <strong className={improved ? 'replay-control-bar__delta--good' : delta === 0 ? '' : 'replay-control-bar__delta--bad'}>
          {formatDelta(delta, metric.unit)}
        </strong>
      </footer>
    </article>
  );
}

export function ReplayControlBar({
  benchmark,
  onRunReplay,
  onAnalyzeTrace,
  scenarioId = DEFAULT_REPLAY_SCENARIO_ID,
  workerCount = DEFAULT_REPLAY_WORKER_COUNT,
  initialTrace = DEMO_TRACE_INPUT,
  onBenchmarkComplete,
  onTraceAnalyzed,
  onError,
  title = 'Live load replay',
  className,
}: ReplayControlBarProps) {
  const [response, setResponse] = useState<ReplayBenchmarkResponse>(benchmark ?? DEMO_BENCHMARK_RESPONSE);
  const [isDemo, setIsDemo] = useState(benchmark === undefined || benchmark === null);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const [traceStatus, setTraceStatus] = useState<string | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const controlId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const runHelpId = `${controlId}-run-help`;

  useEffect(() => {
    if (benchmark === undefined || benchmark === null) return;
    setResponse(benchmark);
    setIsDemo(false);
  }, [benchmark]);

  useEffect(() => {
    if (!isRunning) return undefined;
    setProgress((current) => Math.max(current, 8));
    const timer = window.setInterval(() => {
      setProgress((current) => Math.min(92, current + Math.max(2, (92 - current) * 0.12)));
    }, 180);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  const metrics = useMemo(() => normalizeReplayBenchmark(response) ?? normalizeReplayBenchmark(DEMO_BENCHMARK_RESPONSE)!, [response]);
  const metricViews = useMemo<MetricView[]>(
    () => METRICS.map((definition) => {
      const before = definition.key === 'throughput'
        ? metrics.before.throughputRps
        : definition.key === 'deadlocks'
          ? metrics.before.deadlockCount
          : metrics.before.p99LatencyMs;
      const after = definition.key === 'throughput'
        ? metrics.after.throughputRps
        : definition.key === 'deadlocks'
          ? metrics.after.deadlockCount
          : metrics.after.p99LatencyMs;
      return { ...definition, before, after };
    }),
    [metrics],
  );

  const runReplay = async (): Promise<void> => {
    if (isRunning) return;
    setError(null);
    setProgress(6);
    setIsRunning(true);

    try {
      const request: ReplayBenchmarkRequest = { scenarioId, workerCount };
      const next = onRunReplay === undefined ? await demoBenchmark() : await onRunReplay(request);
      if (normalizeReplayBenchmark(next) === null) {
        throw new Error('Benchmark response is missing before/after throughput, deadlock, or p99 metrics.');
      }
      setResponse(next);
      setIsDemo(onRunReplay === undefined);
      setProgress(100);
      onBenchmarkComplete?.(next);
    } catch (caughtError) {
      const normalizedError = errorFrom(caughtError, 'The replay could not be completed.');
      setError(normalizedError.message);
      onError?.(normalizedError, 'benchmark');
    } finally {
      setIsRunning(false);
    }
  };

  const analyzeTrace = async (request: CustomTraceRequest): Promise<void> => {
    setTraceError(null);
    setTraceStatus(null);
    try {
      const result = onAnalyzeTrace === undefined ? DEMO_ANALYZE_RESPONSE : await onAnalyzeTrace(request);
      const eventCount = analysisEventCount(result);
      setTraceStatus(
        onAnalyzeTrace === undefined
          ? 'Demo trace accepted — connect onAnalyzeTrace to send it to /api/analyze.'
          : eventCount === null
            ? 'Custom trace analyzed successfully.'
            : `Custom trace analyzed successfully · ${eventCount} events returned.`,
      );
      onTraceAnalyzed?.(result, request);
    } catch (caughtError) {
      const normalizedError = errorFrom(caughtError, 'The custom trace could not be analyzed.');
      setTraceError(normalizedError.message);
      onError?.(normalizedError, 'analyze');
      throw normalizedError;
    }
  };

  const rootClassName = ['replay-control-bar', className].filter(Boolean).join(' ');
  const status = isRunning
    ? `Replaying ${workerCount.toLocaleString()} workers…`
    : error
      ? 'Replay failed'
      : isDemo
        ? 'Demo telemetry'
        : 'Live benchmark result';

  return (
    <section className={rootClassName} aria-label={title} aria-busy={isRunning}>
      <header className="replay-control-bar__header">
        <div className="replay-control-bar__heading">
          <p className="replay-control-bar__eyebrow">Live benchmark control</p>
          <h2>{title}</h2>
          <p className="replay-control-bar__subtitle">
            Replay the incident at {workerCount.toLocaleString()} concurrent workers and watch the remediation move tail risk.
          </p>
        </div>
        <span className={`replay-control-bar__status${isDemo ? ' replay-control-bar__status--demo' : ''}`} role="status" aria-live="polite">
          <i aria-hidden="true" />
          {status}
        </span>
      </header>

      <div className="replay-control-bar__actions">
        <button
          type="button"
          className="replay-control-bar__run-button"
          onClick={() => void runReplay()}
          disabled={isRunning}
          aria-describedby={runHelpId}
        >
          <span className="replay-control-bar__run-icon" aria-hidden="true">↻</span>
          <span>{isRunning ? 'Running chaos replay…' : `Run ${workerCount.toLocaleString()}-Worker Chaos Replay`}</span>
        </button>
        <button
          type="button"
          className="replay-control-bar__trace-button"
          onClick={() => {
            setTraceError(null);
            setTraceOpen(true);
          }}
          disabled={isRunning}
        >
          <span aria-hidden="true">＋</span>
          Custom Trace Input
        </button>
        <p id={runHelpId} className="replay-control-bar__run-help">
          Before vs After · deterministic 500-worker load · safe to replay
        </p>
      </div>

      <div className="replay-control-bar__progress-area" aria-live="polite">
        <div className="replay-control-bar__progress-copy">
          <span>{isRunning ? 'Simulating contention, queueing, and recovery' : progress >= 100 ? 'Replay complete' : 'Ready to run'}</span>
          <strong>{Math.round(progress)}%</strong>
        </div>
        <div className="replay-control-bar__progress-track" role="progressbar" aria-label="Chaos replay progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
          <div className="replay-control-bar__progress-fill" style={{ width: `${progress}%` }} />
        </div>
        {error ? <p className="replay-control-bar__error" role="alert">{error}</p> : null}
      </div>

      <div className="replay-control-bar__summary" aria-label="Replay summary">
        <span><strong>{metrics.workerCount.toLocaleString()}</strong> workers</span>
        <span><strong>{metrics.scenarioName ?? scenarioId}</strong> scenario</span>
        <span>Comparing <strong>Before</strong> to <strong>After</strong></span>
      </div>

      <div className="replay-control-bar__metrics">
        {metricViews.map((metric) => <MetricCard key={metric.key} metric={metric} />)}
      </div>

      <div className="replay-control-bar__trace-status" role="status" aria-live="polite">
        <span className="replay-control-bar__trace-status-label">Custom trace</span>
        <span>{traceError ?? traceStatus ?? 'Bring a lock trace when the incident does not match a preset.'}</span>
      </div>

      <CustomTraceModal
        open={traceOpen}
        initialValue={initialTrace}
        onClose={() => setTraceOpen(false)}
        onSubmit={analyzeTrace}
        submitError={traceError}
      />
    </section>
  );
}

export default ReplayControlBar;
