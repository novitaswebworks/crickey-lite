import { useCallback, useEffect, useState } from 'react';
import { ApiFail, PlayerDto, TeamDto, del, get, post, put, uploadLogo } from '../api';
import { Empty, Field, toast } from '../ui';

const fail = (e: unknown) => toast((e as ApiFail).message, 'error');

export function Teams() {
  const [teams, setTeams] = useState<TeamDto[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [draft, setDraft] = useState({ name: '', shortName: '', color: '#1d4ed8' });

  const load = useCallback(async () => {
    const t = await get<TeamDto[]>('/api/teams');
    setTeams(t);
    setSel((cur) => (cur !== null && t.some((x) => x.id === cur) ? cur : t[0]?.id ?? null));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    try {
      const t = await post<TeamDto>('/api/teams', draft);
      setDraft({ name: '', shortName: '', color: '#1d4ed8' });
      await load();
      setSel(t.id);
      toast('Team added');
    } catch (e) { fail(e); }
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-4 p-4 md:grid-cols-[300px_1fr]">
      <aside className="flex flex-col gap-3">
        <div className="card flex flex-col gap-2">
          <div className="label !mb-0">New team</div>
          <input className="input" placeholder="Full name (e.g. Mumbai Indians)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <div className="flex gap-2">
            <input className="input" placeholder="Short (3–4)" maxLength={5} value={draft.shortName} onChange={(e) => setDraft({ ...draft, shortName: e.target.value })} />
            <input type="color" className="h-[44px] w-16 cursor-pointer rounded-lg border border-ink-600 bg-ink-900" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} aria-label="Team colour" />
          </div>
          <button className="btn btn-primary" onClick={() => void add()}>Add team</button>
        </div>
        {teams.map((t) => (
          <button key={t.id} onClick={() => setSel(t.id)} className={`card flex items-center gap-3 text-left ${sel === t.id ? '!border-accent' : ''}`}>
            <span className="h-8 w-8 rounded-full" style={{ background: t.color }} />
            <span className="flex-1"><b>{t.name}</b><br /><span className="text-xs text-slate-400">{t.shortName} · {t.playerCount ?? 0} players</span></span>
          </button>
        ))}
      </aside>
      {sel !== null && teams.find((t) => t.id === sel) ? <TeamEditor key={sel} team={teams.find((t) => t.id === sel)!} onChange={load} /> : <Empty title="No teams yet" hint="Add two teams on the left to get started." />}
    </div>
  );
}

function TeamEditor({ team, onChange }: { team: TeamDto; onChange: () => Promise<void> }) {
  const [form, setForm] = useState({ name: team.name, shortName: team.shortName, color: team.color });
  const [players, setPlayers] = useState<PlayerDto[]>([]);
  const [bulk, setBulk] = useState('');
  const load = useCallback(async () => setPlayers(await get<PlayerDto[]>(`/api/teams/${team.id}/players`)), [team.id]);
  useEffect(() => { void load(); }, [load]);

  const save = async () => { try { await put(`/api/teams/${team.id}`, form); toast('Team saved'); await onChange(); } catch (e) { fail(e); } };
  const remove = async () => { if (!window.confirm(`Delete ${team.name} and its players?`)) return; try { await del(`/api/teams/${team.id}`); await onChange(); } catch (e) { fail(e); } };
  const addBulk = async () => { try { await post(`/api/teams/${team.id}/players`, { names: bulk.split('\n') }); setBulk(''); await load(); await onChange(); toast('Players added'); } catch (e) { fail(e); } };
  const savePlayer = async (p: PlayerDto) => { try { await put(`/api/players/${p.id}`, { name: p.name, shortName: p.shortName, shirtNo: p.shirtNo, role: p.role }); } catch (e) { fail(e); await load(); } };
  const move = async (i: number, d: number) => {
    const ids = players.map((p) => p.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    await put(`/api/teams/${team.id}/players/order`, { ids });
    await load();
  };
  const patch = (id: number, k: keyof PlayerDto, v: string) => setPlayers((l) => l.map((p) => (p.id === id ? { ...p, [k]: v } : p)));

  return (
    <section className="flex flex-col gap-4">
      <div className="card grid gap-3 sm:grid-cols-[1fr_120px_80px_auto]">
        <Field label="Full name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Short name"><input className="input" maxLength={5} value={form.shortName} onChange={(e) => setForm({ ...form, shortName: e.target.value })} /></Field>
        <Field label="Colour"><input type="color" className="h-[44px] w-full cursor-pointer rounded-lg border border-ink-600 bg-ink-900" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></Field>
        <div className="flex items-end gap-2"><button className="btn btn-primary" onClick={() => void save()}>Save</button><button className="btn btn-ghost !text-red-400" onClick={() => void remove()}>Delete</button></div>
        <div className="flex items-center gap-3 sm:col-span-4">
          {team.logoPath ? <img src={team.logoPath} alt="logo" className="h-14 w-14 rounded bg-white/5 object-contain" /> : <div className="flex h-14 w-14 items-center justify-center rounded bg-ink-900 text-xs text-slate-500">No logo</div>}
          <label className="btn cursor-pointer">Upload logo<input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { await uploadLogo(team.id, f); toast('Logo uploaded'); await onChange(); } catch (er) { fail(er); } }} /></label>
          {team.logoPath && <button className="btn btn-ghost" onClick={async () => { await del(`/api/teams/${team.id}/logo`); await onChange(); }}>Remove logo</button>}
        </div>
      </div>
      <div className="card">
        <div className="label">Players — batting order top to bottom</div>
        <div className="flex flex-col gap-1.5">
          {players.length === 0 && <p className="text-sm text-slate-500">No players yet. Paste names below, one per line.</p>}
          {players.map((p, i) => (
            <div key={p.id} className="grid grid-cols-[28px_1fr_70px_110px_auto] items-center gap-2">
              <span className="text-center text-xs text-slate-500">{i + 1}</span>
              <input className="input" value={p.name} onChange={(e) => patch(p.id, 'name', e.target.value)} onBlur={() => void savePlayer(p)} />
              <input className="input" placeholder="#" value={p.shirtNo} onChange={(e) => patch(p.id, 'shirtNo', e.target.value)} onBlur={() => void savePlayer(p)} />
              <input className="input" placeholder="Role" value={p.role} onChange={(e) => patch(p.id, 'role', e.target.value)} onBlur={() => void savePlayer(p)} />
              <div className="flex gap-1">
                <button className="btn !px-3" disabled={i === 0} onClick={() => void move(i, -1)} aria-label="Move up">↑</button>
                <button className="btn !px-3" disabled={i === players.length - 1} onClick={() => void move(i, 1)} aria-label="Move down">↓</button>
                <button className="btn !px-3 !text-red-400" onClick={async () => { try { await del(`/api/players/${p.id}`); await load(); await onChange(); } catch (e) { fail(e); } }} aria-label="Delete player">✕</button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <Field label="Bulk add — one name per line"><textarea className="input !h-28 py-2" value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'Player One\nPlayer Two\nPlayer Three'} /></Field>
          <button className="btn btn-primary mt-2" disabled={!bulk.trim()} onClick={() => void addBulk()}>Add players</button>
        </div>
      </div>
    </section>
  );
}
