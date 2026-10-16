import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileJson,
  Play,
  RotateCcw,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import type { LockAction, LockEvent } from '../../shared/types';

interface CustomTraceModalProps {
  isOpen: boolean;
  initialEvents: LockEvent[];
  onClose: () => void;
  onAnalyzeCustomTrace: (events: LockEvent[], label?: string) => void;
}

const VALID_ACTIONS = new Set<LockAction>(['ACQUIRE', 'WAIT', 'RELEASE', 'READ', 'WRITE']);

export const SAMPLE_SCHEMA_TEMPLATE: LockEvent[] = [
  {
    id: 'evt-1',
    workerId: 'Worker_1',
    resourceId: 'Lock_A',
    action: 'ACQUIRE',
    timestamp: 1001,
    vectorClock: { Worker_1: 1, Worker_2: 0 },
    file: 'src/services/ledger.ts',
    line: 41,
    codeSnippet: 'await tx.acquireRowLock(fromAccountId);',
  },
  {
    id: 'evt-2',
    workerId: 'Worker_2',
    resourceId: 'Lock_B',
    action: 'ACQUIRE',
    timestamp: 1004,
    vectorClock: { Worker_1: 0, Worker_2: 1 },
    file: 'src/services/ledger.ts',
    line: 42,
    codeSnippet: 'await tx.acquireRowLock(fromAccountId);',
  },
  {
    id: 'evt-3',
    workerId: 'Worker_1',
    resourceId: 'Lock_B',
    action: 'WAIT',
    timestamp: 1012,
    vectorClock: { Worker_1: 2, Worker_2: 0 },
    file: 'src/services/ledger.ts',
    line: 48,
    codeSnippet: 'await tx.acquireRowLock(toAccountId);',
  },
  {
    id: 'evt-4',
    workerId: 'Worker_2',
    resourceId: 'Lock_A',
    action: 'WAIT',
    timestamp: 1015,
    vectorClock: { Worker_1: 0, Worker_2: 2 },
    file: 'src/services/ledger.ts',
    line: 49,
    codeSnippet: 'await tx.acquireRowLock(toAccountId);',
  },
];

export function parseAndValidateTraceText(rawText: string): {
  events: LockEvent[] | null;
  error: string | null;
} {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { events: null, error: 'Trace input is empty. Provide a JSON array or .jsonl lines.' };
  }

  let rawItems: unknown[];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      rawItems = parsed;
    } else if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as { events?: unknown }).events)
    ) {
      rawItems = (parsed as { events: unknown[] }).events;
    } else {
      return {
        events: null,
        error: 'JSON root must be an array of LockEvent objects or { "events": [...] }.',
      };
    }
  } catch {
    // Attempt .jsonl (newline-delimited JSON) parsing
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    try {
      rawItems = lines.map((line, idx) => {
        try {
          return JSON.parse(line);
        } catch {
          throw new Error(`Invalid JSON on line ${idx + 1}.`);
        }
      });
    } catch (lineErr) {
      return {
        events: null,
        error: lineErr instanceof Error ? lineErr.message : 'Malformed JSON / JSONL syntax.',
      };
    }
  }

  if (rawItems.length === 0) {
    return { events: null, error: 'Trace must contain at least one LockEvent object.' };
  }

  const normalized: LockEvent[] = [];
  for (let i = 0; i < rawItems.length; i += 1) {
    const item = rawItems[i];
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return { events: null, error: `events[${i}] must be a JSON object.` };
    }
    const rec = item as Record<string, unknown>;
    const workerId = typeof rec.workerId === 'string' ? rec.workerId.trim() : '';
    const resourceId = typeof rec.resourceId === 'string' ? rec.resourceId.trim() : '';
    const actionRaw = typeof rec.action === 'string' ? rec.action.trim().toUpperCase() : '';

    if (!workerId) {
      return { events: null, error: `events[${i}].workerId is required (non-empty string).` };
    }
    if (!resourceId) {
      return { events: null, error: `events[${i}].resourceId is required (non-empty string).` };
    }
    if (!VALID_ACTIONS.has(actionRaw as LockAction)) {
      return {
        events: null,
        error: `events[${i}].action must be one of ACQUIRE, WAIT, RELEASE, READ, or WRITE.`,
      };
    }

    const timestamp =
      typeof rec.timestamp === 'number' && Number.isFinite(rec.timestamp) ? rec.timestamp : i + 1;
    const file =
      typeof rec.file === 'string' && rec.file.trim().length > 0 ? rec.file.trim() : 'trace.ts';
    const line =
      typeof rec.line === 'number' && Number.isInteger(rec.line) && rec.line >= 1 ? rec.line : 1;
    const codeSnippet =
      typeof rec.codeSnippet === 'string' && rec.codeSnippet.trim().length > 0
        ? rec.codeSnippet
        : `${actionRaw} ${resourceId}`;
    const id =
      typeof rec.id === 'string' && rec.id.trim().length > 0 ? rec.id.trim() : `evt-${i + 1}`;

    const vectorClock: Record<string, number> = {};
    if (rec.vectorClock !== undefined) {
      if (typeof rec.vectorClock !== 'object' || rec.vectorClock === null || Array.isArray(rec.vectorClock)) {
        return {
          events: null,
          error: `events[${i}].vectorClock must be an object mapping worker IDs to integer ticks.`,
        };
      }
      for (const [k, v] of Object.entries(rec.vectorClock as Record<string, unknown>)) {
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
          return {
            events: null,
            error: `events[${i}].vectorClock.${k} must be a non-negative integer.`,
          };
        }
        vectorClock[k] = v;
      }
    }

    normalized.push({
      id,
      workerId,
      resourceId,
      action: actionRaw as LockAction,
      timestamp,
      vectorClock,
      file,
      line,
      codeSnippet,
    });
  }

  return { events: normalized, error: null };
}

export const CustomTraceModal: React.FC<CustomTraceModalProps> = ({
  isOpen,
  initialEvents,
  onClose,
  onAnalyzeCustomTrace,
}) => {
  const [rawJson, setRawJson] = useState(() =>
    JSON.stringify(initialEvents.length > 0 ? initialEvents : SAMPLE_SCHEMA_TEMPLATE, null, 2),
  );

  useEffect(() => {
    if (isOpen) {
      setRawJson(
        JSON.stringify(initialEvents.length > 0 ? initialEvents : SAMPLE_SCHEMA_TEMPLATE, null, 2),
      );
    }
  }, [initialEvents, isOpen]);

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

  const liveValidation = useMemo(() => parseAndValidateTraceText(rawJson), [rawJson]);

  if (!isOpen) return null;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!liveValidation.events) return;
    onAnalyzeCustomTrace(liveValidation.events, 'Edited JSON Trace');
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ingest Lock Trace Editor"
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
              Ingest LockEvent[] Trace (JSON / JSONL Schema Editor)
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
              Paste a JSON array, <code className="text-cyan-300 font-mono">{`{ "events": [...] }`}</code>, or newline-delimited <code className="text-cyan-300 font-mono">.jsonl</code> records:
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRawJson(JSON.stringify(SAMPLE_SCHEMA_TEMPLATE, null, 2))}
                className="h-9 flex items-center gap-1.5 px-3 rounded-lg bg-slate-800/90 border border-slate-700 text-slate-200 hover:bg-slate-700 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] cursor-pointer"
              >
                <FileJson className="w-4 h-4 text-cyan-400" />
                Load Sample Schema Template
              </button>
              {initialEvents.length > 0 && (
                <button
                  type="button"
                  onClick={() => setRawJson(JSON.stringify(initialEvents, null, 2))}
                  className="h-9 flex items-center gap-1.5 px-3 rounded-lg bg-slate-800/90 border border-slate-700 text-slate-300 hover:bg-slate-700 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  Revert
                </button>
              )}
            </div>
          </div>

          <textarea
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            rows={14}
            className="w-full flex-1 p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 font-mono tabular-nums text-xs text-slate-100 leading-relaxed scrollbar-thin focus:outline-none focus:ring-2 focus:ring-cyan-400/70"
          />

          {/* Live Schema Validation Banner */}
          {liveValidation.error ? (
            <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/40 rounded-lg px-3 py-2 font-mono break-all">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Schema Validation Error: {liveValidation.error}</span>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 font-mono tabular-nums">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Valid LockEvent[] Schema — {liveValidation.events?.length ?? 0} event(s) ready for analysis
              </span>
              <span className="text-[10px] text-emerald-300/80 uppercase">Schema OK</span>
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
                disabled={Boolean(liveValidation.error)}
                className="h-9 flex items-center gap-1.5 px-4 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
              >
                <Play className="w-4 h-4" />
                Analyze Trace
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CustomTraceModal;
