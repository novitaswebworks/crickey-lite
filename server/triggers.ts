import { InningsState, LiveState } from './engine';

function teamShort(state: LiveState, inn: InningsState): string {
  return state.teams[inn.battingSide].shortName;
}

function lastBall(inn: InningsState) {
  return inn.timeline[inn.timeline.length - 1];
}

/** Builds the data a transient overlay renders, from the match state and optional operator input. */
export function payloadFor(name: string, state: LiveState, data: Record<string, unknown> = {}): Record<string, unknown> {
  const inn = state.current ?? state.innings[state.innings.length - 1];
  const base = { matchId: state.matchId };
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
