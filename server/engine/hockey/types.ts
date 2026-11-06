import { PlayerId, PlayerRef, Side, TeamConfig } from '../types';

export interface HockeySettings {
  periods: number; // 2 (halves) or 4 (quarters)
  periodDurationMins: number; // e.g. 15 (minutes per period)
}

export interface HockeyMatchConfig {
  id: string;
  title: string;
  venue: string;
  tournament?: string;
  sponsor?: string;
  playersPerSide: number;
  teams: Record<Side, TeamConfig>;
  settings: HockeySettings;
}

export type GoalKind = 'FG' | 'PC' | 'PS' | 'OG'; // Field Goal, Penalty Corner, Penalty Stroke, Own Goal
export type CardKind = 'green' | 'yellow' | 'red';

export interface GoalRecord {
  id: number;
  teamSide: Side;
  scorerId: PlayerId;
  scorerName: string;
  assistId?: PlayerId;
  assistName?: string;
  kind: GoalKind;
  period: number;
  clockDisplay: string;
  at: number;
}

export interface CardRecord {
  id: number;
  teamSide: Side;
  playerId: PlayerId;
  playerName: string;
  kind: CardKind;
  durationMs: number; // e.g. 120_000 for green (2m), 300_000 for yellow (5m), -1 for red (permanent)
  period: number;
  at: number;
}

export interface HockeySuspension {
  teamSide: Side;
  playerId: PlayerId;
  playerName: string;
  kind: CardKind;
  durationMs: number;
  startedAt: number;
  endsAt: number;
  remainingMs: number;
  active: boolean;
}

export interface ShootoutAttempt {
  teamSide: Side;
  round: number;
  scored: boolean;
  takerId?: PlayerId;
  takerName?: string;
}

export interface ShootoutRound {
  round: number;
  attemptA?: ShootoutAttempt;
  attemptB?: ShootoutAttempt;
}

export interface GoalEffect {
  eventId: number;
  teamSide: Side;
  scorerName: string;
  assistName?: string;
  kind: GoalKind;
  time: string;
  scoreA: number;
  scoreB: number;
  teamShort: string;
}

export interface CardEffect {
  eventId: number;
  teamSide: Side;
  playerName: string;
  cardKind: CardKind;
  durationLabel: string;
  teamShort: string;
}

export interface HockeyEffects {
  eventId: number;
  goal?: GoalEffect;
  card?: CardEffect;
  penaltyCorner?: { teamSide: Side; teamShort: string };
}

export interface HockeyClock {
  running: boolean;
  displayMs: number;
  startedAt: number | null;
  adjustmentMs: number;
  periodDurationMs: number;
}

export interface HockeyTeamState {
  id: string;
  name: string;
  shortName: string;
  color: string;
  logo: string | null;
  coach?: string | null;
  starting11: PlayerRef[];
  substitutes: PlayerRef[];
  goals: GoalRecord[];
  cards: CardRecord[];
}

export interface HockeyMatchResult {
  kind: 'won' | 'draw' | 'noresult';
  winner?: Side;
  text: string;
}

export interface HockeyShootoutState {
  active: boolean;
  rounds: ShootoutRound[];
  scoreA: number;
  scoreB: number;
  winner?: Side;
}

export interface HockeyState {
  matchId: string;
  sport: 'hockey';
  title: string;
  venue: string;
  tournament?: string;
  sponsor?: string;
  status: 'prematch' | 'live' | 'break' | 'shootout' | 'completed';
  statusText: string;
  period: number;
  periodLabel: string;
  totalPeriods: number;
  teams: Record<Side, HockeyTeamState>;
  rosters: Record<Side, PlayerRef[]>;
  scoreA: number;
  scoreB: number;
  clock: HockeyClock;
  suspensions: HockeySuspension[];
  penaltyCorners: Record<Side, number>;
  shootout: HockeyShootoutState | null;
  result: HockeyMatchResult | null;
  eventCount: number;
  effects: HockeyEffects | null;
  invariantErrors: string[];
}

export type HockeyEventPayload =
  | { type: 'SET_PERIOD'; period: number; at?: number }
  | { type: 'START_CLOCK'; at: number }
  | { type: 'STOP_CLOCK'; at: number }
  | { type: 'ADJUST_CLOCK'; deltaMs: number; at?: number }
  | { type: 'GOAL'; teamSide: Side; scorerId: PlayerId; assistId?: PlayerId; kind: GoalKind; at: number }
  | { type: 'PENALTY_CORNER'; teamSide: Side; at: number }
  | { type: 'CARD'; teamSide: Side; playerId: PlayerId; kind: CardKind; durationMs: number; at: number }
  | { type: 'SHOOTOUT_ATTEMPT'; teamSide: Side; round: number; scored: boolean; takerId?: PlayerId }
  | { type: 'START_SHOOTOUT' }
  | { type: 'END_PERIOD'; at?: number }
  | { type: 'MATCH_RESULT'; kind: 'won' | 'draw' | 'noresult'; winner?: Side; text?: string; at?: number }
  | { type: 'ADD_PLAYER'; side: Side; player: PlayerRef };

export type HockeyEngineEvent = HockeyEventPayload & { id: number };
