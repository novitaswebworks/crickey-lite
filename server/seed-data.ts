import { Context } from './context';
import { PlayerRow, TeamRow } from './types';

const TEAMS = [
  { name: 'Riverside Rockets', shortName: 'RIV', color: '#1d4ed8', players: ['Aarav Menon', 'Dev Kapoor', 'Rohan Iyer', 'Kabir Sethi', 'Imran Qadri', 'Vikram Rao', 'Nikhil Bose', 'Arjun Pillai', 'Sameer Khan', 'Yash Thakur', 'Tarun Mehra'] },
  { name: 'Harbour Hawks', shortName: 'HAW', color: '#ea580c', players: ['Liam Carter', 'Noah Bennett', 'Owen Hughes', 'Jack Mercer', 'Ethan Brooks', 'Harry Doyle', 'Callum Reid', 'Oscar Finch', 'Max Holland', 'Ryan Walsh', 'Leo Sutton'] },
];

/** Creates (or reuses) the two demo teams and a fresh demo T20 match. */
export function seedDemo(ctx: Context): { matchId: number; teamIds: [number, number] } {
  const { store, matches } = ctx;
  const ids: number[] = [];
  for (const t of TEAMS) {
    let row = store.list<TeamRow>('teams').find((x) => x.name === t.name);
    if (!row) {
      row = store.insert<TeamRow>('teams', { name: t.name, shortName: t.shortName, color: t.color, logoPath: null });
      t.players.forEach((name, i) => store.insert<PlayerRow>('players', { teamId: row!.id, name, shortName: '', shirtNo: String(i + 1), role: i < 6 ? 'Batter' : 'Bowler', orderIdx: i + 1 }, row!.id));
    }
    ids.push(row.id);
  }
  const match = matches.create({
    title: 'Demo T20 · Final', venue: 'Riverside Oval', teamAId: ids[0], teamBId: ids[1], overs: 20, playersPerSide: 11,
    tossWinner: 'A', tossDecision: 'bat', xiA: [], xiB: [],
  });
  matches.setActive(match.id);
  return { matchId: match.id, teamIds: [ids[0], ids[1]] };
}
