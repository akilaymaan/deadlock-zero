import { LOCK_ACTIONS, type LockAction, type LockEvent } from './types';

/** Default ceiling on events per trace; the server's MAX_TRACE_EVENTS may override it. */
export const DEFAULT_MAX_TRACE_EVENTS = 10_000;

export interface ValidationIssue {
  readonly field: string;
  readonly message: string;
}

export class RequestValidationError extends Error {
  public constructor(
    message: string,
    public readonly details: readonly ValidationIssue[],
    public readonly statusCode = 400,
    public readonly code = 'INVALID_EVENTS_PAYLOAD',
  ) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

const MAX_ISSUES = 50;
const MAX_STRING_LENGTH = 512;
const MAX_SNIPPET_LENGTH = 2_000;
const MAX_SOURCE_CODE_LENGTH = 100_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, issues: ValidationIssue[]): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({ field, message: 'must be a non-empty string' });
    return '';
  }
  if (value.length > MAX_STRING_LENGTH) {
    issues.push({ field, message: `must be at most ${MAX_STRING_LENGTH} characters` });
    return '';
  }
  return value.trim();
}

function optionalString(value: unknown, field: string, fallback: string, maxLength: number, issues: ValidationIssue[]): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') {
    issues.push({ field, message: 'must be a string' });
    return fallback;
  }
  if (value.length > maxLength) {
    issues.push({ field, message: `must be at most ${maxLength} characters` });
    return fallback;
  }
  return value.trim().length > 0 ? value : fallback;
}

function validateEvent(raw: unknown, index: number, issues: ValidationIssue[]): LockEvent | undefined {
  const prefix = `events[${index}]`;
  if (!isRecord(raw)) {
    issues.push({ field: prefix, message: 'must be a JSON object' });
    return undefined;
  }
  const before = issues.length;
  const workerId = requiredString(raw.workerId, `${prefix}.workerId`, issues);
  const resourceId = requiredString(raw.resourceId, `${prefix}.resourceId`, issues);
  const action = typeof raw.action === 'string' ? raw.action.trim().toUpperCase() : '';
  if (!LOCK_ACTIONS.includes(action as LockAction)) {
    issues.push({ field: `${prefix}.action`, message: `must be one of ${LOCK_ACTIONS.join(', ')}` });
  }

  let timestamp = index;
  if (raw.timestamp !== undefined) {
    if (typeof raw.timestamp !== 'number' || !Number.isFinite(raw.timestamp) || raw.timestamp < 0) {
      issues.push({ field: `${prefix}.timestamp`, message: 'must be a non-negative finite number' });
    } else timestamp = raw.timestamp;
  }

  let line = 1;
  if (raw.line !== undefined) {
    if (typeof raw.line !== 'number' || !Number.isInteger(raw.line) || raw.line < 1) {
      issues.push({ field: `${prefix}.line`, message: 'must be a positive integer' });
    } else line = raw.line;
  }

  const vectorClock: Record<string, number> = {};
  if (raw.vectorClock !== undefined) {
    if (!isRecord(raw.vectorClock)) {
      issues.push({ field: `${prefix}.vectorClock`, message: 'must be an object of worker IDs to non-negative integers' });
    } else {
      for (const [key, tick] of Object.entries(raw.vectorClock)) {
        if (typeof tick !== 'number' || !Number.isInteger(tick) || tick < 0) {
          issues.push({ field: `${prefix}.vectorClock.${key}`, message: 'must be a non-negative integer' });
        } else vectorClock[key] = tick;
      }
    }
  }

  const id = optionalString(raw.id, `${prefix}.id`, `evt-${index + 1}`, MAX_STRING_LENGTH, issues);
  const file = optionalString(raw.file, `${prefix}.file`, 'trace', MAX_STRING_LENGTH, issues);
  const codeSnippet = optionalString(raw.codeSnippet, `${prefix}.codeSnippet`, `${action} ${resourceId}`, MAX_SNIPPET_LENGTH, issues);

  if (issues.length > before) return undefined;
  return { id, workerId, resourceId, action: action as LockAction, timestamp, vectorClock, file, line, codeSnippet };
}

export interface EventsPayload {
  readonly events: LockEvent[];
  readonly sourceCode?: string;
}

export function validateEventsPayload(body: unknown, maxEvents: number): EventsPayload {
  if (!isRecord(body)) {
    throw new RequestValidationError('Request body must be a JSON object with an "events" array.', [
      { field: 'body', message: 'must be a JSON object' },
    ]);
  }
  if (!Array.isArray(body.events) || body.events.length === 0) {
    throw new RequestValidationError('Field "events" must be a non-empty array of LockEvent objects.', [
      { field: 'events', message: 'must be a non-empty array' },
    ]);
  }
  if (body.events.length > maxEvents) {
    throw new RequestValidationError(
      `Trace has ${body.events.length} events; the limit is ${maxEvents}.`,
      [{ field: 'events', message: `must contain at most ${maxEvents} events` }],
      413,
      'TRACE_TOO_LARGE',
    );
  }

  const issues: ValidationIssue[] = [];
  const events: LockEvent[] = [];
  for (let index = 0; index < body.events.length && issues.length < MAX_ISSUES; index += 1) {
    const event = validateEvent(body.events[index], index, issues);
    if (event) events.push(event);
  }

  let sourceCode: string | undefined;
  if (body.sourceCode !== undefined) {
    if (typeof body.sourceCode !== 'string' || body.sourceCode.length > MAX_SOURCE_CODE_LENGTH) {
      issues.push({ field: 'sourceCode', message: `must be a string of at most ${MAX_SOURCE_CODE_LENGTH} characters` });
    } else if (body.sourceCode.trim().length > 0) sourceCode = body.sourceCode;
  }

  if (issues.length > 0) {
    throw new RequestValidationError(`Invalid LockEvent payload: ${issues[0].field} ${issues[0].message}.`, issues.slice(0, MAX_ISSUES));
  }
  return { events, sourceCode };
}

export interface SimulationParameters {
  readonly workers?: number;
  readonly requestsPerWorker?: number;
  readonly seed?: number;
}

export function validateSimulationParameters(body: unknown, maxWorkers: number): SimulationParameters {
  const record = isRecord(body) ? body : {};
  const issues: ValidationIssue[] = [];
  const integer = (name: string, min: number, max: number): number | undefined => {
    const value = record[name];
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      issues.push({ field: name, message: `must be an integer between ${min} and ${max}` });
      return undefined;
    }
    return value;
  };
  const parameters = {
    workers: integer('workers', 1, maxWorkers),
    requestsPerWorker: integer('requestsPerWorker', 1, 20),
    seed: integer('seed', 0, 0xffffffff),
  };
  if (issues.length > 0) {
    throw new RequestValidationError(`Invalid simulation parameters: ${issues[0].field} ${issues[0].message}.`, issues);
  }
  return parameters;
}
