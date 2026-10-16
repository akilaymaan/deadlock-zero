import React, { useEffect, useState } from 'react';
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

  useEffect(() => {
    setRawJson(JSON.stringify(initialEvents, null, 2));
    setError(null);
  }, [initialEvents, isOpen]);

  // Lock background body scroll and listen for Escape key while modal is open
  useEffect(() => {
    if (!isOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

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
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 transition-opacity duration-200 ease-out"
    >
      <div className="w-full max-w-3xl bg-slate-900/95 backdrop-blur-md border border-slate-800/80 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Standardized h-12 Modal Header */}
        <div className="h-12 px-4 flex items-center justify-between border-b border-slate-800/80 bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shrink-0">
              <Terminal className="w-4 h-4 text-cyan-400" />
            </div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-100 truncate">
              Live LockEvent[] Trace Studio (JSON)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] transition-all cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 p-4 gap-4 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-400">
              Inject a custom cycle, edit vector clocks, or test a canonical lock-order fix:
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setRawJson(JSON.stringify(CANONICAL_SAFE_SAMPLE, null, 2));
                  setError(null);
                }}
                className="h-9 flex items-center gap-1.5 px-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                Load Cycle-Free Canonical Trace
              </button>
              <button
                type="button"
                onClick={() => {
                  setRawJson(JSON.stringify(initialEvents, null, 2));
                  setError(null);
                }}
                className="h-9 flex items-center gap-1.5 px-3 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                Reset Trace
              </button>
            </div>
          </div>

          <textarea
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            rows={14}
            className="w-full flex-1 p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 font-mono tabular-nums text-xs text-slate-100 leading-relaxed scrollbar-thin focus:outline-none focus:ring-2 focus:ring-cyan-400/70"
          />

          {error && (
            <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/40 rounded-lg px-3 py-2 font-mono break-all">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
              Press <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">Esc</kbd> or click outside to close
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-3.5 rounded-lg border border-slate-700 text-slate-300 text-xs font-medium hover:bg-slate-800 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-9 flex items-center gap-1.5 px-4 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] cursor-pointer"
              >
                <Play className="w-4 h-4" />
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
