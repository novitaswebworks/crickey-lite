import { LiveState } from './engine';

const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** One flat CSV with batting, bowling, extras and fall of wickets for every innings. */
export function exportCsv(state: LiveState): string {
  const rows: unknown[][] = [['Innings', 'Team', 'Section', 'Name', 'Detail', 'Runs', 'Balls', '4s', '6s', 'SR / Econ', 'Wickets']];
  for (const inn of state.innings) {
    const team = inn.battingTeam;
    for (const b of inn.batting.filter((x) => x.status !== 'yet to bat')) {
      rows.push([inn.number, team, 'Batting', b.name, b.howOut || b.status, b.runs, b.balls, b.fours, b.sixes, b.strikeRate, '']);
    }
    for (const b of inn.bowling) {
      rows.push([inn.number, inn.bowlingTeam, 'Bowling', b.name, `${b.overs} ov, ${b.maidens} md`, b.runs, b.balls, '', '', b.economy, b.wickets]);
    }
    const e = inn.extras;
    rows.push([inn.number, team, 'Extras', 'Extras', `wd ${e.wd}, nb ${e.nb}, b ${e.b}, lb ${e.lb}, pen ${e.pen}`, e.total, '', '', '', '', '']);
    rows.push([inn.number, team, 'Total', 'Total', `${inn.wickets} wkts, ${inn.overs} ov`, inn.runs, '', '', '', inn.crr, inn.wickets]);
    for (const f of inn.fow) rows.push([inn.number, team, 'Fall of wicket', f.batterName, f.text, f.runs, '', '', '', '', f.wicket]);
  }
  if (state.result) rows.push(['', '', 'Result', '', state.result.text, '', '', '', '', '', '']);
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
}
