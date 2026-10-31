import {
  BallInput, DismissalKind, Effects, EngineError, EngineEvent, ExtraKind, MatchConfig,
  MatchResult, Milestone, PlayerId, PlayerRef, Side,
} from './types';
import { ballChip, formatBalls } from './format';

export const BOWLER_WICKETS: DismissalKind[] = ['bowled', 'caught', 'lbw', 'stumped', 'hitwicket'];
const FREE_HIT_OK: DismissalKind[] = ['runout', 'obstructing', 'handled', 'hittwice'];
const ALL_BALL_KINDS: DismissalKind[] = [
  'bowled', 'caught', 'lbw', 'runout', 'stumped', 'hitwicket', 'obstructing', 'handled', 'hittwice',
];
const STRIKER_ONLY: DismissalKind[] = ['bowled', 'caught', 'lbw', 'stumped', 'hitwicket', 'handled', 'hittwice'];

export interface RawBall {
  eventId: number;
  innings: number;
  over: number;
  legalBefore: number;
  legal: boolean;
  bowlerId: PlayerId;
  strikerId: PlayerId;
  nonStrikerId: PlayerId;
  extra: ExtraKind | null;
  runs: number;
  batRuns: number;
  teamRuns: number;
  bowlerCharge: number;
  boundary: boolean;
  freeHit: boolean;
  label: string;
  kind: ReturnType<typeof ballChip>['kind'];
  wicket: { kind: DismissalKind; outId: PlayerId; fielderId?: PlayerId; creditBowler: boolean } | null;
  scoreAfter: string;
}

export interface BatRec {
  id: PlayerId; order: number; runs: number; balls: number; fours: number; sixes: number;
  out: boolean; retiredHurt: boolean;
  dismissal: { kind: DismissalKind; bowlerId: PlayerId | null; fielderId?: PlayerId } | null;
}

export interface BowlRec {
  id: PlayerId; balls: number; runs: number; wickets: number; maidens: number;
  wides: number; noBalls: number; dots: number;
}

export interface OverRec {
  over: number; bowlerId: PlayerId; runs: number; wickets: number; maiden: boolean;
  balls: RawBall[]; score: string;
}

export interface Inn {
  number: number;
  battingSide: Side;
  bowlingSide: Side;
  superOver: boolean;
  maxOvers: number;
  runs: number;
  wickets: number;
  legalBalls: number;
  oversCompleted: number;
  ballsInOver: number;
  extras: { wd: number; nb: number; b: number; lb: number; pen: number };
  adjustment: number;
  striker: PlayerId | null;
  nonStriker: PlayerId | null;
  bowler: PlayerId | null;
  prevOverBowler: PlayerId | null;
  bats: Map<PlayerId, BatRec>;
  bowls: Map<PlayerId, BowlRec>;
  fow: { wicket: number; runs: number; batterId: PlayerId; over: string }[];
  part: { runs: number; balls: number; contrib: Map<PlayerId, { runs: number; balls: number }> };
  timeline: RawBall[];
  curOver: RawBall[];
  lastOver: OverRec | null;
  overRuns: number[];
  freeHit: boolean;
  target: number | null;
  complete: boolean;
  endReason: 'allout' | 'overs' | 'target' | 'declared' | 'abandoned' | null;
  streak: { bowler: PlayerId | null; count: number };
}

function err(code: string, message: string): never {
  throw new EngineError(code, message);
}

export class Machine {
  roster: Record<Side, PlayerRef[]>;
  names = new Map<PlayerId, string>();
  innings: Inn[] = [];
  revised: { target: number; overs: number | null } | null = null;
  result: MatchResult | null = null;
  resultAuto = false;
  eventCount = 0;
  fx: Effects = this.blankFx(0);

  constructor(public cfg: MatchConfig) {
    this.roster = { A: [...cfg.teams.A.players], B: [...cfg.teams.B.players] };
    for (const p of [...this.roster.A, ...this.roster.B]) this.names.set(p.id, p.name);
  }

  private blankFx(eventId: number): Effects {
    return { eventId, boundary: null, wicket: null, milestones: [], overCompleted: false, newBatter: null, inningsEnded: false, resultSet: false };
  }

  get current(): Inn | null {
    return this.innings[this.innings.length - 1] ?? null;
  }

  name(id: PlayerId | null | undefined): string {
    return id ? this.names.get(id) ?? id : '';
  }

  sideOf(id: PlayerId): Side | null {
    if (this.roster.A.some((p) => p.id === id)) return 'A';
    if (this.roster.B.some((p) => p.id === id)) return 'B';
    return null;
  }

  maxWickets(inn: Inn): number {
    if (inn.superOver) return 2;
    return Math.min(this.cfg.playersPerSide, this.roster[inn.battingSide].length) - 1;
  }

  bowlerLimitBalls(inn: Inn): number | null {
    if (!this.cfg.settings.limitBowlerOvers) return null;
    const bowlers = Math.max(1, this.roster[inn.bowlingSide].length);
    return Math.max(Math.ceil(inn.maxOvers / 5), Math.ceil(inn.maxOvers / bowlers)) * 6;
  }

  defaultBattingSide(): Side {
    const n = this.innings.length;
    if (n === 0) {
      const t = this.cfg.toss;
      if (!t) return 'A';
      return t.decision === 'bat' ? t.winner : t.winner === 'A' ? 'B' : 'A';
    }
    const last = this.innings[n - 1];
    if (n >= 2 && (n + 1) % 2 === 1) return last.battingSide;
    return last.battingSide === 'A' ? 'B' : 'A';
  }

  private activeInnings(): Inn {
    if (this.result) err('MATCH_COMPLETE', 'The match is already completed.');
    const inn = this.current;
    if (!inn) err('NO_INNINGS', 'Start an innings first.');
    if (inn.complete) err('INNINGS_COMPLETE', 'This innings is complete.');
    return inn;
  }

  needs(inn: Inn): { openers: boolean; bowler: boolean; batter: boolean } {
    if (inn.complete) return { openers: false, bowler: false, batter: false };
    const openers = inn.bats.size === 0 && (!inn.striker || !inn.nonStriker);
    return {
      openers,
      bowler: !inn.bowler,
      batter: !openers && (inn.striker === null || inn.nonStriker === null),
    };
  }

  private requireReady(inn: Inn): void {
    const n = this.needs(inn);
    if (n.openers) err('PROMPT_OPEN', 'Select the opening batters before scoring.');
    if (n.batter) err('PROMPT_OPEN', 'Select the incoming batter before scoring.');
    if (n.bowler) err('PROMPT_OPEN', 'Select the bowler before scoring.');
  }

  private bat(inn: Inn, id: PlayerId): BatRec {
    let r = inn.bats.get(id);
    if (!r) {
      r = { id, order: inn.bats.size + 1, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, retiredHurt: false, dismissal: null };
      inn.bats.set(id, r);
    }
    return r;
  }

  private bowl(inn: Inn, id: PlayerId): BowlRec {
    let r = inn.bowls.get(id);
    if (!r) {
      r = { id, balls: 0, runs: 0, wickets: 0, maidens: 0, wides: 0, noBalls: 0, dots: 0 };
      inn.bowls.set(id, r);
    }
    return r;
  }

  private inRoster(side: Side, id: PlayerId): void {
    if (!this.roster[side].some((p) => p.id === id)) err('NOT_IN_TEAM', `Player is not in the ${this.cfg.teams[side].name} squad.`);
  }

  private canBat(inn: Inn, id: PlayerId): boolean {
    return !inn.bats.get(id)?.out && id !== inn.striker && id !== inn.nonStriker;
  }

  availableBatters(inn: Inn): PlayerRef[] {
    if (inn.complete) return [];
    return this.roster[inn.battingSide].filter((p) => this.canBat(inn, p.id));
  }

  apply(ev: EngineEvent): void {
    this.fx = this.blankFx(ev.id);
    this.eventCount += 1;
    switch (ev.type) {
      case 'START_INNINGS': return this.startInnings(ev.battingSide);
      case 'SET_BATTERS': return this.setBatters(ev.striker, ev.nonStriker);
      case 'NEW_BATTER': return this.newBatter(ev.batter);
      case 'SET_BOWLER': return this.setBowler(ev.bowler);
      case 'BALL': return this.ball(ev.id, ev);
      case 'SWAP_STRIKE': {
        const inn = this.activeInnings();
        [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];
        return;
      }
      case 'PENALTY': {
        const inn = this.activeInnings();
        if (ev.runs <= 0) err('BAD_RUNS', 'Penalty runs must be positive.');
        inn.runs += ev.runs; inn.extras.pen += ev.runs; inn.part.runs += ev.runs;
        return this.checkEnd(inn);
      }
      case 'ADJUSTMENT': {
        const inn = this.current;
        if (!inn) err('NO_INNINGS', 'Start an innings first.');
        inn.runs += ev.runs; inn.adjustment += ev.runs;
        if (inn.runs < 0) err('BAD_RUNS', 'Total cannot go below zero.');
        if (!inn.complete) this.checkEnd(inn); else this.refreshAutoResult();
        return;
      }
      case 'RETIRE': return this.retireHurt(ev.batter);
      case 'END_OVER': {
        const inn = this.activeInnings();
        if (inn.ballsInOver === 0) err('NO_OVER', 'No legal balls have been bowled in this over.');
        this.completeOver(inn);
        return this.checkEnd(inn);
      }
      case 'END_INNINGS': {
        const inn = this.activeInnings();
        if (this.needs(inn).openers) err('PROMPT_OPEN', 'Select the opening batters before ending the innings.');
        return this.finishInnings(inn, ev.reason ?? 'declared');
      }
      case 'ADD_PLAYER': {
        if (this.names.has(ev.player.id)) err('DUPLICATE_PLAYER', 'A player with that id already exists.');
        this.roster[ev.side].push(ev.player);
        this.names.set(ev.player.id, ev.player.name);
        return;
      }
      case 'RENAME_PLAYER': {
        if (!this.names.has(ev.playerId)) err('NOT_FOUND', 'Unknown player.');
        this.names.set(ev.playerId, ev.name);
        for (const side of ['A', 'B'] as Side[]) {
          this.roster[side] = this.roster[side].map((p) => (p.id === ev.playerId ? { ...p, name: ev.name } : p));
        }
        return;
      }
      case 'REVISED_TARGET': return this.reviseTarget(ev.target, ev.overs ?? null);
      case 'MATCH_RESULT': return this.setResult(ev.kind, ev.winner, ev.text);
    }
  }

  private startInnings(side?: Side): void {
    if (this.result && !(this.resultAuto && this.result.kind === 'tie')) err('MATCH_COMPLETE', 'The match is already completed.');
    const prev = this.current;
    if (prev && !prev.complete) err('INNINGS_IN_PROGRESS', 'Finish the current innings first.');
    const number = this.innings.length + 1;
    const batting = side ?? this.defaultBattingSide();
    if (prev && number % 2 === 0 && prev.battingSide === batting) err('SAME_BATTING_SIDE', 'The other side must bat in this innings.');
    const superOver = number > 2;
    const chase = number % 2 === 0;
    const rev = number === 2 ? this.revised : null;
    const inn: Inn = {
      number, battingSide: batting, bowlingSide: batting === 'A' ? 'B' : 'A', superOver,
      maxOvers: superOver ? 1 : rev?.overs ?? this.cfg.overs,
      runs: 0, wickets: 0, legalBalls: 0, oversCompleted: 0, ballsInOver: 0,
      extras: { wd: 0, nb: 0, b: 0, lb: 0, pen: 0 }, adjustment: 0,
      striker: null, nonStriker: null, bowler: null, prevOverBowler: null,
      bats: new Map(), bowls: new Map(), fow: [],
      part: { runs: 0, balls: 0, contrib: new Map() },
      timeline: [], curOver: [], lastOver: null, overRuns: [], freeHit: false,
      target: chase && prev ? (rev?.target ?? prev.runs + 1) : null,
      complete: false, endReason: null, streak: { bowler: null, count: 0 },
    };
    this.result = null;
    this.resultAuto = false;
    this.innings.push(inn);
  }

  private setBatters(striker: PlayerId, nonStriker: PlayerId): void {
    const inn = this.activeInnings();
    if (striker === nonStriker) err('SAME_BATTER', 'Striker and non-striker must be different players.');
    for (const id of [striker, nonStriker]) {
      this.inRoster(inn.battingSide, id);
      if (inn.bats.get(id)?.out) err('BATTER_OUT', `${this.name(id)} is already out.`);
    }
    for (const old of [inn.striker, inn.nonStriker]) {
      if (old && old !== striker && old !== nonStriker) {
        const r = inn.bats.get(old);
        if (r && r.balls === 0 && r.runs === 0) inn.bats.delete(old);
        else if (r) r.retiredHurt = true;
      }
    }
    inn.striker = striker; inn.nonStriker = nonStriker;
    for (const id of [striker, nonStriker]) {
      const r = this.bat(inn, id);
      r.retiredHurt = false;
      if (!inn.part.contrib.has(id)) inn.part.contrib.set(id, { runs: 0, balls: 0 });
    }
    this.reorderBats(inn);
  }

  /** Keeps `order` dense and in arrival order after batters were removed. */
  private reorderBats(inn: Inn): void {
    let i = 1;
    for (const r of inn.bats.values()) r.order = i++;
  }

  private newBatter(id: PlayerId): void {
    const inn = this.activeInnings();
    if (inn.striker !== null && inn.nonStriker !== null) err('NO_VACANCY', 'Both batters are already at the crease.');
    this.fillVacancy(inn, id);
  }

  private fillVacancy(inn: Inn, id: PlayerId): void {
    this.inRoster(inn.battingSide, id);
    if (inn.bats.get(id)?.out) err('BATTER_OUT', `${this.name(id)} is already out.`);
    if (id === inn.striker || id === inn.nonStriker) err('SAME_BATTER', `${this.name(id)} is already batting.`);
    const r = this.bat(inn, id);
    r.retiredHurt = false;
    if (inn.striker === null) inn.striker = id; else inn.nonStriker = id;
    if (!inn.part.contrib.has(id)) inn.part.contrib.set(id, { runs: 0, balls: 0 });
    this.fx.newBatter = { id, name: this.name(id) };
    this.checkEnd(inn);
  }

  private retireHurt(id: PlayerId): void {
    const inn = this.activeInnings();
    if (id !== inn.striker && id !== inn.nonStriker) err('NOT_AT_CREASE', 'That batter is not at the crease.');
    const r = this.bat(inn, id);
    r.retiredHurt = true;
    if (inn.striker === id) inn.striker = null; else inn.nonStriker = null;
    inn.part = { runs: 0, balls: 0, contrib: new Map() };
    const other = inn.striker ?? inn.nonStriker;
    if (other) inn.part.contrib.set(other, { runs: 0, balls: 0 });
    this.checkEnd(inn);
  }

  private setBowler(id: PlayerId): void {
    const inn = this.activeInnings();
    this.inRoster(inn.bowlingSide, id);
    if (id === inn.bowler) err('SAME_BOWLER', `${this.name(id)} is already the current bowler.`);
    if (id === inn.prevOverBowler) err('CONSECUTIVE_OVER', `${this.name(id)} bowled the previous over and cannot bowl consecutive overs.`);
    const limit = this.bowlerLimitBalls(inn);
    if (limit !== null && (inn.bowls.get(id)?.balls ?? 0) >= limit) {
      err('BOWLER_QUOTA', `${this.name(id)} has bowled the maximum ${limit / 6} overs.`);
    }
    inn.bowler = id;
    this.bowl(inn, id);
  }

  private reviseTarget(target: number, overs: number | null): void {
    this.revised = { target, overs };
    const inn = this.current;
    if (inn && inn.number === 2 && !inn.complete) {
      inn.target = target;
      if (overs !== null) inn.maxOvers = overs;
      this.checkEnd(inn);
    }
  }

  private setResult(kind: 'tie' | 'noresult' | 'won', winner: Side | undefined, text?: string): void {
    if (kind === 'won' && !winner) err('BAD_RESULT', 'Pick the winning team.');
    const winnerName = kind === 'won' && winner ? this.cfg.teams[winner].name : null;
    this.result = {
      kind, winner: kind === 'won' ? winner! : null, winnerName,
      text: text?.trim() || (kind === 'tie' ? 'Match tied' : kind === 'noresult' ? 'No result' : `${winnerName} won`),
    };
    this.resultAuto = false;
    this.fx.resultSet = true;
  }

  private ball(eventId: number, e: BallInput): void {
    const inn = this.activeInnings();
    this.requireReady(inn);
    const extra = e.extra ?? null;
    const runs = e.runs ?? 0;
    const over = e.overthrows ?? 0;
    if (runs < 0 || over < 0 || !Number.isInteger(runs) || !Number.isInteger(over)) err('BAD_RUNS', 'Runs must be whole numbers.');
    if (extra === 'dead' && (runs || over)) err('BAD_RUNS', 'A dead ball carries no runs.');
    if (e.noballExtra && extra !== 'noball') err('BAD_EXTRA', 'Bye/leg-bye options only apply to no-balls.');
    const w = e.wicket;
    const strikerId = inn.striker!;
    const nonStrikerId = inn.nonStriker!;
    const bowlerId = inn.bowler!;
    const freeHit = inn.freeHit;
    if (w) this.validateWicket(inn, extra, w, runs, freeHit);

    const boundary = (e.boundary ?? true) && (runs === 4 || runs === 6) && extra !== 'dead';
    const runsRun = (boundary ? 0 : runs) + over;
    const total = runs + over;
    const legal = extra === null || extra === 'bye' || extra === 'legbye';
    const batBall = extra === null || (extra === 'noball' && !e.noballExtra);
    let batRuns = 0, teamRuns = 0, charge = 0;
    switch (extra) {
      case null: batRuns = total; teamRuns = total; charge = total; break;
      case 'wide': inn.extras.wd += 1 + total; teamRuns = 1 + total; charge = teamRuns; break;
      case 'noball':
        inn.extras.nb += 1; teamRuns = 1; charge = 1;
        if (e.noballExtra === 'bye') { inn.extras.b += total; teamRuns += total; }
        else if (e.noballExtra === 'legbye') { inn.extras.lb += total; teamRuns += total; }
        else { batRuns = total; teamRuns += total; charge += total; }
        break;
      case 'bye': inn.extras.b += total; teamRuns = total; break;
      case 'legbye': inn.extras.lb += total; teamRuns = total; break;
      case 'dead': break;
    }
    const bat = this.bat(inn, strikerId);
    const bowl = this.bowl(inn, bowlerId);
    const before = { bat: bat.runs, wkts: bowl.wickets };
    inn.runs += teamRuns;
    inn.part.runs += teamRuns;
    const contrib = inn.part.contrib.get(strikerId) ?? { runs: 0, balls: 0 };
    inn.part.contrib.set(strikerId, contrib);
    bat.runs += batRuns; contrib.runs += batRuns;
    const faced = extra !== 'wide' && extra !== 'dead';
    if (faced) { bat.balls += 1; contrib.balls += 1; }
    if (batBall && boundary) { if (runs === 4) bat.fours += 1; else bat.sixes += 1; }
    bowl.runs += charge;
    if (extra === 'wide') bowl.wides += 1 + total;
    if (extra === 'noball') bowl.noBalls += 1;
    if (legal) {
      bowl.balls += 1; inn.legalBalls += 1; inn.part.balls += 1;
      if (charge === 0) bowl.dots += 1;
    }
    const legalBefore = inn.ballsInOver;
    if (legal) inn.ballsInOver += 1;

    // Strike rotation: positions after the runs that were physically run, then any wicket.
    let s: PlayerId | null = strikerId;
    let n: PlayerId | null = nonStrikerId;
    let parity = runsRun % 2;
    if (w && (w.kind === 'caught' || w.kind === 'runout') && w.crossed) parity ^= 1;
    if (parity) [s, n] = [n, s];
    let outId: PlayerId | null = null;
    if (w) {
      outId = w.out ?? strikerId;
      if (s === outId) s = null; else if (n === outId) n = null;
      const creditBowler = BOWLER_WICKETS.includes(w.kind);
      const rec = this.bat(inn, outId);
      rec.out = true;
      rec.dismissal = { kind: w.kind, bowlerId: creditBowler ? bowlerId : null, fielderId: w.fielder };
      inn.wickets += 1;
      if (creditBowler) bowl.wickets += 1;
      inn.fow.push({ wicket: inn.wickets, runs: inn.runs, batterId: outId, over: this.oversText(inn, legalBefore, legal) });
      inn.part = { runs: 0, balls: 0, contrib: new Map() };
      const survivor = s ?? n;
      if (survivor) inn.part.contrib.set(survivor, { runs: 0, balls: 0 });
    }
    inn.striker = s; inn.nonStriker = n;

    // Streak for hat-tricks: consecutive legal deliveries by one bowler that all took wickets.
    if (legal) {
      const credited = !!w && BOWLER_WICKETS.includes(w.kind);
      if (credited) inn.streak = { bowler: bowlerId, count: inn.streak.bowler === bowlerId ? inn.streak.count + 1 : 1 };
      else inn.streak = { bowler: null, count: 0 };
    }

    inn.freeHit = extra === 'noball' ? true : extra === 'wide' || extra === 'dead' ? freeHit : false;

    const chip = ballChip({ extra, runs: total, noballExtra: e.noballExtra, wicket: !!w, boundary, batRuns });
    const raw: RawBall = {
      eventId, innings: inn.number, over: inn.oversCompleted, legalBefore, legal, bowlerId, strikerId, nonStrikerId,
      extra, runs: total, batRuns, teamRuns, bowlerCharge: charge, boundary, freeHit, label: chip.label, kind: chip.kind,
      wicket: w && outId ? { kind: w.kind, outId, fielderId: w.fielder, creditBowler: BOWLER_WICKETS.includes(w.kind) } : null,
      scoreAfter: `${inn.runs}/${inn.wickets}`,
    };
    inn.timeline.push(raw);
    inn.curOver.push(raw);

    this.collectEffects(inn, raw, batRuns, boundary && batBall ? (runs as 4 | 6) : null, before, bowlerId, strikerId, outId);

    if (legal && inn.ballsInOver >= 6) { this.completeOver(inn); }
    if (w?.incoming && (inn.striker === null || inn.nonStriker === null) && inn.wickets < this.maxWickets(inn)) {
      this.fillVacancy(inn, w.incoming);
    }
    this.checkEnd(inn);
  }

  private oversText(inn: Inn, legalBefore: number, legal: boolean): string {
    return formatBalls(inn.oversCompleted * 6 + legalBefore + (legal ? 1 : 0));
  }

  private validateWicket(inn: Inn, extra: ExtraKind | null, w: NonNullable<BallInput['wicket']>, runs: number, freeHit: boolean): void {
    let allowed: DismissalKind[];
    if (extra === 'wide') allowed = ['stumped', 'runout', 'hitwicket'];
    else if (extra === 'noball') allowed = ['runout', 'obstructing', 'handled', 'hittwice'];
    else if (extra === 'bye' || extra === 'legbye') allowed = ['runout', 'stumped', 'hitwicket', 'obstructing', 'handled', 'hittwice'];
    else if (extra === 'dead') allowed = ['timedout', 'retiredout'];
    else allowed = ALL_BALL_KINDS;
    if (freeHit && extra !== 'dead') allowed = allowed.filter((k) => FREE_HIT_OK.includes(k));
    if (!allowed.includes(w.kind)) {
      const where = freeHit && extra !== 'dead' ? 'on a free hit' : extra ? `on a ${extra === 'legbye' ? 'leg bye' : extra === 'noball' ? 'no-ball' : extra}` : 'on this delivery';
      err('INVALID_DISMISSAL', `${dismissalName(w.kind)} is not a valid dismissal ${where}.`);
    }
    if (['bowled', 'caught', 'lbw'].includes(w.kind) && runs > 0) err('BAD_RUNS', `No runs can be scored when a batter is ${dismissalName(w.kind).toLowerCase()}.`);
    const out = w.out ?? inn.striker!;
    if (out !== inn.striker && out !== inn.nonStriker) err('NOT_AT_CREASE', 'The dismissed batter must be at the crease.');
    if (STRIKER_ONLY.includes(w.kind) && out !== inn.striker) err('INVALID_DISMISSAL', `${dismissalName(w.kind)} can only dismiss the striker.`);
    if (w.fielder && this.sideOf(w.fielder) !== inn.bowlingSide) err('NOT_IN_TEAM', 'The fielder must belong to the bowling side.');
  }

  private collectEffects(inn: Inn, raw: RawBall, batRuns: number, boundary: 4 | 6 | null, before: { bat: number; wkts: number }, bowlerId: PlayerId, strikerId: PlayerId, outId: PlayerId | null): void {
    const fx = this.fx;
    fx.boundary = boundary;
    if (raw.wicket && outId) {
      const r = inn.bats.get(outId)!;
      fx.wicket = {
        batterId: outId, name: this.name(outId), howOut: '', runs: r.runs, balls: r.balls,
        strikeRate: r.balls ? Math.round((r.runs / r.balls) * 10000) / 100 : 0, bowler: this.name(bowlerId),
      };
    }
    const ms: Milestone[] = [];
    const after = inn.bats.get(strikerId)!.runs;
    if (batRuns > 0) {
      for (const m of [50, 100, 150, 200, 250, 300]) {
        if (before.bat < m && after >= m) {
          ms.push({ id: `${raw.eventId}:bat${m}`, kind: m === 50 ? 'fifty' : m === 100 ? 'hundred' : 'runs', playerId: strikerId, name: this.name(strikerId), text: String(m) });
        }
      }
    }
    const bw = inn.bowls.get(bowlerId)!;
    if (before.wkts < 5 && bw.wickets >= 5) ms.push({ id: `${raw.eventId}:five`, kind: 'fivefor', playerId: bowlerId, name: this.name(bowlerId), text: '5 WICKETS' });
    if (inn.streak.count === 3 && inn.streak.bowler === bowlerId) ms.push({ id: `${raw.eventId}:hat`, kind: 'hattrick', playerId: bowlerId, name: this.name(bowlerId), text: 'HAT-TRICK' });
    fx.milestones = ms;
  }

  private completeOver(inn: Inn): void {
    const balls = inn.curOver;
    const bowlerId = inn.bowler ?? balls[balls.length - 1]?.bowlerId ?? '';
    const runs = balls.reduce((a, b) => a + b.teamRuns, 0);
    const wickets = balls.filter((b) => b.wicket).length;
    const single = balls.every((b) => b.bowlerId === bowlerId);
    const maiden = inn.ballsInOver === 6 && single && balls.every((b) => b.bowlerCharge === 0);
    if (maiden) this.bowl(inn, bowlerId).maidens += 1;
    inn.lastOver = { over: inn.oversCompleted + 1, bowlerId, runs, wickets, maiden, balls: [...balls], score: `${inn.runs}/${inn.wickets}` };
    inn.overRuns.push(runs);
    inn.oversCompleted += 1;
    inn.ballsInOver = 0;
    inn.prevOverBowler = bowlerId;
    inn.bowler = null;
    inn.curOver = [];
    [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];
    this.fx.overCompleted = true;
  }

  private checkEnd(inn: Inn): void {
    if (inn.complete) return;
    if (inn.target !== null && inn.runs >= inn.target) return this.finishInnings(inn, 'target');
    if (inn.wickets >= this.maxWickets(inn)) return this.finishInnings(inn, 'allout');
    if (inn.oversCompleted >= inn.maxOvers) return this.finishInnings(inn, 'overs');
    if ((inn.striker === null || inn.nonStriker === null) && this.availableBatters(inn).length === 0) return this.finishInnings(inn, 'allout');
  }

  private finishInnings(inn: Inn, reason: NonNullable<Inn['endReason']>): void {
    inn.complete = true;
    inn.endReason = reason;
    this.fx.inningsEnded = true;
    if (inn.number % 2 === 0) this.computeChaseResult(inn);
  }

  private refreshAutoResult(): void {
    const inn = this.current;
    if (inn && inn.complete && inn.number % 2 === 0 && (this.resultAuto || !this.result)) this.computeChaseResult(inn);
  }

  private computeChaseResult(inn: Inn): void {
    const first = this.innings[inn.number - 2];
    const target = inn.target ?? first.runs + 1;
    const so = inn.superOver;
    const name = (s: Side) => this.cfg.teams[s].name;
    let r: MatchResult;
    if (inn.runs >= target) {
      const wk = this.maxWickets(inn) - inn.wickets;
      const left = (inn.maxOvers - inn.oversCompleted) * 6 - inn.ballsInOver;
      r = {
        kind: 'won', winner: inn.battingSide, winnerName: name(inn.battingSide),
        text: so ? `${name(inn.battingSide)} won the Super Over` : `${name(inn.battingSide)} won by ${plural(wk, 'wicket')} (${plural(Math.max(left, 0), 'ball')} left)`,
      };
    } else if (inn.runs === target - 1) {
      r = { kind: 'tie', winner: null, winnerName: null, text: so ? 'Super Over tied' : 'Match tied' };
    } else {
      r = {
        kind: 'won', winner: first.battingSide, winnerName: name(first.battingSide),
        text: so ? `${name(first.battingSide)} won the Super Over` : `${name(first.battingSide)} won by ${plural(target - 1 - inn.runs, 'run')}`,
      };
    }
    this.result = r;
    this.resultAuto = true;
    this.fx.resultSet = true;
  }
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function dismissalName(k: DismissalKind): string {
  const map: Record<DismissalKind, string> = {
    bowled: 'Bowled', caught: 'Caught', lbw: 'LBW', runout: 'Run out', stumped: 'Stumped', hitwicket: 'Hit wicket',
    retiredout: 'Retired out', obstructing: 'Obstructing the field', timedout: 'Timed out', handled: 'Handled the ball', hittwice: 'Hit the ball twice',
  };
  return map[k];
}
