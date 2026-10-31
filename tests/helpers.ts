import { appendEvent, computeState, EngineError, EngineEvent, EventPayload, LiveState, MatchConfig, PlayerRef } from '../server/engine';

export function squad(prefix: string, n = 11): PlayerRef[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix.toLowerCase()}${i + 1}`, name: `${prefix}${i + 1}` }));
}

export function makeConfig(over: Partial<MatchConfig> = {}): MatchConfig {
  const n = over.playersPerSide ?? 11;
  return {
    id: 'm1', title: 'Test Match', venue: 'Ground', overs: 20, playersPerSide: n,
    teams: {
      A: { id: 'ta', name: 'Alpha', shortName: 'ALP', color: '#c00', players: squad('A', n) },
      B: { id: 'tb', name: 'Bravo', shortName: 'BRA', color: '#00c', players: squad('B', n) },
    },
    toss: { winner: 'A', decision: 'bat' },
    settings: { powerplayOvers: 6, limitBowlerOvers: true },
    ...over,
  };
}

export class Game {
  events: EngineEvent[] = [];
  state: LiveState;
  constructor(public config: MatchConfig = makeConfig()) {
    this.state = computeState(config, []);
  }
  send(p: EventPayload): LiveState {
    const r = appendEvent(this.config, this.events, p);
    this.events.push(r.event);
    this.state = r.state;
    return r.state;
  }
  fails(p: EventPayload): EngineError {
    try {
      appendEvent(this.config, this.events, p);
    } catch (e) {
      if (e instanceof EngineError) return e;
      throw e;
    }
    throw new Error('expected the event to be rejected');
  }
  get inn() {
    return this.state.current!;
  }
  /** Start innings 1 with a1/a2 opening and b1 bowling. */
  static started(config?: MatchConfig): Game {
    const g = new Game(config);
    g.send({ type: 'START_INNINGS' });
    g.send({ type: 'SET_BATTERS', striker: 'a1', nonStriker: 'a2' });
    g.send({ type: 'SET_BOWLER', bowler: 'b1' });
    return g;
  }
  run(runs: number) { return this.send({ type: 'BALL', runs }); }
  /** Bowl n dot balls. */
  dots(n: number) { for (let i = 0; i < n; i++) this.run(0); }
  batter(id: string) { return this.inn.batting.find((b) => b.id === id)!; }
  bowler(id: string) { return this.inn.bowling.find((b) => b.id === id)!; }
  /** Finish the over by bowling the remaining legal balls as dots, then pick the next bowler. */
  finishOver(next: string) {
    while (this.inn.ballsInOver !== 0) this.run(0);
    this.send({ type: 'SET_BOWLER', bowler: next });
  }
}
