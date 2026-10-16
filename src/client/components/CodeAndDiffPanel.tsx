import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, ClipboardCheck, Code2, Copy, ListChecks, TriangleAlert } from 'lucide-react';
import type { RemediationPlan } from '../../shared/types';
import { useCopy, type CopyState } from '../lib/clipboard';

interface CodeAndDiffPanelProps {
  remediation: RemediationPlan;
}

const STRATEGY_TITLES: Record<RemediationPlan['strategy'], string> = {
  'canonical-lock-order': 'Acquire locks in one canonical order',
  'guard-shared-state': 'Guard shared state with a lock or compare-and-swap',
  'shorten-lock-hold-time': 'Shorten how long the contended resource is held',
  'none-required': 'No fix required for this trace',
};

function CopyButton({ state, label, onClick, primary = false }: { state: CopyState | undefined; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-10 inline-flex items-center gap-2 px-4 rounded-xl text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 active:scale-[0.98] cursor-pointer ${
        primary ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold' : 'bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100'
      }`}
    >
      {state === 'copied' ? <Check className="w-4 h-4" aria-hidden="true" /> : state === 'failed' ? <TriangleAlert className="w-4 h-4" aria-hidden="true" /> : primary ? <Copy className="w-4 h-4" aria-hidden="true" /> : <ClipboardCheck className="w-4 h-4" aria-hidden="true" />}
      <span aria-live="polite">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed: select the text manually' : label}</span>
    </button>
  );
}

function CodeBlock({ code, tone }: { code: string; tone: 'before' | 'after' }) {
  return (
    <div className={`rounded-xl border bg-slate-950 p-4 overflow-x-auto ${tone === 'before' ? 'border-rose-500/30' : 'border-emerald-500/30'}`}>
      <pre className={`font-mono tabular-nums text-xs leading-relaxed ${tone === 'before' ? 'text-rose-200/90' : 'text-emerald-200/95'}`}>
        {code.split(/\r?\n/).map((line, index) => (
          <div key={index} className="flex gap-4">
            <span className="text-slate-600 select-none w-6 text-right shrink-0">{index + 1}</span>
            <span className="whitespace-pre">{line}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

export const CodeAndDiffPanel: React.FC<CodeAndDiffPanelProps> = ({ remediation }) => {
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [showDiff, setShowDiff] = useState(false);
  const { state: copyState, copy } = useCopy();

  useEffect(() => {
    setChecked({});
  }, [remediation.runbookMarkdown]);

  const steps = remediation.runbookMarkdown
    .split(/\r?\n/)
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.startsWith('- [ ] '));
  const done = steps.filter(({ index }) => checked[index]).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      <section aria-labelledby="fix-title" className="bg-slate-900/50 border border-slate-800/60 rounded-2xl p-6 lg:p-8 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <p className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider">
              <Code2 className="w-4 h-4" aria-hidden="true" />
              Suggested code fix
            </p>
            <h2 id="fix-title" className="text-lg font-bold text-slate-100">{STRATEGY_TITLES[remediation.strategy]}</h2>
          </div>
          <CopyButton primary state={copyState.patched} label="Copy suggested code" onClick={() => void copy('patched', remediation.patchedCode)} />
        </div>

        <p className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-sm text-slate-200 leading-relaxed">
          {remediation.rationale}
        </p>
        <p className="text-xs text-amber-300/90">
          Generated from your trace. It shows the lock order to adopt; adapt it to your codebase and review it before applying.
        </p>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-rose-400">Before: code implicated by the trace</h3>
          <CodeBlock code={remediation.brokenCode} tone="before" />
        </div>
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-400">After: suggested pattern</h3>
          <CodeBlock code={remediation.patchedCode} tone="after" />
        </div>

        <div className="pt-2 border-t border-slate-800/60">
          <button
            type="button"
            aria-expanded={showDiff}
            onClick={() => setShowDiff((value) => !value)}
            className="flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded cursor-pointer"
          >
            {showDiff ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
            {showDiff ? 'Hide unified diff' : 'Show unified diff'}
          </button>
          {showDiff && (
            <div className="mt-3 space-y-3">
              <CopyButton state={copyState.diff} label="Copy diff" onClick={() => void copy('diff', remediation.unifiedDiff)} />
              <pre className="rounded-xl border border-slate-800/80 bg-slate-950 p-4 overflow-x-auto font-mono text-xs leading-relaxed">
                {remediation.unifiedDiff.split(/\r?\n/).map((line, index) => (
                  <div
                    key={index}
                    className={`px-2 whitespace-pre ${
                      line.startsWith('+++') || line.startsWith('---')
                        ? 'text-slate-400'
                        : line.startsWith('+')
                          ? 'text-emerald-400 bg-emerald-500/10'
                          : line.startsWith('-')
                            ? 'text-rose-400 bg-rose-500/10'
                            : 'text-cyan-400'
                    }`}
                  >
                    {line}
                  </div>
                ))}
              </pre>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="runbook-title" className="bg-slate-900/50 border border-slate-800/60 rounded-2xl p-6 lg:p-8 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <p className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider">
              <ListChecks className="w-4 h-4" aria-hidden="true" />
              Incident checklist
            </p>
            <h2 id="runbook-title" className="text-lg font-bold text-slate-100">Step-by-step recovery</h2>
          </div>
          <CopyButton state={copyState.runbook} label="Copy Markdown" onClick={() => void copy('runbook', remediation.runbookMarkdown)} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300">Progress</span>
            <span className="font-mono tabular-nums text-emerald-400">{done} of {steps.length} done</span>
          </div>
          <div className="h-2 bg-slate-950 rounded-full overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}>
            <div
              className="h-full bg-emerald-500 transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{ width: `${steps.length ? (done / steps.length) * 100 : 0}%` }}
            />
          </div>
        </div>

        <ol className="space-y-3">
          {steps.map(({ line, index }, position) => (
            <li key={index}>
              <label
                className={`flex items-start gap-3.5 p-4 rounded-xl border cursor-pointer transition-colors ${
                  checked[index] ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-950/70 border-slate-800/60 hover:border-slate-700'
                }`}
              >
                <input
                  type="checkbox"
                  checked={Boolean(checked[index])}
                  onChange={() => setChecked((previous) => ({ ...previous, [index]: !previous[index] }))}
                  className="mt-1 w-4 h-4 accent-emerald-400 shrink-0"
                />
                <span className="space-y-1 text-sm leading-relaxed">
                  <span className="block text-xs font-mono uppercase tracking-wider text-slate-400">Step {position + 1}</span>
                  <span className={checked[index] ? 'line-through text-slate-500' : 'text-slate-200'}>{line.slice(6)}</span>
                </span>
              </label>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
};

export default CodeAndDiffPanel;
