import type { InningsState, LiveState } from '@engine/types';
import { useEffect, useRef, useState } from 'react';
import { useRealtime } from '../realtime';
import { Empty, Modal, isTyping } from '../ui';
import { FixMenu, EditBall } from '../live/FixMenu';
import { BatterPicker, BowlerPicker, StartInnings } from '../live/Pickers';
import { BattersCard, BowlerCard, PartnershipCard, Timeline } from '../live/Panels';
import { ExtraKind, ExtraModal, HelpModal, ScoringPad } from '../live/ScoringPad';
import { InningsCard } from '../live/Scorecard';
import { promptText, useScorer } from '../live/scorer';
import { WicketWizard } from '../live/WicketWizard';
import { HockeyLive } from '../live/hockey/HockeyLive';

type ModalState = null | { kind: 'extra'; extra: ExtraKind } | { kind: 'wicket' } | { kind: 'bowler'; mid?: boolean } | { kind: 'batter' } | { kind: 'fix' } | { kind: 'help' } | { kind: 'edit'; id: number } | { kind: 'card' };

export function Live({ goto }: { goto: (page: string) => void }) {
  const { state, matchId, clients } = useRealtime();
  const { send, undo } = useScorer(matchId);
  const [modal, setModal] = useState<ModalState>(null);
  const [overthrows, setOverthrows] = useState(0);
  const dismissed = useRef<string>('');

  const inn = state?.current ?? null;
  const prompt = inn && !inn.complete ? promptText(inn) : null;
  const needsKey = inn ? `${inn.number}:${inn.needs.bowler}:${inn.needs.batter}:${inn.timeline.length}` : '';

  // Open the required picker automatically whenever a new prompt appears.
  useEffect(() => {
    if (!inn || inn.complete || inn.needs.openers) return;
    if (dismissed.current === needsKey) return;
    if (inn.needs.batter) setModal({ kind: 'batter' });
    else if (inn.needs.bowler) setModal({ kind: 'bowler' });
  }, [needsKey]);

  // Enter reopens a required picker that was dismissed with Esc.
  useEffect(() => {
    if (modal !== null || !inn || inn.complete || inn.needs.openers || !(inn.needs.batter || inn.needs.bowler)) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || isTyping() || document.activeElement !== document.body) return;
      setModal({ kind: inn.needs.batter ? 'batter' : 'bowler' });
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  if (!state || matchId === null) {
    return (
      <Empty title="No active match yet" hint="Follow the checklist: add teams, create a match, then copy the overlay URLs.">
        <button className="btn btn-primary" onClick={() => goto('teams')}>1 · Add teams</button>
        <button className="btn" onClick={() => goto('setup')}>2 · Create match</button>
        <button className="btn" onClick={() => goto('broadcast')}>3 · Overlay URLs</button>
      </Empty>
    );
  }

  // Route hockey matches to the dedicated scoring interface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((state as any).sport === 'hockey') return <HockeyLive />;

  const close = () => { dismissed.current = needsKey; setModal(null); };
  const closeFree = () => setModal(null);

  if (state.status === 'setup' || state.status === 'break' || (state.status === 'live' && inn?.needs.openers) || state.canSuperOver) {
    return (
      <div className="mx-auto max-w-6xl p-4">
        <TopBar state={state} clients={clients.total} />
        {state.canSuperOver && state.result && <div className="card mx-auto mt-6 max-w-2xl text-center text-xl font-bold">{state.result.text}</div>}
        <StartInnings key={state.innings.length + String(state.canSuperOver)} state={state} send={send} />
        <div className="mx-auto mt-4 flex max-w-2xl justify-between">
          <button className="btn" onClick={() => void undo()} disabled={state.eventCount === 0}>Undo last step</button>
          {state.innings.length > 0 && <button className="btn" onClick={() => setModal({ kind: 'card' })}>View scorecard</button>}
          <button className="btn" onClick={() => setModal({ kind: 'fix' })}>Revised target / more…</button>
        </div>
        {modal?.kind === 'card' && <ScorecardModal state={state} onClose={closeFree} />}
        {modal?.kind === 'fix' && matchId !== null && <FixMenu state={state} matchId={matchId} send={send} onClose={closeFree} onBowler={() => undefined} />}
      </div>
    );
  }

  if (state.status === 'completed' || !inn) {
    return (
      <div className="mx-auto max-w-4xl p-4">
        <TopBar state={state} clients={clients.total} />
        <div className="card mt-6 text-center">
          <div className="text-sm uppercase tracking-widest text-slate-400">Result</div>
          <div className="mt-2 text-3xl font-black">{state.result?.text}</div>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button className="btn" onClick={() => void undo()}>Undo last step</button>
            <button className="btn" onClick={() => setModal({ kind: 'card' })}>Scorecard</button>
            <button className="btn btn-primary" onClick={() => goto('broadcast')}>Show result overlay</button>
            <button className="btn" onClick={() => goto('setup')}>New match</button>
          </div>
        </div>
        {modal?.kind === 'card' && <ScorecardModal state={state} onClose={closeFree} />}
      </div>
    );
  }

  const disabled = !!prompt || inn.complete;
  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-3 p-3">
      <TopBar state={state} clients={clients.total} />
      {prompt && (
        <div className="flex items-center justify-between rounded-lg bg-amber-500 px-4 py-3 font-bold text-ink-950">
          <span>{prompt}</span>
          <button className="btn !min-h-[36px] !bg-ink-950 !text-white" onClick={() => setModal(inn.needs.batter ? { kind: 'batter' } : { kind: 'bowler' })}>Select now</button>
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <ScoringPad
          inn={inn} disabled={disabled} modalOpen={modal !== null} send={(p, o) => void send(p, o)} undo={(k) => void undo(k)}
          openWicket={() => setModal({ kind: 'wicket' })} openExtra={(k) => setModal({ kind: 'extra', extra: k })}
          openFix={() => setModal({ kind: 'fix' })} openHelp={() => setModal({ kind: 'help' })}
          overthrows={overthrows} setOverthrows={setOverthrows}
        />
        <div className="flex flex-col gap-3">
          <BattersCard inn={inn} />
          <BowlerCard inn={inn} />
          <PartnershipCard inn={inn} />
          <Timeline inn={inn} onEdit={(id) => setModal({ kind: 'edit', id })} />
          <button className="btn" onClick={() => setModal({ kind: 'card' })}>Full scorecard</button>
        </div>
      </div>
      {state.invariantErrors.length > 0 && <InvariantPanel errors={state.invariantErrors} />}

      {modal?.kind === 'extra' && <ExtraModal kind={modal.extra} onClose={closeFree} onSend={(p) => { void send(p); setOverthrows(0); }} />}
      {modal?.kind === 'wicket' && <WicketWizard state={state} inn={inn} matchId={matchId} onClose={closeFree} onSend={send} />}
      {modal?.kind === 'bowler' && <BowlerPicker inn={inn} matchId={matchId} send={send} onClose={close} mid={modal.mid} />}
      {modal?.kind === 'batter' && <BatterPicker inn={inn} matchId={matchId} send={send} onClose={close} />}
      {modal?.kind === 'fix' && <FixMenu state={state} matchId={matchId} send={send} onClose={closeFree} onBowler={() => setModal({ kind: 'bowler', mid: true })} />}
      {modal?.kind === 'help' && <HelpModal onClose={closeFree} />}
      {modal?.kind === 'edit' && <EditBall state={state} matchId={matchId} eventId={modal.id} onClose={closeFree} />}
      {modal?.kind === 'card' && <ScorecardModal state={state} onClose={closeFree} />}
    </div>
  );
}

function InvariantPanel({ errors }: { errors: string[] }) {
  return (
    <details className="rounded-lg border border-red-700 bg-red-950/50 p-3 text-xs text-red-200" open>
      <summary className="cursor-pointer font-bold">Consistency check failed ({errors.length})</summary>
      <ul className="mt-2 list-disc pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
    </details>
  );
}

export function ScorecardModal({ state, onClose }: { state: LiveState; onClose: () => void }) {
  return (
    <Modal title="Scorecard" onClose={onClose} wide>
      {state.innings.map((i) => <InningsCard key={i.number} inn={i} state={state} />)}
      {state.result && <p className="font-bold">{state.result.text}</p>}
    </Modal>
  );
}

function badge(status: LiveState['status']): [string, string] {
  if (status === 'live') return ['LIVE', 'bg-red-600'];
  if (status === 'break') return ['INNINGS BREAK', 'bg-amber-500 text-ink-950'];
  if (status === 'completed') return ['COMPLETED', 'bg-emerald-600'];
  return ['SETUP', 'bg-ink-500'];
}

export function TopBar({ state, clients }: { state: LiveState; clients: number }) {
  const inn: InningsState | undefined = state.current ?? state.innings[state.innings.length - 1];
  const [label, cls] = badge(state.status);
  const short = inn ? state.teams[inn.battingSide].shortName : `${state.teams.A.shortName} v ${state.teams.B.shortName}`;
  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-ink-700 bg-ink-800 px-4 py-3">
      <div className="min-w-0">
        <div className="truncate text-xs uppercase tracking-widest text-slate-400">{state.title || 'Match'}{inn ? ` · ${inn.superOver ? 'Super Over' : `Innings ${inn.number}`}` : ''}</div>
        <div className="text-3xl font-black tabular-nums">{short} {inn ? `${inn.runs}/${inn.wickets}` : ''} {inn && <span className="text-lg font-semibold text-slate-400">({inn.overs}{inn.maxOvers ? `/${inn.maxOvers}` : ''})</span>}</div>
      </div>
      {inn && <div className="text-sm"><span className="text-slate-400">CRR</span> <b>{inn.crr.toFixed(2)}</b></div>}
      {inn && inn.target !== null && !inn.complete && (
        <div className="rounded-lg bg-ink-900 px-3 py-1 text-sm">Target <b>{inn.target}</b> · need <b>{inn.runsNeeded}</b> off <b>{inn.ballsRemaining}</b> · RRR <b>{inn.rrr?.toFixed(2) ?? '–'}</b></div>
      )}
      {inn?.powerplay && <span className="rounded bg-sky-600 px-2 py-0.5 text-xs font-bold">POWERPLAY</span>}
      {inn?.freeHit && <span className="rounded bg-amber-500 px-2 py-0.5 text-xs font-bold text-ink-950">FREE HIT</span>}
      <div className="ml-auto flex items-center gap-3">
        <span title="Connected overlay clients" className={`flex items-center gap-1.5 text-sm ${clients ? 'text-emerald-400' : 'text-slate-500'}`}><span className={`h-2.5 w-2.5 rounded-full ${clients ? 'bg-emerald-400' : 'bg-slate-600'}`} />{clients} overlay{clients === 1 ? '' : 's'}</span>
        <span className={`rounded px-3 py-1 text-xs font-extrabold tracking-wider ${cls}`}>{label}</span>
      </div>
    </header>
  );
}
