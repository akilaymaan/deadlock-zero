import React, { useMemo, useRef, useState } from 'react';
import {
  Activity,
  Check,
  Code2,
  Copy,
  FileJson,
  FileUp,
  GitBranch,
  Loader2,
  Play,
  ShieldAlert,
  Sparkles,
  Terminal,
  Trash2,
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

const CURL_INGEST_SNIPPET = `curl -X POST http://localhost:3000/api/analyze \\
  -H "Content-Type: application/json" \\
  -d '{
    "events": [
      {
        "id": "evt-1",
        "workerId": "Worker_1",
        "resourceId": "Lock_A",
        "action": "ACQUIRE",
        "timestamp": 1001,
        "vectorClock": { "Worker_1": 1, "Worker_2": 0 },
        "file": "src/services/ledger.ts",
        "line": 41,
        "codeSnippet": "await tx.acquireRowLock(fromAccountId);"
      }
    ]
  }'`;

export const App: React.FC = () => {
  const [traceEvents, setTraceEvents] = useState<LockEvent[]>([]);
  const [traceSourceLabel, setTraceSourceLabel] = useState<string>('Empty Workspace');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayCount, setReplayCount] = useState(0);
  const [copiedCurl, setCopiedCurl] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const analysis = useMemo(() => {
    if (traceEvents.length === 0) return null;
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
    return {
      graph,
      cycles,
      races,
      starvation,
      remediation,
      benchmark,
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

  const handleCopyCurl = async () => {
    try {
      await navigator.clipboard.writeText(CURL_INGEST_SNIPPET);
    } catch {
      // Headless environment fallback
    }
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
  };

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

      {/* Top Studio Navigation Bar */}
      <header className="border-b border-slate-800/80 bg-slate-900/75 backdrop-blur-md px-4 lg:px-6 py-3 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-30">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-rose-500/10 border border-rose-500/40 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-sm sm:text-base font-bold tracking-tight text-slate-100 truncate">
                DeadlockZero // Concurrency &amp; Outage Forensics Workbench
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 shrink-0">
                <Sparkles className="w-3.5 h-3.5" /> 100% Offline Deterministic
              </span>
            </div>
            <p className="text-xs text-slate-400 truncate">
              Tarjan&apos;s SCC Cycle Detector • Lamport Vector-Clock Verifier • 500-Worker Chaos Simulator
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="h-9 flex items-center gap-1.5 px-3 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-slate-700/80 text-xs font-semibold text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] transition-all cursor-pointer"
          >
            <FileUp className="w-4 h-4 text-cyan-400" />
            Upload .json / .jsonl
          </button>

          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="h-9 flex items-center gap-1.5 px-3 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-slate-700/80 text-xs font-semibold text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] transition-all cursor-pointer"
          >
            <Terminal className="w-4 h-4 text-cyan-400" />
            Ingest Lock Trace
          </button>

          {traceEvents.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => {
                  setTraceEvents([]);
                  setTraceSourceLabel('Empty Workspace');
                  setSelectedNodeId(null);
                  setUploadError(null);
                }}
                className="h-9 flex items-center gap-1.5 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-400 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] transition-all cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                Clear
              </button>

              <button
                type="button"
                onClick={handleRunChaosReplay}
                disabled={isReplaying}
                className="h-9 flex items-center gap-1.5 px-3.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all cursor-pointer"
              >
                {isReplaying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Replaying...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Run 500-Worker Chaos Replay
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </header>

      {/* Active Trace Status Strip */}
      <div className="bg-slate-900/50 border-b border-slate-800/80 px-4 lg:px-6 py-2.5">
        <div className="max-w-[1600px] w-full mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            <span
              className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] uppercase shrink-0 ${
                traceEvents.length > 0
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}
            >
              {traceEvents.length > 0 ? 'INGESTED TRACE' : 'AWAITING TRACE'}
            </span>
            <span className="font-semibold text-slate-100 truncate">{traceSourceLabel}</span>
            {uploadError && (
              <span className="text-rose-400 font-mono truncate">• {uploadError}</span>
            )}
          </div>

          <div className="flex items-center gap-4 text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
            <span className="flex items-center gap-1.5">
              <GitBranch className="w-4 h-4 text-emerald-400" />
              Events: <strong className="text-slate-200">{traceEvents.length}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-amber-400" />
              Simulation Workers: <strong className="text-slate-200">500</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Main Workspace Area */}
      <main className="flex-1 p-4 lg:p-5 flex flex-col gap-4 max-w-[1600px] w-full mx-auto">
        {!analysis ? (
          /* Clean Empty Workspace Onboarding State */
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            {/* Drag-and-Drop / Upload Ingestion Panel */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingOver(true);
              }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) {
                  void handleFileUpload(file);
                }
              }}
              className={`lg:col-span-7 bg-slate-900/75 backdrop-blur-md border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center gap-4 transition-all ${
                isDraggingOver
                  ? 'border-cyan-400 bg-cyan-500/5'
                  : 'border-slate-800/80 hover:border-slate-700'
              }`}
            >
              <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
                <FileUp className="w-6 h-6 text-cyan-400" />
              </div>

              <div className="max-w-lg space-y-1.5">
                <h2 className="text-base font-bold text-slate-100">
                  Ingest a Distributed Lock or Vector-Clock Trace
                </h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Drag and drop a <code className="text-cyan-300 font-mono">.json</code> or{' '}
                  <code className="text-cyan-300 font-mono">.jsonl</code> lock trace file here, paste
                  events directly in the Trace Editor, or POST to <code className="text-emerald-400 font-mono">/api/analyze</code>.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-9 flex items-center gap-1.5 px-4 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] transition-all cursor-pointer"
                >
                  <FileUp className="w-4 h-4" />
                  Select .json / .jsonl File
                </button>

                <button
                  type="button"
                  onClick={() => setIsModalOpen(true)}
                  className="h-9 flex items-center gap-1.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-semibold text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] transition-all cursor-pointer"
                >
                  <Terminal className="w-4 h-4 text-cyan-400" />
                  Open Trace Editor
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTraceEvents(SAMPLE_SCHEMA_TEMPLATE);
                    setTraceSourceLabel('Sample Schema Template');
                    setUploadError(null);
                  }}
                  className="h-9 flex items-center gap-1.5 px-3.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] transition-all cursor-pointer"
                >
                  <FileJson className="w-4 h-4 text-emerald-400" />
                  Load Sample Schema Template
                </button>
              </div>
            </div>

            {/* Schema & CLI / API Ingestion Guide */}
            <div className="lg:col-span-5 bg-slate-900/75 backdrop-blur-md border border-slate-800/80 rounded-xl p-5 flex flex-col justify-between gap-4 shadow-xl">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-100">
                    LockEvent JSON Schema &amp; REST API Ingestion
                  </h3>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Each trace event records a thread or service lock acquisition, wait edge, release,
                  or Lamport vector-clock memory access:
                </p>
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 font-mono text-[11px] text-slate-300 space-y-1">
                  <div>
                    <span className="text-cyan-400">&quot;workerId&quot;</span>: string{' '}
                    <span className="text-slate-500">// e.g. &quot;Worker_1&quot;</span>
                  </div>
                  <div>
                    <span className="text-cyan-400">&quot;resourceId&quot;</span>: string{' '}
                    <span className="text-slate-500">// e.g. &quot;Lock_A&quot;</span>
                  </div>
                  <div>
                    <span className="text-cyan-400">&quot;action&quot;</span>:{' '}
                    <span className="text-amber-300">
                      &quot;ACQUIRE&quot; | &quot;WAIT&quot; | &quot;RELEASE&quot; | &quot;READ&quot; | &quot;WRITE&quot;
                    </span>
                  </div>
                  <div>
                    <span className="text-cyan-400">&quot;timestamp&quot;</span>: number{' '}
                    <span className="text-slate-500">// epoch or logical ms</span>
                  </div>
                  <div>
                    <span className="text-cyan-400">&quot;vectorClock&quot;</span>:{' '}
                    <span className="text-emerald-400">{`Record<string, number>`}</span>
                  </div>
                  <div>
                    <span className="text-cyan-400">&quot;file&quot;</span>: string,{' '}
                    <span className="text-cyan-400">&quot;line&quot;</span>: number,{' '}
                    <span className="text-cyan-400">&quot;codeSnippet&quot;</span>: string
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    CLI / API cURL Ingestion
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyCurl}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] cursor-pointer"
                  >
                    {copiedCurl ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" /> Copy cURL
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 font-mono text-[10.5px] text-slate-300 overflow-x-auto scrollbar-thin leading-relaxed">
                  {CURL_INGEST_SNIPPET}
                </pre>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-[480px]">
              <div className="lg:col-span-7 flex flex-col min-w-0">
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
              <div className="lg:col-span-5 flex flex-col min-w-0">
                <CodeAndDiffPanel
                  events={traceEvents}
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
          </>
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
