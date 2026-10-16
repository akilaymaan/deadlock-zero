import React, { useState } from 'react';
import { Check, ClipboardCheck, Code2, FileDiff, ListChecks, Clock } from 'lucide-react';
import type { DeadlockCycle, LockEvent, RaceConflict, RemediationPlan } from '../../shared/types';

interface CodeAndDiffPanelProps {
  events: LockEvent[];
  cycles: DeadlockCycle[];
  races: RaceConflict[];
  remediation: RemediationPlan;
}

export const CodeAndDiffPanel: React.FC<CodeAndDiffPanelProps> = ({
  events,
  cycles,
  races,
  remediation,
}) => {
  const [activeTab, setActiveTab] = useState<'trace' | 'diff' | 'runbook'>('trace');
  const [checkedItems, setCheckedItems] = useState<Record<number, boolean>>({});
  const [copied, setCopied] = useState(false);

  const handleCopyRunbook = async () => {
    try {
      await navigator.clipboard.writeText(remediation.runbookMarkdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const runbookLines = remediation.runbookMarkdown.split(/\r?\n/);

  return (
    <div className="flex flex-col h-full bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
      <div className="flex items-center border-b border-slate-800 bg-slate-950/60 px-2 pt-2 gap-1">
        <button
          type="button"
          onClick={() => setActiveTab('trace')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors ${
            activeTab === 'trace'
              ? 'border-cyan-400 text-cyan-300 bg-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          Offending Lock Trace &amp; Vector Clocks
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('diff')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors ${
            activeTab === 'diff'
              ? 'border-cyan-400 text-cyan-300 bg-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileDiff className="w-3.5 h-3.5" />
          Canonical Lock-Order Patch Diff
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('runbook')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors ${
            activeTab === 'runbook'
              ? 'border-cyan-400 text-cyan-300 bg-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <ListChecks className="w-3.5 h-3.5" />
          3 a.m. SRE Runbook Checklist
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs font-mono">
        {activeTab === 'trace' && (
          <div className="space-y-3">
            {cycles.length > 0 && (
              <div className="p-3 rounded-lg bg-red-950/50 border border-red-800/70 text-red-200 space-y-1">
                <div className="font-bold text-red-400 uppercase">
                  SCC Cycle Proof ({cycles[0].cycleNodes.join(' -> ')})
                </div>
                <div>{cycles[0].explanation}</div>
              </div>
            )}

            {races.length > 0 && (
              <div className="p-3 rounded-lg bg-amber-950/50 border border-amber-800/70 text-amber-200 space-y-1">
                <div className="font-bold text-amber-400 uppercase">
                  Concurrent Vector Clock Conflict on {races[0].resourceId}
                </div>
                <div>{races[0].explanation}</div>
              </div>
            )}

            <div className="space-y-2">
              {events.map((ev) => {
                const clockStr = Object.entries(ev.vectorClock || {})
                  .map(([k, v]) => `${k}:${v}`)
                  .join(', ');
                return (
                  <div
                    key={ev.id}
                    className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex flex-col gap-1"
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-cyan-300">
                        {ev.workerId}{' '}
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-300">
                          {ev.action}
                        </span>{' '}
                        {ev.resourceId}
                      </span>
                      <span className="text-slate-400">
                        {ev.file}:{ev.line} @ t={ev.timestamp}ms
                      </span>
                    </div>
                    <div className="text-slate-300 truncate">{ev.codeSnippet}</div>
                    <div className="text-[10px] text-emerald-400">
                      VectorClock: [{clockStr}]
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'diff' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-slate-400 text-[11px]">
              <span className="flex items-center gap-1.5">
                <Code2 className="w-3.5 h-3.5 text-cyan-400" />
                Strategy: <strong className="text-slate-200">{remediation.strategy}</strong>
              </span>
            </div>
            <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 overflow-x-auto leading-relaxed">
              {remediation.unifiedDiff.split(/\r?\n/).map((line, i) => {
                const color = line.startsWith('+')
                  ? 'text-emerald-400 bg-emerald-950/30'
                  : line.startsWith('-')
                    ? 'text-red-400 bg-red-950/30'
                    : line.startsWith('@@')
                      ? 'text-cyan-400'
                      : 'text-slate-300';
                return (
                  <div key={i} className={`px-1 ${color}`}>
                    {line}
                  </div>
                );
              })}
            </pre>
          </div>
        )}

        {activeTab === 'runbook' && (
          <div className="space-y-3 font-sans">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Interactive Incident Triage Checklist
              </span>
              <button
                type="button"
                onClick={handleCopyRunbook}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30 text-xs font-medium"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    Copied!
                  </>
                ) : (
                  <>
                    <ClipboardCheck className="w-3.5 h-3.5" />
                    Copy Runbook Markdown
                  </>
                )}
              </button>
            </div>
            <div className="space-y-1.5 text-xs text-slate-200">
              {runbookLines.map((line, idx) => {
                if (line.startsWith('- [ ] ')) {
                  const text = line.replace('- [ ] ', '');
                  const checked = !!checkedItems[idx];
                  return (
                    <label
                      key={idx}
                      className="flex items-start gap-2 p-2 rounded bg-slate-950/80 border border-slate-800 cursor-pointer hover:border-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setCheckedItems((prev) => ({ ...prev, [idx]: !prev[idx] }))
                        }
                        className="mt-0.5 accent-cyan-400"
                      />
                      <span className={checked ? 'line-through text-slate-500' : 'text-slate-200'}>
                        {text}
                      </span>
                    </label>
                  );
                }
                if (line.startsWith('# ')) {
                  return (
                    <h3 key={idx} className="text-sm font-bold text-cyan-300 pt-1">
                      {line.replace('# ', '')}
                    </h3>
                  );
                }
                if (line.startsWith('## ')) {
                  return (
                    <h4 key={idx} className="text-xs font-semibold uppercase tracking-wider text-amber-300 pt-2">
                      {line.replace('## ', '')}
                    </h4>
                  );
                }
                return line.trim() ? (
                  <p key={idx} className="text-slate-400">
                    {line}
                  </p>
                ) : null;
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CodeAndDiffPanel;
