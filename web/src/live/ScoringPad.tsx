import type { EventPayload, InningsState } from '@engine/types';
import type { SendOpts } from './scorer';
import { useEffect, useState } from 'react';
import { Modal, isTyping } from '../ui';

export type ExtraKind = 'wide' | 'noball' | 'bye' | 'legbye';

interface Props {
  inn: InningsState;
  disabled: boolean;
  modalOpen: boolean;
  send: (p: EventPayload, opts?: SendOpts) => void;
  undo: (key?: boolean) => void;
  openWicket: () => void;
  openExtra: (k: ExtraKind) => void;
  openFix: () => void;
  openHelp: () => void;
  overthrows: number;
  setOverthrows: (n: number) => void;
}

const RUN_STYLES = ['bg-ink-700', 'bg-ink-700', 'bg-ink-700', 'bg-ink-700', 'bg-emerald-700 hover:bg-emerald-600 border-emerald-500', 'bg-ink-700', 'bg-violet-700 hover:bg-violet-600 border-violet-500'];

export function ScoringPad({ inn, disabled, modalOpen, send, undo, openWicket, openExtra, openFix, openHelp, overthrows, setOverthrows }: Props) {
  const run = (n: number, key = false) => send({ type: 'BALL', runs: n, overthrows: overthrows || undefined }, { key });

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (isTyping() || modalOpen || e.altKey || e.repeat) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(true); return; }
      if (e.ctrlKey || e.metaKey) return;
      if (k === 'u') return void undo(true);
      if (k === '?' || k === '/') return openHelp();
      if (disabled) return;
      if (/^[0-6]$/.test(k)) return run(Number(k), true);
      if (k === 'w') return openWicket();
      if (k === 'd') return openExtra('wide');
      if (k === 'n') return openExtra('noball');
      if (k === 'b') return openExtra('bye');
      if (k === 'l') return openExtra('legbye');
      if (k === 's') return void send({ type: 'SWAP_STRIKE' }, { key: true });
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const big = 'min-h-[64px] text-2xl font-extrabold';
  return (
    <div className="flex flex-col gap-3">
      {inn.freeHit && <div className="rounded-lg bg-amber-500 px-4 py-2 text-center text-lg font-extrabold tracking-widest text-ink-950">FREE HIT</div>}
      <div className="grid grid-cols-7 gap-2">
        {[0, 1, 2, 3, 4, 5, 6].map((n) => (
          <button key={n} disabled={disabled} className={`btn ${big} !min-h-[88px] !text-4xl ${RUN_STYLES[n]}`} onClick={() => run(n)} aria-label={`${n} runs`}>
            {n}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span className="font-semibold uppercase tracking-wide">Overthrows</span>
        {[0, 1, 2, 3, 4].map((n) => (
          <button key={n} className={`btn !min-h-[36px] !px-3 ${overthrows === n ? '!bg-accent !text-ink-950' : ''}`} onClick={() => setOverthrows(n)}>{n === 0 ? 'Off' : `+${n}`}</button>
        ))}
        <span>adds to the next run ball; strike follows total runs run</span>
      </div>
      <div className="grid grid-cols-6 gap-2">
        <button disabled={disabled} className="btn !min-h-[56px]" onClick={() => openExtra('wide')}>Wd<span className="ml-1 text-[10px] opacity-60">D</span></button>
        <button disabled={disabled} className="btn !min-h-[56px]" onClick={() => openExtra('noball')}>Nb<span className="ml-1 text-[10px] opacity-60">N</span></button>
        <button disabled={disabled} className="btn !min-h-[56px]" onClick={() => openExtra('bye')}>Bye<span className="ml-1 text-[10px] opacity-60">B</span></button>
        <button disabled={disabled} className="btn !min-h-[56px]" onClick={() => openExtra('legbye')}>Leg Bye<span className="ml-1 text-[10px] opacity-60">L</span></button>
        <button disabled={disabled} className="btn !min-h-[56px]" onClick={() => send({ type: 'PENALTY', runs: 5 })}>Penalty 5</button>
        <button disabled={disabled} className="btn !min-h-[56px]" onClick={() => send({ type: 'BALL', extra: 'dead' })}>Dead ball</button>
      </div>
      <div className="grid grid-cols-[2fr_1fr_1fr] gap-2">
        <button disabled={disabled} className="btn btn-danger !min-h-[72px] !text-xl tracking-wide" onClick={openWicket}>WICKET <span className="ml-2 text-xs opacity-70">W</span></button>
        <button className="btn !min-h-[72px] !bg-amber-600 hover:!bg-amber-500" onClick={() => undo()}>UNDO <span className="ml-1 text-[10px] opacity-70">U</span></button>
        <button disabled={disabled} className="btn !min-h-[72px]" onClick={() => send({ type: 'SWAP_STRIKE' })}>Swap strike <span className="ml-1 text-[10px] opacity-60">S</span></button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button disabled={inn.complete} className="btn" onClick={() => send({ type: 'END_OVER' })}>End over (force)</button>
        <button disabled={inn.complete} className="btn" onClick={() => window.confirm('End this innings now?') && send({ type: 'END_INNINGS', reason: 'declared' })}>End innings</button>
        <button className="btn" onClick={openFix}>Fix / More…</button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
        {[['0–6', 'runs'], ['W', 'wicket'], ['D', 'wide'], ['N', 'no-ball'], ['B', 'bye'], ['L', 'leg bye'], ['S', 'swap'], ['U', 'undo']].map(([k, v]) => (
          <span key={k}><kbd className="rounded bg-ink-600 px-1.5 py-0.5 font-mono text-[11px] text-slate-200">{k}</kbd> {v}</span>
        ))}
        <button className="underline" onClick={openHelp}>All shortcuts (?)</button>
      </div>
    </div>
  );
}

export function ExtraModal({ kind, onClose, onSend }: { kind: ExtraKind; onClose: () => void; onSend: (p: EventPayload) => void }) {
  const [runs, setRuns] = useState(kind === 'bye' || kind === 'legbye' ? 1 : 0);
  const [mode, setMode] = useState<'bat' | 'bye' | 'legbye'>('bat');
  const [over, setOver] = useState(0);
  const title = { wide: 'Wide', noball: 'No-ball', bye: 'Bye', legbye: 'Leg bye' }[kind];

  const confirm = (n = runs) => {
    const p: EventPayload = { type: 'BALL', extra: kind, runs: n, overthrows: over || undefined };
    if (kind === 'noball' && mode !== 'bat') p.noballExtra = mode;
    onSend(p);
    onClose();
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (isTyping()) return;
      const k = e.key.toLowerCase();
      if (/^[0-6]$/.test(k)) { e.preventDefault(); setRuns(Number(k)); }
      else if (k === ' ' || k === 'enter') { e.preventDefault(); confirm(); }
      else if (kind === 'noball' && k === 't') setMode('bat');
      else if (kind === 'noball' && k === 'b') setMode('bye');
      else if (kind === 'noball' && k === 'l') setMode('legbye');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  return (
    <Modal title={kind === 'wide' ? 'Wide — additional runs' : kind === 'noball' ? 'No-ball — runs' : `${title} — runs`} onClose={onClose}>
      {kind === 'noball' && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          {([['bat', 'Off the bat', 'T'], ['bye', 'Byes', 'B'], ['legbye', 'Leg byes', 'L']] as const).map(([m, label, key]) => (
            <button key={m} className={`btn ${mode === m ? '!bg-accent !text-ink-950' : ''}`} onClick={() => setMode(m)}>{label} <span className="ml-1 text-[10px] opacity-60">{key}</span></button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-7 gap-2">
        {[0, 1, 2, 3, 4, 5, 6].map((n) => (
          <button key={n} className={`btn !min-h-[64px] !text-2xl ${runs === n ? '!bg-accent !text-ink-950' : ''}`} onClick={() => confirm(n)}>{n}</button>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
        <span className="font-semibold uppercase">+ Overthrows</span>
        {[0, 1, 2, 3, 4].map((n) => <button key={n} className={`btn !min-h-[36px] !px-3 ${over === n ? '!bg-accent !text-ink-950' : ''}`} onClick={() => setOver(n)}>{n}</button>)}
      </div>
      <p className="mt-3 text-xs text-slate-400">Tap a number to confirm in one tap, or press a digit then <b>Space</b>. {kind === 'wide' && 'The 1 wide penalty run is added automatically.'} {kind === 'noball' && 'The 1 no-ball penalty run is added automatically and the next ball is a free hit.'}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => confirm()}>Confirm ({runs}) <span className="ml-1 text-[10px] opacity-70">Space</span></button>
      </div>
    </Modal>
  );
}

export function HelpModal({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['0 – 6', 'Runs off the bat'], ['W', 'Wicket wizard'], ['D', 'Wide'], ['N', 'No-ball'], ['B', 'Bye'], ['L', 'Leg bye'], ['S', 'Swap strike'],
    ['U  /  Ctrl/Cmd + Z', 'Undo last event'], ['Space / Enter', 'Confirm a popup'], ['Esc', 'Cancel a popup'], ['1 – 9', 'Pick a listed option in wizards and pickers'], ['Enter', 'Reopen a dismissed new-bowler / new-batter picker'], ['?', 'This cheat-sheet'],
  ];
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-ink-700"><td className="py-2 pr-4"><kbd className="rounded bg-ink-600 px-2 py-1 font-mono text-xs">{k}</kbd></td><td>{v}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-slate-400">Shortcuts are disabled while you type in a text box and while a required prompt (new bowler / new batter) is open.</p>
    </Modal>
  );
}
