import React from 'react';
import { Activity, Flame, Gauge, ShieldCheck, Zap } from 'lucide-react';
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
  return (
    <div className="bg-slate-900/95 border border-slate-800 rounded-xl p-4 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-amber-400" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
            500-Worker Deterministic Chaos Replay Telemetry (Before Patch vs. After Canonical Patch)
          </h2>
          <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            {improvementFactor}x Throughput Gain
          </span>
        </div>
        <button
          type="button"
          onClick={onRunReplay}
          disabled={isRunning}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs transition-colors cursor-pointer"
        >
          <Zap className="w-3.5 h-3.5" />
          {isRunning ? 'Replaying 500 Workers...' : 'Re-Run 500-Worker Chaos Replay'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs font-mono">
        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
          <div className="flex items-center justify-between text-slate-400">
            <span>Deadlocks / Races</span>
            <Activity className="w-3.5 h-3.5 text-red-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-red-400 font-bold text-base">
              {before.deadlocksTriggered + before.raceConditionsTriggered}
            </span>
            <span className="text-slate-500">-&gt;</span>
            <span className="text-emerald-400 font-bold text-base">
              {after.deadlocksTriggered + after.raceConditionsTriggered}
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 w-full" />
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
          <div className="flex items-center justify-between text-slate-400">
            <span>Throughput (req/s)</span>
            <Gauge className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-amber-400 font-bold text-base">
              {before.throughputReqPerSec.toLocaleString()} req/s
            </span>
            <span className="text-slate-500">-&gt;</span>
            <span className="text-emerald-400 font-bold text-base">
              {after.throughputReqPerSec.toLocaleString()} req/s
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-cyan-400 w-11/12" />
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
          <div className="flex items-center justify-between text-slate-400">
            <span>p99 Tail Latency</span>
            <Zap className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-red-400 font-bold text-base">
              {before.p99Ms.toLocaleString()}ms
            </span>
            <span className="text-slate-500">-&gt;</span>
            <span className="text-emerald-400 font-bold text-base">
              {after.p99Ms}ms
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-400 w-full" />
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
          <div className="flex items-center justify-between text-slate-400">
            <span>Worker Success Rate</span>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-red-400 font-bold text-base">
              {before.successRatePct}%
            </span>
            <span className="text-slate-500">-&gt;</span>
            <span className="text-emerald-400 font-bold text-base">
              {after.successRatePct}%
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500"
              style={{ width: `${after.successRatePct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChaosBenchmarkBar;
