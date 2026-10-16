import {
  DEFAULT_MAX_TRACE_EVENTS,
  RequestValidationError,
  validateEventsPayload,
  type ValidationIssue,
} from '../../shared/traceValidation';
import type { LockEvent } from '../../shared/types';

export const MAX_TRACE_FILE_BYTES = 5 * 1024 * 1024;

export type TraceParseResult =
  | { readonly ok: true; readonly events: LockEvent[] }
  | { readonly ok: false; readonly error: string; readonly details: readonly ValidationIssue[] };

/** Documentation example of the LockEvent schema. Shown only when a user asks for it. */
export const SCHEMA_EXAMPLE: LockEvent[] = [
  {
    id: 'evt-1',
    workerId: 'worker-1',
    resourceId: 'lock-a',
    action: 'ACQUIRE',
    timestamp: 1,
    vectorClock: { 'worker-1': 1 },
    file: 'src/example.ts',
    line: 10,
    codeSnippet: 'await mutexA.lock();',
  },
  {
    id: 'evt-2',
    workerId: 'worker-1',
    resourceId: 'lock-b',
    action: 'WAIT',
    timestamp: 2,
    vectorClock: { 'worker-1': 2 },
    file: 'src/example.ts',
    line: 11,
    codeSnippet: 'await mutexB.lock();',
  },
];

function failure(error: string, details: readonly ValidationIssue[] = []): TraceParseResult {
  return { ok: false, error, details };
}

/**
 * Parse a trace from text. Accepts a JSON array of LockEvents, an object
 * `{ "events": [...] }`, or newline-delimited JSON (one LockEvent per line).
 * Validation is shared with the server, so a trace accepted here is accepted by the API.
 */
export function parseTraceText(text: string, maxEvents = DEFAULT_MAX_TRACE_EVENTS): TraceParseResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return failure('The trace is empty.');

  let candidate: unknown;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    candidate = Array.isArray(parsed) ? parsed : (parsed as { events?: unknown } | null)?.events;
    if (!Array.isArray(candidate)) {
      return failure('JSON must be an array of LockEvents or an object with an "events" array.');
    }
  } catch {
    const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const items: unknown[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      try {
        items.push(JSON.parse(lines[index]));
      } catch {
        return failure(`Line ${index + 1} is not valid JSON.`);
      }
    }
    candidate = items;
  }

  try {
    return { ok: true, events: validateEventsPayload({ events: candidate }, maxEvents).events };
  } catch (error) {
    if (error instanceof RequestValidationError) return failure(error.message, error.details);
    throw error;
  }
}
