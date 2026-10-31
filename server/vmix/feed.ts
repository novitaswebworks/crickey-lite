import { InningsState, LiveState, Side } from '../engine';

export type FlatValue = string | number;

const f2 = (n: number | null | undefined) => (n === null || n === undefined ? '' : n.toFixed(2));

function sideInnings(state: LiveState, side: Side): InningsState | undefined {
  return [...state.innings].reverse().find((i) => i.battingSide === side && !i.superOver) ?? state.innings.find((i) => i.battingSide === side);
}

/** Flat, stable key/value view of the match for vMix data sources and title templates. */
export function flatState(state: LiveState | null): Record<string, FlatValue> {
  if (!state) return { status_text: 'No active match' };
  const out: Record<string, FlatValue> = {
    match_title: state.title, venue: state.venue, status: state.status, status_text: state.statusText,
    toss_text: state.toss?.text ?? '', result_text: state.result?.text ?? '',
  };
  for (const side of ['A', 'B'] as Side[]) {
    const k = side.toLowerCase();
    const t = state.teams[side];
    const inn = sideInnings(state, side);
    Object.assign(out, {
      [`team_${k}_name`]: t.name, [`team_${k}_short`]: t.shortName, [`team_${k}_color`]: t.color,
      [`team_${k}_score`]: inn ? `${inn.runs}/${inn.wickets}` : '', [`team_${k}_runs`]: inn?.runs ?? '',
      [`team_${k}_wickets`]: inn?.wickets ?? '', [`team_${k}_overs`]: inn?.overs ?? '',
    });
  }
  const inn = state.current ?? state.innings[state.innings.length - 1];
  const bat = (id: string | null) => inn?.batting.find((b) => b.id === id);
  const striker = bat(inn?.strikerId ?? null);
  const non = bat(inn?.nonStrikerId ?? null);
  const bowler = inn?.bowling.find((b) => b.id === inn.bowlerId) ?? inn?.bowling.find((b) => b.current);
  const chasing = inn?.target != null;
  Object.assign(out, {
    innings: inn?.number ?? 0,
    batting_team: inn ? inn.battingTeam : '', batting_team_short: inn ? state.teams[inn.battingSide].shortName : '',
    bowling_team: inn ? inn.bowlingTeam : '', bowling_team_short: inn ? state.teams[inn.bowlingSide].shortName : '',
    score: inn ? `${inn.runs}/${inn.wickets}` : '', runs: inn?.runs ?? 0, wickets: inn?.wickets ?? 0,
    overs: inn?.overs ?? '0.0', max_overs: inn?.maxOvers ?? state.overs, crr: f2(inn?.crr ?? 0),
    projected: inn?.projected.current ?? '',
    striker_name: striker?.name ?? '', striker_runs: striker?.runs ?? '', striker_balls: striker?.balls ?? '',
    striker_fours: striker?.fours ?? '', striker_sixes: striker?.sixes ?? '', striker_sr: f2(striker?.strikeRate),
    nonstriker_name: non?.name ?? '', nonstriker_runs: non?.runs ?? '', nonstriker_balls: non?.balls ?? '',
    nonstriker_fours: non?.fours ?? '', nonstriker_sixes: non?.sixes ?? '', nonstriker_sr: f2(non?.strikeRate),
    bowler_name: bowler?.name ?? '', bowler_overs: bowler?.overs ?? '', bowler_maidens: bowler?.maidens ?? '',
    bowler_runs: bowler?.runs ?? '', bowler_wkts: bowler?.wickets ?? '', bowler_econ: f2(bowler?.economy),
    bowler_figures: bowler ? `${bowler.overs}-${bowler.maidens}-${bowler.runs}-${bowler.wickets}` : '',
    this_over: inn?.thisOver.map((c) => c.label).join(' · ') ?? '',
    target: inn?.target ?? '', need_runs: chasing ? inn!.runsNeeded ?? '' : '', balls_left: chasing ? inn!.ballsRemaining : '',
    rrr: chasing ? f2(inn!.rrr) : '',
    chase_text: chasing && !inn!.complete ? `Need ${inn!.runsNeeded} off ${inn!.ballsRemaining}` : '',
    free_hit: inn?.freeHit ? 'FREE HIT' : '', powerplay: inn?.powerplay ? 'POWERPLAY' : '',
    partnership_runs: inn?.partnership.runs ?? '', partnership_balls: inn?.partnership.balls ?? '',
    extras_total: inn?.extras.total ?? '', last_wicket: inn?.fow[inn.fow.length - 1]?.text ?? '',
  });
  return out;
}

const esc = (s: FlatValue) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function toXml(flat: Record<string, FlatValue>): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<crickey>\n${Object.entries(flat).map(([k, v]) => `  <${k}>${esc(v)}</${k}>`).join('\n')}\n</crickey>\n`;
}

export function toCsv(flat: Record<string, FlatValue>): string {
  const cell = (v: FlatValue) => `"${String(v).replace(/"/g, '""')}"`;
  return `${Object.keys(flat).map(cell).join(',')}\n${Object.values(flat).map(cell).join(',')}\n`;
}

/** Replaces `{key}` placeholders using the flat feed. A bare key such as "striker_name" also works. */
export function renderTemplate(template: string, flat: Record<string, FlatValue>): string {
  if (!template.includes('{')) return String(flat[template] ?? template);
  return template.replace(/\{([a-z0-9_]+)\}/g, (_, k: string) => String(flat[k] ?? ''));
}
