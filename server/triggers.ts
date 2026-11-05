import { InningsState, LiveState } from './engine';
import type { HockeyState } from './engine/hockey';

function teamShort(state: LiveState, inn: InningsState): string {
  return state.teams[inn.battingSide].shortName;
}

function lastBall(inn: InningsState) {
  return inn.timeline[inn.timeline.length - 1];
}

/** Builds the data a transient overlay renders, from the match state and optional operator input. */
export function payloadFor(name: string, state: LiveState, data: Record<string, unknown> = {}): Record<string, unknown> {
  const base = { matchId: state.matchId };

  // Hockey transient overlays
  if (name.startsWith('hockey/')) {
    const hState = state as unknown as HockeyState;
    switch (name) {
      case 'hockey/goal': {
        const fx = hState.effects?.goal;
        const lastGoal = [...(hState.teams?.A?.goals ?? []), ...(hState.teams?.B?.goals ?? [])].sort((a, b) => b.at - a.at)[0];
        const teamSide = fx?.teamSide ?? lastGoal?.teamSide ?? 'A';
        const team = hState.teams?.[teamSide];
        return {
          ...base,
          scorer: fx?.scorerName ?? lastGoal?.scorerName ?? '',
          assist: fx?.assistName ?? lastGoal?.assistName ?? '',
          kind: fx?.kind ?? lastGoal?.kind ?? 'FG',
          time: fx?.time ?? lastGoal?.clockDisplay ?? '',
          scoreA: fx?.scoreA ?? hState.scoreA ?? 0,
          scoreB: fx?.scoreB ?? hState.scoreB ?? 0,
          teamShort: team?.shortName ?? '',
          ...data,
        };
      }
      case 'hockey/card': {
        const fx = hState.effects?.card;
        const lastCard = [...(hState.teams?.A?.cards ?? []), ...(hState.teams?.B?.cards ?? [])].sort((a, b) => b.at - a.at)[0];
        const teamSide = fx?.teamSide ?? lastCard?.teamSide ?? 'A';
        const team = hState.teams?.[teamSide];
        const durationLabel = fx?.durationLabel ?? (
          lastCard?.kind === 'red'
            ? 'Permanent'
            : lastCard?.durationMs && lastCard.durationMs >= 60_000
            ? `${Math.round(lastCard.durationMs / 60_000)}m`
            : `${Math.round((lastCard?.durationMs ?? 120_000) / 1000)}s`
        );
        return {
          ...base,
          playerName: fx?.playerName ?? lastCard?.playerName ?? '',
          jerseyNo: '',
          cardKind: fx?.cardKind ?? lastCard?.kind ?? 'green',
          durationLabel,
          teamShort: team?.shortName ?? '',
          ...data,
        };
      }
      case 'hockey/penalty-corner': {
        const fx = hState.effects?.penaltyCorner;
        const teamSide = fx?.teamSide ?? 'A';
        const team = hState.teams?.[teamSide];
        return {
          ...base,
          teamShort: team?.shortName ?? '',
          matchId: hState.matchId,
          ...data,
        };
      }
      case 'hockey/starting11': {
        const side = (data.side === 'B' ? 'B' : 'A') as 'A' | 'B';
        const team = hState.teams?.[side];
        return {
          ...base,
          side,
          teamName: team?.name ?? (side === 'A' ? 'Team A' : 'Team B'),
          teamShort: team?.shortName ?? side,
          teamColor: team?.color ?? '#1d4ed8',
          teamLogo: team?.logo ?? null,
          coach: team?.coach ?? '',
          tournament: hState.tournament ?? 'FIH PRO LEAGUE',
          sponsor: hState.sponsor ?? 'polytan',
          players: team?.starting11 ?? [],
          ...data,
        };
      }
      case 'hockey/substitutes': {
        const side = (data.side === 'B' ? 'B' : 'A') as 'A' | 'B';
        const team = hState.teams?.[side];
        return {
          ...base,
          side,
          teamName: team?.name ?? (side === 'A' ? 'Team A' : 'Team B'),
          teamShort: team?.shortName ?? side,
          teamColor: team?.color ?? '#1d4ed8',
          teamLogo: team?.logo ?? null,
          coach: team?.coach ?? '',
          tournament: hState.tournament ?? 'FIH PRO LEAGUE',
          sponsor: hState.sponsor ?? 'polytan',
          substitutes: team?.substitutes ?? [],
          ...data,
        };
      }
      case 'hockey/scoreboard-banner': {
        return {
          ...base,
          teamA: hState.teams?.A,
          teamB: hState.teams?.B,
          scoreA: hState.scoreA ?? 0,
          scoreB: hState.scoreB ?? 0,
          periodLabel: hState.periodLabel ?? 'Q1',
          status: hState.status ?? 'live',
          statusText: hState.statusText ?? '',
          venue: hState.venue ?? '',
          tournament: hState.tournament ?? 'FIH PRO LEAGUE',
          sponsor: hState.sponsor ?? 'Dream11',
          ...data,
        };
      }
      default:
        return { ...base, ...data };
    }
  }

  const inn = state.current ?? state.innings[state.innings.length - 1];
  if (!inn) return { ...base, ...data };
  const striker = inn.batting.find((b) => b.id === inn.strikerId);
  switch (name) {
    case 'four':
    case 'six': {
      const b = lastBall(inn);
      const bat = inn.batting.find((x) => x.id === b?.strikerId) ?? striker;
      return { ...base, name: bat?.name ?? '', runs: bat?.runs ?? 0, balls: bat?.balls ?? 0, team: teamShort(state, inn), ...data };
    }
    case 'wicket': {
      const fx = state.effects?.wicket;
      if (fx) return { ...base, name: fx.name, howOut: fx.howOut, runs: fx.runs, balls: fx.balls, strikeRate: fx.strikeRate, bowler: fx.bowler, score: `${inn.runs}/${inn.wickets}`, team: teamShort(state, inn), ...data };
      const w = [...inn.timeline].reverse().find((x) => x.wicket);
      const bat = inn.batting.find((x) => x.id === w?.wicket?.outId);
      return {
        ...base, name: bat?.name ?? w?.wicket?.outName ?? '', howOut: bat?.howOut ?? '', runs: bat?.runs ?? 0, balls: bat?.balls ?? 0,
        strikeRate: bat?.strikeRate ?? 0, bowler: w?.bowlerName ?? '', score: `${inn.runs}/${inn.wickets}`, team: teamShort(state, inn), ...data,
      };
    }
    case 'new-batter': {
      const id = state.effects?.newBatter?.id ?? [inn.strikerId, inn.nonStrikerId].filter(Boolean)
        .sort((a, b) => (inn.batting.find((x) => x.id === b)?.order ?? 0) - (inn.batting.find((x) => x.id === a)?.order ?? 0))[0];
      const bat = inn.batting.find((x) => x.id === id);
      return { ...base, name: bat?.name ?? '', order: bat?.order ?? null, team: teamShort(state, inn), note: '', ...data };
    }
    case 'over-summary': {
      const o = inn.lastOver;
      return { ...base, ...(o ?? {}), team: teamShort(state, inn), score: o?.score ?? `${inn.runs}/${inn.wickets}`, ...data };
    }
    case 'milestone': {
      const m = state.effects?.milestones[0];
      if (m) return { ...base, kind: m.kind, name: m.name, text: m.text, ...data };
      const top = [...inn.batting].sort((a, b) => b.runs - a.runs)[0];
      const best = [...inn.bowling].sort((a, b) => b.wickets - a.wickets)[0];
      if (best && best.wickets >= 3 && (!top || best.wickets * 20 > top.runs)) return { ...base, kind: 'fivefor', name: best.name, text: `${best.wickets} WICKETS`, ...data };
      return { ...base, kind: (top?.runs ?? 0) >= 100 ? 'hundred' : 'fifty', name: top?.name ?? '', text: String((top?.runs ?? 0) >= 100 ? 100 : 50), ...data };
    }
    default:
      return { ...base, ...data };
  }
}
