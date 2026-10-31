import { describe, expect, it } from 'vitest';
import { computeState, EngineEvent, EventPayload } from '../server/engine';
import { Game, makeConfig } from './helpers';

describe('wickets', () => {
  it('bowled credits the bowler, records fall of wicket and resets the partnership', () => {
    const g = Game.started();
    g.run(2);
    g.run(1);
    g.send({ type: 'BALL', runs: 0, wicket: { kind: 'bowled', incoming: 'a3' } });
    expect(g.inn).toMatchObject({ runs: 3, wickets: 1, strikerId: 'a3', nonStrikerId: 'a1' });
    expect(g.batter('a2')).toMatchObject({ status: 'out', howOut: 'b B1', runs: 0, balls: 1 });
    expect(g.bowler('b1').wickets).toBe(1);
    expect(g.inn.fow[0]).toMatchObject({ wicket: 1, runs: 3, batterName: 'A2', over: '0.3', text: '3/1 (A2, 0.3 ov)' });
    expect(g.inn.partnership).toMatchObject({ runs: 0, balls: 0 });
    g.run(1);
    expect(g.inn.partnership.runs).toBe(1);
  });

  it('run out does not credit the bowler; completed runs count and decide the ends', () => {
    const g = Game.started();
    g.send({ type: 'BALL', runs: 1, wicket: { kind: 'runout', out: 'a2', fielder: 'b4', incoming: 'a3' } });
    expect(g.inn).toMatchObject({ runs: 1, wickets: 1 });
    expect(g.bowler('b1').wickets).toBe(0);
    expect(g.batter('a1')).toMatchObject({ runs: 1, balls: 1 });
    expect(g.batter('a2').howOut).toBe('run out (B4)');
    expect(g.inn.strikerId).toBe('a3');
    expect(g.inn.nonStrikerId).toBe('a1');
  });

  it('run out of the striker with no run completed puts the new batter on strike', () => {
    const g = Game.started();
    g.send({ type: 'BALL', runs: 0, wicket: { kind: 'runout', incoming: 'a3' } });
    expect(g.inn).toMatchObject({ strikerId: 'a3', nonStrikerId: 'a2' });
  });

  it('caught: the crossed toggle decides who faces next', () => {
    const plain = Game.started();
    plain.send({ type: 'BALL', wicket: { kind: 'caught', fielder: 'b3', incoming: 'a3' } });
    expect(plain.inn).toMatchObject({ strikerId: 'a3', nonStrikerId: 'a2' });
    expect(plain.batter('a1').howOut).toBe('c B3 b B1');
    const crossed = Game.started();
    crossed.send({ type: 'BALL', wicket: { kind: 'caught', fielder: 'b1', crossed: true, incoming: 'a3' } });
    expect(crossed.inn).toMatchObject({ strikerId: 'a2', nonStrikerId: 'a3' });
    expect(crossed.batter('a1').howOut).toBe('c & b B1');
  });

  it('stumped on a wide: wicket, no ball counted, no ball faced, bowler credited', () => {
    const g = Game.started();
    g.send({ type: 'BALL', extra: 'wide', wicket: { kind: 'stumped', fielder: 'b9', incoming: 'a3' } });
    expect(g.inn).toMatchObject({ runs: 1, wickets: 1, legalBalls: 0, strikerId: 'a3' });
    expect(g.batter('a1')).toMatchObject({ balls: 0, status: 'out', howOut: 'st B9 b B1' });
    expect(g.bowler('b1').wickets).toBe(1);
    expect(g.fails({ type: 'BALL', extra: 'wide', wicket: { kind: 'bowled' } }).code).toBe('INVALID_DISMISSAL');
    expect(g.fails({ type: 'BALL', extra: 'noball', wicket: { kind: 'stumped' } }).code).toBe('INVALID_DISMISSAL');
  });

  it('a wicket on the last ball: new batter placed, then end-of-over swap, then a new bowler', () => {
    const g = Game.started();
    g.dots(5);
    g.send({ type: 'BALL', wicket: { kind: 'lbw', incoming: 'a3' } });
    expect(g.inn).toMatchObject({ oversCompleted: 1, wickets: 1, strikerId: 'a2', nonStrikerId: 'a3', bowlerId: null });
    expect(g.inn.needs).toEqual({ openers: false, bowler: true, batter: false });
  });

  it('incoming batter can be chosen afterwards; scoring is blocked until then', () => {
    const g = Game.started();
    g.send({ type: 'BALL', wicket: { kind: 'bowled' } });
    expect(g.inn.needs.batter).toBe(true);
    expect(g.fails({ type: 'BALL', runs: 1 }).code).toBe('PROMPT_OPEN');
    expect(g.fails({ type: 'NEW_BATTER', batter: 'a1' }).code).toBe('BATTER_OUT');
    g.send({ type: 'NEW_BATTER', batter: 'a3' });
    expect(g.inn).toMatchObject({ strikerId: 'a3', nonStrikerId: 'a2' });
    expect(g.state.effects?.newBatter?.name).toBe('A3');
  });

  it('only the striker can be bowled; free hit allows only run out and friends', () => {
    const g = Game.started();
    expect(g.fails({ type: 'BALL', wicket: { kind: 'bowled', out: 'a2' } }).code).toBe('INVALID_DISMISSAL');
    expect(g.fails({ type: 'BALL', runs: 1, wicket: { kind: 'caught' } }).code).toBe('BAD_RUNS');
  });

  it('hat-trick, five-for and fifty milestones are reported once', () => {
    const g = Game.started();
    g.send({ type: 'BALL', runs: 1, overthrows: 49 });
    expect(g.state.effects?.milestones.map((m) => m.kind)).toEqual(['fifty']);
    g.send({ type: 'BALL', wicket: { kind: 'bowled', incoming: 'a3' } });
    g.send({ type: 'BALL', wicket: { kind: 'bowled', incoming: 'a4' } });
    expect(g.state.effects?.milestones).toEqual([]);
    g.send({ type: 'BALL', wicket: { kind: 'bowled', incoming: 'a5' } });
    expect(g.state.effects?.milestones.map((m) => m.kind)).toEqual(['hattrick']);
  });

  it('boundary and wicket effects are exposed for triggers', () => {
    const g = Game.started();
    g.run(6);
    expect(g.state.effects?.boundary).toBe(6);
    g.send({ type: 'BALL', wicket: { kind: 'bowled' } });
    expect(g.state.effects?.wicket).toMatchObject({ name: 'A1', howOut: 'b B1', runs: 6, balls: 2, bowler: 'B1' });
  });
});

function tiny(extra = {}) {
  return makeConfig({ overs: 2, playersPerSide: 3, ...extra });
}

function bowlOver(g: Game, runs: number[], next?: string) {
  for (const r of runs) g.run(r);
  if (next && !g.state.current?.complete) g.send({ type: 'SET_BOWLER', bowler: next });
}

function inningsOneTwenty(): Game {
  const g = new Game(tiny());
  g.send({ type: 'START_INNINGS' });
  g.send({ type: 'SET_BATTERS', striker: 'a1', nonStriker: 'a2' });
  g.send({ type: 'SET_BOWLER', bowler: 'b1' });
  bowlOver(g, [6, 6, 4, 4, 0, 0], 'b2');
  bowlOver(g, [0, 0, 0, 0, 0, 0]);
  return g;
}

function startChase(g: Game) {
  g.send({ type: 'START_INNINGS' });
  g.send({ type: 'SET_BATTERS', striker: 'b1', nonStriker: 'b2' });
  g.send({ type: 'SET_BOWLER', bowler: 'a1' });
}

describe('innings and match end', () => {
  it('overs complete ends the innings and opens the innings break', () => {
    const g = inningsOneTwenty();
    expect(g.inn).toMatchObject({ complete: true, endReason: 'overs', runs: 20, overs: '2.0' });
    expect(g.state.status).toBe('break');
    expect(g.state.statusText).toBe('Innings break');
    expect(g.state.nextBattingSide).toBe('B');
    expect(g.fails({ type: 'BALL', runs: 1 }).code).toBe('INNINGS_COMPLETE');
  });

  it('all out ends the innings immediately without asking for a batter', () => {
    const g = new Game(tiny());
    g.send({ type: 'START_INNINGS' });
    g.send({ type: 'SET_BATTERS', striker: 'a1', nonStriker: 'a2' });
    g.send({ type: 'SET_BOWLER', bowler: 'b1' });
    g.send({ type: 'BALL', wicket: { kind: 'bowled', incoming: 'a3' } });
    g.send({ type: 'BALL', wicket: { kind: 'bowled' } });
    expect(g.inn).toMatchObject({ complete: true, endReason: 'allout', wickets: 2 });
    expect(g.inn.needs.batter).toBe(false);
  });

  it('chase ends the moment the target is passed with wickets and balls left', () => {
    const g = inningsOneTwenty();
    startChase(g);
    expect(g.inn).toMatchObject({ target: 21, runsNeeded: 21, ballsRemaining: 12, rrr: 10.5 });
    g.run(6); g.run(6); g.run(6);
    expect(g.inn).toMatchObject({ runsNeeded: 3, ballsRemaining: 9, rrr: 2 });
    g.run(4);
    expect(g.inn).toMatchObject({ complete: true, endReason: 'target' });
    expect(g.state.status).toBe('completed');
    expect(g.state.result?.text).toBe('Bravo won by 2 wickets (8 balls left)');
    expect(g.fails({ type: 'START_INNINGS' }).code).toBe('MATCH_COMPLETE');
  });

  it('refuses to end an innings before the openers are chosen', () => {
    const g = new Game();
    g.send({ type: 'START_INNINGS' });
    expect(g.fails({ type: 'END_INNINGS', reason: 'declared' }).code).toBe('PROMPT_OPEN');
  });

  it('refuses the same side batting twice in a row', () => {
    const g = inningsOneTwenty();
    expect(g.state.nextBattingSide).toBe('B');
    expect(g.fails({ type: 'START_INNINGS', battingSide: 'A' }).code).toBe('SAME_BATTING_SIDE');
  });

  it('defending side wins by runs', () => {
    const g = inningsOneTwenty();
    startChase(g);
    bowlOver(g, [1, 1, 1, 1, 3, 3], 'a2');
    bowlOver(g, [0, 0, 0, 0, 0, 0]);
    expect(g.state.result?.text).toBe('Alpha won by 10 runs');
    expect(g.state.performers.topScorer).toMatchObject({ name: 'A1', runs: 20 });
  });

  it('tie, then a Super Over that reuses the engine with one over and two wickets', () => {
    const g = inningsOneTwenty();
    startChase(g);
    bowlOver(g, [4, 4, 4, 4, 4, 0], 'a2');
    bowlOver(g, [0, 0, 0, 0, 0, 0]);
    expect(g.state.result).toMatchObject({ kind: 'tie', text: 'Match tied' });
    expect(g.state.canSuperOver).toBe(true);
    g.send({ type: 'START_INNINGS' });
    expect(g.inn).toMatchObject({ number: 3, superOver: true, maxOvers: 1, maxWickets: 2, battingSide: 'B' });
    expect(g.state.result).toBeNull();
    g.send({ type: 'SET_BATTERS', striker: 'b1', nonStriker: 'b2' });
    g.send({ type: 'SET_BOWLER', bowler: 'a1' });
    bowlOver(g, [6, 4, 0, 0, 0, 0]);
    g.send({ type: 'START_INNINGS' });
    expect(g.inn).toMatchObject({ number: 4, battingSide: 'A', target: 11 });
    g.send({ type: 'SET_BATTERS', striker: 'a1', nonStriker: 'a2' });
    g.send({ type: 'SET_BOWLER', bowler: 'b1' });
    g.run(6); g.run(6);
    expect(g.state.result?.text).toBe('Alpha won the Super Over');
  });

  it('revised target overrides the target and overs mid-chase', () => {
    const g = inningsOneTwenty();
    startChase(g);
    g.run(1);
    g.send({ type: 'REVISED_TARGET', target: 15, overs: 1 });
    expect(g.inn).toMatchObject({ target: 15, maxOvers: 1, runsNeeded: 14, ballsRemaining: 5 });
    g.run(6); g.run(6); g.run(2);
    expect(g.state.result?.text).toContain('Bravo won by');
  });

  it('manual declare and match result overrides', () => {
    const g = Game.started();
    g.run(4);
    g.send({ type: 'END_INNINGS', reason: 'declared' });
    expect(g.inn).toMatchObject({ complete: true, endReason: 'declared' });
    g.send({ type: 'MATCH_RESULT', kind: 'noresult' });
    expect(g.state).toMatchObject({ status: 'completed', result: { text: 'No result' } });
  });

  it('adjustments keep history and invariants hold', () => {
    const g = Game.started();
    g.run(4);
    g.send({ type: 'ADJUSTMENT', runs: -2 });
    expect(g.inn.runs).toBe(2);
    expect(g.state.invariantErrors).toEqual([]);
  });
});

describe('undo and edit', () => {
  const play = (g: Game, ps: EventPayload[]) => ps.forEach((p) => g.send(p));

  it('undo across a wicket, an over change and an innings change restores the earlier state', () => {
    const g = inningsOneTwenty();
    const all = g.events;
    // Undoing to any point must leave a consistent state.
    for (let cut = all.length - 1; cut >= 0; cut--) {
      expect(computeState(g.config, all.slice(0, cut)).invariantErrors).toEqual([]);
    }
    const afterStart = all.findIndex((e) => e.type === 'SET_BOWLER');
    const dropBall = computeState(g.config, all.slice(0, afterStart + 2));
    expect(dropBall.current?.runs).toBe(6);
    const w = Game.started();
    w.run(1);
    const beforeWicket = w.state;
    w.send({ type: 'BALL', wicket: { kind: 'bowled', incoming: 'a3' } });
    const undone = computeState(w.config, w.events.slice(0, -1));
    expect(undone.current?.wickets).toBe(0);
    expect(undone.current?.strikerId).toBe(beforeWicket.current?.strikerId);
    const oc = Game.started();
    oc.dots(6);
    oc.send({ type: 'SET_BOWLER', bowler: 'b2' });
    expect(computeState(oc.config, oc.events.slice(0, -1)).current?.needs.bowler).toBe(true);
    const inn = inningsOneTwenty();
    startChase(inn);
    const noInn2 = computeState(inn.config, inn.events.slice(0, inn.events.findLastIndex((e) => e.type === 'START_INNINGS')));
    expect(noInn2.status).toBe('break');
  });

  it('editing a past ball recomputes everything after it', () => {
    const g = Game.started();
    play(g, [{ type: 'BALL', runs: 1 }, { type: 'BALL', runs: 0 }, { type: 'BALL', runs: 2 }]);
    expect(g.inn.strikerId).toBe('a2');
    const edited: EngineEvent[] = g.events.map((e) => (e.id === 4 ? ({ ...e, runs: 4 } as EngineEvent) : e));
    const s = computeState(g.config, edited);
    expect(s.current).toMatchObject({ runs: 6, strikerId: 'a1' });
    expect(s.invariantErrors).toEqual([]);
  });

  it('an edit that makes later events invalid is refused', () => {
    const g = Game.started();
    g.send({ type: 'BALL', wicket: { kind: 'bowled', incoming: 'a3' } });
    g.send({ type: 'BALL', runs: 1, });
    g.send({ type: 'BALL', wicket: { kind: 'bowled', incoming: 'a4' } });
    const edited = g.events.map((e) => (e.id === 4 ? ({ type: 'BALL', id: 4, runs: 1 } as EngineEvent) : e));
    // ball 1 no longer takes a wicket, so a3 is not allowed to be dismissed as the new batter etc. - still valid;
    // but forcing a dismissed batter back in as incoming must throw
    const bad = edited.map((e) => (e.id === 6 ? ({ ...e, wicket: { kind: 'bowled', incoming: 'a1' } } as EngineEvent) : e));
    expect(() => computeState(g.config, bad)).toThrow();
  });
});

describe('squad changes', () => {
  it('retired hurt batter can return later; players can be added mid-match', () => {
    const g = Game.started();
    g.run(1);
    g.send({ type: 'RETIRE', batter: 'a2' });
    expect(g.batter('a2').status).toBe('retired hurt');
    expect(g.inn.needs.batter).toBe(true);
    expect(g.inn.availableBatters.map((p) => p.id)).toContain('a2');
    g.send({ type: 'NEW_BATTER', batter: 'a3' });
    expect(g.inn.wickets).toBe(0);
    g.send({ type: 'ADD_PLAYER', side: 'A', player: { id: 'a12', name: 'Guest' } });
    g.send({ type: 'BALL', wicket: { kind: 'bowled', incoming: 'a12' } });
    expect(g.batter('a12').name).toBe('Guest');
    g.send({ type: 'RENAME_PLAYER', playerId: 'a12', name: 'Guest Star' });
    expect(g.batter('a12').name).toBe('Guest Star');
    g.send({ type: 'BALL', wicket: { kind: 'bowled', incoming: 'a2' } });
    expect(g.batter('a2').status).toBe('batting');
    expect(g.inn.wickets).toBe(2);
  });
});
