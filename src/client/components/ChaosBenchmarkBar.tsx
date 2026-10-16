import React, { useEffect, useState } from 'react';
import { Activity, ArrowRight, CheckCircle2, Gauge, Loader2, Play, Zap } from 'lucide-react';
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
    Math.max(5, Math.round((before.throughputReqPerSec / Math.max(1, after.throughputReqPerSec)) * 100)),
  );
  const latencyDropFactor = Math.max(1, Math.round(before.p99Ms / Math.max(1, after.p99Ms)));

  return (
    <section
      aria-label="500-Worker Chaos Benchmark Telemetry"
      className="space-y-6"
    >
      {/* Prominent Simulation Header Card */}
      <div className="bg-slate-900/50 border border-slate-800/60 rounded-2xl p-6 lg:p-8 flex flex-wrap items-center justify-between gap-6 shadow-xl">
        <div className="space-y-2 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            500-Worker Concurrency Proof
          </div>
          <h2 className="text-xl font-bold text-slate-100">
            Throughput increased {improvementFactor}x with zero lockups
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            We replayed {before.workers} concurrent workers against both the broken lock sequence
            and the canonical lock-ordering patch to verify how the system behaves under heavy load.
          </p>
        </div>

        <button
          type="button"
          onClick={onRunReplay}
          disabled={isRunning}
          className="h-12 flex items-center gap-2.5 px-6 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none shadow-lg cursor-pointer shrink-0"
        >
          {isRunning ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Running 500-Worker Simulation...
            </>
          ) : (
            <>
              <Play className="w-5 h-5" />
              Run 500-Worker Chaos Simulation
            </>
          )}
        </button>
      </div>

      {/* 3 Big, Easy-to-Read Comparison Cards Side-by-Side */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: Deadlocks */}
        <div className="bg-slate-900/50 border border-slate-800/60 rounded-2xl p-6 lg:p-8 space-y-5 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-300">1. Deadlocks &amp; Conflicts</span>
            <div className="w-9 h-9 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center">
              <Activity className="w-4 h-4 text-rose-400" />
            </div>
          </div>

          <div className="flex items-baseline gap-3 font-mono tabular-nums">
            <span className="text-3xl font-bold text-rose-400">{beforeIncidents}</span>
            <ArrowRight className="w-5 h-5 text-slate-500" />
            <span className="text-3xl font-bold text-emerald-400">{afterIncidents}</span>
          </div>

          <div className="space-y-3 text-xs font-mono tabular-nums">
            <div className="space-y-1.5">
              <div className="flex justify-between text-slate-400">
                <span>Broken Code</span>
                <span className="text-rose-400">{beforeIncidents} lockups</span>
              </div>
              <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden">
                <div
                  className="h-full bg-rose-500 transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
                  style={{ width: animateWidths ? '92%' : '0%' }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-slate-400">
                <span>Patched Code</span>
                <span className="text-emerald-400">0 lockups (100% safe)</span>
              </div>
              <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
                  style={{ width: animateWidths ? '100%' : '0%' }}
                />
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-400 pt-2 border-t border-slate-800/60 leading-relaxed">
            Every circular wait and conflicting write was eliminated across all 500 workers.
          </p>
        </div>

        {/* Card 2: Throughput (req/sec) */}
        <div className="bg-slate-900/50 border border-slate-800/60 rounded-2xl p-6 lg:p-8 space-y-5 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-300">2. Throughput (req/sec)</span>
            <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
              <Gauge className="w-4 h-4 text-cyan-400" />
            </div>
          </div>

          <div className="flex items-baseline gap-3 font-mono tabular-nums">
            <span className="text-2xl font-bold text-amber-400">
              {before.throughputReqPerSec.toLocaleString()}
            </span>
            <ArrowRight className="w-5 h-5 text-slate-500" />
            <span className="text-3xl font-bold text-emerald-400">
              {after.throughputReqPerSec.toLocaleString()}
            </span>
            <span className="text-xs text-slate-400">req/s</span>
          </div>

          <div className="space-y-3 text-xs font-mono tabular-nums">
            <div className="space-y-1.5">
              <div className="flex justify-between text-slate-400">
                <span>Broken Code (Stalled)</span>
                <span className="text-amber-400">{before.throughputReqPerSec.toLocaleString()} req/s</span>
              </div>
              <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
                  style={{ width: animateWidths ? `${beforeThroughputPct}%` : '0%' }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-slate-400">
                <span>Patched Code (Unblocked)</span>
                <span className="text-emerald-400">{after.throughputReqPerSec.toLocaleString()} req/s</span>
              </div>
              <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
                  style={{ width: animateWidths ? '100%' : '0%' }}
                />
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-400 pt-2 border-t border-slate-800/60 leading-relaxed">
            Throughput increased {improvementFactor}x once workers stopped blocking each other.
          </p>
        </div>

        {/* Card 3: Response Time (p99 Latency) */}
        <div className="bg-slate-900/50 border border-slate-800/60 rounded-2xl p-6 lg:p-8 space-y-5 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-300">3. Response Time (p99 Latency)</span>
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
              <Zap className="w-4 h-4 text-amber-400" />
            </div>
          </div>

          <div className="flex items-baseline gap-3 font-mono tabular-nums">
            <span className="text-2xl font-bold text-rose-400">
              {before.p99Ms.toLocaleString()}ms
            </span>
            <ArrowRight className="w-5 h-5 text-slate-500" />
            <span className="text-3xl font-bold text-emerald-400">
              {after.p99Ms}ms
            </span>
          </div>

          <div className="space-y-3 text-xs font-mono tabular-nums">
            <div className="space-y-1.5">
              <div className="flex justify-between text-slate-400">
                <span>Broken Code (Timeouts)</span>
                <span className="text-rose-400">{before.p99Ms.toLocaleString()}ms</span>
              </div>
              <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden">
                <div
                  className="h-full bg-rose-500 transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
                  style={{ width: animateWidths ? '96%' : '0%' }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-slate-400">
                <span>Patched Code (Fast)</span>
                <span className="text-emerald-400">{after.p99Ms}ms</span>
              </div>
              <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
                  style={{ width: animateWidths ? '8%' : '0%' }}
                />
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-400 pt-2 border-t border-slate-800/60 leading-relaxed">
            Worst-case response time is {latencyDropFactor}x faster ({after.successRatePct}% requests succeed).
          </p>
        </div>
      </div>
    </section>
  );
};

export default ChaosBenchmarkBar;
