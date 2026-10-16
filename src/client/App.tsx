import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileUp,
  Flame,
  Network,
  ShieldAlert,
  Terminal,
  Trash2,
  Wrench,
} from 'lucide-react';
import { analyzeTrace } from '../engine/analyze';
import { DEFAULT_WORKER_COUNT, SIMULATION_LIMITS } from '../engine/simulator';
import type { ChaosBenchmarkResult, LockEvent } from '../shared/types';
import { ChaosBenchmarkBar, type BenchmarkState } from './components/ChaosBenchmarkBar';
import { CodeAndDiffPanel } from './components/CodeAndDiffPanel';
import { CustomTraceModal } from './components/CustomTraceModal';
import { LockGraphCanvas } from './components/LockGraphCanvas';
import { useCopy } from './lib/clipboard';
import { buildStory } from './lib/story';
import { MAX_TRACE_FILE_BYTES, parseTraceText } from './lib/traceParser';

type Step = 'diagnose' | 'fix' | 'stress';

const BENCHMARK_TIMEOUT_MS = 60_000;

const CURL_EXAMPLE = `curl -X POST http://localhost:3000/api/analyze \\
  -H "Content-Type: application/json" \\
  -d @trace.json   # {"events": [ ...LockEvent objects... ]}`;

const STEPS: readonly { id: Step; label: string; icon: React.ReactNode }[] = [
  { id: 'diagnose', label: '1. Diagnose', icon: <Network className="w-4 h-4" aria-hidden="true" /> },
  { id: 'fix', label: '2. Fix & runbook', icon: <Wrench className="w-4 h-4" aria-hidden="true" /> },
  { id: 'stress', label: '3. Stress-test', icon: <Flame className="w-4 h-4" aria-hidden="true" /> },
];

const secondaryButton =
  'h-10 inline-flex items-center gap-2 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800/80 text-xs font-semibold text-slate-200 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 active:scale-[0.98] cursor-pointer';
const primaryButton =
  'h-11 inline-flex items-center gap-2 px-5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 active:scale-[0.98] cursor-pointer';

async function requestBenchmark(events: LockEvent[], workers: number, signal: AbortSignal): Promise<ChaosBenchmarkResult> {
  const response = await fetch('/api/benchmark', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ events, workers }),
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `Server responded with HTTP ${response.status}.`;
    throw new Error(message);
  }
  return body as ChaosBenchmarkResult;
}

export const App: React.FC = () => {
  const [events, setEvents] = useState<LockEvent[]>([]);
  const [sourceLabel, setSourceLabel] = useState('');
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('diagnose');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [workers, setWorkers] = useState(DEFAULT_WORKER_COUNT);
  const [benchmark, setBenchmark] = useState<BenchmarkState>({ status: 'idle' });
  const fileInput = useRef<HTMLInputElement | null>(null);
  const benchmarkAbort = useRef<AbortController | null>(null);
  const { state: copyState, copy } = useCopy();

  const analysis = useMemo(() => (events.length > 0 ? analyzeTrace(events) : null), [events]);
  const story = useMemo(
    () => (analysis ? buildStory(events, analysis.cycles, analysis.races) : []),
    [analysis, events],
  );

  useEffect(() => () => benchmarkAbort.current?.abort(), []);

  const loadEvents = useCallback((next: LockEvent[], label: string) => {
    benchmarkAbort.current?.abort();
    setEvents(next);
    setSourceLabel(label);
    setIngestError(null);
    setSelectedNodeId(null);
    setBenchmark({ status: 'idle' });
    setStep('diagnose');
  }, []);

  const ingestFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_TRACE_FILE_BYTES) {
        setIngestError(`${file.name} is larger than ${MAX_TRACE_FILE_BYTES / 1024 / 1024} MB.`);
        return;
      }
      try {
        const parsed = parseTraceText(await file.text());
        if (parsed.ok) loadEvents(parsed.events, file.name);
        else setIngestError(`${file.name}: ${parsed.error}`);
      } catch (error) {
        setIngestError(`Could not read ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [loadEvents],
  );

  const runBenchmark = useCallback(async () => {
    benchmarkAbort.current?.abort();
    const controller = new AbortController();
    benchmarkAbort.current = controller;
    const timer = setTimeout(() => controller.abort(), BENCHMARK_TIMEOUT_MS);
    setBenchmark({ status: 'running' });
    try {
      const result = await requestBenchmark(events, workers, controller.signal);
      setBenchmark({ status: 'done', result });
    } catch (error) {
      if (controller.signal.aborted && benchmarkAbort.current !== controller) return;
      const message = controller.signal.aborted
        ? `the server did not respond within ${BENCHMARK_TIMEOUT_MS / 1000} seconds.`
        : error instanceof TypeError
          ? 'could not reach the DeadlockZero API. Is the server running?'
          : error instanceof Error
            ? error.message
            : String(error);
      setBenchmark({ status: 'error', message });
    } finally {
      clearTimeout(timer);
    }
  }, [events, workers]);

  const fileInputElement = (
    <input
      ref={fileInput}
      type="file"
      accept=".json,.jsonl,application/json"
      className="hidden"
      aria-label="Upload trace file"
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void ingestFile(file);
        event.target.value = '';
      }}
    />
  );

  const hasDeadlock = (analysis?.cycles.length ?? 0) > 0;
  const hasRace = (analysis?.races.length ?? 0) > 0;
  const hasStarvation = (analysis?.starvation.length ?? 0) > 0;
  const primaryFile = analysis?.remediation.sourceFile.split('/').pop() ?? '';
  const summary = !analysis
    ? ''
    : hasDeadlock
      ? `Deadlock: ${analysis.cycles[0].cycle.length} workers are each waiting for a lock another one holds, so none can proceed. Suggested fix: acquire locks in one canonical order (${primaryFile}).`
      : hasRace
        ? `Race condition: ${analysis.races.length} pair(s) of workers access the same data concurrently without a shared lock (${primaryFile}).`
        : hasStarvation
          ? `Resource starvation: most workers are blocked waiting on ${analysis.starvation[0].resourceId}.`
          : 'No deadlock cycles, races, or starvation were found in this trace.';
  const tone = hasDeadlock ? 'rose' : hasRace || hasStarvation ? 'amber' : 'emerald';

  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-100 flex flex-col overflow-x-hidden"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files?.[0];
        if (file) void ingestFile(file);
      }}
    >
      {fileInputElement}

      <header className="border-b border-slate-800/60 bg-slate-900/50 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5 text-rose-400" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-base font-bold tracking-tight text-slate-100">DeadlockZero</h1>
                {sourceLabel && (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700/80 truncate max-w-[220px]">
                    {sourceLabel}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">Find, understand, and fix lock deadlocks and data races from a trace</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => fileInput.current?.click()} className={secondaryButton}>
              <FileUp className="w-4 h-4 text-cyan-400" aria-hidden="true" />
              Upload trace
            </button>
            <button type="button" onClick={() => setEditorOpen(true)} className={secondaryButton}>
              <Terminal className="w-4 h-4 text-cyan-400" aria-hidden="true" />
              {events.length > 0 ? 'Edit trace' : 'Paste trace'}
            </button>
            {events.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  benchmarkAbort.current?.abort();
                  setEvents([]);
                  setSourceLabel('');
                  setBenchmark({ status: 'idle' });
                }}
                className={secondaryButton}
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                Clear
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-8 space-y-8">
        {ingestError && (
          <p role="alert" className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-300 text-sm">
            {ingestError}
          </p>
        )}

        {!analysis ? (
          <section aria-labelledby="empty-title" className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div
              className={`rounded-2xl border-2 border-dashed p-8 lg:p-10 flex flex-col items-center justify-center text-center gap-5 transition-colors ${
                dragging ? 'border-cyan-400 bg-cyan-500/5' : 'border-slate-800/80'
              }`}
            >
              <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
                <FileUp className="w-6 h-6 text-cyan-400" aria-hidden="true" />
              </div>
              <div className="space-y-2 max-w-md">
                <h2 id="empty-title" className="text-lg font-bold text-slate-100">Start by loading a lock trace</h2>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Drop a .json or .jsonl file anywhere on this page, choose a file, or paste events. Analysis runs in your browser;
                  only the stress test sends the trace to this server.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                <button type="button" onClick={() => fileInput.current?.click()} className={primaryButton}>
                  <FileUp className="w-4 h-4" aria-hidden="true" />
                  Choose a file
                </button>
                <button type="button" onClick={() => setEditorOpen(true)} className={secondaryButton}>
                  <Terminal className="w-4 h-4 text-cyan-400" aria-hidden="true" />
                  Paste a trace
                </button>
              </div>
            </div>

            <div className="bg-slate-900/50 border border-slate-800/60 rounded-2xl p-8 space-y-5">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">Trace format</h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                Each event records one step a worker (thread, process, or service) took on a shared resource.
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
                {[
                  ['workerId', 'Who acted (required)'],
                  ['resourceId', 'Lock, row, or key acted on (required)'],
                  ['action', 'ACQUIRE, WAIT, RELEASE, READ, or WRITE (required)'],
                  ['timestamp', 'Ordering, any monotonic number'],
                  ['vectorClock', 'Optional Lamport vector clock, used for race detection'],
                  ['file, line, codeSnippet', 'Optional source location shown in the report'],
                ].map(([field, meaning]) => (
                  <React.Fragment key={field}>
                    <dt className="font-mono text-cyan-300">{field}</dt>
                    <dd className="text-slate-300">{meaning}</dd>
                  </React.Fragment>
                ))}
              </dl>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-400">Or call the API</h3>
                  <button
                    type="button"
                    onClick={() => void copy('curl', CURL_EXAMPLE)}
                    className="text-xs font-semibold text-slate-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded cursor-pointer"
                  >
                    {copyState.curl === 'copied' ? 'Copied' : copyState.curl === 'failed' ? 'Copy failed' : 'Copy'}
                  </button>
                </div>
                <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800/60 font-mono text-xs text-slate-300 overflow-x-auto">{CURL_EXAMPLE}</pre>
              </div>
            </div>
          </section>
        ) : (
          <>
            <section
              aria-label="Summary"
              className={`rounded-2xl p-6 lg:p-8 border bg-slate-900/60 flex flex-col lg:flex-row lg:items-center justify-between gap-6 ${
                tone === 'rose' ? 'border-rose-500/40' : tone === 'amber' ? 'border-amber-500/30' : 'border-emerald-500/30'
              }`}
            >
              <div className="space-y-2 max-w-2xl">
                <p className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider ${tone === 'rose' ? 'text-rose-400' : tone === 'amber' ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {tone === 'emerald' ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : <AlertTriangle className="w-4 h-4" aria-hidden="true" />}
                  {hasDeadlock ? 'Deadlock detected' : hasRace ? 'Race condition detected' : hasStarvation ? 'Starvation detected' : 'No issues found'}
                </p>
                <h2 className="text-lg sm:text-xl font-bold text-slate-100 leading-snug">{summary}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-3 shrink-0">
                {[
                  ['Cycles', analysis.cycles.length, hasDeadlock ? 'text-rose-400' : 'text-emerald-400'],
                  ['Races', analysis.races.length, hasRace ? 'text-amber-400' : 'text-emerald-400'],
                  ['Events', events.length, 'text-slate-100'],
                ].map(([label, value, color]) => (
                  <div key={label as string} className="px-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800/60">
                    <span className="text-[11px] text-slate-400 block">{label}</span>
                    <strong className={`text-sm font-mono tabular-nums ${color}`}>{value}</strong>
                  </div>
                ))}
                {step !== 'stress' && (
                  <button type="button" onClick={() => setStep(step === 'diagnose' ? 'fix' : 'stress')} className={primaryButton}>
                    {step === 'diagnose' ? 'See the suggested fix' : 'Stress-test the fix'}
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            </section>

            <nav aria-label="Workflow steps" className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-1.5 rounded-2xl bg-slate-900/70 border border-slate-800/60">
              {STEPS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-current={step === item.id ? 'step' : undefined}
                  onClick={() => setStep(item.id)}
                  className={`flex items-center justify-center gap-2.5 py-3.5 px-4 rounded-xl text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 cursor-pointer ${
                    step === item.id ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </nav>

            {step === 'diagnose' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-8">
                  <LockGraphCanvas
                    nodes={analysis.graph.nodes}
                    edges={analysis.graph.edges}
                    cycles={analysis.cycles}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={setSelectedNodeId}
                  />
                </div>
                <aside aria-labelledby="story-title" className="lg:col-span-4 bg-slate-900/50 border border-slate-800/60 rounded-2xl p-6 lg:p-8 space-y-6">
                  <div className="space-y-1">
                    <p className="flex items-center gap-2 text-cyan-400 text-xs font-bold uppercase tracking-wider">
                      <BookOpen className="w-4 h-4" aria-hidden="true" />
                      Timeline
                    </p>
                    <h2 id="story-title" className="text-lg font-bold text-slate-100">What happened, step by step</h2>
                  </div>
                  <ol className="space-y-3">
                    {story.map((item) => (
                      <li
                        key={item.stepNumber}
                        className={`p-4 rounded-xl border space-y-1.5 ${item.critical ? 'bg-rose-500/10 border-rose-500/40' : 'bg-slate-950/70 border-slate-800/60'}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-xs font-bold uppercase tracking-wider ${item.critical ? 'text-rose-400' : 'text-cyan-400'}`}>
                            Step {item.stepNumber}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400 truncate">{item.location}</span>
                        </div>
                        <p className="text-sm font-bold text-slate-100">{item.title}</p>
                        <p className="text-xs text-slate-300 leading-relaxed break-words">{item.description}</p>
                      </li>
                    ))}
                  </ol>
                  <div className="pt-4 border-t border-slate-800/60 space-y-3">
                    <button
                      type="button"
                      aria-expanded={showAdvanced}
                      onClick={() => setShowAdvanced((value) => !value)}
                      className="w-full flex items-center justify-between text-xs font-semibold text-slate-400 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded cursor-pointer"
                    >
                      Show cycle paths and vector clocks
                      {showAdvanced ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
                    </button>
                    {showAdvanced && (
                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 space-y-3 text-xs font-mono text-slate-300">
                        {analysis.cycles.map((cycle) => (
                          <p key={cycle.id} className="break-words">
                            <span className="text-rose-400">cycle </span>
                            {cycle.cycleNodes.join(' -> ')}
                          </p>
                        ))}
                        {analysis.races.map((race, index) => (
                          <p key={index} className="break-words">
                            <span className="text-amber-400">race </span>
                            {race.workerA} {JSON.stringify(race.vectorClockA)} || {race.workerB} {JSON.stringify(race.vectorClockB)} on {race.resourceId}
                          </p>
                        ))}
                        {events.map((event, index) => (
                          <p key={`${event.id}-${index}`} className="truncate">
                            {event.workerId} {event.action} {event.resourceId} <span className="text-emerald-400">{JSON.stringify(event.vectorClock)}</span>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </aside>
              </div>
            )}

            {step === 'fix' && <CodeAndDiffPanel remediation={analysis.remediation} />}

            {step === 'stress' && (
              <ChaosBenchmarkBar
                state={benchmark}
                workers={workers}
                maxWorkers={SIMULATION_LIMITS.maxWorkers}
                onWorkersChange={setWorkers}
                onRun={() => void runBenchmark()}
              />
            )}
          </>
        )}
      </main>

      <CustomTraceModal
        isOpen={editorOpen}
        initialEvents={events}
        onClose={() => setEditorOpen(false)}
        onSubmit={(next) => loadEvents(next, 'Pasted trace')}
      />
    </div>
  );
};

export default App;
