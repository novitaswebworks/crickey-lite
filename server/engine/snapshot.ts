import { BatRec, Inn, Machine, OverRec, RawBall, dismissalName } from './machine';
import { formatBalls, round2 } from './format';
import {
  BallRecord, BatterStat, BowlerStat, InningsState, LiveState, OverSummary, Side,
} from './types';

function howOut(m: Machine, rec: BatRec): string {
  const d = rec.dismissal;
  if (!d) return '';
  const b = m.name(d.bowlerId);
  const f = d.fielderId ? m.name(d.fielderId) : '';
  switch (d.kind) {
    case 'bowled': return `b ${b}`;
    case 'lbw': return `lbw b ${b}`;
    case 'caught': return d.fielderId && d.fielderId === d.bowlerId ? `c & b ${b}` : `c ${f ? f + ' ' : ''}b ${b}`;
    case 'stumped': return `st ${f ? f + ' ' : ''}b ${b}`;
    case 'hitwicket': return `hit wicket b ${b}`;
    case 'runout': return f ? `run out (${f})` : 'run out';
    default: return dismissalName(d.kind).toLowerCase();
  }
}

function toBall(m: Machine, r: RawBall): BallRecord {
  const w = r.wicket;
  const rec = w ? m.innings[r.innings - 1].bats.get(w.outId) : undefined;
  return {
    eventId: r.eventId, innings: r.innings, over: r.over, legalBefore: r.legalBefore, legal: r.legal,
    overLabel: `${r.over}.${r.legalBefore + (r.legal ? 1 : 0)}`,
    bowlerId: r.bowlerId, bowlerName: m.name(r.bowlerId),
    strikerId: r.strikerId, strikerName: m.name(r.strikerId), nonStrikerId: r.nonStrikerId,
    extra: r.extra, runs: r.runs, batRuns: r.batRuns, teamRuns: r.teamRuns, boundary: r.boundary,
    freeHit: r.freeHit, label: r.label, kind: r.kind,
    wicket: w && rec?.dismissal ? { kind: w.kind, outId: w.outId, outName: m.name(w.outId), howOut: howOut(m, rec) } : null,
    scoreAfter: r.scoreAfter,
  };
}

function overSummary(m: Machine, o: OverRec): OverSummary {
  const inn = m.innings.find((i) => i.lastOver === o) ?? m.current!;
  const b = inn.bowls.get(o.bowlerId);
  return {
    over: o.over, bowlerId: o.bowlerId, bowlerName: m.name(o.bowlerId), runs: o.runs, wickets: o.wickets, maiden: o.maiden,
    chips: o.balls.map((x) => ({ label: x.label, kind: x.kind })),
    bowlerFigures: b ? `${formatBalls(b.balls)}-${b.maidens}-${b.runs}-${b.wickets}` : '',
    score: o.score,
  };
}

export function snapshotInnings(m: Machine, inn: Inn): InningsState {
  const live = !inn.complete;
  const batting: BatterStat[] = [];
  for (const r of inn.bats.values()) {
    const atCrease = r.id === inn.striker || r.id === inn.nonStriker;
    batting.push({
      id: r.id, name: m.name(r.id), order: r.order, runs: r.runs, balls: r.balls, fours: r.fours, sixes: r.sixes,
      strikeRate: r.balls ? round2((r.runs / r.balls) * 100) : 0,
      status: r.out ? 'out' : atCrease ? (live ? 'batting' : 'not out') : r.retiredHurt ? 'retired hurt' : 'not out',
      howOut: r.out && r.dismissal ? howOut(m, r) : '',
      onStrike: live && r.id === inn.striker,
    });
  }
  for (const p of m.roster[inn.battingSide]) {
    if (!inn.bats.has(p.id)) {
      batting.push({ id: p.id, name: p.name, order: null, runs: 0, balls: 0, fours: 0, sixes: 0, strikeRate: 0, status: 'yet to bat', howOut: '', onStrike: false });
    }
  }
  const bowling: BowlerStat[] = [...inn.bowls.values()].map((r) => ({
    id: r.id, name: m.name(r.id), balls: r.balls, overs: formatBalls(r.balls), maidens: r.maidens, runs: r.runs,
    wickets: r.wickets, wides: r.wides, noBalls: r.noBalls, dots: r.dots,
    economy: r.balls ? round2(r.runs / (r.balls / 6)) : 0, current: live && r.id === inn.bowler,
  }));
  const ballsRemaining = Math.max(0, (inn.maxOvers - inn.oversCompleted) * 6 - inn.ballsInOver);
  const crr = inn.legalBalls ? round2(inn.runs / (inn.legalBalls / 6)) : 0;
  const remainingOvers = ballsRemaining / 6;
  const extrasTotal = inn.extras.wd + inn.extras.nb + inn.extras.b + inn.extras.lb + inn.extras.pen;
  const runsNeeded = inn.target !== null ? Math.max(0, inn.target - inn.runs) : null;
  const rrr = inn.target !== null && ballsRemaining > 0 ? round2(((inn.target - inn.runs) / ballsRemaining) * 6) : null;
  const timeline = inn.timeline.map((r) => toBall(m, r));
  const currentOver = inn.curOver.map((r) => toBall(m, r));
  const lastOver = inn.lastOver ? overSummary(m, inn.lastOver) : null;
  const chips = (inn.curOver.length ? inn.curOver : inn.lastOver?.balls ?? []).map((x) => ({ label: x.label, kind: x.kind }));
  const sumLast = (n: number) => [...inn.overRuns, inn.curOver.reduce((a, b) => a + b.teamRuns, 0)].slice(-n).reduce((a, b) => a + b, 0);
  const partIds = [inn.striker, inn.nonStriker].filter((x): x is string => !!x);
  const needs = m.needs(inn);
  const eligibleLimit = m.bowlerLimitBalls(inn);
  return {
    number: inn.number, battingSide: inn.battingSide, bowlingSide: inn.bowlingSide,
    battingTeam: m.cfg.teams[inn.battingSide].name, bowlingTeam: m.cfg.teams[inn.bowlingSide].name,
    superOver: inn.superOver, maxOvers: inn.maxOvers, maxWickets: m.maxWickets(inn),
    runs: inn.runs, wickets: inn.wickets, legalBalls: inn.legalBalls, oversCompleted: inn.oversCompleted,
    ballsInOver: inn.ballsInOver, overs: `${inn.oversCompleted}.${inn.ballsInOver}`, ballsRemaining,
    extras: { ...inn.extras, total: extrasTotal }, adjustment: inn.adjustment, crr,
    projected: {
      current: Math.round(inn.runs + crr * remainingOvers),
      rates: [6, 8, 10, 12].map((rate) => ({ rate, score: Math.round(inn.runs + rate * remainingOvers) })),
    },
    powerplay: live && inn.oversCompleted < m.cfg.settings.powerplayOvers && !inn.superOver,
    freeHit: live && inn.freeHit, target: inn.target, runsNeeded, rrr,
    strikerId: inn.striker, nonStrikerId: inn.nonStriker, bowlerId: inn.bowler,
    batting, bowling,
    fow: inn.fow.map((f) => ({
      wicket: f.wicket, runs: f.runs, batterId: f.batterId, batterName: m.name(f.batterId), over: f.over,
      text: `${f.runs}/${f.wicket} (${m.name(f.batterId)}, ${f.over} ov)`,
    })),
    partnership: {
      runs: inn.part.runs, balls: inn.part.balls,
      batters: partIds.map((id) => ({ id, name: m.name(id), runs: inn.part.contrib.get(id)?.runs ?? 0, balls: inn.part.contrib.get(id)?.balls ?? 0 })),
    },
    timeline, currentOver, lastOver, thisOver: chips, runsLast5Overs: sumLast(5), runsLast10Overs: sumLast(10),
    complete: inn.complete, endReason: inn.endReason, needs,
    availableBatters: m.availableBatters(inn),
    eligibleBowlers: m.roster[inn.bowlingSide].map((p) => {
      let blocked: string | null = null;
      if (p.id === inn.bowler) blocked = 'Current bowler';
      else if (p.id === inn.prevOverBowler) blocked = 'Bowled the previous over';
      else if (eligibleLimit !== null && (inn.bowls.get(p.id)?.balls ?? 0) >= eligibleLimit) blocked = `Quota of ${eligibleLimit / 6} overs reached`;
      return { id: p.id, name: p.name, blocked };
    }),
  };
}

function checkInvariants(inn: InningsState): string[] {
  const errs: string[] = [];
  const prefix = `Innings ${inn.number}`;
  const batRuns = inn.batting.reduce((a, b) => a + b.runs, 0);
  if (batRuns + inn.extras.total + inn.adjustment !== inn.runs) errs.push(`${prefix}: batter runs ${batRuns} + extras ${inn.extras.total} + adjustment ${inn.adjustment} != total ${inn.runs}`);
  const bowlRuns = inn.bowling.reduce((a, b) => a + b.runs, 0);
  const nonBowler = inn.extras.b + inn.extras.lb + inn.extras.pen;
  if (bowlRuns + nonBowler + inn.adjustment !== inn.runs) errs.push(`${prefix}: bowler runs ${bowlRuns} + non-bowler extras ${nonBowler} + adjustment != total ${inn.runs}`);
  const bowlBalls = inn.bowling.reduce((a, b) => a + b.balls, 0);
  if (bowlBalls !== inn.legalBalls) errs.push(`${prefix}: bowler balls ${bowlBalls} != legal balls ${inn.legalBalls}`);
  const legal = inn.timeline.filter((b) => b.legal).length;
  if (legal !== inn.legalBalls) errs.push(`${prefix}: timeline legal balls ${legal} != ${inn.legalBalls}`);
  const outs = inn.batting.filter((b) => b.status === 'out').length;
  if (outs !== inn.wickets) errs.push(`${prefix}: dismissed batters ${outs} != wickets ${inn.wickets}`);
  return errs;
}

export function snapshot(m: Machine): LiveState {
  const cfg = m.cfg;
  const innings = m.innings.map((i) => snapshotInnings(m, i));
  const cur = innings[innings.length - 1] ?? null;
  const rawCur = m.current;
  const status: LiveState['status'] = m.result ? 'completed' : !cur ? 'setup' : cur.complete ? 'break' : 'live';
  const canSuperOver = !!m.result && m.result.kind === 'tie' && m.resultAuto;
  const teamName = (s: Side) => cfg.teams[s].name;
  let statusText = 'Not started';
  if (status === 'live' && cur) statusText = `${cur.superOver ? 'Super Over' : `Innings ${cur.number}`} · ${cur.battingTeam} batting`;
  else if (status === 'break') statusText = rawCur && rawCur.number % 2 === 1 ? 'Innings break' : 'Innings complete';
  else if (status === 'completed' && m.result) statusText = m.result.text;

  const bats = innings.filter((i) => !i.superOver).flatMap((i) => i.batting.filter((b) => b.balls > 0 || b.runs > 0).map((b) => ({ ...b, team: i.battingTeam })));
  const bowls = innings.filter((i) => !i.superOver).flatMap((i) => i.bowling.map((b) => ({ ...b, team: i.bowlingTeam })));
  const top = [...bats].sort((a, b) => b.runs - a.runs || a.balls - b.balls)[0];
  const best = [...bowls].sort((a, b) => b.wickets - a.wickets || a.runs - b.runs || b.balls - a.balls)[0];

  const fx = m.fx;
  const effects = fx.eventId ? { ...fx, wicket: fx.wicket ? { ...fx.wicket } : null } : null;
  if (effects?.wicket && rawCur) {
    const r = rawCur.bats.get(effects.wicket.batterId);
    if (r?.dismissal) effects.wicket.howOut = howOut(m, r);
  }

  return {
    matchId: cfg.id, title: cfg.title, venue: cfg.venue, overs: cfg.overs, playersPerSide: cfg.playersPerSide,
    teams: {
      A: { id: cfg.teams.A.id, name: cfg.teams.A.name, shortName: cfg.teams.A.shortName, color: cfg.teams.A.color, logo: cfg.teams.A.logo ?? null },
      B: { id: cfg.teams.B.id, name: cfg.teams.B.name, shortName: cfg.teams.B.shortName, color: cfg.teams.B.color, logo: cfg.teams.B.logo ?? null },
    },
    toss: cfg.toss ? { ...cfg.toss, text: `${teamName(cfg.toss.winner)} won the toss and chose to ${cfg.toss.decision}` } : null,
    rosters: { A: [...m.roster.A], B: [...m.roster.B] },
    status, statusText, innings, current: cur,
    nextBattingSide: status === 'setup' || status === 'break' || canSuperOver ? m.defaultBattingSide() : null,
    canSuperOver, revised: m.revised, result: m.result,
    performers: {
      topScorer: top ? { name: top.name, team: top.team, runs: top.runs, balls: top.balls } : null,
      bestBowler: best && (best.balls > 0) ? { name: best.name, team: best.team, wickets: best.wickets, runs: best.runs, overs: best.overs } : null,
    },
    eventCount: m.eventCount, effects, invariantErrors: innings.flatMap(checkInvariants),
  };
}
