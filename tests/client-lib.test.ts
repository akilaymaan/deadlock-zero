import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../src/engine/analyze';
import { buildStory } from '../src/client/lib/story';
import { parseTraceText } from '../src/client/lib/traceParser';
import { ABBA_DEADLOCK_TRACE, CANONICAL_SAFE_TRACE } from './fixtures/traces';

describe('client trace parser', () => {
  it('accepts a JSON array, an { events } object, and JSONL', () => {
    const array = parseTraceText(JSON.stringify(ABBA_DEADLOCK_TRACE));
    const wrapped = parseTraceText(JSON.stringify({ events: ABBA_DEADLOCK_TRACE }));
    const jsonl = parseTraceText(ABBA_DEADLOCK_TRACE.map((event) => JSON.stringify(event)).join('\n'));
    for (const result of [array, wrapped, jsonl]) {
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.events).toHaveLength(4);
    }
  });

  it('reports the failing JSONL line', () => {
    const result = parseTraceText(`${JSON.stringify(ABBA_DEADLOCK_TRACE[0])}\n{broken`);
    expect(result).toMatchObject({ ok: false, error: 'Line 2 is not valid JSON.' });
  });

  it('applies the same schema validation as the server', () => {
    const result = parseTraceText(JSON.stringify([{ workerId: 'w', resourceId: 'r', action: 'NOPE' }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details[0].field).toBe('events[0].action');
  });

  it('rejects empty input and traces over the event limit', () => {
    expect(parseTraceText('   ').ok).toBe(false);
    expect(parseTraceText(JSON.stringify(ABBA_DEADLOCK_TRACE), 2).ok).toBe(false);
  });
});

describe('plain-English story', () => {
  it('narrates every event and ends with the circular wait', () => {
    const { cycles, races } = analyzeTrace(ABBA_DEADLOCK_TRACE);
    const story = buildStory(ABBA_DEADLOCK_TRACE, cycles, races);
    expect(story.map((step) => step.title)).toEqual([
      'Worker_1 locked Account_A',
      'Worker_2 locked Account_B',
      'Worker_1 started waiting for Account_B',
      'Worker_2 started waiting for Account_A',
      'Circular wait: no worker in the cycle can proceed',
    ]);
    expect(story.filter((step) => step.critical)).toHaveLength(3);
  });

  it('marks nothing critical for a safe trace', () => {
    const { cycles, races } = analyzeTrace(CANONICAL_SAFE_TRACE);
    expect(buildStory(CANONICAL_SAFE_TRACE, cycles, races).some((step) => step.critical)).toBe(false);
  });
});
