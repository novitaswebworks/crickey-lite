import { EventEmitter } from 'node:events';
import { computeState, EngineError, EngineEvent, EventPayload, LiveState, MatchConfig, PlayerRef, Side } from './engine';
import { computeHockeyState, HockeyEngineEvent, HockeyMatchConfig, HockeyState } from './engine/hockey';
import { SettingsService } from './settings';
import { Doc, Store } from './store';
import { MatchPlayerRow, MatchRow, PlayerRow, TeamRow } from './types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export interface MatchInput {
  sport: 'cricket' | 'hockey';
  title: string;
  venue: string;
  teamAId: number;
  teamBId: number;
  overs: number;
  playersPerSide: number;
  tossWinner: 'A' | 'B' | null;
  tossDecision: 'bat' | 'bowl' | null;
  xiA: number[];
  xiB: number[];
  powerplayOvers?: number;
  limitBowlerOvers?: boolean;
  periods?: number;
  periodDurationMins?: number;
}

export interface MatchSummary {
  id: number;
  title: string;
  venue: string;
  sport: 'cricket' | 'hockey';
  overs: number;
  teamA: { name: string; shortName: string; color: string };
  teamB: { name: string; shortName: string; color: string };
  status: LiveState['status'];
  statusText: string;
  score: string;
  createdAt: string;
  active: boolean;
  eventCount: number;
}

export type ChangeKind = 'append' | 'undo' | 'edit' | 'reload';
export interface ChangeEvent {
  matchId: number;
  state: LiveState;
  kind: ChangeKind;
}

interface Entry {
  config: MatchConfig;
  events: EngineEvent[];
  state: LiveState;
}

export class MatchService extends EventEmitter {
  private cache = new Map<number, Entry>();

  constructor(private store: Store, private settings: SettingsService) {
    super();
  }

  invalidate(id?: number): void {
    if (id === undefined) this.cache.clear();
    else this.cache.delete(id);
  }

  private row(id: number): Doc<MatchRow> {
    const m = this.store.get<MatchRow>('matches', id);
    if (!m) throw new ApiError(404, 'NOT_FOUND', `Match ${id} was not found.`);
    return m;
  }

  private team(id: number): Doc<TeamRow> {
    const t = this.store.get<TeamRow>('teams', id);
    if (!t) throw new ApiError(404, 'NOT_FOUND', `Team ${id} was not found.`);
    return t;
  }

  buildHockeyConfig(id: number): HockeyMatchConfig {
    const m = this.row(id);
    const side = (s: Side): HockeyMatchConfig['teams'][Side] => {
      const t = this.team(s === 'A' ? m.teamAId : m.teamBId);
      const squad = this.store.list<PlayerRow>('players', t.id).sort((a, b) => a.orderIdx - b.orderIdx || a.id - b.id);
      const rows = this.store.list<MatchPlayerRow>('matchPlayers', id).filter((r) => r.side === s && r.inXi).sort((a, b) => a.battingOrder - b.battingOrder);
      const chosen = rows.length ? rows.map((r) => squad.find((p) => p.id === r.playerId)).filter((p): p is Doc<PlayerRow> => !!p) : squad;
      const players: PlayerRef[] = chosen.map((p) => ({ id: String(p.id), name: p.name, shortName: p.shortName || undefined }));
      return { id: String(t.id), name: t.name, shortName: t.shortName, color: t.color, logo: t.logoPath, players };
    };
    return {
      id: String(id), title: m.title, venue: m.venue, playersPerSide: m.playersPerSide,
      teams: { A: side('A'), B: side('B') },
      settings: {
        periods: m.hockeySettings?.periods ?? 4,
        periodDurationMins: m.hockeySettings?.periodDurationMins ?? 15,
      },
    };
  }

  buildConfig(id: number): MatchConfig {
    const m = this.row(id);
    const side = (s: Side): MatchConfig['teams'][Side] => {
      const t = this.team(s === 'A' ? m.teamAId : m.teamBId);
      const squad = this.store.list<PlayerRow>('players', t.id).sort((a, b) => a.orderIdx - b.orderIdx || a.id - b.id);
      const rows = this.store.list<MatchPlayerRow>('matchPlayers', id).filter((r) => r.side === s && r.inXi).sort((a, b) => a.battingOrder - b.battingOrder);
      const chosen = rows.length ? rows.map((r) => squad.find((p) => p.id === r.playerId)).filter((p): p is Doc<PlayerRow> => !!p) : squad;
      const players: PlayerRef[] = chosen.map((p) => ({ id: String(p.id), name: p.name, shortName: p.shortName || undefined }));
      return { id: String(t.id), name: t.name, shortName: t.shortName, color: t.color, logo: t.logoPath, players };
    };
    return {
      id: String(id), title: m.title, venue: m.venue, overs: m.overs, playersPerSide: m.playersPerSide,
      teams: { A: side('A'), B: side('B') },
      toss: m.tossWinner && m.tossDecision ? { winner: m.tossWinner, decision: m.tossDecision } : null,
      settings: m.settings,
    };
  }

  private computeForMatch(id: number, config: MatchConfig, events: EngineEvent[]): LiveState {
    const m = this.row(id);
    if ((m.sport ?? 'cricket') === 'hockey') {
      const hConfig = this.buildHockeyConfig(id);
      return computeHockeyState(hConfig, events as unknown as HockeyEngineEvent[], Date.now()) as unknown as LiveState;
    }
    return this.compute(config, events);
  }

  private load(id: number): Entry {
    let e = this.cache.get(id);
    if (!e) {
      const config = this.buildConfig(id);
      const events = this.store.events.list(id);
      e = { config, events, state: this.computeForMatch(id, config, events) };
      this.cache.set(id, e);
    }
    return e;
  }

  private compute(config: MatchConfig, events: EngineEvent[]): LiveState {
    try {
      return computeState(config, events);
    } catch (err) {
      if (err instanceof EngineError) throw new ApiError(409, err.code, err.message);
      throw err;
    }
  }

  state(id: number): LiveState {
    const e = this.load(id);
    const m = this.row(id);
    if ((m.sport ?? 'cricket') === 'hockey') {
      const curState = e.state as unknown as HockeyState;
      if (curState?.clock?.running) {
        const hConfig = this.buildHockeyConfig(id);
        const nextState = computeHockeyState(hConfig, e.events as unknown as HockeyEngineEvent[], Date.now());
        e.state = { ...nextState, effects: null } as unknown as LiveState;
      }
    }
    return e.state;
  }

  events(id: number): EngineEvent[] {
    return this.load(id).events;
  }

  private publish(id: number, entry: Entry, kind: ChangeKind): void {
    this.emit('change', { matchId: id, state: entry.state, kind } satisfies ChangeEvent);
    entry.state = { ...entry.state, effects: null };
  }

  append(id: number, payload: EventPayload): LiveState {
    const entry = this.load(id);
    const next: EngineEvent = { ...payload, id: (entry.events[entry.events.length - 1]?.id ?? 0) + 1 } as EngineEvent;
    const state = this.computeForMatch(id, entry.config, [...entry.events, next]);
    const saved = this.store.events.append(id, payload);
    entry.events = [...entry.events, saved];
    entry.state = state;
    const out = state;
    this.publish(id, entry, 'append');
    return out;
  }

  undo(id: number): LiveState {
    const entry = this.load(id);
    if (!entry.events.length) throw new ApiError(409, 'NOTHING_TO_UNDO', 'There is nothing to undo.');
    const events = entry.events.slice(0, -1);
    const state = { ...this.computeForMatch(id, entry.config, events), effects: null };
    this.store.events.removeLast(id);
    entry.events = events;
    entry.state = state;
    this.publish(id, entry, 'undo');
    return state;
  }

  private withEdit(entry: Entry, eventId: number, payload: EventPayload): EngineEvent[] {
    if (!entry.events.some((e) => e.id === eventId)) throw new ApiError(404, 'NOT_FOUND', `Event ${eventId} was not found.`);
    return entry.events.map((e) => (e.id === eventId ? ({ ...payload, id: eventId } as EngineEvent) : e));
  }

  /** The state an edit would produce, without saving it; throws exactly what `edit` would. */
  previewEdit(id: number, eventId: number, payload: EventPayload): LiveState {
    const entry = this.load(id);
    return this.computeForMatch(id, entry.config, this.withEdit(entry, eventId, payload));
  }

  edit(id: number, eventId: number, payload: EventPayload): LiveState {
    const entry = this.load(id);
    const events = this.withEdit(entry, eventId, payload);
    const state = { ...this.computeForMatch(id, entry.config, events), effects: null };
    this.store.events.replacePayload(id, eventId, payload);
    entry.events = events;
    entry.state = state;
    this.publish(id, entry, 'edit');
    return state;
  }

  activeId(): number | null {
    const id = this.store.kvGet<number>('activeMatchId');
    return id && this.store.get('matches', id) ? id : null;
  }

  setActive(id: number | null): void {
    if (id !== null) this.row(id);
    this.store.kvSet('activeMatchId', id);
    this.emit('active', id);
  }

  list(): MatchSummary[] {
    const active = this.activeId();
    return this.store.list<MatchRow>('matches').reverse().map((m) => {
      const teamA = this.team(m.teamAId);
      const teamB = this.team(m.teamBId);
      let state: LiveState | null = null;
      try {
        state = this.state(m.id);
      } catch {
        state = null;
      }
      let score = '';
      if ((m.sport ?? 'cricket') === 'hockey') {
        const h = state as unknown as HockeyState;
        score = h ? `${h.teams.A.shortName} ${h.scoreA} - ${h.scoreB} ${h.teams.B.shortName}` : '0 - 0';
      } else {
        score = (state?.innings ?? []).map((i) => `${state!.teams[i.battingSide].shortName} ${i.runs}/${i.wickets} (${i.overs})`).join(' · ');
      }
      return {
        id: m.id, title: m.title, venue: m.venue, sport: m.sport ?? 'cricket', overs: m.overs,
        teamA: { name: teamA.name, shortName: teamA.shortName, color: teamA.color },
        teamB: { name: teamB.name, shortName: teamB.shortName, color: teamB.color },
        status: state?.status ?? 'setup', statusText: state?.statusText ?? '', score, createdAt: m.createdAt,
        active: m.id === active, eventCount: state?.eventCount ?? 0,
      };
    });
  }

  private validate(input: MatchInput): void {
    if (input.teamAId === input.teamBId) throw new ApiError(400, 'SAME_TEAM', 'Pick two different teams.');
    this.team(input.teamAId);
    this.team(input.teamBId);
    for (const [label, ids, teamId] of [['A', input.xiA, input.teamAId], ['B', input.xiB, input.teamBId]] as const) {
      const squad = this.store.list<PlayerRow>('players', teamId);
      if (!ids.length) {
        if (squad.length < 2) throw new ApiError(400, 'SQUAD_TOO_SMALL', `Team ${label} needs at least 2 players.`);
        continue;
      }
      if (new Set(ids).size !== ids.length) throw new ApiError(400, 'DUPLICATE_PLAYER', `Team ${label} lists a player twice.`);
      if (ids.some((id) => !squad.some((p) => p.id === id))) throw new ApiError(400, 'NOT_IN_TEAM', `Team ${label} XI has a player outside the squad.`);
      if (ids.length < 2) throw new ApiError(400, 'SQUAD_TOO_SMALL', `Team ${label} needs at least 2 players.`);
    }
  }

  private writeXi(matchId: number, input: MatchInput): void {
    const rows: MatchPlayerRow[] = [];
    const squadIds = (teamId: number) => this.store.list<PlayerRow>('players', teamId).sort((a, b) => a.orderIdx - b.orderIdx || a.id - b.id).map((p) => p.id);
    for (const [side, chosen, teamId] of [['A', input.xiA, input.teamAId], ['B', input.xiB, input.teamBId]] as const) {
      const ids = chosen.length ? chosen : squadIds(teamId);
      ids.forEach((playerId, i) => rows.push({ side, playerId, inXi: true, battingOrder: i + 1 }));
    }
    this.store.replaceByParent('matchPlayers', matchId, rows);
  }

  create(input: MatchInput): Doc<MatchRow> {
    this.validate(input);
    const s = this.settings.get();
    const row = this.store.insert<MatchRow>('matches', {
      sport: input.sport ?? 'cricket',
      title: input.title, venue: input.venue, teamAId: input.teamAId, teamBId: input.teamBId, overs: input.overs,
      playersPerSide: input.playersPerSide, tossWinner: input.tossWinner, tossDecision: input.tossDecision,
      settings: { powerplayOvers: input.powerplayOvers ?? s.powerplayOvers, limitBowlerOvers: input.limitBowlerOvers ?? s.limitBowlerOvers },
      hockeySettings: input.sport === 'hockey' ? { periods: input.periods ?? 4, periodDurationMins: input.periodDurationMins ?? 15 } : undefined,
      createdAt: new Date().toISOString(),
    });
    this.writeXi(row.id, input);
    if (!this.activeId()) this.setActive(row.id);
    return row;
  }

  update(id: number, input: MatchInput): Doc<MatchRow> {
    const cur = this.row(id);
    const started = this.store.events.list(id).some((e) => e.type === 'START_INNINGS');
    this.validate(input);
    if (started && (cur.teamAId !== input.teamAId || cur.teamBId !== input.teamBId || cur.overs !== input.overs || cur.playersPerSide !== input.playersPerSide)) {
      throw new ApiError(409, 'MATCH_STARTED', 'Teams, overs and players per side cannot change once the match has started.');
    }
    const row = this.store.update<MatchRow>('matches', id, {
      title: input.title, venue: input.venue, teamAId: input.teamAId, teamBId: input.teamBId, overs: input.overs,
      playersPerSide: input.playersPerSide, tossWinner: input.tossWinner, tossDecision: input.tossDecision,
      settings: { powerplayOvers: input.powerplayOvers ?? cur.settings.powerplayOvers, limitBowlerOvers: input.limitBowlerOvers ?? cur.settings.limitBowlerOvers },
      hockeySettings: (cur.sport ?? 'cricket') === 'hockey' ? { periods: input.periods ?? cur.hockeySettings?.periods ?? 4, periodDurationMins: input.periodDurationMins ?? cur.hockeySettings?.periodDurationMins ?? 15 } : undefined,
    })!;
    if (!started) this.writeXi(id, input);
    this.reload(id);
    return row;
  }

  /** Re-reads config from the database (after team/player edits) and tells clients. */
  reload(id: number): void {
    this.invalidate(id);
    const entry = this.load(id);
    this.publish(id, entry, 'reload');
  }

  remove(id: number): void {
    this.row(id);
    this.store.events.clear(id);
    this.store.removeByParent('matchPlayers', id);
    this.store.remove('matches', id);
    this.invalidate(id);
    if (this.store.kvGet<number>('activeMatchId') === id) this.setActive(null);
    this.emit('removed', id);
  }
}
