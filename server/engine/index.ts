import { Machine } from './machine';
import { snapshot } from './snapshot';
import { EngineError, EngineEvent, EventPayload, LiveState, MatchConfig } from './types';

export * from './types';
export { dismissalName, plural } from './machine';

/** Recomputes the full live state from the ordered event list. Throws EngineError if an event is invalid. */
export function computeState(config: MatchConfig, events: EngineEvent[]): LiveState {
  const m = new Machine(config);
  for (const ev of events) {
    try {
      m.apply(ev);
    } catch (e) {
      if (e instanceof EngineError) throw new EngineError(e.code, e.message);
      throw e;
    }
  }
  return snapshot(m);
}

/** Validates and returns the state after appending `payload`. */
export function appendEvent(config: MatchConfig, events: EngineEvent[], payload: EventPayload): { event: EngineEvent; state: LiveState } {
  const id = (events[events.length - 1]?.id ?? 0) + 1;
  const event = { ...payload, id } as EngineEvent;
  return { event, state: computeState(config, [...events, event]) };
}
