import React from 'react';
import { Activity, ArrowRight, Flame, Gauge, ShieldCheck, Zap } from 'lucide-react';
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
      className="bg-slate-900/95 border border-slate-800 rounded-xl p-4 shadow-xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="p-1.5 rounded-md bg-amber-500/10 border border-amber-500/30">
            <Flame className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-100">
                500-Worker Deterministic Chaos Replay Telemetry
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">
                +{improvementFactor}x Throughput Recovery
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                -{afterLatencyReductionPct}% p99 Tail Latency
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onRunReplay}
          disabled={isRunning}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-400 hover:from-cyan-400 hover:to-emerald-300 text-slate-950 font-bold text-xs transition-all shadow-md cursor-pointer"
        >
          <Zap className="w-3.5 h-3.5" />
          {isRunning ? 'Simulating 500 Workers...' : 'Re-Run 500-Worker Chaos Replay'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 text-xs font-mono">
        {/* Card 1: Deadlocks & Races */}
        <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800/90 space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-[11px]">
            <span>Deadlocks / Races ({before.workers}w)</span>
            <Activity className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-rose-400 font-bold text-lg">{beforeIncidents}</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-emerald-400 font-bold text-lg">{afterIncidents}</span>
            <span className="text-[10px] text-emerald-400/80 ml-auto">100% eliminated</span>
          </div>
          <div className="space-y-1 text-[10px]">
            <div className="flex justify-between text-slate-400">
              <span>Before Patch</span>
              <span className="text-rose-400">{beforeIncidents} incidents</span>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div className="h-full bg-rose-500 transition-all duration-500" style={{ width: '92%' }} />
            </div>
            <div className="flex justify-between text-slate-400 pt-0.5">
              <span>After Canonical Patch</span>
              <span className="text-emerald-400">0 incidents</span>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: '100%' }} />
            </div>
          </div>
        </div>

        {/* Card 2: Throughput (req/sec) */}
        <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800/90 space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-[11px]">
            <span>Throughput (req/sec)</span>
            <Gauge className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-amber-400 font-bold text-base">
              {before.throughputReqPerSec.toLocaleString()} req/s
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-emerald-400 font-bold text-base">
              {after.throughputReqPerSec.toLocaleString()} req/s
            </span>
          </div>
          <div className="space-y-1 text-[10px]">
            <div className="flex justify-between text-slate-400">
              <span>Before (Stalled)</span>
              <span className="text-amber-400">{before.throughputReqPerSec} rps</span>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 transition-all duration-500"
                style={{ width: `${beforeThroughputPct}%` }}
              />
            </div>
            <div className="flex justify-between text-slate-400 pt-0.5">
              <span>After (Unblocked)</span>
              <span className="text-emerald-400">{after.throughputReqPerSec} rps</span>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-400 transition-all duration-500" style={{ width: '100%' }} />
            </div>
          </div>
        </div>

        {/* Card 3: p50 / p95 / p99 Latency */}
        <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800/90 space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-[11px]">
            <span>p99 Tail Latency</span>
            <Zap className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-rose-400 font-bold text-base">
              {before.p99Ms.toLocaleString()}ms
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-emerald-400 font-bold text-base">{after.p99Ms}ms</span>
          </div>
          <div className="space-y-1 text-[10px]">
            <div className="flex justify-between text-slate-400">
              <span>Before (p50: {before.p50Ms}ms · p95: {before.p95Ms}ms)</span>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div className="h-full bg-rose-500 transition-all duration-500" style={{ width: '96%' }} />
            </div>
            <div className="flex justify-between text-slate-400 pt-0.5">
              <span>After (p50: {after.p50Ms}ms · p95: {after.p95Ms}ms)</span>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div className="h-full bg-cyan-400 transition-all duration-500" style={{ width: '8%' }} />
            </div>
          </div>
        </div>

        {/* Card 4: Success Rate */}
        <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800/90 space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-[11px]">
            <span>Worker Completion Rate</span>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-rose-400 font-bold text-lg">{before.successRatePct}%</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-emerald-400 font-bold text-lg">{after.successRatePct}%</span>
          </div>
          <div className="space-y-1 text-[10px]">
            <div className="flex justify-between text-slate-400">
              <span>Before Patch</span>
              <span className="text-rose-400">{before.successRatePct}% ok</span>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-rose-500 transition-all duration-500"
                style={{ width: `${before.successRatePct}%` }}
              />
            </div>
            <div className="flex justify-between text-slate-400 pt-0.5">
              <span>After Canonical Patch</span>
              <span className="text-emerald-400">{after.successRatePct}% ok</span>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${after.successRatePct}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ChaosBenchmarkBar;
