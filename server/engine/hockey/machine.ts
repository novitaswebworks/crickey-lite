import { EngineError, PlayerId, PlayerRef, Side, TeamConfig } from '../types';
import type {
  CardRecord, GoalRecord, HockeyEffects, HockeyEngineEvent,
  HockeyMatchConfig, HockeyMatchResult, HockeySuspension, ShootoutAttempt, ShootoutRound
} from './types';

export function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export class HockeyMachine {
  readonly id: string;
  readonly title: string;
  readonly venue: string;
  readonly playersPerSide: number;
  readonly teams: Record<Side, TeamConfig>;
  readonly rosters: Record<Side, PlayerRef[]>;

  readonly totalPeriods: number;
  readonly periodDurationMs: number;

  period: number = 1;
  displayMs: number;
  clockRunning: boolean = false;
  clockStartedAt: number | null = null;
  clockAdjustmentMs: number = 0;
  totalElapsedGameTimeMs: number = 0;

  goals: GoalRecord[] = [];
  cards: CardRecord[] = [];
  penaltyCorners: Record<Side, number> = { A: 0, B: 0 };

  shootoutActive: boolean = false;
  shootoutAttempts: ShootoutAttempt[] = [];

  result: HockeyMatchResult | null = null;
  effects: HockeyEffects | null = null;
  eventCount: number = 0;
  lastEventAt: number = 0;

  constructor(public readonly config: HockeyMatchConfig) {
    this.id = config.id;
    this.title = config.title;
    this.venue = config.venue;
    this.playersPerSide = config.playersPerSide;
    this.teams = {
      A: { ...config.teams.A, players: [...config.teams.A.players] },
      B: { ...config.teams.B, players: [...config.teams.B.players] },
    };
    this.rosters = {
      A: [...config.teams.A.players],
      B: [...config.teams.B.players],
    };

    this.totalPeriods = config.settings.periods === 2 ? 2 : 4;
    this.periodDurationMs = (config.settings.periodDurationMins || (this.totalPeriods === 2 ? 35 : 15)) * 60 * 1000;
    this.displayMs = this.periodDurationMs;
  }

  name(id: PlayerId | undefined): string {
    if (!id) return '';
    if (id === 'OG') return 'Own Goal';
    for (const s of ['A', 'B'] as const) {
      const p = this.rosters[s].find((r) => r.id === id);
      if (p) return p.name;
    }
    return id;
  }

  score(side: Side): number {
    return this.goals.filter((g) => g.teamSide === side).length;
  }

  /** Current elapsed time within the active period, in ms. */
  currentPeriodElapsedMs(atTimestamp: number): number {
    let elapsed = this.periodDurationMs - this.displayMs;
    if (this.clockRunning && this.clockStartedAt !== null) {
      elapsed += Math.max(0, atTimestamp - this.clockStartedAt);
    }
    return Math.max(0, Math.min(this.periodDurationMs, elapsed));
  }

  apply(event: HockeyEngineEvent): void {
    this.eventCount++;
    this.effects = null;

    switch (event.type) {
      case 'START_CLOCK': {
        const at = event.at;
        this.lastEventAt = at;
        if (!this.clockRunning) {
          this.clockRunning = true;
          this.clockStartedAt = at;
        }
        break;
      }

      case 'STOP_CLOCK': {
        const at = event.at;
        this.lastEventAt = at;
        if (this.clockRunning && this.clockStartedAt !== null) {
          const delta = Math.max(0, at - this.clockStartedAt);
          this.displayMs = Math.max(0, this.displayMs - delta);
          this.totalElapsedGameTimeMs += delta;
          this.clockRunning = false;
          this.clockStartedAt = null;
        }
        break;
      }

      case 'ADJUST_CLOCK': {
        const at = event.at ?? this.lastEventAt;
        this.lastEventAt = at;
        if (this.clockRunning && this.clockStartedAt !== null) {
          const elapsed = Math.max(0, at - this.clockStartedAt);
          const curLive = Math.max(0, this.displayMs - elapsed);
          this.displayMs = Math.max(0, Math.min(this.periodDurationMs, curLive + event.deltaMs));
          this.clockStartedAt = at;
        } else {
          this.displayMs = Math.max(0, Math.min(this.periodDurationMs, this.displayMs + event.deltaMs));
        }
        this.clockAdjustmentMs += event.deltaMs;
        break;
      }

      case 'SET_PERIOD': {
        const at = event.at ?? this.lastEventAt;
        this.lastEventAt = at;
        if (this.clockRunning && this.clockStartedAt !== null) {
          const delta = Math.max(0, at - this.clockStartedAt);
          this.totalElapsedGameTimeMs += delta;
        }
        this.clockRunning = false;
        this.clockStartedAt = null;
        if (event.period < 1 || event.period > this.totalPeriods) {
          throw new EngineError('BAD_PERIOD', `Period must be between 1 and ${this.totalPeriods}.`);
        }
        this.period = event.period;
        this.displayMs = this.periodDurationMs;
        break;
      }

      case 'END_PERIOD': {
        const at = event.at ?? this.lastEventAt;
        this.lastEventAt = at;
        if (this.clockRunning && this.clockStartedAt !== null) {
          const delta = Math.max(0, at - this.clockStartedAt);
          this.totalElapsedGameTimeMs += delta;
        }
        this.clockRunning = false;
        this.clockStartedAt = null;
        this.displayMs = 0;
        break;
      }

      case 'GOAL': {
        const at = event.at;
        this.lastEventAt = at;
        if (!['A', 'B'].includes(event.teamSide)) {
          throw new EngineError('BAD_TEAM', 'Invalid team side for goal.');
        }

        const scorerName = this.name(event.scorerId);
        const assistName = event.assistId ? this.name(event.assistId) : undefined;
        const clockDisplay = formatClock(this.displayMs);

        const goal: GoalRecord = {
          id: event.id,
          teamSide: event.teamSide,
          scorerId: event.scorerId,
          scorerName,
          assistId: event.assistId,
          assistName,
          kind: event.kind,
          period: this.period,
          clockDisplay,
          at,
        };
        this.goals.push(goal);

        this.effects = {
          eventId: event.id,
          goal: {
            eventId: event.id,
            teamSide: event.teamSide,
            scorerName,
            assistName,
            kind: event.kind,
            time: `${formatClock(this.displayMs)} (${this.periodLabel})`,
            scoreA: this.score('A'),
            scoreB: this.score('B'),
            teamShort: this.teams[event.teamSide].shortName,
          },
        };
        break;
      }

      case 'PENALTY_CORNER': {
        const at = event.at;
        this.lastEventAt = at;
        if (!['A', 'B'].includes(event.teamSide)) {
          throw new EngineError('BAD_TEAM', 'Invalid team side for penalty corner.');
        }
        this.penaltyCorners[event.teamSide] = (this.penaltyCorners[event.teamSide] ?? 0) + 1;
        this.effects = {
          eventId: event.id,
          penaltyCorner: {
            teamSide: event.teamSide,
            teamShort: this.teams[event.teamSide].shortName,
          },
        };
        break;
      }

      case 'CARD': {
        const at = event.at;
        this.lastEventAt = at;
        if (!['A', 'B'].includes(event.teamSide)) {
          throw new EngineError('BAD_TEAM', 'Invalid team side for card.');
        }

        const playerName = this.name(event.playerId);
        const card: CardRecord = {
          id: event.id,
          teamSide: event.teamSide,
          playerId: event.playerId,
          playerName,
          kind: event.kind,
          durationMs: event.durationMs,
          period: this.period,
          at,
        };
        this.cards.push(card);

        const durationLabel =
          event.kind === 'red'
            ? 'Permanent'
            : event.durationMs >= 60_000
            ? `${Math.round(event.durationMs / 60_000)}m`
            : `${Math.round(event.durationMs / 1000)}s`;

        this.effects = {
          eventId: event.id,
          card: {
            eventId: event.id,
            teamSide: event.teamSide,
            playerName,
            cardKind: event.kind,
            durationLabel,
            teamShort: this.teams[event.teamSide].shortName,
          },
        };
        break;
      }

      case 'START_SHOOTOUT': {
        this.shootoutActive = true;
        break;
      }

      case 'SHOOTOUT_ATTEMPT': {
        this.shootoutActive = true;
        const attempt: ShootoutAttempt = {
          teamSide: event.teamSide,
          round: event.round,
          scored: event.scored,
          takerId: event.takerId,
          takerName: event.takerId ? this.name(event.takerId) : undefined,
        };
        this.shootoutAttempts.push(attempt);
        break;
      }

      case 'MATCH_RESULT': {
        const at = event.at ?? (this.lastEventAt || Date.now());
        if (this.clockRunning && this.clockStartedAt !== null) {
          const elapsed = Math.max(0, at - this.clockStartedAt);
          this.displayMs = Math.max(0, this.displayMs - elapsed);
          this.totalElapsedGameTimeMs += elapsed;
          this.clockRunning = false;
          this.clockStartedAt = null;
        }
        this.lastEventAt = at;
        this.result = {
          kind: event.kind,
          winner: event.winner,
          text: event.text || this.defaultResultText(event.kind, event.winner),
        };
        break;
      }

      case 'ADD_PLAYER': {
        this.rosters[event.side].push(event.player);
        break;
      }

      default:
        break;
    }
  }

  get periodLabel(): string {
    if (this.shootoutActive) return 'SO';
    if (this.totalPeriods === 2) {
      return this.period === 1 ? 'H1' : 'H2';
    }
    return `Q${this.period}`;
  }

  private defaultResultText(kind: 'won' | 'draw' | 'noresult', winner?: Side): string {
    if (kind === 'won' && winner) {
      const winTeam = this.teams[winner];
      return `${winTeam.name} won (${this.score('A')} - ${this.score('B')})`;
    }
    if (kind === 'draw') {
      return `Match drawn (${this.score('A')} - ${this.score('B')})`;
    }
    return 'Match abandoned';
  }

  computeSuspensions(currentClockAt: number = Date.now()): HockeySuspension[] {
    const suspensions: HockeySuspension[] = [];

    // Elapsed game time at current point
    let liveElapsedGameTime = this.totalElapsedGameTimeMs;
    if (this.clockRunning && this.clockStartedAt !== null) {
      liveElapsedGameTime += Math.max(0, currentClockAt - this.clockStartedAt);
    }

    for (const card of this.cards) {
      if (card.kind === 'red' || card.durationMs <= 0) {
        // Red card is permanent
        suspensions.push({
          teamSide: card.teamSide,
          playerId: card.playerId,
          playerName: card.playerName,
          kind: card.kind,
          durationMs: -1,
          startedAt: card.at,
          endsAt: -1,
          remainingMs: -1,
          active: true,
        });
      } else {
        // Timed suspension (green/yellow)
        // Elapsed time since card was given in game time:
        // We approximate using card's at timestamp vs currentClockAt or game clock running
        // If clock is stopped, endsAt is estimated from remainingMs
        const elapsedSinceCard = Math.max(0, currentClockAt - card.at);
        const remainingMs = Math.max(0, card.durationMs - elapsedSinceCard);
        const active = remainingMs > 0;

        suspensions.push({
          teamSide: card.teamSide,
          playerId: card.playerId,
          playerName: card.playerName,
          kind: card.kind,
          durationMs: card.durationMs,
          startedAt: card.at,
          endsAt: card.at + card.durationMs,
          remainingMs,
          active,
        });
      }
    }

    return suspensions;
  }

  computeShootoutRounds(): ShootoutRound[] {
    const roundsMap = new Map<number, ShootoutRound>();
    for (const att of this.shootoutAttempts) {
      let r = roundsMap.get(att.round);
      if (!r) {
        r = { round: att.round };
        roundsMap.set(att.round, r);
      }
      if (att.teamSide === 'A') r.attemptA = att;
      else r.attemptB = att;
    }
    return Array.from(roundsMap.values()).sort((a, b) => a.round - b.round);
  }
}
