import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileJson, Play, Terminal, X } from 'lucide-react';
import type { LockEvent } from '../../shared/types';
import { parseTraceText, SCHEMA_EXAMPLE } from '../lib/traceParser';

interface CustomTraceModalProps {
  isOpen: boolean;
  initialEvents: LockEvent[];
  onClose: () => void;
  onSubmit: (events: LockEvent[]) => void;
}

const buttonBase =
  'h-10 inline-flex items-center gap-2 px-4 rounded-xl text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none cursor-pointer';

export const CustomTraceModal: React.FC<CustomTraceModalProps> = ({ isOpen, initialEvents, onClose, onSubmit }) => {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const onCloseRef = useRef(onClose);
  const initialEventsRef = useRef(initialEvents);
  onCloseRef.current = onClose;
  initialEventsRef.current = initialEvents;

  // Initialize only when the modal opens, so parent re-renders never discard in-progress edits.
  useEffect(() => {
    if (!isOpen) return undefined;
    const events = initialEventsRef.current;
    setText(events.length > 0 ? JSON.stringify(events, null, 2) : '');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    const frame = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  const result = useMemo(() => (text.trim().length === 0 ? null : parseTraceText(text)), [text]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trace-editor-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4"
    >
      <div className="w-full max-w-3xl bg-slate-900 border border-slate-800/60 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 flex items-center justify-between border-b border-slate-800/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
              <Terminal className="w-4 h-4 text-cyan-400" aria-hidden="true" />
            </div>
            <div>
              <h2 id="trace-editor-title" className="text-sm font-bold text-slate-100">Paste a lock trace</h2>
              <p className="text-xs text-slate-400">JSON array, {'{ "events": [...] }'}, or one JSON object per line (JSONL)</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close trace editor"
            className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form
          className="flex flex-col flex-1 min-h-0 p-6 gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (result?.ok) {
              onSubmit(result.events);
              onClose();
            }
          }}
        >
          <label htmlFor="trace-editor-input" className="sr-only">Trace JSON</label>
          <textarea
            id="trace-editor-input"
            ref={textareaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            rows={16}
            placeholder='[{ "workerId": "worker-1", "resourceId": "lock-a", "action": "ACQUIRE", ... }]'
            className="w-full flex-1 min-h-[280px] p-4 rounded-xl bg-slate-950 border border-slate-800/60 font-mono text-xs text-slate-100 leading-relaxed focus:outline-none focus:ring-2 focus:ring-cyan-400/70"
          />

          <div aria-live="polite">
            {result === null ? (
              <p className="text-xs text-slate-400">Paste a trace to validate it. Nothing is analyzed until you click Analyze.</p>
            ) : result.ok ? (
              <p className="flex items-center gap-2 text-xs text-emerald-400">
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                Valid trace: {result.events.length} event(s).
              </p>
            ) : (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/40 text-xs text-rose-300 space-y-1">
                <p className="flex items-center gap-2 font-semibold">
                  <AlertCircle className="w-4 h-4" aria-hidden="true" />
                  {result.error}
                </p>
                {result.details.slice(1, 6).map((issue) => (
                  <p key={issue.field} className="font-mono pl-6">{issue.field}: {issue.message}</p>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setText(JSON.stringify(SCHEMA_EXAMPLE, null, 2))}
              className={`${buttonBase} bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200`}
            >
              <FileJson className="w-4 h-4 text-cyan-400" aria-hidden="true" />
              Insert schema example
            </button>
            <div className="flex items-center gap-3">
              <button type="button" onClick={onClose} className={`${buttonBase} border border-slate-700 text-slate-300 hover:bg-slate-800`}>
                Cancel
              </button>
              <button type="submit" disabled={!result?.ok} className={`${buttonBase} bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold`}>
                <Play className="w-4 h-4" aria-hidden="true" />
                Analyze trace
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CustomTraceModal;
