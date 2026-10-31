import { describe, expect, it } from 'vitest';
import { BallInput } from '../server/engine';
import { Game, makeConfig } from './helpers';

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('seeded full-innings replay', () => {
  it('a scripted 20-over innings reconciles to the ball', () => {
    const rand = rng(2024);
    const g = Game.started();
    let expectedRuns = 0, expectedLegal = 0, expectedExtras = 0, expectedWickets = 0;
    let bowlers = ['b1', 'b2', 'b3', 'b4', 'b5'];
    let over = 0;
    while (!g.inn.complete) {
      if (g.inn.needs.bowler) {
        over++;
        g.send({ type: 'SET_BOWLER', bowler: bowlers[over % 5] });
        continue;
      }
      const r = rand();
      let ball: BallInput; let runs = 0, extras = 0, legal = 1, wkt = 0;
      const incoming = g.inn.availableBatters[0]?.id;
      if (r < 0.03) { ball = { type: 'BALL', wicket: { kind: 'bowled', incoming } }; wkt = 1; }
      else if (r < 0.06) { ball = { type: 'BALL', wicket: { kind: 'runout', out: g.inn.nonStrikerId!, runs: 1, incoming } as never, runs: 1 }; runs = 1; wkt = 1; }
      else if (r < 0.11) { const a = Math.floor(rand() * 3); ball = { type: 'BALL', extra: 'wide', runs: a }; runs = 1 + a; extras = runs; legal = 0; }
      else if (r < 0.14) { const b = Math.floor(rand() * 5); ball = { type: 'BALL', extra: 'noball', runs: b }; runs = 1 + b; extras = 1; legal = 0; }
      else if (r < 0.16) { ball = { type: 'BALL', extra: 'bye', runs: 1 }; runs = 1; extras = 1; }
      else if (r < 0.18) { ball = { type: 'BALL', extra: 'legbye', runs: 2 }; runs = 2; extras = 2; }
      else { const pick = [0, 0, 0, 0, 1, 1, 1, 2, 3, 4, 4, 6][Math.floor(rand() * 12)]; ball = { type: 'BALL', runs: pick }; runs = pick; }
      if (ball.wicket?.kind === 'runout') delete (ball.wicket as { runs?: number }).runs;
      g.send(ball);
      expectedRuns += runs; expectedExtras += extras; expectedLegal += legal; expectedWickets += wkt;
    }
    const s = g.state;
    const inn = s.current!;
    expect(s.invariantErrors).toEqual([]);
    expect(inn.runs).toBe(expectedRuns);
    expect(inn.legalBalls).toBe(expectedLegal);
    expect(inn.wickets).toBe(expectedWickets);
    expect(inn.extras.total).toBe(expectedExtras);
    expect(inn.batting.reduce((a, b) => a + b.runs, 0) + inn.extras.total).toBe(inn.runs);
    expect(inn.bowling.reduce((a, b) => a + b.runs, 0) + inn.extras.b + inn.extras.lb + inn.extras.pen).toBe(inn.runs);
    expect(inn.bowling.reduce((a, b) => a + b.balls, 0)).toBe(inn.legalBalls);
    expect(['overs', 'allout']).toContain(inn.endReason);
    if (inn.endReason === 'overs') expect(inn.overs).toBe('20.0');
    expect(inn.fow).toHaveLength(inn.wickets);
  });

  it('powerplay, projections and per-over runs are derived', () => {
    const g = Game.started(makeConfig());
    g.run(4); g.run(2);
    expect(g.inn.powerplay).toBe(true);
    expect(g.inn.crr).toBe(18);
    expect(g.inn.projected.current).toBe(Math.round(6 + 18 * (118 / 6)));
    expect(g.inn.runsLast5Overs).toBe(6);
  });
});
