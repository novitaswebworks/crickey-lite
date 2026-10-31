import type { EventPayload, InningsState } from '@engine/types';
import { useCallback, useRef } from 'react';
import { ApiFail, post, sendEvent } from '../api';
import { applyState } from '../realtime';
import { toast } from '../ui';
import type { LiveState } from '@engine/types';

export function describe(p: EventPayload): string {
  switch (p.type) {
    case 'BALL': {
      const runs = (p.runs ?? 0) + (p.overthrows ?? 0);
      if (p.wicket) return 'WICKET';
      if (p.extra === 'wide') return runs ? `Wide + ${runs}` : 'Wide';
      if (p.extra === 'noball') return runs ? `No-ball + ${runs}${p.noballExtra ? (p.noballExtra === 'bye' ? ' byes' : ' leg byes') : ''}` : 'No-ball';
      if (p.extra === 'bye') return `${runs} bye${runs === 1 ? '' : 's'}`;
      if (p.extra === 'legbye') return `${runs} leg bye${runs === 1 ? '' : 's'}`;
      if (p.extra === 'dead') return 'Dead ball';
      return runs === 0 ? 'Dot ball' : runs === 4 ? 'FOUR' : runs === 6 ? 'SIX' : `${runs} run${runs === 1 ? '' : 's'}`;
    }
    case 'SWAP_STRIKE': return 'Strike swapped';
    case 'PENALTY': return `${p.runs} penalty runs`;
    case 'END_OVER': return 'Over ended';
    case 'END_INNINGS': return 'Innings ended';
    case 'ADJUSTMENT': return `Total adjusted ${p.runs > 0 ? '+' : ''}${p.runs}`;
    case 'SET_BOWLER': return 'Bowler set';
    case 'SET_BATTERS': return 'Batters set';
    case 'NEW_BATTER': return 'New batter in';
    case 'START_INNINGS': return 'Innings started';
    case 'RETIRE': return 'Batter retired hurt';
    default: return 'Saved';
  }
}

const DEBOUNCE_MS = 250;

export interface SendOpts { quiet?: boolean; key?: boolean }

/** Sends scoring events. Clicks get a short per-action debounce so a double-tap cannot score twice; keyboard presses do not (two quick dot balls are legitimate). */
export function useScorer(matchId: number | null) {
  const last = useRef(new Map<string, number>());

  const send = useCallback(async (payload: EventPayload, opts: SendOpts = {}): Promise<LiveState | null> => {
    if (matchId === null) return null;
    const key = JSON.stringify(payload);
    const now = Date.now();
    if (!opts.key && now - (last.current.get(key) ?? 0) < DEBOUNCE_MS) return null;
    last.current.set(key, now);
    try {
      const state = await sendEvent(matchId, payload);
      applyState(state);
      if (!opts.quiet) toast(describe(payload));
      return state;
    } catch (e) {
      toast((e as ApiFail).message, 'error');
      return null;
    }
  }, [matchId]);

  const undo = useCallback(async (key = false): Promise<void> => {
    if (matchId === null) return;
    const now = Date.now();
    if (!key && now - (last.current.get('undo') ?? 0) < DEBOUNCE_MS) return;
    last.current.set('undo', now);
    try {
      const r = await post<{ state: LiveState }>(`/api/matches/${matchId}/undo`);
      applyState(r.state);
      toast('Undone');
    } catch (e) {
      toast((e as ApiFail).message, 'error');
    }
  }, [matchId]);

  return { send, undo };
}

export function promptText(inn: InningsState): string | null {
  if (inn.complete) return null;
  if (inn.needs.openers) return 'Select the opening batters and bowler to begin.';
  if (inn.needs.batter) return 'Select the incoming batter to continue scoring.';
  if (inn.needs.bowler) return 'Select the new bowler to continue scoring.';
  return null;
}
