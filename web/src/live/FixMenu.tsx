import type { DismissalKind, EngineEvent, EventPayload, LiveState, Side } from '@engine/types';
import { useEffect, useState } from 'react';
import { ApiFail, get, post, api } from '../api';
import { applyState } from '../realtime';
import { Field, Modal, toast } from '../ui';

type Send = (p: EventPayload, o?: { quiet?: boolean }) => Promise<LiveState | null>;
type View = 'menu' | 'batters' | 'retire' | 'rename' | 'adjust' | 'target' | 'guest' | 'result';

export function FixMenu({ state, matchId, send, onClose, onBowler }: { state: LiveState; matchId: number; send: Send; onClose: () => void; onBowler: () => void }) {
  const [view, setView] = useState<View>('menu');
  const inn = state.current;
  const all = [...state.rosters.A.map((p) => ({ ...p, side: 'A' as Side })), ...state.rosters.B.map((p) => ({ ...p, side: 'B' as Side }))];
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [text, setText] = useState('');
  const [num, setNum] = useState('');
  const [overs, setOvers] = useState('');
  const [side, setSide] = useState<Side>('A');
  const done = async (p: Promise<unknown> | unknown) => { if (await p) onClose(); };


  return (
    <Modal title={view === 'menu' ? 'Fix / More' : 'Fix'} onClose={onClose}>
      {view === 'menu' && (
        <div className="grid grid-cols-2 gap-2">
          <button className="btn" disabled={!inn || inn.complete} onClick={() => { setA(inn?.strikerId ?? ''); setB(inn?.nonStrikerId ?? ''); setView('batters'); }}>Change striker / non-striker</button>
          <button className="btn" disabled={!inn || inn.complete} onClick={() => { onClose(); onBowler(); }}>Change current bowler</button>
          <button className="btn" disabled={!inn || inn.complete} onClick={() => { setA(inn?.strikerId ?? ''); setView('retire'); }}>Retired hurt…</button>
          <button className="btn" onClick={() => { setA(all[0]?.id ?? ''); setText(all[0]?.name ?? ''); setView('rename'); }}>Rename a player</button>
          <button className="btn" disabled={!inn} onClick={() => { setNum(''); setText(''); setView('adjust'); }}>Adjust total (signed)</button>
          <button className="btn" onClick={() => { setNum(String(state.revised?.target ?? '')); setOvers(String(state.revised?.overs ?? '')); setView('target'); }}>Revised target / overs</button>
          <button className="btn" onClick={() => { setText(''); setSide('A'); setView('guest'); }}>Add a player mid-match</button>
          <button className="btn" onClick={() => { setText(''); setSide('A'); setView('result'); }}>Match result override</button>
          <button className="btn col-span-2" disabled={!inn || inn.complete} onClick={() => done(send({ type: 'PENALTY', runs: 5 }))}>Penalty runs (5)</button>
        </div>
      )}
      {view === 'batters' && inn && (
        <div className="grid gap-3">
          <Field label="Striker"><select className="input" value={a} onChange={(e) => setA(e.target.value)}>{state.rosters[inn.battingSide].map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Non-striker"><select className="input" value={b} onChange={(e) => setB(e.target.value)}>{state.rosters[inn.battingSide].map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <button className="btn btn-primary" onClick={() => done(send({ type: 'SET_BATTERS', striker: a, nonStriker: b }))}>Apply</button>
        </div>
      )}
      {view === 'retire' && inn && (
        <div className="grid gap-3">
          <Field label="Batter retiring hurt (not a wicket; may return later)">
            <select className="input" value={a} onChange={(e) => setA(e.target.value)}>
              {[inn.strikerId, inn.nonStrikerId].filter(Boolean).map((id) => <option key={id} value={id!}>{inn.batting.find((x) => x.id === id)?.name}</option>)}
            </select>
          </Field>
          <button className="btn btn-primary" onClick={() => done(send({ type: 'RETIRE', batter: a }))}>Retire hurt</button>
        </div>
      )}
      {view === 'rename' && (
        <div className="grid gap-3">
          <Field label="Player"><select className="input" value={a} onChange={(e) => { setA(e.target.value); setText(all.find((p) => p.id === e.target.value)?.name ?? ''); }}>{all.map((p) => <option key={p.id} value={p.id}>{p.name} ({state.teams[p.side].shortName})</option>)}</select></Field>
          <Field label="New name"><input className="input" value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <button className="btn btn-primary" onClick={async () => {
            try { const r = await post<{ state: LiveState }>(`/api/matches/${matchId}/rename-player`, { playerId: a, name: text }); applyState(r.state); toast('Renamed'); onClose(); } catch (e) { toast((e as ApiFail).message, 'error'); }
          }}>Rename</button>
        </div>
      )}
      {view === 'adjust' && (
        <div className="grid gap-3">
          <Field label="Runs to add (negative to remove)"><input className="input" type="number" value={num} onChange={(e) => setNum(e.target.value)} placeholder="e.g. -2 or 5" /></Field>
          <Field label="Note (optional)"><input className="input" value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <p className="text-xs text-slate-400">Adds a labelled adjustment event; the ball-by-ball history is kept.</p>
          <button className="btn btn-primary" disabled={!num || Number(num) === 0} onClick={() => done(send({ type: 'ADJUSTMENT', runs: Number(num), note: text || undefined }))}>Apply adjustment</button>
        </div>
      )}
      {view === 'target' && (
        <div className="grid gap-3">
          <Field label="Revised target"><input className="input" type="number" value={num} onChange={(e) => setNum(e.target.value)} /></Field>
          <Field label="Revised overs for the chase (optional)"><input className="input" type="number" value={overs} onChange={(e) => setOvers(e.target.value)} /></Field>
          <p className="text-xs text-slate-400">Type the figures from your DLS / par-score table. No DLS maths is done here.</p>
          <button className="btn btn-primary" disabled={!num} onClick={() => done(send({ type: 'REVISED_TARGET', target: Number(num), overs: overs ? Number(overs) : undefined }))}>Apply</button>
        </div>
      )}
      {view === 'guest' && (
        <div className="grid gap-3">
          <Field label="Team"><select className="input" value={side} onChange={(e) => setSide(e.target.value as Side)}><option value="A">{state.teams.A.name}</option><option value="B">{state.teams.B.name}</option></select></Field>
          <Field label="Player name"><input className="input" value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <button className="btn btn-primary" disabled={!text.trim()} onClick={async () => {
            try { const r = await post<{ state: LiveState }>(`/api/matches/${matchId}/guest-player`, { side, name: text.trim() }); applyState(r.state); toast('Player added'); onClose(); } catch (e) { toast((e as ApiFail).message, 'error'); }
          }}>Add player</button>
        </div>
      )}
      {view === 'result' && (
        <div className="grid gap-3">
          <div className="grid grid-cols-3 gap-2">
            <button className="btn" onClick={() => window.confirm('Record the match as tied?') && done(send({ type: 'MATCH_RESULT', kind: 'tie' }))}>Match tied</button>
            <button className="btn" onClick={() => window.confirm('Record the match as no result?') && done(send({ type: 'MATCH_RESULT', kind: 'noresult' }))}>No result</button>
            <button className="btn" onClick={() => window.confirm(`Record ${state.teams[side].name} as the winner?`) && done(send({ type: 'MATCH_RESULT', kind: 'won', winner: side, text: text || undefined }))}>Team won</button>
          </div>
          <Field label="Winner (for “Team won”)"><select className="input" value={side} onChange={(e) => setSide(e.target.value as Side)}><option value="A">{state.teams.A.name}</option><option value="B">{state.teams.B.name}</option></select></Field>
          <Field label="Result text (optional)"><input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Alpha won by 5 runs (DLS)" /></Field>
        </div>
      )}
      {view !== 'menu' && <button className="btn btn-ghost mt-3" onClick={() => setView('menu')}>← Back</button>}
    </Modal>
  );
}

const KIND_LABELS: Record<DismissalKind, string> = {
  bowled: 'Bowled', caught: 'Caught', lbw: 'LBW', runout: 'Run out', stumped: 'Stumped', hitwicket: 'Hit wicket',
  retiredout: 'Retired out', obstructing: 'Obstructing', timedout: 'Timed out', handled: 'Handled ball', hittwice: 'Hit twice',
};

function payloadOf(ev: EngineEvent & { type: 'BALL' }): EventPayload {
  const { id: _id, ...payload } = ev;
  if (payload.wicket && !payload.wicket.kind) delete payload.wicket;
  return payload;
}

/** One line per innings whose score would change, plus a changed result. */
function describeChange(before: LiveState, after: LiveState): string {
  const parts = after.innings.flatMap((i) => {
    const old = before.innings.find((o) => o.number === i.number);
    return old && (old.runs !== i.runs || old.wickets !== i.wickets) ? [`Innings ${i.number}: ${old.runs}/${old.wickets} → ${i.runs}/${i.wickets}`] : [];
  });
  if (before.result?.text !== after.result?.text) parts.push(`Result: ${after.result?.text ?? 'no result yet'}`);
  return parts.length ? parts.join(' · ') : 'This edit does not change any totals.';
}

/** Edits any past ball; the server recomputes everything after it and refuses invalid results. */
export function EditBall({ state, matchId, eventId, onClose }: { state: LiveState; matchId: number; eventId: number; onClose: () => void }) {
  const [ev, setEv] = useState<(EngineEvent & { type: 'BALL' }) | null>(null);
  useEffect(() => {
    void get<EngineEvent[]>(`/api/matches/${matchId}/events`).then((list) => {
      const e = list.find((x) => x.id === eventId);
      if (e && e.type === 'BALL') setEv(e);
      else { toast('That event is not a ball', 'error'); onClose(); }
    });
  }, [matchId, eventId]);
  const [preview, setPreview] = useState<{ error: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!ev) return;
    let live = true;
    const t = setTimeout(() => {
      post<{ state: LiveState }>(`/api/matches/${matchId}/events/${eventId}/preview`, payloadOf(ev))
        .then((r) => live && setPreview({ error: false, text: describeChange(state, r.state) }))
        .catch((e) => live && setPreview({ error: true, text: (e as ApiFail).message }));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [ev]);
  if (!ev) return null;
  const all = [...state.rosters.A, ...state.rosters.B];
  const set = (patch: Record<string, unknown>) => setEv({ ...ev, ...patch } as typeof ev);
  const save = async () => {
    const payload = payloadOf(ev);
    try {
      const r = await api<{ state: LiveState }>('PATCH', `/api/matches/${matchId}/events/${eventId}`, payload);
      applyState(r.state);
      toast('Ball updated');
      onClose();
    } catch (e) {
      toast((e as ApiFail).message, 'error');
    }
  };
  return (
    <Modal title={`Edit ball (event #${eventId})`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Delivery">
          <select className="input" value={ev.extra ?? ''} onChange={(e) => set({ extra: e.target.value || undefined })}>
            <option value="">Off the bat</option><option value="wide">Wide</option><option value="noball">No-ball</option><option value="bye">Bye</option><option value="legbye">Leg bye</option><option value="dead">Dead ball</option>
          </select>
        </Field>
        <Field label="Runs"><input className="input" type="number" min={0} value={ev.runs ?? 0} onChange={(e) => set({ runs: Number(e.target.value) })} /></Field>
        <Field label="Overthrows"><input className="input" type="number" min={0} value={ev.overthrows ?? 0} onChange={(e) => set({ overthrows: Number(e.target.value) || undefined })} /></Field>
        {ev.extra === 'noball' && (
          <Field label="No-ball runs are">
            <select className="input" value={ev.noballExtra ?? ''} onChange={(e) => set({ noballExtra: e.target.value || undefined })}>
              <option value="">Off the bat</option><option value="bye">Byes</option><option value="legbye">Leg byes</option>
            </select>
          </Field>
        )}
        <Field label="Wicket">
          <select className="input" value={ev.wicket?.kind ?? ''} onChange={(e) => set({ wicket: e.target.value ? { ...ev.wicket, kind: e.target.value } : undefined })}>
            <option value="">No wicket</option>{Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        {ev.wicket && (
          <>
            <Field label="Batter out (blank = striker)">
              <select className="input" value={ev.wicket.out ?? ''} onChange={(e) => set({ wicket: { ...ev.wicket, out: e.target.value || undefined } })}>
                <option value="">Striker</option>{all.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Fielder">
              <select className="input" value={ev.wicket.fielder ?? ''} onChange={(e) => set({ wicket: { ...ev.wicket, fielder: e.target.value || undefined } })}>
                <option value="">None</option>{all.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Incoming batter">
              <select className="input" value={ev.wicket.incoming ?? ''} onChange={(e) => set({ wicket: { ...ev.wicket, incoming: e.target.value || undefined } })}>
                <option value="">Chosen separately</option>{all.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={!!ev.wicket.crossed} onChange={(e) => set({ wicket: { ...ev.wicket, crossed: e.target.checked || undefined } })} /> Batters crossed</label>
          </>
        )}
      </div>
      {preview && <p className={`mt-4 rounded-lg px-3 py-2 text-sm ${preview.error ? 'bg-red-950/60 text-red-200' : 'bg-ink-900 text-slate-200'}`}>{preview.text}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={preview?.error} onClick={() => void save()}>Save &amp; recompute</button>
      </div>
    </Modal>
  );
}
