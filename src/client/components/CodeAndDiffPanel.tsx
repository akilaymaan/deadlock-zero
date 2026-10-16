import React, { useState } from 'react';
import {
  AlertCircle,
  Check,
  ClipboardCheck,
  Clock,
  Code2,
  Copy,
  FileDiff,
  ListChecks,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
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
  const [diffViewMode, setDiffViewMode] = useState<'cards' | 'unified'>('cards');
  const [checkedItems, setCheckedItems] = useState<Record<number, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for headless/offline test environments without clipboard permission
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000);
  };

  const runbookLines = remediation.runbookMarkdown.split(/\r?\n/);
  const totalCheckboxes = runbookLines.filter((l) => l.startsWith('- [ ] ')).length;
  const completedCheckboxes = Object.values(checkedItems).filter(Boolean).length;

  return (
    <div className="flex flex-col h-full bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
      {/* Studio Tab Header */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-2 pt-2 gap-1">
        <div className="flex items-center gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('trace')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'trace'
                ? 'border-cyan-400 text-cyan-300 bg-slate-900/90'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            Offending Lock Trace &amp; Vector Clocks
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('diff')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'diff'
                ? 'border-emerald-400 text-emerald-300 bg-slate-900/90'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileDiff className="w-3.5 h-3.5" />
            Canonical Lock-Order Patch Diff
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('runbook')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'runbook'
                ? 'border-amber-400 text-amber-300 bg-slate-900/90'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ListChecks className="w-3.5 h-3.5" />
            3 a.m. SRE Runbook Checklist
          </button>
        </div>
      </div>

      {/* Tab Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs font-mono">
        {activeTab === 'trace' && (
          <div className="space-y-3">
            {cycles.length > 0 && (
              <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-200 space-y-1.5 shadow-inner">
                <div className="flex items-center gap-1.5 font-bold text-rose-400 uppercase tracking-wider">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  SCC Cycle Proof ({cycles[0].cycleNodes.join(' → ')})
                </div>
                <div className="text-[11px] text-rose-100/90 leading-relaxed">
                  {cycles[0].explanation}
                </div>
              </div>
            )}

            {races.length > 0 && (
              <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold text-amber-400 uppercase tracking-wider">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  Concurrent Vector Clock Conflict on {races[0].resourceId}
                </div>
                <div className="text-[11px] text-amber-100/90 leading-relaxed">
                  {races[0].explanation}
                </div>
              </div>
            )}

            <div className="space-y-2">
              {events.map((ev, index) => {
                const clockEntries = Object.entries(ev.vectorClock || {});
                const isWaitOrWrite = ev.action === 'WAIT' || ev.action === 'WRITE';
                const actionBadgeClass =
                  ev.action === 'WAIT'
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : ev.action === 'ACQUIRE'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : ev.action === 'WRITE'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';

                return (
                  <div
                    key={ev.id || index}
                    className={`p-3 rounded-xl bg-slate-950/90 border transition-colors flex flex-col gap-1.5 ${
                      isWaitOrWrite
                        ? 'border-rose-500/30 hover:border-rose-500/60'
                        : 'border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">#{index + 1}</span>
                        <span className="font-bold text-cyan-300">{ev.workerId}</span>
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${actionBadgeClass}`}>
                          {ev.action}
                        </span>
                        <span className="font-semibold text-amber-200">{ev.resourceId}</span>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
                        {ev.file}:{ev.line} · t={ev.timestamp}ms
                      </span>
                    </div>

                    <div className="px-2.5 py-1.5 rounded bg-slate-900/90 border border-slate-800/80 text-slate-200 overflow-x-auto">
                      {ev.codeSnippet}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">
                        Lamport Clock:
                      </span>
                      {clockEntries.map(([worker, tick]) => (
                        <span
                          key={worker}
                          className="px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/30 text-[10px] text-emerald-300"
                        >
                          {worker}: {tick}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'diff' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
              <span className="flex items-center gap-1.5 text-slate-300 text-[11px]">
                <Code2 className="w-3.5 h-3.5 text-emerald-400" />
                Strategy: <strong className="text-emerald-300">{remediation.strategy}</strong>
              </span>
              <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800">
                <button
                  type="button"
                  onClick={() => setDiffViewMode('cards')}
                  className={`px-2 py-1 rounded text-[10px] font-semibold cursor-pointer ${
                    diffViewMode === 'cards'
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Broken vs. Patched Cards
                </button>
                <button
                  type="button"
                  onClick={() => setDiffViewMode('unified')}
                  className={`px-2 py-1 rounded text-[10px] font-semibold cursor-pointer ${
                    diffViewMode === 'unified'
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Unified Git Diff
                </button>
              </div>
            </div>

            {diffViewMode === 'cards' ? (
              <div className="space-y-3">
                {/* Broken Code Card */}
                <div className="rounded-xl border border-rose-500/40 bg-slate-950 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-rose-950/50 border-b border-rose-500/30">
                    <span className="text-[11px] font-bold text-rose-300 uppercase tracking-wider">
                      Broken Concurrency Path (Outage Trigger)
                    </span>
                    <button
                      type="button"
                      onClick={() => copyText('broken', remediation.brokenCode)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-[10px] cursor-pointer"
                    >
                      {copiedKey === 'broken' ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" /> Copy
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="p-3 overflow-x-auto leading-relaxed text-[11px] text-rose-200/90">
                    {remediation.brokenCode.split(/\r?\n/).map((line, idx) => (
                      <div key={idx} className="flex gap-3">
                        <span className="text-slate-600 select-none w-5 text-right">{idx + 1}</span>
                        <span>{line}</span>
                      </div>
                    ))}
                  </pre>
                </div>

                {/* Patched Canonical Code Card */}
                <div className="rounded-xl border border-emerald-500/40 bg-slate-950 overflow-hidden shadow-[0_0_20px_-8px_rgba(16,185,129,0.25)]">
                  <div className="flex items-center justify-between px-3 py-2 bg-emerald-950/50 border-b border-emerald-500/30">
                    <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-300 uppercase tracking-wider">
                      <Sparkles className="w-3.5 h-3.5" />
                      Canonical Lock-Order Patch (Cycle-Free Guarantee)
                    </span>
                    <button
                      type="button"
                      onClick={() => copyText('patched', remediation.patchedCode)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 text-[10px] cursor-pointer"
                    >
                      {copiedKey === 'patched' ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" /> Copy Patch
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="p-3 overflow-x-auto leading-relaxed text-[11px] text-emerald-200/95">
                    {remediation.patchedCode.split(/\r?\n/).map((line, idx) => (
                      <div key={idx} className="flex gap-3">
                        <span className="text-slate-600 select-none w-5 text-right">{idx + 1}</span>
                        <span>{line}</span>
                      </div>
                    ))}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-slate-900/90 border-b border-slate-800">
                  <span className="text-[11px] font-semibold text-slate-300">Unified Git Diff</span>
                  <button
                    type="button"
                    onClick={() => copyText('diff', remediation.unifiedDiff)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] cursor-pointer"
                  >
                    {copiedKey === 'diff' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" /> Copy Diff
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-3 overflow-x-auto leading-relaxed text-[11px]">
                  {remediation.unifiedDiff.split(/\r?\n/).map((line, i) => {
                    const color = line.startsWith('+')
                      ? 'text-emerald-300 bg-emerald-950/35'
                      : line.startsWith('-')
                        ? 'text-rose-300 bg-rose-950/35'
                        : line.startsWith('@@')
                          ? 'text-cyan-400'
                          : 'text-slate-300';
                    return (
                      <div key={i} className={`px-1.5 rounded-xs ${color}`}>
                        {line}
                      </div>
                    );
                  })}
                </pre>
              </div>
            )}
          </div>
        )}

        {activeTab === 'runbook' && (
          <div className="space-y-3 font-sans">
            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800">
              <div className="space-y-1">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-200 block">
                  3 a.m. Incident Triage Progress ({completedCheckboxes}/{totalCheckboxes})
                </span>
                <div className="w-44 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300"
                    style={{
                      width: `${totalCheckboxes > 0 ? Math.round((completedCheckboxes / totalCheckboxes) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => copyText('runbook', remediation.runbookMarkdown)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30 text-xs font-semibold cursor-pointer"
              >
                {copiedKey === 'runbook' ? (
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
                      className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        checked
                          ? 'bg-emerald-950/20 border-emerald-500/30 text-slate-400'
                          : 'bg-slate-950/90 border-slate-800 hover:border-slate-700 text-slate-200'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setCheckedItems((prev) => ({ ...prev, [idx]: !prev[idx] }))
                        }
                        className="mt-0.5 accent-emerald-400"
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
                    <h4
                      key={idx}
                      className="text-xs font-bold uppercase tracking-wider text-amber-300 pt-2"
                    >
                      {line.replace('## ', '')}
                    </h4>
                  );
                }
                return line.trim() ? (
                  <p key={idx} className="text-slate-400 text-[11px]">
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
