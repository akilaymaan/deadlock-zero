import type { DeadlockCycle, LockEvent, RaceConflict } from '../../shared/types';

export interface StoryStep {
  readonly stepNumber: number;
  readonly title: string;
  readonly description: string;
  readonly location: string;
  readonly critical: boolean;
}

function location(event: LockEvent): string {
  return `${event.file.split('/').pop() ?? event.file}:${event.line}`;
}

/**
 * Turn a trace into a plain-English timeline. Every sentence is derived from trace
 * events and detector findings; nothing is invented.
 */
export function buildStory(events: readonly LockEvent[], cycles: readonly DeadlockCycle[], races: readonly RaceConflict[]): StoryStep[] {
  const ordered = events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => left.event.timestamp - right.event.timestamp || left.index - right.index)
    .map(({ event }) => event);
  const cycleMembers = new Set(cycles.flatMap((cycle) => cycle.cycleNodes));
  const racedEvents = new Set(races.flatMap((race) => [race.eventA.id, race.eventB.id]));

  const steps: StoryStep[] = ordered.map((event, index) => {
    const inCycle = cycleMembers.has(event.workerId) && cycleMembers.has(event.resourceId);
    const raced = racedEvents.has(event.id);
    const verb: Record<LockEvent['action'], string> = {
      ACQUIRE: `${event.workerId} locked ${event.resourceId}`,
      WAIT: `${event.workerId} started waiting for ${event.resourceId}`,
      RELEASE: `${event.workerId} released ${event.resourceId}`,
      READ: `${event.workerId} read ${event.resourceId}`,
      WRITE: `${event.workerId} wrote ${event.resourceId}`,
    };
    let description = event.codeSnippet;
    if (event.action === 'WAIT' && inCycle) description = `Blocked while still holding another lock in the cycle. ${event.codeSnippet}`;
    if (raced) description = `Concurrent with another worker's access and not protected by a common lock. ${event.codeSnippet}`;
    return {
      stepNumber: index + 1,
      title: verb[event.action],
      description,
      location: location(event),
      critical: (event.action === 'WAIT' && inCycle) || raced,
    };
  });

  if (cycles.length > 0) {
    steps.push({
      stepNumber: steps.length + 1,
      title: 'Circular wait: no worker in the cycle can proceed',
      description: cycles[0].cycleNodes.join(' -> '),
      location: cycles[0].offendingLines[0] ? `${cycles[0].offendingLines[0].file.split('/').pop()}:${cycles[0].offendingLines[0].line}` : '',
      critical: true,
    });
  }
  return steps;
}
