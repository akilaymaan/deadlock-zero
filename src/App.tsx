import { useEffect, useMemo, useState } from 'react';

import IncidentForensicsPanel, {
  type IncidentForensicsResponse,
} from './components/IncidentForensicsPanel';
import LockGraphCanvas, {
  type LockGraphCycleFinding,
  type LockGraphCycleInput,
  type LockGraphPayload,
  type LockGraphSnapshotInput,
} from './components/LockGraphCanvas';
import ReplayControlBar, {
  DEFAULT_REPLAY_SCENARIO_ID,
  DEMO_BENCHMARK_RESPONSE,
  normalizeReplayBenchmark,
  type ReplayAnalyzeResponse,
  type ReplayBenchmarkRequest,
  type ReplayBenchmarkResponse,
} from './components/ReplayControlBar';
import type { CustomTraceRequest } from './components/CustomTraceModal';

const DEFAULT_SCENARIO = DEFAULT_REPLAY_SCENARIO_ID;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    const message = isRecord(payload) && textValue(payload.error) ? String(payload.error) : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

function lockGraphDataFrom(analysis: IncidentForensicsResponse | null): LockGraphPayload | undefined {
  if (analysis === null) return undefined;
  return {
    graph: analysis.graph as LockGraphSnapshotInput | null | undefined,
    cycles: analysis.cycles as readonly LockGraphCycleInput[] | undefined,
    detectedCycles: analysis.detectedCycles as readonly LockGraphCycleInput[] | undefined,
    deadlocks: analysis.deadlocks as readonly LockGraphCycleFinding[] | undefined,
  };
}

function formatCompact(value: number | undefined, suffix = ''): string {
  if (value === undefined) return '—';
  return `${value.toLocaleString(undefined, { maximumFractionDigits: value >= 100 ? 0 : 1 })}${suffix}`;
}

function App() {
  const [analysis, setAnalysis] = useState<IncidentForensicsResponse | null>(null);
  const [benchmark, setBenchmark] = useState<ReplayBenchmarkResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [activeSurface, setActiveSurface] = useState<'graph' | 'evidence' | 'replay'>('graph');

  useEffect(() => {
    const controller = new AbortController();
    const loadSnapshot = async (): Promise<void> => {
      setLoading(true);
      const [analysisResult, benchmarkResult] = await Promise.allSettled([
        postJson<IncidentForensicsResponse>('/api/analyze', { presetId: DEFAULT_SCENARIO }, controller.signal),
        postJson<ReplayBenchmarkResponse>('/api/benchmark', { scenarioId: DEFAULT_SCENARIO }, controller.signal),
      ]);

      if (controller.signal.aborted) return;

      const failures: string[] = [];
      if (analysisResult.status === 'fulfilled') setAnalysis(analysisResult.value);
      else failures.push(`analysis: ${analysisResult.reason instanceof Error ? analysisResult.reason.message : 'unavailable'}`);
      if (benchmarkResult.status === 'fulfilled') setBenchmark(benchmarkResult.value);
      else failures.push(`replay: ${benchmarkResult.reason instanceof Error ? benchmarkResult.reason.message : 'unavailable'}`);

      setRequestError(failures.length > 0 ? failures.join(' · ') : null);
      setLoading(false);
    };

    void loadSnapshot();
    return () => controller.abort();
  }, []);

  const replayMetrics = useMemo(
    () => normalizeReplayBenchmark(benchmark ?? DEMO_BENCHMARK_RESPONSE) ?? normalizeReplayBenchmark(DEMO_BENCHMARK_RESPONSE)!,
    [benchmark],
  );
  const graphData = useMemo(() => lockGraphDataFrom(analysis), [analysis]);

  const cycleCount = analysis
    ? Math.max(arrayLength(analysis.cycles), arrayLength(analysis.detectedCycles), arrayLength(analysis.deadlocks))
    : 0;
  const nodeCount = analysis && isRecord(analysis.graph)
    ? arrayLength(analysis.graph.nodes) || arrayLength(analysis.graph.executionNodes) + arrayLength(analysis.graph.resourceNodes)
    : 0;
  const scenarioName = analysis && isRecord(analysis.source)
    ? textValue(analysis.source.scenarioName) ?? 'Payment Ledger AB-BA Lock Deadlock'
    : 'Payment Ledger AB-BA Lock Deadlock';
  const incidentStatus = cycleCount > 0 ? 'Deadlock detected' : loading ? 'Syncing snapshot' : 'Patch verified';
  const incidentTone = cycleCount > 0 ? 'critical' : loading ? 'syncing' : 'stable';

  const handleRunReplay = async (request: ReplayBenchmarkRequest): Promise<ReplayBenchmarkResponse> => {
    const result = await postJson<ReplayBenchmarkResponse>('/api/benchmark', request);
    setBenchmark(result);
    setRequestError(null);
    setActiveSurface('replay');
    return result;
  };

  const handleAnalyzeTrace = async (request: CustomTraceRequest): Promise<ReplayAnalyzeResponse> => {
    const result = await postJson<ReplayAnalyzeResponse>('/api/analyze', request);
    setAnalysis(result as IncidentForensicsResponse);
    setRequestError(null);
    setActiveSurface('graph');
    return result;
  };

  const jumpTo = (surface: 'graph' | 'evidence' | 'replay'): void => {
    setActiveSurface(surface);
    document.getElementById(`surface-${surface}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <main className="war-room-shell min-h-screen">
      <header className="war-room-topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">DZ</span>
          <div>
            <p className="brand-name">DeadlockZero</p>
            <p className="brand-subtitle">SRE / CONCURRENCY WAR ROOM</p>
          </div>
        </div>
        <div className="topbar-meta">
          <span className="topbar-environment"><i aria-hidden="true" /> prod-eu-west-1</span>
          <span className="topbar-clock">INCIDENT WINDOW · 03:17 UTC</span>
          <span className="topbar-operator">OPERATOR / AK</span>
        </div>
      </header>

      <section className="war-room-hero" aria-labelledby="war-room-title">
        <div className="hero-copy">
          <p className="hero-kicker"><span>SEV-1</span> / LOCK CONTENTION EVENT</p>
          <h1 id="war-room-title">Deadlock <em>Zero</em></h1>
          <p className="hero-lede">
            Make the invisible wait-for graph visible. Trace the lock order that froze production, apply the canonical patch, and replay the blast radius before sunrise.
          </p>
          <div className="hero-actions" aria-label="War-room navigation">
            <button type="button" className={activeSurface === 'graph' ? 'hero-action hero-action--active' : 'hero-action'} onClick={() => jumpTo('graph')}>
              <span>01</span> Lock graph
            </button>
            <button type="button" className={activeSurface === 'evidence' ? 'hero-action hero-action--active' : 'hero-action'} onClick={() => jumpTo('evidence')}>
              <span>02</span> Trace &amp; patch
            </button>
            <button type="button" className={activeSurface === 'replay' ? 'hero-action hero-action--active' : 'hero-action'} onClick={() => jumpTo('replay')}>
              <span>03</span> Chaos replay
            </button>
          </div>
        </div>
        <aside className="incident-card" aria-label="Current incident summary">
          <div className="incident-card__topline">
            <span className={`incident-state incident-state--${incidentTone}`}><i aria-hidden="true" />{incidentStatus}</span>
            <span className="incident-card__id">INC-0427</span>
          </div>
          <p className="incident-card__label">Active incident snapshot</p>
          <h2>{scenarioName}</h2>
          <p className="incident-card__summary">Payment and reconciliation workers acquired the same locks in opposite orders.</p>
          <div className="incident-card__footer">
            <span>Last evidence sync</span>
            <strong>{loading ? 'syncing…' : 'just now'}</strong>
          </div>
        </aside>
      </section>

      <section className="war-room-metrics" aria-label="Incident telemetry">
        <article className="telemetry-card telemetry-card--critical">
          <span className="telemetry-card__label">Cycle count</span>
          <strong>{loading ? '—' : cycleCount}</strong>
          <span className="telemetry-card__hint">detected in wait-for graph</span>
          <span className="telemetry-card__pulse" aria-hidden="true" />
        </article>
        <article className="telemetry-card">
          <span className="telemetry-card__label">Worker load</span>
          <strong>{replayMetrics.workerCount.toLocaleString()}</strong>
          <span className="telemetry-card__hint">concurrent workers in replay</span>
        </article>
        <article className="telemetry-card">
          <span className="telemetry-card__label">p99 latency</span>
          <strong>{formatCompact(replayMetrics.before.p99LatencyMs, ' ms')}</strong>
          <span className="telemetry-card__hint">before canonical patch</span>
        </article>
        <article className="telemetry-card telemetry-card--positive">
          <span className="telemetry-card__label">Recovered throughput</span>
          <strong>{formatCompact(replayMetrics.after.throughputRps, ' req/s')}</strong>
          <span className="telemetry-card__hint">after lock-order remediation</span>
        </article>
      </section>

      {requestError ? (
        <div className="war-room-notice" role="status">
          <span className="war-room-notice__icon" aria-hidden="true">!</span>
          <span><strong>Using local telemetry fallback.</strong> {requestError}</span>
        </div>
      ) : null}

      <section id="surface-graph" className="war-room-surface war-room-surface--graph" aria-labelledby="graph-surface-title">
        <div className="surface-heading">
          <div>
            <p className="surface-kicker">01 / topology signal</p>
            <h2 id="graph-surface-title">The lock graph is the incident</h2>
          </div>
          <div className="surface-heading__meta">
            <span><i className="meta-dot meta-dot--blue" />{nodeCount || 6} nodes online</span>
            <span><i className="meta-dot meta-dot--red" />{cycleCount || 1} crimson cycle</span>
          </div>
        </div>
        <LockGraphCanvas data={graphData} title="Live wait-for graph" />
      </section>

      <section id="surface-evidence" className="war-room-surface" aria-labelledby="evidence-surface-title">
        <div className="surface-heading">
          <div>
            <p className="surface-kicker">02 / forensic evidence</p>
            <h2 id="evidence-surface-title">From first hold to production freeze</h2>
          </div>
          <span className="surface-heading__tag">SOURCE-AWARE · REPRODUCIBLE</span>
        </div>
        <IncidentForensicsPanel data={analysis} title="Code trace / diff / runbook" />
      </section>

      <section id="surface-replay" className="war-room-surface war-room-surface--replay" aria-labelledby="replay-surface-title">
        <div className="surface-heading">
          <div>
            <p className="surface-kicker">03 / controlled blast radius</p>
            <h2 id="replay-surface-title">Prove the patch before you ship it</h2>
          </div>
          <span className="surface-heading__tag surface-heading__tag--green">500 WORKERS · DETERMINISTIC</span>
        </div>
        <ReplayControlBar
          benchmark={benchmark}
          scenarioId={DEFAULT_SCENARIO}
          onRunReplay={handleRunReplay}
          onAnalyzeTrace={handleAnalyzeTrace}
          title="Live load replay"
        />
      </section>

      <footer className="war-room-footer">
        <span><span className="footer-mark" aria-hidden="true">◈</span> DeadlockZero engine v0.1.0</span>
        <span>DETECT · EXPLAIN · REMEDIATE · REPLAY</span>
        <span>All times UTC</span>
      </footer>
    </main>
  );
}

export default App;
