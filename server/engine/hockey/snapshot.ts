import { HockeyMachine } from './machine';
import { HockeyShootoutState, HockeyState, ShootoutRound } from './types';

export function snapshotHockey(machine: HockeyMachine, currentClockAt?: number): HockeyState {
  const now = currentClockAt ?? (machine.lastEventAt || Date.now());

  let liveDisplayMs = machine.displayMs;
  if (machine.clockRunning && machine.clockStartedAt !== null) {
    const elapsedSinceStart = Math.max(0, now - machine.clockStartedAt);
    liveDisplayMs = Math.max(0, machine.displayMs - elapsedSinceStart);
  }

  const scoreA = machine.score('A');
  const scoreB = machine.score('B');

  // Determine status
  let status: HockeyState['status'] = 'prematch';
  let statusText = 'Prematch';

  if (machine.result) {
    status = 'completed';
    statusText = machine.result.text;
  } else if (machine.shootoutActive) {
    status = 'shootout';
    const soA = machine.shootoutAttempts.filter((a) => a.teamSide === 'A' && a.scored).length;
    const soB = machine.shootoutAttempts.filter((a) => a.teamSide === 'B' && a.scored).length;
    statusText = `Shootout (${soA} - ${soB})`;
  } else if (machine.eventCount === 0) {
    status = 'prematch';
    statusText = 'Prematch';
  } else if (liveDisplayMs === 0 && machine.eventCount > 0) {
    status = 'break';
    statusText = machine.period === machine.totalPeriods ? 'Full Time' : `End of ${machine.periodLabel}`;
  } else {
    status = 'live';
    const isRunning = machine.clockRunning && liveDisplayMs > 0;
    statusText = `${machine.periodLabel} · ${isRunning ? 'Live' : 'Paused'}`;
  }

  // Shootout details
  let shootout: HockeyShootoutState | null = null;
  if (machine.shootoutActive) {
    const rounds: ShootoutRound[] = machine.computeShootoutRounds();
    const soScoreA = machine.shootoutAttempts.filter((a) => a.teamSide === 'A' && a.scored).length;
    const soScoreB = machine.shootoutAttempts.filter((a) => a.teamSide === 'B' && a.scored).length;
    shootout = {
      active: true,
      rounds,
      scoreA: soScoreA,
      scoreB: soScoreB,
      winner: soScoreA > soScoreB ? 'A' : soScoreB > soScoreA ? 'B' : undefined,
    };
  }

  const suspensions = machine.computeSuspensions(now);

  return {
    matchId: machine.id,
    sport: 'hockey',
    title: machine.title,
    venue: machine.venue,
    status,
    statusText,
    period: machine.period,
    periodLabel: machine.periodLabel,
    totalPeriods: machine.totalPeriods,
    teams: {
      A: {
        id: machine.teams.A.id,
        name: machine.teams.A.name,
        shortName: machine.teams.A.shortName,
        color: machine.teams.A.color,
        logo: machine.teams.A.logo ?? null,
        goals: machine.goals.filter((g) => g.teamSide === 'A'),
        cards: machine.cards.filter((c) => c.teamSide === 'A'),
      },
      B: {
        id: machine.teams.B.id,
        name: machine.teams.B.name,
        shortName: machine.teams.B.shortName,
        color: machine.teams.B.color,
        logo: machine.teams.B.logo ?? null,
        goals: machine.goals.filter((g) => g.teamSide === 'B'),
        cards: machine.cards.filter((c) => c.teamSide === 'B'),
      },
    },
    rosters: machine.rosters,
    scoreA,
    scoreB,
    clock: {
      running: machine.clockRunning && liveDisplayMs > 0,
      displayMs: liveDisplayMs,
      startedAt: machine.clockStartedAt,
      adjustmentMs: machine.clockAdjustmentMs,
      periodDurationMs: machine.periodDurationMs,
    },
    suspensions,
    penaltyCorners: { ...machine.penaltyCorners },
    shootout,
    result: machine.result,
    eventCount: machine.eventCount,
    effects: machine.effects,
    invariantErrors: [],
  };
}
