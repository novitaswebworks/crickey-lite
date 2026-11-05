export interface TeamRow {
  name: string;
  shortName: string;
  color: string;
  logoPath: string | null;
}

export interface PlayerRow {
  teamId: number;
  name: string;
  shortName: string;
  shirtNo: string;
  role: string;
  orderIdx: number;
}

export interface MatchRow {
  title: string;
  venue: string;
  sport: 'cricket' | 'hockey';
  teamAId: number;
  teamBId: number;
  overs: number;
  playersPerSide: number;
  tossWinner: 'A' | 'B' | null;
  tossDecision: 'bat' | 'bowl' | null;
  settings: { powerplayOvers: number; limitBowlerOvers: boolean };
  /** Hockey-specific match configuration; undefined for cricket matches. */
  hockeySettings?: { periods: number; periodDurationMins: number };
  createdAt: string;
}

export interface MatchPlayerRow {
  side: 'A' | 'B';
  playerId: number;
  inXi: boolean;
  battingOrder: number;
}
