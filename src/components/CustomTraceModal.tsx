import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import './CustomTraceModal.css';

/** The payload sent to an integration that forwards the trace to `/api/analyze`. */
export interface CustomTraceRequest {
  readonly trace: string;
}

/** A submitter may return an API response, a promise, or nothing at all. */
export type CustomTraceSubmitHandler<TResult = unknown> = (
  request: CustomTraceRequest,
) => TResult | Promise<TResult>;

export interface CustomTraceModalProps {
  /** Render the modal when true. The parent owns the open/closed state. */
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSubmit: CustomTraceSubmitHandler;
  /** Text to place in the editor each time the modal opens. */
  readonly initialValue?: string;
  /** An error returned by the integration, displayed alongside local validation. */
  readonly submitError?: string | null;
  /** Lets an integration keep the submit button busy while it owns the request. */
  readonly isSubmitting?: boolean;
  readonly title?: string;
  readonly description?: string;
  readonly className?: string;
}

export const DEMO_TRACE_INPUT = [
  '{"kind":"acquire","threadId":"worker-a","lockId":"ledger-entry","observedAt":1}',
  '{"kind":"acquire","threadId":"worker-b","lockId":"account-balance","observedAt":2}',
  '{"kind":"wait","threadId":"worker-a","holderId":"worker-b","lockId":"account-balance","observedAt":3}',
  '{"kind":"wait","threadId":"worker-b","holderId":"worker-a","lockId":"ledger-entry","observedAt":4}',
].join('\n');

const TRACE_COLLECTION_FIELDS = [
  'events',
  'traceEvents',
  'lockEvents',
  'lockTrace',
  'logs',
  'accesses',
  'memoryAccesses',
  'synchronization',
  'synchronizationEvents',
  'syncEvents',
  'poolSamples',
  'poolEvents',
] as const;

const TRACE_OPERATION_FIELDS = [
  'operation',
  'op',
  'event',
  'eventType',
  'kind',
  'type',
  'action',
  'mode',
  'access',
  'accessType',
] as const;

const LOG_EVENT_PATTERN = /\b(acquire|acquired|release|released|unlock|wait|waiting|blocked|request|contended)\b/i;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasTraceEventShape(value: unknown, depth = 0): boolean {
  if (depth > 4) return false;
  if (Array.isArray(value)) return value.some((item) => hasTraceEventShape(item, depth + 1));
  if (!isRecord(value)) return false;

  if (TRACE_OPERATION_FIELDS.some((field) => value[field] !== undefined)) return true;
  return TRACE_COLLECTION_FIELDS.some((field) => value[field] !== undefined && hasTraceEventShape(value[field], depth + 1));
}

/**
 * Validate the two formats accepted by the server: JSON event collections or
 * newline-delimited lock log lines. A null return means the input is ready to
 * submit.
 */
export function validateCustomTrace(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Paste at least one lock event before submitting.';

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!hasTraceEventShape(parsed)) {
      return 'JSON must contain at least one lock event with an operation or event collection.';
    }
    return null;
  } catch {
    const logLines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (logLines.some((line) => LOG_EVENT_PATTERN.test(line))) return null;
    return 'Use a JSON event array/object or newline-delimited acquire, wait, release, or unlock log lines.';
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return 'The trace could not be submitted. Check the input and try again.';
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  );
}

export function CustomTraceModal({
  open,
  onClose,
  onSubmit,
  initialValue = DEMO_TRACE_INPUT,
  submitError,
  isSubmitting = false,
  title = 'Custom Trace Input',
  description = 'Paste lock-event JSON or newline-delimited logs to send them to the concurrency analyzer.',
  className,
}: CustomTraceModalProps) {
  const [draft, setDraft] = useState(initialValue);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastActiveElement = useRef<HTMLElement | null>(null);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const dialogId = `${id}-dialog`;
  const descriptionId = `${id}-description`;
  const feedbackId = `${id}-feedback`;
  const editorId = `${id}-editor`;
  const busy = submitting || isSubmitting;
  const feedback = validationError ?? submitError ?? null;

  useEffect(() => {
    if (!open) return undefined;

    setDraft(initialValue);
    setValidationError(null);
    lastActiveElement.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => textareaRef.current?.focus(), 0);

    return () => {
      window.clearTimeout(focusTimer);
      lastActiveElement.current?.focus();
      lastActiveElement.current = null;
    };
  }, [initialValue, open]);

  useEffect(() => {
    if (!open) return undefined;

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [busy, onClose, open]);

  if (!open) return null;

  const submit = async (): Promise<void> => {
    const localError = validateCustomTrace(draft);
    if (localError !== null) {
      setValidationError(localError);
      return;
    }

    setValidationError(null);
    setSubmitting(true);
    try {
      await onSubmit({ trace: draft.trim() });
      onClose();
    } catch (error) {
      setValidationError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return;
    const elements = focusableElements(event.currentTarget);
    if (elements.length === 0) return;
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const rootClassName = ['custom-trace-modal', className].filter(Boolean).join(' ');

  return (
    <div
      className="custom-trace-modal__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className={rootClassName}
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogId}
        aria-describedby={descriptionId}
        onKeyDown={handleDialogKeyDown}
      >
        <header className="custom-trace-modal__header">
          <div>
            <p className="custom-trace-modal__eyebrow">Analyzer input</p>
            <h2 id={dialogId}>{title}</h2>
            <p id={descriptionId} className="custom-trace-modal__description">{description}</p>
          </div>
          <button
            type="button"
            className="custom-trace-modal__close"
            aria-label="Close custom trace input"
            onClick={onClose}
            disabled={busy}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="custom-trace-modal__body">
          <label className="custom-trace-modal__label" htmlFor={editorId}>
            Lock-event trace
            <span>JSON or log text</span>
          </label>
          <textarea
            ref={textareaRef}
            id={editorId}
            className="custom-trace-modal__editor"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (validationError !== null) setValidationError(null);
            }}
            spellCheck={false}
            aria-invalid={feedback !== null}
            aria-describedby={feedback !== null ? feedbackId : descriptionId}
            disabled={busy}
            rows={11}
          />
          <div className="custom-trace-modal__editor-meta">
            <span>Accepted: acquire · wait · release · unlock</span>
            <span>{draft.length.toLocaleString()} characters</span>
          </div>
          <div
            id={feedbackId}
            className={`custom-trace-modal__feedback${feedback ? ' custom-trace-modal__feedback--error' : ''}`}
            role={feedback ? 'alert' : 'status'}
            aria-live="polite"
          >
            {feedback ?? 'The server accepts JSON arrays, nested event collections, and readable lock logs.'}
          </div>
        </div>

        <footer className="custom-trace-modal__footer">
          <button type="button" className="custom-trace-modal__button custom-trace-modal__button--quiet" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="custom-trace-modal__button custom-trace-modal__button--primary" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Analyzing trace…' : 'Analyze custom trace'}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default CustomTraceModal;
