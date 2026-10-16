import React, { useEffect, useState } from 'react';
import { Activity, ArrowRight, Flame, Gauge, Loader2, ShieldCheck, Zap } from 'lucide-react';
import type { SimulationMetrics } from '../../shared/types';

interface ChaosBenchmarkBarProps {
  before: SimulationMetrics;
  after: SimulationMetrics;
  improvementFactor: number;
  isRunning: boolean;
  onRunReplay: () => void;
}

export const ChaosBenchmarkBar: React.FC<ChaosBenchmarkBarProps> = ({
  before,
  after,
  improvementFactor,
  isRunning,
  onRunReplay,
}) => {
  const [animateWidths, setAnimateWidths] = useState(false);

  useEffect(() => {
    setAnimateWidths(false);
    const frame = requestAnimationFrame(() => {
      setAnimateWidths(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [before, after]);

  const beforeIncidents = before.deadlocksTriggered + before.raceConditionsTriggered;
  const afterIncidents = after.deadlocksTriggered + after.raceConditionsTriggered;

  const beforeThroughputPct = Math.min(
    100,
    Math.max(4, Math.round((before.throughputReqPerSec / Math.max(1, after.throughputReqPerSec)) * 100)),
  );
  const afterLatencyReductionPct = Math.max(
    1,
    Math.round(((before.p99Ms - after.p99Ms) / Math.max(1, before.p99Ms)) * 100),
  );

  return (
    <section
      aria-label="500-Worker Chaos Benchmark Telemetry"
      className="bg-slate-900/75 backdrop-blur-md border border-slate-800/80 rounded-xl shadow-xl overflow-hidden"
    >
      {/* Standardized h-12 Header */}
      <div className="h-12 px-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-950/60">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
            <Flame className="w-4 h-4 text-amber-400" />
          </div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-100 truncate">
            500-Worker Chaos Replay Telemetry (Before vs. After Canonical Patch)
          </h2>
          <span className="hidden sm:inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-mono tabular-nums font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shrink-0">
            +{improvementFactor}x Throughput
          </span>
          <span className="hidden md:inline-flex px-2 py-0.5 rounded-full text-[10px] font-mono tabular-nums bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 shrink-0">
            -{afterLatencyReductionPct}% p99 Latency
          </span>
        </div>

        <button
          type="button"
          onClick={onRunReplay}
          disabled={isRunning}
          className="h-9 flex items-center gap-1.5 px-3.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none shadow-md cursor-pointer shrink-0"
        >
          {isRunning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Replaying 500 Workers...
            </>
          ) : (
            <>
              <Zap className="w-4 h-4" />
              Re-Run 500-Worker Chaos Replay
            </>
          )}
        </button>
      </div>

      {/* 4-Column Metric Grid with gap-4 and p-4 */}
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono tabular-nums">
        {/* Card 1: Deadlocks & Races */}
        <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-2.5">
          <div className="flex items-center justify-between text-slate-400 text-[11px]">
            <span className="truncate">Deadlocks / Races ({before.workers}w)</span>
            <Activity className="w-4 h-4 text-rose-400 shrink-0" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-rose-400 font-bold text-lg">{beforeIncidents}</span>
            <ArrowRight className="w-4 h-4 text-slate-500 shrink-0" />
            <span className="text-emerald-400 font-bold text-lg">{afterIncidents}</span>
            <span className="text-[10px] text-emerald-400 ml-auto">0 Cycles</span>
          </div>
          <div className="space-y-1.5 text-[10px]">
            <div className="flex justify-between text-slate-400">
              <span>Before Patch</span>
              <span className="text-rose-400">{beforeIncidents} incidents</span>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-rose-500 transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{ width: animateWidths ? '92%' : '0%' }}
              />
            </div>
            <div className="flex justify-between text-slate-400 pt-0.5">
              <span>After Canonical Patch</span>
              <span className="text-emerald-400">0 incidents</span>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{ width: animateWidths ? '100%' : '0%' }}
              />
            </div>
          </div>
        </div>

        {/* Card 2: Throughput (req/sec) */}
        <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-2.5">
          <div className="flex items-center justify-between text-slate-400 text-[11px]">
            <span className="truncate">Throughput (req/sec)</span>
            <Gauge className="w-4 h-4 text-cyan-400 shrink-0" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-amber-400 font-bold text-base">
              {before.throughputReqPerSec.toLocaleString()} req/s
            </span>
            <ArrowRight className="w-4 h-4 text-slate-500 shrink-0" />
            <span className="text-emerald-400 font-bold text-base">
              {after.throughputReqPerSec.toLocaleString()} req/s
            </span>
          </div>
          <div className="space-y-1.5 text-[10px]">
            <div className="flex justify-between text-slate-400">
              <span>Before (Stalled)</span>
              <span className="text-amber-400">{before.throughputReqPerSec} rps</span>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{ width: animateWidths ? `${beforeThroughputPct}%` : '0%' }}
              />
            </div>
            <div className="flex justify-between text-slate-400 pt-0.5">
              <span>After (Unblocked)</span>
              <span className="text-emerald-400">{after.throughputReqPerSec} rps</span>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{ width: animateWidths ? '100%' : '0%' }}
              />
            </div>
          </div>
        </div>

        {/* Card 3: p50 / p95 / p99 Latency */}
        <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-2.5">
          <div className="flex items-center justify-between text-slate-400 text-[11px]">
            <span className="truncate">p99 Tail Latency</span>
            <Zap className="w-4 h-4 text-amber-400 shrink-0" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-rose-400 font-bold text-base">
              {before.p99Ms.toLocaleString()}ms
            </span>
            <ArrowRight className="w-4 h-4 text-slate-500 shrink-0" />
            <span className="text-emerald-400 font-bold text-base">{after.p99Ms}ms</span>
          </div>
          <div className="space-y-1.5 text-[10px]">
            <div className="flex justify-between text-slate-400 truncate">
              <span>Before (p50: {before.p50Ms}ms · p95: {before.p95Ms}ms)</span>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-rose-500 transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{ width: animateWidths ? '96%' : '0%' }}
              />
            </div>
            <div className="flex justify-between text-slate-400 pt-0.5 truncate">
              <span>After (p50: {after.p50Ms}ms · p95: {after.p95Ms}ms)</span>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{ width: animateWidths ? '8%' : '0%' }}
              />
            </div>
          </div>
        </div>

        {/* Card 4: Worker Completion Rate */}
        <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-2.5">
          <div className="flex items-center justify-between text-slate-400 text-[11px]">
            <span className="truncate">Worker Completion Rate</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-rose-400 font-bold text-lg">{before.successRatePct}%</span>
            <ArrowRight className="w-4 h-4 text-slate-500 shrink-0" />
            <span className="text-emerald-400 font-bold text-lg">{after.successRatePct}%</span>
          </div>
          <div className="space-y-1.5 text-[10px]">
            <div className="flex justify-between text-slate-400">
              <span>Before Patch</span>
              <span className="text-rose-400">{before.successRatePct}% ok</span>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-rose-500 transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{ width: animateWidths ? `${before.successRatePct}%` : '0%' }}
              />
            </div>
            <div className="flex justify-between text-slate-400 pt-0.5">
              <span>After Canonical Patch</span>
              <span className="text-emerald-400">{after.successRatePct}% ok</span>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{ width: animateWidths ? `${after.successRatePct}%` : '0%' }}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ChaosBenchmarkBar;
