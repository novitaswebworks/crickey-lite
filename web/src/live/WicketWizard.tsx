import type { DismissalKind, EventPayload, ExtraKind, InningsState, PlayerRef } from '@engine/types';
import { useEffect, useMemo, useState } from 'react';
import { ApiFail, post } from '../api';
import { applyState } from '../realtime';
import { Modal, isTyping, toast } from '../ui';
import type { LiveState } from '@engine/types';

const KINDS: { kind: DismissalKind; label: string }[] = [
  { kind: 'bowled', label: 'Bowled' }, { kind: 'caught', label: 'Caught' }, { kind: 'lbw', label: 'LBW' },
  { kind: 'runout', label: 'Run out' }, { kind: 'stumped', label: 'Stumped' }, { kind: 'hitwicket', label: 'Hit wicket' },
  { kind: 'obstructing', label: 'Obstructing the field' }, { kind: 'handled', label: 'Handled the ball' }, { kind: 'hittwice', label: 'Hit the ball twice' },
  { kind: 'timedout', label: 'Timed out' }, { kind: 'retiredout', label: 'Retired out' },
];

type Delivery = 'normal' | 'wide' | 'noball' | 'bye' | 'legbye';
const FREE_HIT_OK: DismissalKind[] = ['runout', 'obstructing', 'handled', 'hittwice'];

function allowedKinds(delivery: Delivery, freeHit: boolean): DismissalKind[] {
  let list: DismissalKind[] = ['bowled', 'caught', 'lbw', 'runout', 'stumped', 'hitwicket', 'obstructing', 'handled', 'hittwice'];
  if (delivery === 'wide') list = ['stumped', 'runout', 'hitwicket'];
  else if (delivery === 'noball') list = ['runout', 'obstructing', 'handled', 'hittwice'];
  else if (delivery === 'bye' || delivery === 'legbye') list = ['runout', 'stumped', 'hitwicket', 'obstructing', 'handled', 'hittwice'];
  if (freeHit) list = list.filter((k) => FREE_HIT_OK.includes(k));
  return [...list, 'timedout', 'retiredout'];
}

type Step = 'kind' | 'who' | 'fielder' | 'runs' | 'incoming' | 'confirm';

interface Props {
  state: LiveState;
  inn: InningsState;
  matchId: number;
  onClose: () => void;
  onSend: (p: EventPayload) => Promise<unknown>;
}

export function WicketWizard({ state, inn, matchId, onClose, onSend }: Props) {
  const [step, setStep] = useState<Step>('kind');
  const [delivery, setDelivery] = useState<Delivery>('normal');
  const [kind, setKind] = useState<DismissalKind | null>(null);
  const [outId, setOutId] = useState<string>(inn.strikerId ?? '');
  const [fielder, setFielder] = useState<string | undefined>();
  const [runs, setRuns] = useState(0);
  const [crossed, setCrossed] = useState(false);
  const [guest, setGuest] = useState('');

  const striker = inn.batting.find((b) => b.id === inn.strikerId);
  const non = inn.batting.find((b) => b.id === inn.nonStrikerId);
  const fielders: PlayerRef[] = state.rosters[inn.bowlingSide];
  const lastWicket = inn.wickets + 1 >= inn.maxWickets;
  const allowed = useMemo(() => allowedKinds(delivery, inn.freeHit), [delivery, inn.freeHit]);

  const flow = (k: DismissalKind): Step[] => {
    const s: Step[] = [];
    if (['runout', 'obstructing', 'timedout', 'retiredout'].includes(k)) s.push('who');
    if (['caught', 'stumped', 'runout'].includes(k)) s.push('fielder');
    if (k === 'runout' || k === 'caught') s.push('runs');
    s.push(lastWicket ? 'confirm' : 'incoming');
    return s;
  };

  const finish = async (incoming?: string) => {
    if (!kind) return;
    const extra: ExtraKind | undefined = kind === 'timedout' || kind === 'retiredout' ? 'dead' : delivery === 'normal' ? undefined : delivery;
    const p: EventPayload = {
      type: 'BALL', extra, runs: kind === 'runout' ? runs : 0,
      wicket: { kind, out: outId || undefined, fielder, crossed: crossed || undefined, incoming },
    };
    const ok = await onSend(p);
    if (ok) onClose();
  };

  const advance = (k: DismissalKind, from: Step | null) => {
    const steps = flow(k);
    const i = from ? steps.indexOf(from) + 1 : 0;
    if (i < steps.length) setStep(steps[i]);
    else void finish();
  };

  const pickKind = (k: DismissalKind) => {
    setKind(k);
    setOutId(inn.strikerId ?? '');
    advance(k, null);
  };

  const addGuest = async () => {
    if (!guest.trim()) return;
    try {
      const r = await post<{ state: LiveState; playerId: string }>(`/api/matches/${matchId}/guest-player`, { side: inn.battingSide, name: guest.trim() });
      applyState(r.state);
      void finish(r.playerId);
    } catch (e) {
      toast((e as ApiFail).message, 'error');
    }
  };

  // Digit and letter hotkeys for the current step.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (isTyping() || e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      const n = /^[0-9]$/.test(k) ? Number(k) : -1;
      if (step === 'kind') {
        const letters: Record<string, Delivery> = { x: 'normal', d: 'wide', n: 'noball', b: 'bye', l: 'legbye' };
        if (letters[k]) return setDelivery(letters[k]);
        if (n >= 1) { const c = KINDS[n - 1]; if (c && allowed.includes(c.kind)) pickKind(c.kind); }
        if (k === 't' && allowed.includes('timedout')) pickKind('timedout');
        if (k === 'r' && allowed.includes('retiredout')) pickKind('retiredout');
      } else if (step === 'who') {
        if (n === 1 && striker) { setOutId(striker.id); advance(kind!, 'who'); }
        if (n === 2 && non) { setOutId(non.id); advance(kind!, 'who'); }
      } else if (step === 'fielder') {
        if (k === ' ' || k === 'enter') { e.preventDefault(); setFielder(undefined); advance(kind!, 'fielder'); }
        const idx = n === 0 ? 9 : n - 1;
        if (n >= 0 && fielders[idx]) { setFielder(fielders[idx].id); advance(kind!, 'fielder'); }
      } else if (step === 'runs') {
        if (n >= 0 && n <= 3 && kind === 'runout') setRuns(n);
        if (k === 'c') setCrossed((v) => !v);
        if (k === ' ' || k === 'enter') { e.preventDefault(); advance(kind!, 'runs'); }
      } else if (step === 'confirm') {
        if (k === ' ' || k === 'enter') { e.preventDefault(); void finish(); }
      } else if (step === 'incoming') {
        const idx = n - 1;
        if (n >= 1 && inn.availableBatters[idx]) void finish(inn.availableBatters[idx].id);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const back = () => {
    if (step === 'kind') return onClose();
    const steps = kind ? flow(kind) : [];
    const i = steps.indexOf(step);
    setStep(i > 0 ? steps[i - 1] : 'kind');
  };

  return (
    <Modal title="Wicket" onClose={onClose}>
      {inn.freeHit && <div className="mb-3 rounded bg-amber-500 px-3 py-1 text-center text-sm font-bold text-ink-950">FREE HIT — only run out, obstructing, handled ball and hit twice are valid</div>}
      {step === 'kind' && (
        <>
          <div className="mb-3">
            <div className="label">Delivery</div>
            <div className="grid grid-cols-5 gap-2">
              {([['normal', 'Normal', 'X'], ['wide', 'Wide', 'D'], ['noball', 'No-ball', 'N'], ['bye', 'Bye', 'B'], ['legbye', 'Leg bye', 'L']] as const).map(([d, l, key]) => (
                <button key={d} className={`btn !px-1 ${delivery === d ? '!bg-accent !text-ink-950' : ''}`} onClick={() => setDelivery(d)}>{l} <span className="ml-1 text-[10px] opacity-60">{key}</span></button>
              ))}
            </div>
          </div>
          <div className="label">How was the batter out?</div>
          <div className="grid grid-cols-2 gap-2">
            {KINDS.map((k, i) => (
              <button key={k.kind} disabled={!allowed.includes(k.kind)} className="btn justify-between" onClick={() => pickKind(k.kind)}>
                <span>{k.label}</span>
                <span className="text-[10px] opacity-60">{i < 9 ? i + 1 : k.kind === 'timedout' ? 'T' : 'R'}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">Retired hurt is not a wicket — use Fix / More.</p>
        </>
      )}
      {step === 'who' && kind && (
        <>
          <div className="label">Who is out?</div>
          <div className="grid grid-cols-2 gap-2">
            {[striker, non].map((b, i) => b && (
              <button key={b.id} className="btn !min-h-[64px]" onClick={() => { setOutId(b.id); advance(kind, 'who'); }}>
                {b.name} <span className="ml-2 text-xs opacity-60">{i === 0 ? 'striker · 1' : 'non-striker · 2'}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {step === 'fielder' && kind && (
        <>
          <div className="label">{kind === 'stumped' ? 'Wicket-keeper' : 'Fielder'} (optional)</div>
          <div className="grid grid-cols-2 gap-2">
            {fielders.map((p, i) => (
              <button key={p.id} className="btn justify-between" onClick={() => { setFielder(p.id); advance(kind, 'fielder'); }}>
                <span>{p.name}</span><span className="text-[10px] opacity-60">{i < 10 ? (i + 1) % 10 : ''}</span>
              </button>
            ))}
          </div>
          <button className="btn mt-3 w-full" onClick={() => { setFielder(undefined); advance(kind, 'fielder'); }}>Skip <span className="ml-2 text-[10px] opacity-60">Space</span></button>
        </>
      )}
      {step === 'runs' && kind && (
        <>
          {kind === 'runout' && (
            <>
              <div className="label">Runs completed before the run out (credited to the batter)</div>
              <div className="grid grid-cols-4 gap-2">
                {[0, 1, 2, 3].map((n) => <button key={n} className={`btn !min-h-[56px] !text-xl ${runs === n ? '!bg-accent !text-ink-950' : ''}`} onClick={() => setRuns(n)}>{n}</button>)}
              </div>
            </>
          )}
          <div className="label mt-4">Did the batters cross on the attempt / before the catch? <span className="opacity-60">(C)</span></div>
          <div className="grid grid-cols-2 gap-2">
            <button className={`btn ${!crossed ? '!bg-accent !text-ink-950' : ''}`} onClick={() => setCrossed(false)}>No — new batter takes the dismissed batter's end</button>
            <button className={`btn ${crossed ? '!bg-accent !text-ink-950' : ''}`} onClick={() => setCrossed(true)}>Yes — they crossed</button>
          </div>
          <button className="btn btn-primary mt-4 w-full" onClick={() => advance(kind, 'runs')}>Next <span className="ml-2 text-[10px] opacity-70">Space</span></button>
        </>
      )}
      {step === 'incoming' && (
        <>
          <div className="label">Incoming batter — {inn.battingTeam}</div>
          <div className="grid grid-cols-2 gap-2">
            {inn.availableBatters.map((p, i) => {
              const rec = inn.batting.find((b) => b.id === p.id);
              return (
                <button key={p.id} className="btn justify-between" onClick={() => void finish(p.id)}>
                  <span>{p.name}{rec?.status === 'retired hurt' && <span className="ml-1 text-xs text-amber-400">(returning)</span>}</span>
                  <span className="text-[10px] opacity-60">{i < 9 ? i + 1 : ''}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex gap-2">
            <input className="input" placeholder="Add a new player (guest / impact)" value={guest} onChange={(e) => setGuest(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addGuest()} />
            <button className="btn" onClick={() => void addGuest()}>Add &amp; send in</button>
          </div>
          <button className="btn mt-3 w-full" onClick={() => void finish(undefined)}>Choose later</button>
        </>
      )}
      {step === 'confirm' && (
        <>
          <p className="rounded-lg bg-amber-500 px-3 py-2 font-bold text-ink-950">This is the last wicket — the innings will end.</p>
          <button className="btn btn-primary mt-4 w-full" onClick={() => void finish()}>Confirm wicket <span className="ml-2 text-[10px] opacity-70">Space</span></button>
        </>
      )}
      <div className="mt-4 flex justify-between">
        <button className="btn" onClick={back}>{step === 'kind' ? 'Cancel' : '← Back'}</button>
      </div>
    </Modal>
  );
}
