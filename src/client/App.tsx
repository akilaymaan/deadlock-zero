import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileJson,
  FileUp,
  Flame,
  Network,
  ShieldAlert,
  Terminal,
  Wrench,
} from 'lucide-react';
import { buildWaitForGraph } from '../engine/graph';
import { detectDeadlocks } from '../engine/deadlockDetector';
import { detectRaces, detectStarvation } from '../engine/raceDetector';
import { generateRemediationPlan } from '../engine/remediator';
import { runChaosBenchmark } from '../engine/simulator';
import type { LockEvent } from '../shared/types';
import { LockGraphCanvas } from './components/LockGraphCanvas';
import { CodeAndDiffPanel } from './components/CodeAndDiffPanel';
import { ChaosBenchmarkBar } from './components/ChaosBenchmarkBar';
import {
  CustomTraceModal,
  parseAndValidateTraceText,
  SAMPLE_SCHEMA_TEMPLATE,
} from './components/CustomTraceModal';

type WorkspaceStep = 'diagnose' | 'fix' | 'stress';

interface StoryStep {
  stepNumber: number;
  title: string;
  description: string;
  fileLine: string;
  isFreezeStep: boolean;
}

function buildHumanStoryTimeline(events: LockEvent[], hasCycle: boolean): StoryStep[] {
  const steps: StoryStep[] = [];
  const acquires = events.filter((e) => e.action === 'ACQUIRE');
  const waits = events.filter((e) => e.action === 'WAIT');

  acquires.forEach((ev, idx) => {
    const shortFile = ev.file.split('/').pop() ?? ev.file;
    steps.push({
      stepNumber: idx + 1,
      title: `${ev.workerId} locked ${ev.resourceId}`,
      description: `${ev.workerId} acquired exclusive ownership of ${ev.resourceId} at ${shortFile}:${ev.line}.`,
      fileLine: `${shortFile}:${ev.line}`,
      isFreezeStep: false,
    });
  });

  if (waits.length > 0 && hasCycle) {
    const waiters = [...new Set(waits.map((w) => w.workerId))].join(' and ');
    const targetLocks = [...new Set(waits.map((w) => w.resourceId))].join(' & ');
    const firstWait = waits[0];
    const shortFile = firstWait.file.split('/').pop() ?? firstWait.file;
    steps.push({
      stepNumber: steps.length + 1,
      title: 'Both workers tried to grab the other’s lock and froze',
      description: `${waiters} requested ${targetLocks} while still holding their first lock, creating an unbreakable circular wait.`,
      fileLine: `${shortFile}:${firstWait.line}`,
      isFreezeStep: true,
    });
  } else {
    waits.forEach((ev) => {
      const shortFile = ev.file.split('/').pop() ?? ev.file;
      steps.push({
        stepNumber: steps.length + 1,
        title: `${ev.workerId} waited for ${ev.resourceId}`,
        description: `${ev.workerId} queued in safe order for ${ev.resourceId} without forming a loop.`,
        fileLine: `${shortFile}:${ev.line}`,
        isFreezeStep: false,
      });
    });
  }

  if (steps.length === 0) {
    events.forEach((ev, idx) => {
      const shortFile = ev.file.split('/').pop() ?? ev.file;
      steps.push({
        stepNumber: idx + 1,
        title: `${ev.workerId} performed ${ev.action} on ${ev.resourceId}`,
        description: `Executed ${ev.codeSnippet} at ${shortFile}:${ev.line}.`,
        fileLine: `${shortFile}:${ev.line}`,
        isFreezeStep: ev.action === 'WRITE',
      });
    });
  }

  return steps;
}

export const App: React.FC = () => {
  const [activeStep, setActiveStep] = useState<WorkspaceStep>('diagnose');
  const [traceEvents, setTraceEvents] = useState<LockEvent[]>(SAMPLE_SCHEMA_TEMPLATE);
  const [traceSourceLabel, setTraceSourceLabel] = useState<string>('Sample Trace (ledger.ts)');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayCount, setReplayCount] = useState(0);
  const [showAdvancedMath, setShowAdvancedMath] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const analysis = useMemo(() => {
    const graph = buildWaitForGraph(traceEvents);
    const cycles = detectDeadlocks(graph);
    const races = detectRaces(traceEvents);
    const starvation = detectStarvation(traceEvents).map((s) => ({
      resourceId: s.poolId,
      blockedWorkers: [],
      totalWorkers: s.capacity + s.queued,
      blockedRatio: s.queued / Math.max(1, s.capacity + s.queued),
      file: s.source?.file ?? 'trace.ts',
      line: s.source?.line ?? 1,
      explanation: s.explanation,
    }));
    const remediation = generateRemediationPlan(traceEvents, cycles, races);
    const benchmark = runChaosBenchmark(traceEvents, 500);
    const storySteps = buildHumanStoryTimeline(traceEvents, cycles.length > 0);

    return {
      graph,
      cycles,
      races,
      starvation,
      remediation,
      benchmark,
      storySteps,
    };
  }, [traceEvents, replayCount]);

  const handleIngestText = (rawText: string, sourceName: string) => {
    const { events, error } = parseAndValidateTraceText(rawText);
    if (error || !events) {
      setUploadError(error ?? 'Invalid trace file');
      return;
    }
    setUploadError(null);
    setTraceEvents(events);
    setTraceSourceLabel(sourceName);
    setSelectedNodeId(null);
  };

  const handleFileUpload = async (file: File) => {
    try {
      const content = await file.text();
      handleIngestText(content, file.name);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to read trace file.');
    }
  };

  const handleRunChaosReplay = async () => {
    if (isReplaying || traceEvents.length === 0) return;
    setIsReplaying(true);
    try {
      await fetch('/api/benchmark', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: traceEvents, workers: 500 }),
      });
    } catch {
      // Offline deterministic engine already computes benchmark locally
    } finally {
      setReplayCount((c) => c + 1);
      setIsReplaying(false);
    }
  };

  const primaryFile = (traceEvents[0]?.file ?? 'ledger.ts').split('/').pop() ?? 'ledger.ts';
  const hasDeadlock = analysis.cycles.length > 0;
  const hasRace = analysis.races.length > 0;
  const stuckWorkerCount = hasDeadlock ? analysis.cycles[0].cycle.length : 0;

  const plainEnglishSummary = hasDeadlock
    ? `Deadlock Detected: ${stuckWorkerCount} workers are stuck waiting on each other in a circle. Suggested Fix: Enforce canonical lock ordering in ${primaryFile}.`
    : hasRace
      ? `Race Condition Detected: Workers are concurrently overwriting shared state in ${primaryFile} without a common lock.`
      : `All Clear: Workers acquire locks in a safe, consistent order in ${primaryFile} with zero circular waits.`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col overflow-x-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.jsonl,.log"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            void handleFileUpload(file);
          }
          e.target.value = '';
        }}
      />

      {/* Friendly Top Header Bar */}
      <header className="border-b border-slate-800/60 bg-slate-900/50 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5 text-rose-400" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-base font-bold tracking-tight text-slate-100">
                  DeadlockZero
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700/80">
                  {traceSourceLabel}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Find, understand, and fix concurrency lockups in 3 guided steps
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-10 flex items-center gap-2 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800/80 text-xs font-semibold text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 active:scale-[0.98] transition-all cursor-pointer"
            >
              <FileUp className="w-4 h-4 text-cyan-400" />
              Upload .json / .jsonl
            </button>

            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="h-10 flex items-center gap-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 active:scale-[0.98] transition-all cursor-pointer"
            >
              <Terminal className="w-4 h-4 text-cyan-400" />
              Paste Custom Trace
            </button>

            <button
              type="button"
              onClick={() => {
                setTraceEvents(SAMPLE_SCHEMA_TEMPLATE);
                setTraceSourceLabel('Sample Trace (ledger.ts)');
                setUploadError(null);
              }}
              className="h-10 flex items-center gap-2 px-3.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800/60 text-xs font-medium text-slate-400 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 active:scale-[0.98] transition-all cursor-pointer"
            >
              <FileJson className="w-4 h-4 text-emerald-400" />
              Reset Sample
            </button>
          </div>
        </div>
      </header>

      {/* Main Spacious 3-Step Container */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-8 space-y-8">
        {uploadError && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-300 text-sm">
            {uploadError}
          </div>
        )}

        {/* Top Summary Banner (Always Visible & Plain-English) */}
        <section
          aria-label="Plain-English Incident Summary"
          className={`rounded-2xl p-6 lg:p-8 border shadow-xl flex flex-col lg:flex-row lg:items-center justify-between gap-6 ${
            hasDeadlock
              ? 'bg-slate-900/60 border-rose-500/40'
              : hasRace
                ? 'bg-slate-900/60 border-amber-500/30'
                : 'bg-slate-900/60 border-emerald-500/30'
          }`}
        >
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
              {hasDeadlock ? (
                <span className="flex items-center gap-1.5 text-rose-400">
                  <AlertTriangle className="w-4 h-4" /> Critical Concurrency Issue Found
                </span>
              ) : hasRace ? (
                <span className="flex items-center gap-1.5 text-amber-400">
                  <AlertTriangle className="w-4 h-4" /> Data Race Warning
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" /> Lock Hierarchy Verified Safe
                </span>
              )}
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-100 leading-snug">
              {plainEnglishSummary}
            </h2>
          </div>

          {/* 3 Clean Summary Pills + Next-Step CTA */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div className="px-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800/60">
              <span className="text-[11px] text-slate-400 block">Active Cycles</span>
              <strong
                className={`text-sm font-mono tabular-nums ${
                  analysis.cycles.length > 0 ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {analysis.cycles.length}
              </strong>
            </div>

            <div className="px-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800/60">
              <span className="text-[11px] text-slate-400 block">Race Conflicts</span>
              <strong
                className={`text-sm font-mono tabular-nums ${
                  analysis.races.length > 0 ? 'text-amber-400' : 'text-emerald-400'
                }`}
              >
                {analysis.races.length}
              </strong>
            </div>

            <div className="px-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800/60">
              <span className="text-[11px] text-slate-400 block">System Health</span>
              <strong
                className={`text-sm font-semibold ${
                  hasDeadlock ? 'text-rose-400' : hasRace ? 'text-amber-400' : 'text-emerald-400'
                }`}
              >
                {hasDeadlock ? 'Blocked' : hasRace ? 'At Risk' : 'Healthy'}
              </strong>
            </div>

            {activeStep === 'diagnose' ? (
              <button
                type="button"
                onClick={() => setActiveStep('fix')}
                className="h-11 flex items-center gap-2 px-5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 active:scale-[0.98] cursor-pointer"
              >
                View Recommended Code Fix
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : activeStep === 'fix' ? (
              <button
                type="button"
                onClick={() => setActiveStep('stress')}
                className="h-11 flex items-center gap-2 px-5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 active:scale-[0.98] cursor-pointer"
              >
                Verify with 500-Worker Stress Test
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setActiveStep('diagnose')}
                className="h-11 flex items-center gap-2 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-semibold text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 active:scale-[0.98] cursor-pointer"
              >
                Back to Visual Map
              </button>
            )}
          </div>
        </section>

        {/* Segmented 3-Step View Switcher */}
        <nav
          aria-label="Guided 3-Step Workflow"
          className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-1.5 rounded-2xl bg-slate-900/70 border border-slate-800/60"
        >
          <button
            type="button"
            onClick={() => setActiveStep('diagnose')}
            className={`flex items-center justify-center gap-2.5 py-3.5 px-4 rounded-xl text-sm font-bold transition-all cursor-pointer ${
              activeStep === 'diagnose'
                ? 'bg-cyan-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
            }`}
          >
            <Network className="w-4 h-4" />
            1. Diagnose (Visual Map)
          </button>

          <button
            type="button"
            onClick={() => setActiveStep('fix')}
            className={`flex items-center justify-center gap-2.5 py-3.5 px-4 rounded-xl text-sm font-bold transition-all cursor-pointer ${
              activeStep === 'fix'
                ? 'bg-cyan-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
            }`}
          >
            <Wrench className="w-4 h-4" />
            2. Fix &amp; Runbook (Solution)
          </button>

          <button
            type="button"
            onClick={() => setActiveStep('stress')}
            className={`flex items-center justify-center gap-2.5 py-3.5 px-4 rounded-xl text-sm font-bold transition-all cursor-pointer ${
              activeStep === 'stress'
                ? 'bg-cyan-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
            }`}
          >
            <Flame className="w-4 h-4" />
            3. Stress-Test (500-Worker Proof)
          </button>
        </nav>

        {/* STEP 1 VIEW: 1. Diagnose (Visual Map + Plain-English Story Sidebar) */}
        {activeStep === 'diagnose' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* 70% Width Wait-For Graph */}
            <div className="lg:col-span-8 flex flex-col">
              <LockGraphCanvas
                nodes={analysis.graph.nodes}
                edges={analysis.graph.edges}
                events={traceEvents}
                cycles={analysis.cycles}
                races={analysis.races}
                starvation={analysis.starvation}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
              />
            </div>

            {/* 30% Width "How This Crash Happened" Story Timeline Sidebar */}
            <aside className="lg:col-span-4 bg-slate-900/50 border border-slate-800/60 rounded-2xl p-6 lg:p-8 flex flex-col justify-between gap-6 shadow-xl">
              <div className="space-y-5">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold uppercase tracking-wider">
                    <BookOpen className="w-4 h-4" />
                    Step-by-Step Story
                  </div>
                  <h2 className="text-lg font-bold text-slate-100">
                    How This Crash Happened
                  </h2>
                  <p className="text-xs text-slate-400">
                    Plain-English timeline of the events leading to the lockup:
                  </p>
                </div>

                {/* Numbered Story Cards */}
                <ol className="space-y-3.5">
                  {analysis.storySteps.map((step) => (
                    <li
                      key={step.stepNumber}
                      className={`p-4 rounded-xl border space-y-1.5 ${
                        step.isFreezeStep
                          ? 'bg-rose-500/10 border-rose-500/40'
                          : 'bg-slate-950/70 border-slate-800/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-xs font-bold uppercase tracking-wider ${
                            step.isFreezeStep ? 'text-rose-400' : 'text-cyan-400'
                          }`}
                        >
                          Step {step.stepNumber}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400">
                          {step.fileLine}
                        </span>
                      </div>
                      <div className="text-sm font-bold text-slate-100">
                        {step.title}
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        {step.description}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Progressive Disclosure Accordion for Advanced Math & Vector Clocks */}
              <div className="pt-4 border-t border-slate-800/60 space-y-3">
                <button
                  type="button"
                  onClick={() => setShowAdvancedMath((prev) => !prev)}
                  className="w-full flex items-center justify-between text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                >
                  <span>Show Advanced Math &amp; Vector Clocks</span>
                  {showAdvancedMath ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>

                {showAdvancedMath && (
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 space-y-2.5 text-[11px] font-mono tabular-nums text-slate-300">
                    {analysis.cycles.length > 0 && (
                      <div>
                        <span className="text-rose-400 font-bold block">
                          Tarjan SCC Cycle Path:
                        </span>
                        <span className="break-words">
                          {analysis.cycles[0].cycleNodes.join(' -> ')}
                        </span>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <span className="text-slate-400 block">
                        Lamport Vector Clocks per Event:
                      </span>
                      {traceEvents.map((ev, i) => (
                        <div key={ev.id || i} className="truncate text-slate-300">
                          {ev.workerId} {ev.action} {ev.resourceId}:{' '}
                          <span className="text-emerald-400">
                            {JSON.stringify(ev.vectorClock)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </div>
        )}

        {/* STEP 2 VIEW: 2. Fix & Runbook (Solution) */}
        {activeStep === 'fix' && (
          <CodeAndDiffPanel
            events={traceEvents}
            cycles={analysis.cycles}
            races={analysis.races}
            remediation={analysis.remediation}
          />
        )}

        {/* STEP 3 VIEW: 3. Stress-Test (500-Worker Proof) */}
        {activeStep === 'stress' && (
          <ChaosBenchmarkBar
            before={analysis.benchmark.before}
            after={analysis.benchmark.after}
            improvementFactor={analysis.benchmark.improvementFactor}
            isRunning={isReplaying}
            onRunReplay={handleRunChaosReplay}
          />
        )}
      </main>

      <CustomTraceModal
        isOpen={isModalOpen}
        initialEvents={traceEvents}
        onClose={() => setIsModalOpen(false)}
        onAnalyzeCustomTrace={(events, label) => {
          setTraceEvents(events);
          setTraceSourceLabel(label ?? 'Custom Trace');
          setSelectedNodeId(null);
          setUploadError(null);
        }}
      />
    </div>
  );
};

export default App;
