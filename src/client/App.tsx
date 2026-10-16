import React, { useMemo, useState } from 'react';
import {
  Activity,
  GitBranch,
  Layers,
  Play,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { buildWaitForGraph } from '../engine/graph';
import { detectDeadlocks } from '../engine/deadlockDetector';
import { detectRaces, detectStarvation } from '../engine/raceDetector';
import { generateRemediationPlan } from '../engine/remediator';
import { runChaosBenchmark } from '../engine/simulator';
import { INCIDENT_PRESETS } from '../scenarios/presets';
import type { LockEvent } from '../shared/types';
import { LockGraphCanvas } from './components/LockGraphCanvas';
import { CodeAndDiffPanel } from './components/CodeAndDiffPanel';
import { ChaosBenchmarkBar } from './components/ChaosBenchmarkBar';
import { CustomTraceModal } from './components/CustomTraceModal';

export const App: React.FC = () => {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(INCIDENT_PRESETS[0].id);
  const [customEvents, setCustomEvents] = useState<LockEvent[] | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayCount, setReplayCount] = useState(0);

  const activePreset = useMemo(
    () => INCIDENT_PRESETS.find((p) => p.id === selectedScenarioId) ?? INCIDENT_PRESETS[0],
    [selectedScenarioId],
  );

  const activeEvents = useMemo(
    () => customEvents ?? activePreset.events,
    [customEvents, activePreset],
  );

  const analysis = useMemo(() => {
    const graph = buildWaitForGraph(activeEvents);
    const cycles = detectDeadlocks(graph);
    const races = detectRaces(activeEvents);
    const starvation = detectStarvation(activeEvents).map((s) => ({
      resourceId: s.poolId,
      blockedWorkers: [],
      totalWorkers: s.capacity + s.queued,
      blockedRatio: s.queued / Math.max(1, s.capacity + s.queued),
      file: s.source?.file ?? 'src/db/poolManager.ts',
      line: s.source?.line ?? 37,
      explanation: s.explanation,
    }));
    const remediation = customEvents
      ? generateRemediationPlan(customEvents, cycles, races)
      : generateRemediationPlan(activePreset, cycles, races);
    const benchmark = runChaosBenchmark(customEvents ?? activePreset, 500);
    return {
      graph,
      cycles,
      races,
      starvation,
      remediation,
      benchmark,
    };
  }, [activeEvents, activePreset, customEvents, replayCount]);

  const handleRunChaosReplay = async () => {
    setIsReplaying(true);
    try {
      await fetch('/api/benchmark', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          customEvents
            ? { customEvents, workers: 500 }
            : { scenarioId: activePreset.id, workers: 500 },
        ),
      });
    } catch {
      // Offline deterministic fallback already computed in memo
    } finally {
      setReplayCount((c) => c + 1);
      setIsReplaying(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Studio Navigation Bar */}
      <header className="border-b border-slate-800/90 bg-slate-900/95 backdrop-blur-md px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-rose-500/15 border border-rose-500/40 shadow-[0_0_15px_-3px_rgba(244,63,94,0.4)]">
            <ShieldAlert className="w-5 h-5 text-rose-400" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-slate-100">
                DeadlockZero // Concurrency &amp; Outage Forensics Workbench
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> 100% Offline Deterministic
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Tarjan&apos;s SCC Cycle Detector • Lamport Vector-Clock Verifier • 500-Worker Chaos Simulator
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label htmlFor="scenario-select" className="sr-only">
            Select Outage Scenario
          </label>
          <select
            id="scenario-select"
            value={selectedScenarioId}
            onChange={(e) => {
              setSelectedScenarioId(e.target.value);
              setCustomEvents(null);
              setSelectedNodeId(null);
            }}
            className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 hover:border-slate-600 text-xs font-medium text-slate-100 focus:outline-none focus:border-cyan-400 cursor-pointer"
          >
            {INCIDENT_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                [{preset.severity}] {preset.title}
              </option>
            ))}
          </select>

          {customEvents && (
            <button
              type="button"
              onClick={() => setCustomEvents(null)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-medium hover:bg-amber-500/25 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Custom Trace
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
            Paste Custom Trace
          </button>

          <button
            type="button"
            onClick={handleRunChaosReplay}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold shadow-md transition-colors cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            Run 500-Worker Chaos Replay
          </button>
        </div>
      </header>

      {/* Active Incident Summary Strip */}
      <div className="bg-slate-950/90 border-b border-slate-900 px-6 py-2.5">
        <div className="max-w-[1600px] w-full mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            <span
              className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] uppercase ${
                customEvents
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
              }`}
            >
              {customEvents ? 'CUSTOM TRACE' : activePreset.severity}
            </span>
            <span className="font-semibold text-slate-200">
              {customEvents ? 'Custom LockEvent[] Forensic Session' : activePreset.title}
            </span>
            <span className="text-slate-600 hidden sm:inline">•</span>
            <span className="text-slate-400 truncate max-w-2xl">
              {customEvents
                ? `Evaluating ${customEvents.length} custom lock/vector-clock trace events.`
                : activePreset.description}
            </span>
          </div>

          <div className="flex items-center gap-4 text-[11px] font-mono text-slate-400">
            <span className="flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              Service: <strong className="text-slate-200">{activePreset.serviceArea}</strong>
            </span>
            <span className="flex items-center gap-1">
              <GitBranch className="w-3.5 h-3.5 text-emerald-400" />
              Events: <strong className="text-slate-200">{activeEvents.length}</strong>
            </span>
            <span className="flex items-center gap-1">
              <Activity className="w-3.5 h-3.5 text-amber-400" />
              Workers: <strong className="text-slate-200">500</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Main Studio Grid */}
      <main className="flex-1 p-6 flex flex-col gap-5 max-w-[1600px] w-full mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 min-h-[470px]">
          <div className="lg:col-span-7 flex flex-col">
            <LockGraphCanvas
              nodes={analysis.graph.nodes}
              edges={analysis.graph.edges}
              events={activeEvents}
              cycles={analysis.cycles}
              races={analysis.races}
              starvation={analysis.starvation}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
            />
          </div>
          <div className="lg:col-span-5 flex flex-col">
            <CodeAndDiffPanel
              events={activeEvents}
              cycles={analysis.cycles}
              races={analysis.races}
              remediation={analysis.remediation}
            />
          </div>
        </div>

        <ChaosBenchmarkBar
          before={analysis.benchmark.before}
          after={analysis.benchmark.after}
          improvementFactor={analysis.benchmark.improvementFactor}
          isRunning={isReplaying}
          onRunReplay={handleRunChaosReplay}
        />
      </main>

      <CustomTraceModal
        isOpen={isModalOpen}
        initialEvents={activeEvents}
        onClose={() => setIsModalOpen(false)}
        onAnalyzeCustomTrace={(events) => setCustomEvents(events)}
      />
    </div>
  );
};

export default App;
