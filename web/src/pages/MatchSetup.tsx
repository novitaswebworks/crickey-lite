import { useEffect, useState } from 'react';
import { ApiFail, PlayerDto, TeamDto, get, post } from '../api';
import { Empty, Field, toast } from '../ui';

type Sport = 'cricket' | 'hockey';

interface Settings { defaultOvers: number }

export function MatchSetup({ goto }: { goto: (p: string) => void }) {
  const [sport, setSport] = useState<Sport>('cricket');
  const [teams, setTeams] = useState<TeamDto[] | null>(null);
  const [a, setA] = useState<number | ''>('');
  const [b, setB] = useState<number | ''>('');
  const [squads, setSquads] = useState<Record<number, PlayerDto[]>>({});
  const [xi, setXi] = useState<{ A: number[]; B: number[] }>({ A: [], B: [] });
  const [overs, setOvers] = useState(20);
  const [pps, setPps] = useState(11);
  const [title, setTitle] = useState('');
  const [venue, setVenue] = useState('');
  const [tossWinner, setTossWinner] = useState<'A' | 'B' | ''>('');
  const [decision, setDecision] = useState<'bat' | 'bowl'>('bat');
  // Hockey-specific
  const [periods, setPeriods] = useState<2 | 4>(4);
  const [periodDurationMins, setPeriodDurationMins] = useState(15);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void get<TeamDto[]>('/api/teams').then((t) => { setTeams(t); if (t[0]) setA(t[0].id); if (t[1]) setB(t[1].id); });
    void get<Settings>('/api/settings').then((s) => setOvers(s.defaultOvers));
  }, []);

  useEffect(() => {
    for (const id of [a, b]) if (id !== '' && !squads[id]) void get<PlayerDto[]>(`/api/teams/${id}/players`).then((p) => setSquads((s) => ({ ...s, [id]: p })));
  }, [a, b]);

  const squadA = a === '' ? [] : squads[a] ?? [];
  const squadB = b === '' ? [] : squads[b] ?? [];
  useEffect(() => { setXi((x) => ({ ...x, A: squadA.slice(0, pps).map((p) => p.id) })); }, [a, squads[a as number], pps]);
  useEffect(() => { setXi((x) => ({ ...x, B: squadB.slice(0, pps).map((p) => p.id) })); }, [b, squads[b as number], pps]);

  if (teams && teams.length < 2) return <Empty title="Add two teams first" hint="A match needs two teams with players."><button className="btn btn-primary" onClick={() => goto('teams')}>Go to Teams</button></Empty>;

  const toggle = (side: 'A' | 'B', id: number) => setXi((x) => ({ ...x, [side]: x[side].includes(id) ? x[side].filter((i) => i !== id) : [...x[side], id] }));
  const ok = a !== '' && b !== '' && a !== b && xi.A.length === pps && xi.B.length === pps;
  const nameOf = (id: number | '') => teams?.find((t) => t.id === id)?.name ?? '';

  const create = async () => {
    setBusy(true);
    try {
      const orderOf = (squad: PlayerDto[], ids: number[]) => squad.filter((p) => ids.includes(p.id)).map((p) => p.id);
      const body: Record<string, unknown> = {
        sport,
        title, venue, teamAId: a, teamBId: b,
        playersPerSide: pps,
        xiA: orderOf(squadA, xi.A), xiB: orderOf(squadB, xi.B),
        // Cricket fields
        ...(sport === 'cricket' ? {
          overs,
          tossWinner: tossWinner || null,
          tossDecision: tossWinner ? decision : null,
        } : {
          overs: 1, // placeholder, hockey doesn't use overs
          tossWinner: null,
          tossDecision: null,
        }),
        // Hockey fields
        ...(sport === 'hockey' ? { periods, periodDurationMins } : {}),
      };
      const m = await post<{ id: number }>('/api/matches', body);
      await post(`/api/matches/${m.id}/activate`);
      toast(`${sport === 'hockey' ? 'Hockey match' : 'Match'} created — it is now the active match`);
      goto('live');
    } catch (e) { toast((e as ApiFail).message, 'error'); } finally { setBusy(false); }
  };

  const XiList = ({ side, squad }: { side: 'A' | 'B'; squad: PlayerDto[] }) => (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <div className="label !mb-0">{nameOf(side === 'A' ? a : b) || `Team ${side}`} — playing {sport === 'hockey' ? 'squad' : 'XI'} <span className={xi[side].length === pps ? 'text-emerald-400' : 'text-amber-400'}>({xi[side].length}/{pps})</span></div>
        <div className="flex gap-1">
          <button className="btn !min-h-[32px] !px-2 text-xs" onClick={() => setXi((x) => ({ ...x, [side]: squad.slice(0, pps).map((p) => p.id) }))}>First {pps}</button>
          <button className="btn !min-h-[32px] !px-2 text-xs" onClick={() => { setXi((x) => ({ ...x, [side]: squad.map((p) => p.id) })); if (squad.length >= 2 && squad.length <= 11) setPps(squad.length); }}>All players</button>
        </div>
      </div>
      <div className="grid gap-1">
        {squad.map((p, i) => (
          <label key={p.id} className="flex min-h-[40px] cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-ink-700">
            <input type="checkbox" className="h-5 w-5" checked={xi[side].includes(p.id)} onChange={() => toggle(side, p.id)} />
            <span className="w-5 text-xs text-slate-500">{i + 1}</span>{p.name}<span className="text-xs text-slate-500">{p.role}</span>
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <h1 className="text-2xl font-black">Match setup</h1>

      {/* Sport selector */}
      <div className="flex gap-1 rounded-xl border border-ink-700 bg-ink-900 p-1 self-start">
        {(['cricket', 'hockey'] as Sport[]).map((s) => (
          <button
            key={s}
            onClick={() => setSport(s)}
            className={`rounded-lg px-5 py-2 text-sm font-bold capitalize transition-colors ${sport === s ? 'bg-accent text-ink-950' : 'text-slate-400 hover:text-slate-100'}`}
          >
            {s === 'cricket' ? '🏏 Cricket' : '🏑 Hockey'}
          </button>
        ))}
      </div>

      <div className="card grid gap-3 sm:grid-cols-2">
        <Field label="Team A"><select className="input" value={a} onChange={(e) => setA(Number(e.target.value))}>{teams?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        <Field label="Team B"><select className="input" value={b} onChange={(e) => setB(Number(e.target.value))}>{teams?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        <Field label="Match title / stage"><input className="input" placeholder="Final · Day 1" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Venue"><input className="input" value={venue} onChange={(e) => setVenue(e.target.value)} /></Field>
        <Field label="Players per side (2–11)"><input className="input" type="number" min={2} max={11} value={pps} onChange={(e) => setPps(Math.max(2, Math.min(11, Number(e.target.value))))} /></Field>

        {sport === 'cricket' && (
          <>
            <Field label="Overs per innings"><input className="input" type="number" min={1} max={100} value={overs} onChange={(e) => setOvers(Number(e.target.value))} /></Field>
            <Field label="Toss won by"><select className="input" value={tossWinner} onChange={(e) => setTossWinner(e.target.value as 'A' | 'B' | '')}><option value="">Not decided yet</option><option value="A">{nameOf(a) || 'Team A'}</option><option value="B">{nameOf(b) || 'Team B'}</option></select></Field>
            <Field label="Elected to"><select className="input" disabled={!tossWinner} value={decision} onChange={(e) => setDecision(e.target.value as 'bat' | 'bowl')}><option value="bat">Bat</option><option value="bowl">Bowl</option></select></Field>
          </>
        )}

        {sport === 'hockey' && (
          <>
            <Field label="Period format">
              <select className="input" value={periods} onChange={(e) => { const v = Number(e.target.value) as 2 | 4; setPeriods(v); setPeriodDurationMins(v === 4 ? 15 : 35); }}>
                <option value={4}>4 Quarters (FIH standard)</option>
                <option value={2}>2 Halves (club / amateur)</option>
              </select>
            </Field>
            <Field label={`${periods === 4 ? 'Quarter' : 'Half'} duration (minutes)`}>
              <input className="input" type="number" min={5} max={60} value={periodDurationMins} onChange={(e) => setPeriodDurationMins(Number(e.target.value))} />
            </Field>
          </>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2"><XiList side="A" squad={squadA} /><XiList side="B" squad={squadB} /></div>
      {a === b && a !== '' && <p className="text-sm text-amber-400">Pick two different teams.</p>}
      <button className="btn btn-primary !min-h-[56px] text-base" disabled={!ok || busy} onClick={() => void create()}>
        {sport === 'hockey' ? '🏑 Create hockey match & make it live' : '🏏 Create match & make it live'}
      </button>
    </div>
  );
}
