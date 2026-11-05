export type Side = 'A' | 'B';
export type PlayerId = string;

export interface PlayerRef {
  id: PlayerId;
  name: string;
  shortName?: string;
  shirtNo?: string;
  role?: string;
  photoPath?: string | null;
  isCaptain?: boolean;
}

export interface TeamConfig {
  id: string;
  name: string;
  shortName: string;
  color: string;
  logo?: string | null;
  coach?: string | null;
  players: PlayerRef[];
  starting11?: PlayerRef[];
  substitutes?: PlayerRef[];
}

export interface MatchSettings {
  powerplayOvers: number;
  /** When true each bowler may bowl at most ceil(overs / 5) overs. */
  limitBowlerOvers: boolean;
}

export interface MatchConfig {
  id: string;
  title: string;
  venue: string;
  overs: number;
  playersPerSide: number;
  teams: Record<Side, TeamConfig>;
  toss: { winner: Side; decision: 'bat' | 'bowl' } | null;
  settings: MatchSettings;
}

export type DismissalKind =
  | 'bowled' | 'caught' | 'lbw' | 'runout' | 'stumped' | 'hitwicket'
  | 'retiredout' | 'obstructing' | 'timedout' | 'handled' | 'hittwice';

export type ExtraKind = 'wide' | 'noball' | 'bye' | 'legbye' | 'dead';

export interface WicketInput {
  kind: DismissalKind;
  /** Batter who is out. Defaults to the striker. */
  out?: PlayerId;
  fielder?: PlayerId;
  /** Caught only: the batters crossed before the catch was taken. */
  crossed?: boolean;
  /** Incoming batter; may be supplied later with NEW_BATTER. */
  incoming?: PlayerId;
}

export interface BallInput {
  type: 'BALL';
  /** Absent = runs off the bat. */
  extra?: ExtraKind;
  /**
   * Off the bat: bat runs. Wide: additional runs (the 1 penalty run is automatic).
   * Bye / leg bye: the runs. No-ball: bat runs, or bye/leg-bye runs when noballExtra is set.
   */
  runs?: number;
  noballExtra?: 'bye' | 'legbye';
  /** Ball reached the boundary (no running). Defaults to true for 4 and 6. */
  boundary?: boolean;
  /** Extra runs taken through overthrows, added to `runs` and counted as run. */
  overthrows?: number;
  wicket?: WicketInput;
}

export type EventPayload =
  | { type: 'START_INNINGS'; battingSide?: Side }
  | { type: 'SET_BATTERS'; striker: PlayerId; nonStriker: PlayerId }
  | { type: 'NEW_BATTER'; batter: PlayerId }
  | { type: 'SET_BOWLER'; bowler: PlayerId }
  | BallInput
  | { type: 'SWAP_STRIKE' }
  | { type: 'PENALTY'; runs: number }
  | { type: 'ADJUSTMENT'; runs: number; note?: string }
  | { type: 'RETIRE'; batter: PlayerId }
  | { type: 'END_OVER' }
  | { type: 'END_INNINGS'; reason?: 'declared' | 'abandoned' }
  | { type: 'ADD_PLAYER'; side: Side; player: PlayerRef }
  | { type: 'RENAME_PLAYER'; playerId: PlayerId; name: string }
  | { type: 'REVISED_TARGET'; target: number; overs?: number }
  | { type: 'MATCH_RESULT'; kind: 'tie' | 'noresult' | 'won'; winner?: Side; text?: string };

export type EngineEvent = EventPayload & { id: number };

export class EngineError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export type ChipKind =
  | 'dot' | 'run' | 'four' | 'six' | 'wicket' | 'wide' | 'noball' | 'bye' | 'legbye' | 'dead';

export interface BallRecord {
  eventId: number;
  innings: number;
  /** Zero-based over index. */
  over: number;
  /** Legal balls already bowled in the over before this delivery. */
  legalBefore: number;
  legal: boolean;
  /** Label such as "14.3" - the over.ball in progress when this delivery was bowled. */
  overLabel: string;
  bowlerId: PlayerId;
  bowlerName: string;
  strikerId: PlayerId;
  strikerName: string;
  nonStrikerId: PlayerId;
  extra: ExtraKind | null;
  runs: number;
  batRuns: number;
  teamRuns: number;
  boundary: boolean;
  freeHit: boolean;
  label: string;
  kind: ChipKind;
  wicket: { kind: DismissalKind; outId: PlayerId; outName: string; howOut: string } | null;
  scoreAfter: string;
}

export interface BatterStat {
  id: PlayerId;
  name: string;
  order: number | null;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  strikeRate: number;
  status: 'batting' | 'out' | 'not out' | 'retired hurt' | 'yet to bat';
  howOut: string;
  onStrike: boolean;
}

export interface BowlerStat {
  id: PlayerId;
  name: string;
  balls: number;
  overs: string;
  maidens: number;
  runs: number;
  wickets: number;
  wides: number;
  noBalls: number;
  dots: number;
  economy: number;
  current: boolean;
}

export interface FallOfWicket {
  wicket: number;
  runs: number;
  batterId: PlayerId;
  batterName: string;
  over: string;
  text: string;
}

export interface Milestone {
  id: string;
  kind: 'fifty' | 'hundred' | 'fivefor' | 'hattrick' | 'runs';
  playerId: PlayerId;
  name: string;
  text: string;
}

export interface OverSummary {
  over: number;
  bowlerId: PlayerId;
  bowlerName: string;
  runs: number;
  wickets: number;
  maiden: boolean;
  chips: { label: string; kind: ChipKind }[];
  bowlerFigures: string;
  score: string;
}

export interface Partnership {
  runs: number;
  balls: number;
  batters: { id: PlayerId; name: string; runs: number; balls: number }[];
}

export interface InningsState {
  number: number;
  battingSide: Side;
  bowlingSide: Side;
  battingTeam: string;
  bowlingTeam: string;
  superOver: boolean;
  maxOvers: number;
  maxWickets: number;
  runs: number;
  wickets: number;
  legalBalls: number;
  oversCompleted: number;
  ballsInOver: number;
  overs: string;
  ballsRemaining: number;
  extras: { wd: number; nb: number; b: number; lb: number; pen: number; total: number };
  adjustment: number;
  crr: number;
  projected: { current: number; rates: { rate: number; score: number }[] };
  powerplay: boolean;
  freeHit: boolean;
  target: number | null;
  runsNeeded: number | null;
  rrr: number | null;
  strikerId: PlayerId | null;
  nonStrikerId: PlayerId | null;
  bowlerId: PlayerId | null;
  batting: BatterStat[];
  bowling: BowlerStat[];
  fow: FallOfWicket[];
  partnership: Partnership;
  timeline: BallRecord[];
  currentOver: BallRecord[];
  lastOver: OverSummary | null;
  thisOver: { label: string; kind: ChipKind }[];
  runsLast5Overs: number;
  runsLast10Overs: number;
  complete: boolean;
  endReason: 'allout' | 'overs' | 'target' | 'declared' | 'abandoned' | null;
  needs: { openers: boolean; bowler: boolean; batter: boolean };
  availableBatters: PlayerRef[];
  eligibleBowlers: { id: PlayerId; name: string; blocked: string | null }[];
}

export interface MatchResult {
  kind: 'won' | 'tie' | 'noresult';
  winner: Side | null;
  winnerName: string | null;
  text: string;
}

export interface Effects {
  eventId: number;
  boundary: 4 | 6 | null;
  wicket: { batterId: PlayerId; name: string; howOut: string; runs: number; balls: number; strikeRate: number; bowler: string } | null;
  milestones: Milestone[];
  overCompleted: boolean;
  newBatter: { id: PlayerId; name: string } | null;
  inningsEnded: boolean;
  resultSet: boolean;
}

export interface LiveState {
  matchId: string;
  title: string;
  venue: string;
  overs: number;
  playersPerSide: number;
  teams: Record<Side, { id: string; name: string; shortName: string; color: string; logo: string | null }>;
  toss: { winner: Side; decision: 'bat' | 'bowl'; text: string } | null;
  rosters: Record<Side, PlayerRef[]>;
  status: 'setup' | 'live' | 'break' | 'completed';
  statusText: string;
  innings: InningsState[];
  current: InningsState | null;
  /** Side expected to bat next when status is setup/break. */
  nextBattingSide: Side | null;
  canSuperOver: boolean;
  revised: { target: number; overs: number | null } | null;
  result: MatchResult | null;
  performers: {
    topScorer: { name: string; team: string; runs: number; balls: number } | null;
    bestBowler: { name: string; team: string; wickets: number; runs: number; overs: string } | null;
  };
  eventCount: number;
  effects: Effects | null;
  invariantErrors: string[];
}
