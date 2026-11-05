import { HockeyMachine } from './machine';
import { snapshotHockey } from './snapshot';
import { HockeyEngineEvent, HockeyEventPayload, HockeyMatchConfig, HockeyState } from './types';

export * from './types';
export { HockeyMachine, formatClock } from './machine';
export { snapshotHockey } from './snapshot';

/**
 * Deterministically computes the full broadcast HockeyState by replaying all events
 * sequentially through the HockeyMachine.
 */
export function computeHockeyState(
  config: HockeyMatchConfig,
  events: HockeyEngineEvent[],
  currentClockAt?: number,
): HockeyState {
  const machine = new HockeyMachine(config);
  for (const event of events) {
    machine.apply(event);
  }
  return snapshotHockey(machine, currentClockAt);
}

/**
 * Validates and returns the state after appending a new hockey event payload.
 */
export function appendHockeyEvent(
  config: HockeyMatchConfig,
  events: HockeyEngineEvent[],
  payload: HockeyEventPayload,
  currentClockAt?: number,
): { event: HockeyEngineEvent; state: HockeyState } {
  const nextId = (events[events.length - 1]?.id ?? 0) + 1;
  const event = { ...payload, id: nextId } as HockeyEngineEvent;
  const nextEvents = [...events, event];
  const state = computeHockeyState(config, nextEvents, currentClockAt);
  return { event, state };
}
