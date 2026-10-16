import React, { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Code2,
  Copy,
  ListChecks,
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
  const [checkedItems, setCheckedItems] = useState<Record<number, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showRawDiff, setShowRawDiff] = useState(false);

  useEffect(() => {
    setCheckedItems({});
  }, [events, remediation.unifiedDiff]);

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for headless/offline test environments
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000);
  };

  const runbookLines = remediation.runbookMarkdown.split(/\r?\n/);
  const checklistSteps = runbookLines
    .map((line, index) => ({ line, index }))
    .filter((item) => item.line.startsWith('- [ ] '));
  const completedCount = Object.values(checkedItems).filter(Boolean).length;

  const whyFixWorksText =
    cycles.length > 0
      ? 'Why this fix works: Sorting lock IDs into a single canonical order ensures every worker acquires locks in the exact same sequence, making circular wait deadlocks mathematically impossible.'
      : races.length > 0
        ? 'Why this fix works: Wrapping concurrent read-modify-write operations in a scoped mutex or atomic version check prevents two workers from overwriting each other.'
        : 'Why this fix works: Acquiring locks in a consistent, bounded hierarchy keeps the execution graph cycle-free under high concurrency.';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      {/* Left Card: Automated Code Fix (Before vs. After) */}
      <section className="bg-slate-900/50 border border-slate-800/60 rounded-2xl p-6 lg:p-8 space-y-6 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider">
              <Code2 className="w-4 h-4" />
              Automated Code Fix (Before vs. After)
            </div>
            <h2 className="text-lg font-bold text-slate-100">
              Enforce Canonical Lock Ordering
            </h2>
          </div>

          <button
            type="button"
            onClick={() => copyText('patched', remediation.patchedCode)}
            className="h-10 flex items-center gap-2 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 active:scale-[0.98] cursor-pointer"
          >
            {copiedKey === 'patched' ? (
              <>
                <Check className="w-4 h-4" />
                Copied Fixed Code!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copy Fixed Code
              </>
            )}
          </button>
        </div>

        {/* Plain-English 1-Sentence Explanation */}
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-sm text-slate-200 leading-relaxed">
          {whyFixWorksText}
        </div>

        {/* Before (Broken Code) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-rose-400">
              Before — Broken Code (Causes Lockup)
            </span>
          </div>
          <div className="rounded-xl border border-rose-500/30 bg-slate-950 p-4 overflow-x-auto">
            <pre className="font-mono tabular-nums text-xs leading-relaxed text-rose-200/90 space-y-1">
              {remediation.brokenCode.split(/\r?\n/).map((line, idx) => (
                <div key={idx} className="flex gap-4">
                  <span className="text-slate-600 select-none w-5 text-right shrink-0">
                    {idx + 1}
                  </span>
                  <span className="whitespace-pre">{line}</span>
                </div>
              ))}
            </pre>
          </div>
        </div>

        {/* After (Patched Canonical Code) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-400">
              <Sparkles className="w-3.5 h-3.5" />
              After — Recommended Fix (Deadlock-Free)
            </span>
          </div>
          <div className="rounded-xl border border-emerald-500/30 bg-slate-950 p-4 overflow-x-auto">
            <pre className="font-mono tabular-nums text-xs leading-relaxed text-emerald-200/95 space-y-1">
              {remediation.patchedCode.split(/\r?\n/).map((line, idx) => (
                <div key={idx} className="flex gap-4">
                  <span className="text-slate-600 select-none w-5 text-right shrink-0">
                    {idx + 1}
                  </span>
                  <span className="whitespace-pre">{line}</span>
                </div>
              ))}
            </pre>
          </div>
        </div>

        {/* Progressive Disclosure: Optional Unified Git Diff */}
        <div className="pt-2 border-t border-slate-800/60">
          <button
            type="button"
            onClick={() => setShowRawDiff((prev) => !prev)}
            className="flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
          >
            {showRawDiff ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {showRawDiff ? 'Hide Unified Git Diff' : 'Show Unified Git Diff Patch'}
          </button>

          {showRawDiff && (
            <div className="mt-3 rounded-xl border border-slate-800/80 bg-slate-950 p-4 overflow-x-auto">
              <pre className="font-mono tabular-nums text-xs leading-relaxed space-y-0.5">
                {remediation.unifiedDiff.split(/\r?\n/).map((line, i) => {
                  const color = line.startsWith('+')
                    ? 'text-emerald-400 bg-emerald-500/10'
                    : line.startsWith('-')
                      ? 'text-rose-400 bg-rose-500/10'
                      : line.startsWith('@@')
                        ? 'text-cyan-400'
                        : 'text-slate-300';
                  return (
                    <div key={i} className={`px-2 py-0.5 rounded-xs whitespace-pre ${color}`}>
                      {line}
                    </div>
                  );
                })}
              </pre>
            </div>
          )}
        </div>
      </section>

      {/* Right Card: Emergency Incident Checklist */}
      <section className="bg-slate-900/50 border border-slate-800/60 rounded-2xl p-6 lg:p-8 space-y-6 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider">
              <ListChecks className="w-4 h-4" />
              Emergency Incident Checklist
            </div>
            <h2 className="text-lg font-bold text-slate-100">
              Step-by-Step Recovery Runbook
            </h2>
          </div>

          <button
            type="button"
            onClick={() => copyText('runbook', remediation.runbookMarkdown)}
            className="h-10 flex items-center gap-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-semibold text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 active:scale-[0.98] cursor-pointer"
          >
            {copiedKey === 'runbook' ? (
              <>
                <Check className="w-4 h-4 text-emerald-400" />
                Copied Markdown!
              </>
            ) : (
              <>
                <ClipboardCheck className="w-4 h-4 text-cyan-400" />
                Copy Markdown
              </>
            )}
          </button>
        </div>

        {/* Progress Bar */}
        <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/60 flex items-center justify-between gap-4">
          <div className="space-y-1 flex-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300">Runbook Completion</span>
              <span className="font-mono tabular-nums font-bold text-emerald-400">
                {completedCount} of {checklistSteps.length} steps completed
              </span>
            </div>
            <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{
                  width: `${
                    checklistSteps.length > 0
                      ? Math.round((completedCount / checklistSteps.length) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        </div>

        {/* Interactive Step-by-Step Cards */}
        <div className="space-y-3">
          {checklistSteps.map(({ line, index }, stepIdx) => {
            const text = line.replace('- [ ] ', '');
            const checked = !!checkedItems[index];
            return (
              <label
                key={index}
                className={`flex items-start gap-3.5 p-4 rounded-xl border cursor-pointer transition-all ${
                  checked
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-slate-400'
                    : 'bg-slate-950/70 border-slate-800/60 hover:border-slate-700 text-slate-100'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    setCheckedItems((prev) => ({ ...prev, [index]: !prev[index] }))
                  }
                  className="mt-1 w-4 h-4 accent-emerald-400 shrink-0"
                />
                <div className="space-y-1 text-sm leading-relaxed">
                  <span className="text-xs font-mono uppercase tracking-wider text-slate-400 block">
                    Step {stepIdx + 1}
                  </span>
                  <span className={checked ? 'line-through text-slate-500' : 'text-slate-200'}>
                    {text}
                  </span>
                </div>
              </label>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default CodeAndDiffPanel;
