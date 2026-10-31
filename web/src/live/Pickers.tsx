import type { EventPayload, InningsState, LiveState, Side } from '@engine/types';
import { useEffect, useState } from 'react';
import { ApiFail, post } from '../api';
import { applyState } from '../realtime';
import { Field, Modal, isTyping, toast } from '../ui';

type Send = (p: EventPayload, o?: { quiet?: boolean }) => Promise<LiveState | null>;

function useDigitPick(count: number, onPick: (i: number) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const h = (e: KeyboardEvent) => {
      if (isTyping() || e.ctrlKey || e.metaKey) return;
      if (/^[1-9]$/.test(e.key) && Number(e.key) <= count) { e.preventDefault(); onPick(Number(e.key) - 1); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
}

async function addGuest(matchId: number, side: Side, name: string): Promise<string | null> {
  try {
    const r = await post<{ state: LiveState; playerId: string }>(`/api/matches/${matchId}/guest-player`, { side, name });
    applyState(r.state);
    return r.playerId;
  } catch (e) {
    toast((e as ApiFail).message, 'error');
    return null;
  }
}

export function BowlerPicker({ inn, matchId, send, onClose, mid }: { inn: InningsState; matchId: number; send: Send; onClose: () => void; mid?: boolean }) {
  const [guest, setGuest] = useState('');
  const pick = async (id: string) => { if (await send({ type: 'SET_BOWLER', bowler: id })) onClose(); };
  const free = inn.eligibleBowlers;
  useDigitPick(free.length, (i) => !free[i].blocked && void pick(free[i].id));
  return (
    <Modal title={mid ? 'Change bowler (mid-over)' : 'Select the new bowler'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        {free.map((b, i) => (
          <button key={b.id} disabled={!!b.blocked} className="btn !h-auto flex-col items-start !py-2" onClick={() => void pick(b.id)}>
            <span className="flex w-full justify-between"><span>{b.name}</span><span className="text-[10px] opacity-60">{i < 9 ? i + 1 : ''}</span></span>
            {b.blocked && <span className="text-xs font-normal text-amber-400">{b.blocked}</span>}
          </button>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input className="input" placeholder="Add a new bowling-side player" value={guest} onChange={(e) => setGuest(e.target.value)} />
        <button className="btn" onClick={async () => { const id = guest.trim() && await addGuest(matchId, inn.bowlingSide, guest.trim()); if (id) await pick(id); }}>Add &amp; select</button>
      </div>
      {mid && <p className="mt-3 text-xs text-slate-400">The remaining balls of this over are credited to the new bowler.</p>}
    </Modal>
  );
}

export function BatterPicker({ inn, matchId, send, onClose }: { inn: InningsState; matchId: number; send: Send; onClose: () => void }) {
  const [guest, setGuest] = useState('');
  const pick = async (id: string) => { if (await send({ type: 'NEW_BATTER', batter: id })) onClose(); };
  const list = inn.availableBatters;
  useDigitPick(list.length, (i) => void pick(list[i].id));
  return (
    <Modal title="Select the incoming batter" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        {list.map((p, i) => {
          const rec = inn.batting.find((b) => b.id === p.id);
          return (
            <button key={p.id} className="btn justify-between" onClick={() => void pick(p.id)}>
              <span>{p.name}{rec?.status === 'retired hurt' && <span className="ml-1 text-xs text-amber-400">(returning)</span>}</span>
              <span className="text-[10px] opacity-60">{i < 9 ? i + 1 : ''}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex gap-2">
        <input className="input" placeholder="Add a new player (guest / impact)" value={guest} onChange={(e) => setGuest(e.target.value)} />
        <button className="btn" onClick={async () => { const id = guest.trim() && await addGuest(matchId, inn.battingSide, guest.trim()); if (id) await pick(id); }}>Add &amp; send in</button>
      </div>
    </Modal>
  );
}

/** Starts an innings (or finishes the setup of one): batting side, openers and the opening bowler. */
export function StartInnings({ state, send }: { state: LiveState; send: Send }) {
  const inn = state.current;
  const resuming = state.status === 'live' && !!inn?.needs.openers;
  const [side, setSide] = useState<Side>(resuming && inn ? inn.battingSide : state.nextBattingSide ?? 'A');
  const batRoster = state.rosters[side];
  const bowlRoster = state.rosters[side === 'A' ? 'B' : 'A'];
  const [striker, setStriker] = useState('');
  const [non, setNon] = useState('');
  const [bowler, setBowler] = useState('');
  const [busy, setBusy] = useState(false);
  const prevInnings = state.innings[state.innings.length - 1];
  const next = state.innings.length + 1;
  const isSuper = next > 2;

  useEffect(() => { setStriker(batRoster[0]?.id ?? ''); setNon(batRoster[1]?.id ?? ''); setBowler(bowlRoster[0]?.id ?? ''); }, [side, state.innings.length]);

  const go = async () => {
    setBusy(true);
    const steps: EventPayload[] = [];
    if (!resuming) steps.push({ type: 'START_INNINGS', battingSide: side });
    steps.push({ type: 'SET_BATTERS', striker, nonStriker: non }, { type: 'SET_BOWLER', bowler });
    for (const s of steps) if (!(await send(s, { quiet: true }))) break;
    setBusy(false);
  };

  return (
    <div className="card mx-auto mt-6 max-w-2xl">
      <h2 className="text-xl font-bold">{resuming ? 'Choose openers and opening bowler' : isSuper ? `Start Super Over (innings ${next})` : `Start innings ${next}`}</h2>
      {state.toss && next === 1 && <p className="mt-1 text-sm text-slate-400">{state.toss.text}</p>}
      {prevInnings && !resuming && state.status === 'break' && !isSuper && (
        <p className="mt-2 rounded-lg bg-ink-900 p-3 text-sm">
          {prevInnings.battingTeam} {prevInnings.runs}/{prevInnings.wickets} ({prevInnings.overs}). Target: <b>{prevInnings.runs + 1}</b> in {state.revised?.overs ?? state.overs} overs.
        </p>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {!resuming && (
          <Field label="Batting side">
            <select className="input" value={side} onChange={(e) => setSide(e.target.value as Side)}>
              <option value="A">{state.teams.A.name}</option>
              <option value="B">{state.teams.B.name}</option>
            </select>
          </Field>
        )}
        <Field label="Striker">
          <select className="input" value={striker} onChange={(e) => setStriker(e.target.value)}>{batRoster.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </Field>
        <Field label="Non-striker">
          <select className="input" value={non} onChange={(e) => setNon(e.target.value)}>{batRoster.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </Field>
        <Field label="Opening bowler">
          <select className="input" value={bowler} onChange={(e) => setBowler(e.target.value)}>{bowlRoster.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </Field>
      </div>
      <button className="btn btn-primary mt-5 w-full !min-h-[56px] text-base" disabled={busy || !striker || !non || striker === non} onClick={() => void go()}>
        {resuming ? 'Begin scoring' : isSuper ? 'Start Super Over' : `Start innings ${next}`}
      </button>
      {striker === non && <p className="mt-2 text-xs text-amber-400">Striker and non-striker must be different players.</p>}
    </div>
  );
}
