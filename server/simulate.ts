import { EventPayload } from './engine';
import { log } from './logger';
import { ApiError, MatchService } from './matches';

export interface SimStatus {
  running: boolean;
  matchId: number | null;
  remaining: number;
}

/** Plays random balls through the real engine so every overlay can be watched without a real match. */
export class Simulator {
  private timer: NodeJS.Timeout | null = null;
  private matchId: number | null = null;
  private remaining = 0;

  constructor(private matches: MatchService, private onChange: () => void) {}

  status(): SimStatus {
    return { running: !!this.timer, matchId: this.matchId, remaining: this.remaining };
  }

  start(matchId: number, balls: number, speedMs: number): void {
    this.stop();
    this.matchId = matchId;
    this.remaining = balls;
    const tick = () => {
      try {
        this.step();
      } catch (e) {
        log.warn('[sim] stopped:', (e as Error).message);
        this.stop();
        return;
      }
      if (this.remaining > 0 && this.timer) this.timer = setTimeout(tick, speedMs);
      else this.stop();
    };
    this.timer = setTimeout(tick, 0);
    this.onChange();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.onChange();
  }

  private pick<T>(list: T[]): T {
    return list[Math.floor(Math.random() * list.length)];
  }

  private step(): void {
    const id = this.matchId!;
    for (let guard = 0; guard < 12; guard++) {
      const s = this.matches.state(id);
      if (s.status === 'completed') { this.remaining = 0; return; }
      const inn = s.current;
      if (s.status === 'setup' || s.status === 'break' || !inn) { this.matches.append(id, { type: 'START_INNINGS' }); continue; }
      if (inn.needs.openers) {
        const [a, b] = inn.availableBatters;
        this.matches.append(id, { type: 'SET_BATTERS', striker: a.id, nonStriker: b.id });
        continue;
      }
      if (inn.needs.batter) { this.matches.append(id, { type: 'NEW_BATTER', batter: inn.availableBatters[0].id }); continue; }
      if (inn.needs.bowler) {
        const ok = inn.eligibleBowlers.filter((b) => !b.blocked);
        if (!ok.length) throw new ApiError(409, 'NO_BOWLER', 'No eligible bowler is available.');
        this.matches.append(id, { type: 'SET_BOWLER', bowler: this.pick(ok).id });
        continue;
      }
      this.matches.append(id, this.randomBall(s.current!));
      this.remaining -= 1;
      return;
    }
  }

  private randomBall(inn: NonNullable<ReturnType<MatchService['state']>['current']>): EventPayload {
    const r = Math.random();
    const incoming = inn.availableBatters[0]?.id;
    const fielder = this.pick(inn.eligibleBowlers).id;
    if (r < 0.04) {
      const kinds = inn.freeHit ? (['runout'] as const) : (['bowled', 'caught', 'lbw', 'runout'] as const);
      const kind = this.pick([...kinds]);
      return { type: 'BALL', wicket: { kind, fielder: kind === 'caught' || kind === 'runout' ? fielder : undefined, incoming } };
    }
    if (r < 0.09) return { type: 'BALL', extra: 'wide', runs: this.pick([0, 0, 0, 1]) };
    if (r < 0.12) return { type: 'BALL', extra: 'noball', runs: this.pick([0, 0, 1, 4]) };
    if (r < 0.14) return { type: 'BALL', extra: 'bye', runs: 1 };
    if (r < 0.16) return { type: 'BALL', extra: 'legbye', runs: 1 };
    return { type: 'BALL', runs: this.pick([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 4, 4, 6]) };
  }
}
