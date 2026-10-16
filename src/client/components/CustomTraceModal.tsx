import React, { useState } from 'react';
import { CheckCircle2, Play, RotateCcw, Sparkles, Terminal, X } from 'lucide-react';
import type { LockEvent } from '../../shared/types';

interface CustomTraceModalProps {
  isOpen: boolean;
  initialEvents: LockEvent[];
  onClose: () => void;
  onAnalyzeCustomTrace: (events: LockEvent[]) => void;
}

const CANONICAL_SAFE_SAMPLE: LockEvent[] = [
  {
    id: 'safe-1',
    workerId: 'Worker_1',
    resourceId: 'Account_A',
    action: 'ACQUIRE',
    timestamp: 1001,
    vectorClock: { Worker_1: 1, Worker_2: 0 },
    file: 'src/services/ledger.ts',
    line: 41,
    codeSnippet: 'await tx.acquireRowLock(firstLock); // Canonical: Account_A first',
  },
  {
    id: 'safe-2',
    workerId: 'Worker_1',
    resourceId: 'Account_B',
    action: 'ACQUIRE',
    timestamp: 1005,
    vectorClock: { Worker_1: 2, Worker_2: 0 },
    file: 'src/services/ledger.ts',
    line: 42,
    codeSnippet: 'await tx.acquireRowLock(secondLock); // Canonical: Account_B second',
  },
  {
    id: 'safe-3',
    workerId: 'Worker_2',
    resourceId: 'Account_A',
    action: 'WAIT',
    timestamp: 1009,
    vectorClock: { Worker_1: 0, Worker_2: 1 },
    file: 'src/services/ledger.ts',
    line: 41,
    codeSnippet: 'await tx.acquireRowLock(firstLock); // Ordered wait on Account_A (no cycle)',
  },
];

export const CustomTraceModal: React.FC<CustomTraceModalProps> = ({
  isOpen,
  initialEvents,
  onClose,
  onAnalyzeCustomTrace,
}) => {
  const [rawJson, setRawJson] = useState(() => JSON.stringify(initialEvents, null, 2));
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    setRawJson(JSON.stringify(initialEvents, null, 2));
    setError(null);
  }, [initialEvents, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const parsed = JSON.parse(rawJson);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        setError('Trace must be a non-empty JSON array of LockEvent objects.');
        return;
      }
      setError(null);
      onAnalyzeCustomTrace(parsed as LockEvent[]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON payload');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Paste Custom Trace"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-3xl bg-slate-900 border border-slate-700/90 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30">
              <Terminal className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                Live LockEvent[] Trace Studio (JSON)
              </h3>
              <p className="text-[11px] text-slate-400">
                Inject a custom cycle, modify Lamport vector clocks, or test a canonical lock-order fix
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 p-5 gap-3.5 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-400">
              Quick templates:
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setRawJson(JSON.stringify(CANONICAL_SAFE_SAMPLE, null, 2));
                  setError(null);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 text-[11px] font-medium cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Load Cycle-Free Canonical Trace
              </button>
              <button
                type="button"
                onClick={() => {
                  setRawJson(JSON.stringify(initialEvents, null, 2));
                  setError(null);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 text-[11px] font-medium cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset to Scenario Trace
              </button>
            </div>
          </div>

          <textarea
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            rows={14}
            className="w-full flex-1 p-3.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-slate-100 leading-relaxed focus:outline-none focus:border-cyan-400"
          />

          {error && (
            <div className="text-xs text-rose-300 bg-rose-950/60 border border-rose-500/40 rounded-lg px-3 py-2 font-mono">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              Recomputes Tarjan SCC, Vector Clocks &amp; 500-Worker Chaos Telemetry instantaneously
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-lg border border-slate-700 text-slate-300 text-xs hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                Analyze Custom Trace
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CustomTraceModal;
