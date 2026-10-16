import React, { useEffect, useState } from 'react';
import { Activity, AlertCircle, ArrowRight, Gauge, Info, Loader2, Play, Timer } from 'lucide-react';
import type { ChaosBenchmarkResult, SimulationMetrics } from '../../shared/types';

export type BenchmarkState =
  | { readonly status: 'idle' }
  | { readonly status: 'running' }
  | { readonly status: 'done'; readonly result: ChaosBenchmarkResult }
  | { readonly status: 'error'; readonly message: string };

interface ChaosBenchmarkBarProps {
  state: BenchmarkState;
  workers: number;
  maxWorkers: number;
  onWorkersChange: (workers: number) => void;
  onRun: () => void;
}

interface ComparisonBarProps {
  label: string;
  value: number;
  max: number;
  display: string;
  tone: 'before' | 'after';
  animate: boolean;
}

function ComparisonBar({ label, value, max, display, tone, animate }: ComparisonBarProps) {
  const width = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-slate-400 font-mono tabular-nums">
        <span>{label}</span>
        <span className={tone === 'before' ? 'text-rose-300' : 'text-emerald-300'}>{display}</span>
      </div>
      <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden">
        <div
          className={`h-full transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${tone === 'before' ? 'bg-rose-500' : 'bg-emerald-500'}`}
          style={{ width: animate ? `${width}%` : '0%' }}
        />
      </div>
    </div>
  );
}

interface MetricCardProps {
  title: string;
  icon: React.ReactNode;
  before: number;
  after: number;
  format: (value: number) => string;
  takeaway: string;
  animate: boolean;
}

function MetricCard({ title, icon, before, after, format, takeaway, animate }: MetricCardProps) {
  const max = Math.max(before, after);
  return (
    <div className="bg-slate-900/50 border border-slate-800/60 rounded-2xl p-6 lg:p-8 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300">{title}</h3>
        {icon}
      </div>
      <p className="flex items-baseline gap-3 font-mono tabular-nums">
        <span className="text-2xl font-bold text-rose-300">{format(before)}</span>
        <ArrowRight className="w-5 h-5 text-slate-500 self-center" aria-label="to" />
        <span className="text-2xl font-bold text-emerald-300">{format(after)}</span>
      </p>
      <div className="space-y-3">
        <ComparisonBar label="As recorded" value={before} max={max} display={format(before)} tone="before" animate={animate} />
        <ComparisonBar label="With suggested fix" value={after} max={max} display={format(after)} tone="after" animate={animate} />
      </div>
      <p className="text-xs text-slate-400 pt-3 border-t border-slate-800/60 leading-relaxed">{takeaway}</p>
    </div>
  );
}

function failures(metrics: SimulationMetrics): number {
  return metrics.deadlocksTriggered + metrics.raceConditionsTriggered + metrics.lockTimeouts + metrics.unfinishedRequests;
}

function headline(result: ChaosBenchmarkResult): string {
  const { before, after, improvementFactor } = result;
  if (failures(before) === 0 && failures(after) === 0) {
    return 'No deadlocks, races, or timeouts occurred in either run.';
  }
  const parts: string[] = [];
  if (before.deadlocksTriggered > 0) parts.push(`${before.deadlocksTriggered} deadlock(s) as recorded vs ${after.deadlocksTriggered} with the fix`);
  if (before.raceConditionsTriggered > 0) parts.push(`${before.raceConditionsTriggered} race(s) as recorded vs ${after.raceConditionsTriggered} with the fix`);
  if (improvementFactor !== null && improvementFactor !== 1) parts.push(`throughput changed ${improvementFactor}x`);
  if (improvementFactor === null && after.completedRequests > 0) parts.push('the recorded lock order completed no requests; the fix completed some');
  return parts.length > 0 ? `${parts.join('; ')}.` : 'The suggested fix did not change the simulated outcome.';
}

export const ChaosBenchmarkBar: React.FC<ChaosBenchmarkBarProps> = ({ state, workers, maxWorkers, onWorkersChange, onRun }) => {
  const [animate, setAnimate] = useState(false);
  const result = state.status === 'done' ? state.result : null;

  useEffect(() => {
    setAnimate(false);
    if (!result) return undefined;
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, [result]);

  const number = (value: number) => value.toLocaleString();

  return (
    <section aria-labelledby="stress-title" className="space-y-6">
      <div className="bg-slate-900/50 border border-slate-800/60 rounded-2xl p-6 lg:p-8 flex flex-wrap items-end justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <h2 id="stress-title" className="text-xl font-bold text-slate-100">Replay the trace under load</h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Runs a deterministic, virtual-time simulation: many workers repeat the lock steps from your trace, first in the recorded
            order, then with the suggested fix applied. It models lock ordering and synchronization, not your real I/O, so treat it as
            evidence for the fix, not as a load test.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1.5 text-xs text-slate-400">
            <span className="block">Virtual workers</span>
            <input
              type="number"
              min={1}
              max={maxWorkers}
              value={workers}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isInteger(value)) onWorkersChange(Math.min(maxWorkers, Math.max(1, value)));
              }}
              className="h-12 w-28 px-3 rounded-xl bg-slate-950 border border-slate-800/80 font-mono tabular-nums text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-400/70"
            />
          </label>
          <button
            type="button"
            onClick={onRun}
            disabled={state.status === 'running'}
            className="h-12 inline-flex items-center gap-2.5 px-6 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
          >
            {state.status === 'running' ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> : <Play className="w-5 h-5" aria-hidden="true" />}
            {state.status === 'running' ? 'Simulating...' : result ? 'Run again' : 'Run simulation'}
          </button>
        </div>
      </div>

      <div aria-live="polite">
        {state.status === 'idle' && (
          <p className="flex items-center gap-2 p-6 rounded-2xl border border-dashed border-slate-800/80 text-sm text-slate-400">
            <Info className="w-4 h-4 shrink-0" aria-hidden="true" />
            No simulation has run for this trace yet.
          </p>
        )}
        {state.status === 'error' && (
          <p role="alert" className="flex items-center gap-2 p-6 rounded-2xl bg-rose-500/10 border border-rose-500/40 text-sm text-rose-300">
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            Simulation failed: {state.message}
          </p>
        )}
      </div>

      {result && (
        <>
          <p className="text-base font-semibold text-slate-100">{headline(result)}</p>
          {(result.before.truncated || result.after.truncated) && (
            <p className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-sm text-amber-200">
              At least one run stopped at its time or compute budget before every request finished; unfinished requests are counted
              as failures. Try fewer workers for a complete run.
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <MetricCard
              title="Failed requests"
              icon={<Activity className="w-4 h-4 text-rose-400" aria-hidden="true" />}
              before={result.before.failedRequests}
              after={result.after.failedRequests}
              format={number}
              animate={animate}
              takeaway={`Of ${number(result.before.totalRequests)} requests: ${result.before.deadlocksTriggered} deadlock aborts, ${result.before.raceConditionsTriggered} races, ${result.before.lockTimeouts} timeouts, ${result.before.unfinishedRequests} unfinished as recorded.`}
            />
            <MetricCard
              title="Throughput (req/s, virtual time)"
              icon={<Gauge className="w-4 h-4 text-cyan-400" aria-hidden="true" />}
              before={result.before.throughputReqPerSec}
              after={result.after.throughputReqPerSec}
              format={number}
              animate={animate}
              takeaway={`Success rate ${result.before.successRatePct}% as recorded vs ${result.after.successRatePct}% with the fix.`}
            />
            <MetricCard
              title="p99 latency of successful requests"
              icon={<Timer className="w-4 h-4 text-amber-400" aria-hidden="true" />}
              before={result.before.p99Ms}
              after={result.after.p99Ms}
              format={(value) => `${number(value)} ms`}
              animate={animate}
              takeaway={`p50 ${result.before.p50Ms} -> ${result.after.p50Ms} ms, p95 ${result.before.p95Ms} -> ${result.after.p95Ms} ms. Latency includes time spent waiting for locks.`}
            />
          </div>
          <p className="text-xs text-slate-500 font-mono tabular-nums">
            {result.config.workers} workers x {result.config.requestsPerWorker} requests, seed {result.config.seed}, deadlock detection after{' '}
            {result.config.deadlockDetectionMs} ms, lock timeout {result.config.lockTimeoutMs} ms, time budget {result.config.maxVirtualMs} ms.
          </p>
        </>
      )}
    </section>
  );
};

export default ChaosBenchmarkBar;
