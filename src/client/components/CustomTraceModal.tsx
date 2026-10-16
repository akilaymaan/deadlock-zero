import React, { useState } from 'react';
import { Play, Terminal, X } from 'lucide-react';
import type { LockEvent } from '../../shared/types';

interface CustomTraceModalProps {
  isOpen: boolean;
  initialEvents: LockEvent[];
  onClose: () => void;
  onAnalyzeCustomTrace: (events: LockEvent[]) => void;
}

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-slate-100">
              Inject / Edit Custom LockEvent[] Trace (JSON)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 p-4 gap-3 overflow-hidden">
          <p className="text-xs text-slate-400">
            Modify lock acquisition order, inject a circular wait edge, or edit Lamport vector
            clocks below, then click <strong>Analyze Custom Trace</strong>.
          </p>
          <textarea
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            rows={14}
            className="w-full flex-1 p-3 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-slate-100 focus:outline-none focus:border-cyan-400"
          />
          {error && (
            <div className="text-xs text-red-400 bg-red-950/50 border border-red-800 rounded px-3 py-2">
              {error}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 text-xs hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              Analyze Custom Trace
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CustomTraceModal;
