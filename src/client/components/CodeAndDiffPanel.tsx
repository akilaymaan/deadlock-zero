import React, { useEffect, useRef, useState } from 'react';
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

type TabKey = 'trace' | 'diff' | 'runbook';

export const CodeAndDiffPanel: React.FC<CodeAndDiffPanelProps> = ({
  events,
  cycles,
  races,
  remediation,
}) => {
  const [activeTab, setActiveTab] = useState<TabKey>('trace');
  const [diffViewMode, setDiffViewMode] = useState<'cards' | 'unified'>('cards');
  const [checkedItems, setCheckedItems] = useState<Record<number, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollPositionsRef = useRef<Record<TabKey, number>>({
    trace: 0,
    diff: 0,
    runbook: 0,
  });

  // Reset stale checklist and scroll state when switching scenarios/traces
  useEffect(() => {
    setCheckedItems({});
    scrollPositionsRef.current = { trace: 0, diff: 0, runbook: 0 };
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [events, remediation.unifiedDiff]);

  const handleTabChange = (nextTab: TabKey) => {
    if (scrollContainerRef.current) {
      scrollPositionsRef.current[activeTab] = scrollContainerRef.current.scrollTop;
    }
    setActiveTab(nextTab);
    requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollPositionsRef.current[nextTab] ?? 0;
      }
    });
  };

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for offline/headless environments without clipboard permission
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000);
  };

  const runbookLines = remediation.runbookMarkdown.split(/\r?\n/);
  const totalCheckboxes = runbookLines.filter((l) => l.startsWith('- [ ] ')).length;
  const completedCheckboxes = Object.values(checkedItems).filter(Boolean).length;

  return (
    <div className="flex flex-col h-full bg-slate-900/75 backdrop-blur-md border border-slate-800/80 rounded-xl shadow-xl overflow-hidden">
      {/* Standardized h-12 Tab Header */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-slate-800/80 bg-slate-950/60 shrink-0 overflow-x-auto scrollbar-thin">
        <div className="flex items-center h-full gap-1">
          <button
            type="button"
            onClick={() => handleTabChange('trace')}
            className={`h-full flex items-center gap-1.5 px-3 text-xs font-semibold border-b-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 cursor-pointer whitespace-nowrap ${
              activeTab === 'trace'
                ? 'border-cyan-400 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="w-4 h-4 shrink-0" />
            Offending Lock Trace &amp; Vector Clocks
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('diff')}
            className={`h-full flex items-center gap-1.5 px-3 text-xs font-semibold border-b-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 cursor-pointer whitespace-nowrap ${
              activeTab === 'diff'
                ? 'border-cyan-400 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileDiff className="w-4 h-4 shrink-0" />
            Canonical Lock-Order Patch Diff
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('runbook')}
            className={`h-full flex items-center gap-1.5 px-3 text-xs font-semibold border-b-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 cursor-pointer whitespace-nowrap ${
              activeTab === 'runbook'
                ? 'border-cyan-400 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ListChecks className="w-4 h-4 shrink-0" />
            3 a.m. SRE Runbook Checklist
          </button>
        </div>
      </div>

      {/* Scroll-Preserved Tab Content Body */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3 text-xs font-mono tabular-nums"
      >
        {activeTab === 'trace' && (
          <div className="space-y-3">
            {cycles.length > 0 && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-400 space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span className="truncate">
                    SCC Cycle Proof ({cycles[0].cycleNodes.join(' → ')})
                  </span>
                </div>
                <div className="text-[11px] text-slate-200 leading-relaxed break-words">
                  {cycles[0].explanation}
                </div>
              </div>
            )}

            {races.length > 0 && (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="truncate">
                    Concurrent Vector Clock Conflict on {races[0].resourceId}
                  </span>
                </div>
                <div className="text-[11px] text-slate-200 leading-relaxed break-words">
                  {races[0].explanation}
                </div>
              </div>
            )}

            <div className="space-y-2.5">
              {events.map((ev, index) => {
                const clockEntries = Object.entries(ev.vectorClock || {});
                const actionBadgeClass =
                  ev.action === 'WAIT'
                    ? 'bg-rose-500/10 text-rose-400 border-rose-500/40'
                    : ev.action === 'ACQUIRE'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : ev.action === 'WRITE'
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30';

                return (
                  <div
                    key={`${ev.id}-${index}`}
                    className={`p-3 rounded-xl bg-slate-950/80 border transition-colors flex flex-col gap-2 ${
                      ev.action === 'WAIT'
                        ? 'border-rose-500/40'
                        : ev.action === 'WRITE'
                          ? 'border-amber-500/30'
                          : 'border-slate-800/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-slate-500">#{index + 1}</span>
                        <span className="font-bold text-cyan-300 truncate">{ev.workerId}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded border text-[10px] font-bold shrink-0 ${actionBadgeClass}`}
                        >
                          {ev.action}
                        </span>
                        <span className="font-semibold text-amber-300 truncate">
                          {ev.resourceId}
                        </span>
                      </div>
                      <span
                        title={`${ev.file}:${ev.line}`}
                        className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800/80 text-slate-300 truncate max-w-[240px]"
                      >
                        {ev.file}:{ev.line} · t={ev.timestamp}ms
                      </span>
                    </div>

                    <div className="px-2.5 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800/80 text-slate-200 truncate">
                      {ev.codeSnippet}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">
                        Lamport Clock:
                      </span>
                      {clockEntries.map(([worker, tick]) => (
                        <span
                          key={worker}
                          className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-[10px] text-emerald-400"
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-slate-300 text-[11px] min-w-0">
                <Code2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="truncate">
                  Strategy: <strong className="text-emerald-400">{remediation.strategy}</strong>
                </span>
              </span>
              <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800/80">
                <button
                  type="button"
                  onClick={() => setDiffViewMode('cards')}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] cursor-pointer ${
                    diffViewMode === 'cards'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Broken vs. Patched Cards
                </button>
                <button
                  type="button"
                  onClick={() => setDiffViewMode('unified')}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] cursor-pointer ${
                    diffViewMode === 'unified'
                      ? 'bg-slate-800 text-white'
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
                  <div className="flex items-center justify-between px-3.5 py-2 bg-rose-500/10 border-b border-rose-500/40">
                    <span className="text-[11px] font-bold text-rose-400 uppercase tracking-wider truncate">
                      Broken Concurrency Path (Outage Trigger)
                    </span>
                    <button
                      type="button"
                      onClick={() => copyText('broken', remediation.brokenCode)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-[10px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] cursor-pointer shrink-0"
                    >
                      {copiedKey === 'broken' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" /> Copy
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="p-3 overflow-x-auto scrollbar-thin leading-relaxed text-[11px] text-rose-200/90">
                    {remediation.brokenCode.split(/\r?\n/).map((line, idx) => (
                      <div key={idx} className="flex gap-3">
                        <span className="text-slate-600 select-none w-5 text-right shrink-0">
                          {idx + 1}
                        </span>
                        <span className="whitespace-pre">{line}</span>
                      </div>
                    ))}
                  </pre>
                </div>

                {/* Patched Canonical Code Card */}
                <div className="rounded-xl border border-emerald-500/30 bg-slate-950 overflow-hidden">
                  <div className="flex items-center justify-between px-3.5 py-2 bg-emerald-500/10 border-b border-emerald-500/30">
                    <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400 uppercase tracking-wider truncate">
                      <Sparkles className="w-4 h-4 shrink-0" />
                      Canonical Lock-Order Patch (Cycle-Free Guarantee)
                    </span>
                    <button
                      type="button"
                      onClick={() => copyText('patched', remediation.patchedCode)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-[10px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] cursor-pointer shrink-0"
                    >
                      {copiedKey === 'patched' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" /> Copy Patch
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="p-3 overflow-x-auto scrollbar-thin leading-relaxed text-[11px] text-emerald-200/95">
                    {remediation.patchedCode.split(/\r?\n/).map((line, idx) => (
                      <div key={idx} className="flex gap-3">
                        <span className="text-slate-600 select-none w-5 text-right shrink-0">
                          {idx + 1}
                        </span>
                        <span className="whitespace-pre">{line}</span>
                      </div>
                    ))}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-800/80 bg-slate-950 overflow-hidden">
                <div className="flex items-center justify-between px-3.5 py-2 bg-slate-900/90 border-b border-slate-800/80">
                  <span className="text-[11px] font-semibold text-slate-300">Unified Git Diff</span>
                  <button
                    type="button"
                    onClick={() => copyText('diff', remediation.unifiedDiff)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] cursor-pointer"
                  >
                    {copiedKey === 'diff' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" /> Copy Diff
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-3 overflow-x-auto scrollbar-thin leading-relaxed text-[11px]">
                  {remediation.unifiedDiff.split(/\r?\n/).map((line, i) => {
                    const color = line.startsWith('+')
                      ? 'text-emerald-400 bg-emerald-500/10'
                      : line.startsWith('-')
                        ? 'text-rose-400 bg-rose-500/10'
                        : line.startsWith('@@')
                          ? 'text-cyan-400'
                          : 'text-slate-300';
                    return (
                      <div key={i} className={`px-1.5 rounded-xs whitespace-pre ${color}`}>
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
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-950/90 border border-slate-800/80">
              <div className="space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-200 block font-mono tabular-nums">
                  3 a.m. Incident Triage Progress ({completedCheckboxes}/{totalCheckboxes})
                </span>
                <div className="w-48 h-1.5 bg-slate-900 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                    style={{
                      width: `${
                        totalCheckboxes > 0
                          ? Math.round((completedCheckboxes / totalCheckboxes) * 100)
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => copyText('runbook', remediation.runbookMarkdown)}
                className="h-9 flex items-center gap-1.5 px-3 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:scale-[0.98] cursor-pointer"
              >
                {copiedKey === 'runbook' ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    Copied!
                  </>
                ) : (
                  <>
                    <ClipboardCheck className="w-4 h-4" />
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
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-slate-400'
                          : 'bg-slate-950/80 border-slate-800/80 hover:border-slate-700 text-slate-200'
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
                      <span
                        className={`break-words ${
                          checked ? 'line-through text-slate-500' : 'text-slate-200'
                        }`}
                      >
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
                      className="text-xs font-bold uppercase tracking-wider text-amber-400 pt-2"
                    >
                      {line.replace('## ', '')}
                    </h4>
                  );
                }
                return line.trim() ? (
                  <p key={idx} className="text-slate-400 text-[11px] break-words">
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
