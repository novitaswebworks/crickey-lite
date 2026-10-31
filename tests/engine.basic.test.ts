import { describe, expect, it } from 'vitest';
import { Game } from './helpers';

describe('runs and strike rotation', () => {
  it('dot, single, two, three, four, six', () => {
    const g = Game.started();
    g.run(0);
    expect(g.inn).toMatchObject({ runs: 0, overs: '0.1', strikerId: 'a1' });
    g.run(1);
    expect(g.inn).toMatchObject({ runs: 1, strikerId: 'a2', nonStrikerId: 'a1' });
    g.run(2);
    expect(g.inn).toMatchObject({ runs: 3, strikerId: 'a2' });
    g.run(3);
    expect(g.inn).toMatchObject({ runs: 6, strikerId: 'a1' });
    g.run(4);
    expect(g.inn).toMatchObject({ runs: 10, strikerId: 'a1' });
    g.run(6);
    expect(g.inn).toMatchObject({ runs: 16, strikerId: 'a2', overs: '1.0' });
    expect(g.batter('a1')).toMatchObject({ runs: 11, balls: 4, fours: 1, sixes: 1 });
    expect(g.batter('a2')).toMatchObject({ runs: 5, balls: 2 });
    expect(g.bowler('b1')).toMatchObject({ runs: 16, balls: 6, dots: 1 });
  });

  it('overthrows add to the runs run for strike purposes', () => {
    const g = Game.started();
    g.send({ type: 'BALL', runs: 1, overthrows: 4 });
    expect(g.inn.runs).toBe(5);
    expect(g.inn.strikerId).toBe('a2');
    expect(g.batter('a1')).toMatchObject({ runs: 5, fours: 0 });
  });

  it('a boundary that is not run can be flagged as run four', () => {
    const g = Game.started();
    g.send({ type: 'BALL', runs: 4, boundary: false });
    expect(g.inn.strikerId).toBe('a1');
    expect(g.batter('a1').fours).toBe(0);
  });
});

describe('overs', () => {
  it('six legal balls complete the over, swap strike and require a new bowler', () => {
    const g = Game.started();
    g.dots(6);
    expect(g.inn).toMatchObject({ overs: '1.0', oversCompleted: 1, strikerId: 'a2', nonStrikerId: 'a1', bowlerId: null });
    expect(g.inn.needs.bowler).toBe(true);
    expect(g.fails({ type: 'BALL', runs: 1 }).code).toBe('PROMPT_OPEN');
    expect(g.fails({ type: 'SET_BOWLER', bowler: 'b1' }).code).toBe('CONSECUTIVE_OVER');
    expect(g.fails({ type: 'SET_BOWLER', bowler: 'a3' }).code).toBe('NOT_IN_TEAM');
    g.send({ type: 'SET_BOWLER', bowler: 'b2' });
    expect(g.inn.needs.bowler).toBe(false);
    expect(g.inn.lastOver).toMatchObject({ over: 1, runs: 0, maiden: true, bowlerName: 'B1' });
    expect(g.bowler('b1')).toMatchObject({ maidens: 1, overs: '1.0' });
  });

  it('single off the last ball leaves the original striker on strike', () => {
    const g = Game.started();
    g.dots(5);
    g.run(1);
    expect(g.inn.strikerId).toBe('a1');
    expect(g.inn.nonStrikerId).toBe('a2');
  });

  it('enforces the bowler over quota and allows a mid-over bowler change', () => {
    const g = Game.started();
    g.dots(3);
    g.send({ type: 'SET_BOWLER', bowler: 'b2' });
    g.dots(3);
    expect(g.bowler('b1').balls).toBe(3);
    expect(g.bowler('b2').balls).toBe(3);
    for (let o = 1; o < 8; o++) g.finishOver(o % 2 ? 'b1' : 'b3');
    // b1 has bowled 3 + 3 overs by now; the 4th over (quota 4) is still fine, the 5th is not
    const blocked = g.inn.eligibleBowlers.filter((b) => b.blocked);
    expect(blocked.length).toBeGreaterThan(0);
  });

  it('force end over rotates strike and asks for a bowler', () => {
    const g = Game.started();
    g.dots(2);
    g.send({ type: 'END_OVER' });
    expect(g.inn).toMatchObject({ oversCompleted: 1, strikerId: 'a2', bowlerId: null });
  });
});

describe('extras', () => {
  it('wide: not a ball, no ball faced, bowler charged, swap only on odd additional runs', () => {
    const g = Game.started();
    g.send({ type: 'BALL', extra: 'wide' });
    expect(g.inn).toMatchObject({ runs: 1, legalBalls: 0, overs: '0.0', strikerId: 'a1' });
    expect(g.inn.extras.wd).toBe(1);
    expect(g.batter('a1').balls).toBe(0);
    expect(g.bowler('b1')).toMatchObject({ runs: 1, balls: 0, wides: 1 });
    g.send({ type: 'BALL', extra: 'wide', runs: 2 });
    expect(g.inn).toMatchObject({ runs: 4, strikerId: 'a1' });
    expect(g.inn.extras.wd).toBe(4);
    g.send({ type: 'BALL', extra: 'wide', runs: 1 });
    expect(g.inn).toMatchObject({ runs: 6, strikerId: 'a2' });
    expect(g.inn.thisOver.map((c) => c.label)).toEqual(['Wd', '2Wd', '1Wd']);
  });

  it('no-ball with bat runs: counted ball faced, not legal, then a free hit', () => {
    const g = Game.started();
    g.send({ type: 'BALL', extra: 'noball', runs: 4 });
    expect(g.inn).toMatchObject({ runs: 5, legalBalls: 0, freeHit: true, strikerId: 'a1' });
    expect(g.batter('a1')).toMatchObject({ runs: 4, balls: 1, fours: 1 });
    expect(g.bowler('b1')).toMatchObject({ runs: 5, noBalls: 1, balls: 0 });
    expect(g.inn.extras.nb).toBe(1);
    expect(g.fails({ type: 'BALL', runs: 0, wicket: { kind: 'bowled' } }).code).toBe('INVALID_DISMISSAL');
    expect(g.fails({ type: 'BALL', runs: 0, wicket: { kind: 'caught' } }).code).toBe('INVALID_DISMISSAL');
    // a wide keeps the free hit pending
    g.send({ type: 'BALL', extra: 'wide' });
    expect(g.inn.freeHit).toBe(true);
    g.run(1);
    expect(g.inn.freeHit).toBe(false);
    expect(g.inn.legalBalls).toBe(1);
  });

  it('a no-ball on a free hit re-triggers the free hit; run out is valid on a free hit', () => {
    const g = Game.started();
    g.send({ type: 'BALL', extra: 'noball' });
    g.send({ type: 'BALL', extra: 'noball' });
    expect(g.inn.freeHit).toBe(true);
    g.send({ type: 'BALL', runs: 0, wicket: { kind: 'runout', out: 'a2', incoming: 'a3' } });
    expect(g.inn.wickets).toBe(1);
    expect(g.inn.freeHit).toBe(false);
  });

  it('byes and leg-byes: legal ball, ball faced, runs to extras, swap on odd', () => {
    const g = Game.started();
    g.send({ type: 'BALL', extra: 'bye', runs: 1 });
    expect(g.inn).toMatchObject({ runs: 1, legalBalls: 1, strikerId: 'a2' });
    expect(g.inn.extras.b).toBe(1);
    expect(g.batter('a1')).toMatchObject({ runs: 0, balls: 1 });
    expect(g.bowler('b1').runs).toBe(0);
    g.send({ type: 'BALL', extra: 'legbye', runs: 2 });
    expect(g.inn).toMatchObject({ runs: 3, strikerId: 'a2' });
    expect(g.inn.extras.lb).toBe(2);
    expect(g.batter('a2').balls).toBe(1);
  });

  it('byes off a no-ball: penalty to the bowler, byes to extras, ball faced', () => {
    const g = Game.started();
    g.send({ type: 'BALL', extra: 'noball', noballExtra: 'bye', runs: 3 });
    expect(g.inn).toMatchObject({ runs: 4, legalBalls: 0, strikerId: 'a2', freeHit: true });
    expect(g.inn.extras).toMatchObject({ nb: 1, b: 3 });
    expect(g.bowler('b1').runs).toBe(1);
    expect(g.batter('a1')).toMatchObject({ runs: 0, balls: 1 });
    g.send({ type: 'BALL', extra: 'noball', noballExtra: 'legbye', runs: 1 });
    expect(g.inn.extras.lb).toBe(1);
  });

  it('penalty runs add to total and extras without a ball or strike change', () => {
    const g = Game.started();
    g.send({ type: 'PENALTY', runs: 5 });
    expect(g.inn).toMatchObject({ runs: 5, legalBalls: 0, strikerId: 'a1' });
    expect(g.inn.extras.pen).toBe(5);
    expect(g.inn.partnership.runs).toBe(5);
  });

  it('dead ball counts nothing and keeps a pending free hit', () => {
    const g = Game.started();
    g.send({ type: 'BALL', extra: 'noball' });
    g.send({ type: 'BALL', extra: 'dead' });
    expect(g.inn).toMatchObject({ legalBalls: 0, runs: 1, freeHit: true });
    expect(g.batter('a1').balls).toBe(1);
  });
});
