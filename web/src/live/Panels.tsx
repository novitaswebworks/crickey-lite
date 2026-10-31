import type { InningsState } from '@engine/types';
import { BallChip } from './Scorecard';

function BatterRow({ inn, id, strike }: { inn: InningsState; id: string | null; strike: boolean }) {
  const b = inn.batting.find((x) => x.id === id);
  return (
    <div className={`flex items-center gap-3 rounded-lg px-3 py-2 ${strike ? 'bg-accent/15 ring-2 ring-accent' : 'bg-ink-900'}`}>
      <div className={`flex h-8 w-8 items-center justify-center rounded-full text-lg font-black ${strike ? 'bg-accent text-ink-950' : 'bg-ink-700 text-slate-500'}`} aria-label={strike ? 'On strike' : 'Non-striker'}>{strike && <span className="h-3 w-3 rounded-full bg-ink-950" />}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-bold">{b ? b.name : <span className="text-slate-500">— vacant —</span>}</div>
        <div className="text-xs text-slate-400">4s {b?.fours ?? 0} · 6s {b?.sixes ?? 0} · SR {(b?.strikeRate ?? 0).toFixed(1)}</div>
      </div>
      <div className="text-right"><span className="text-2xl font-black">{b?.runs ?? 0}</span><span className="ml-1 text-sm text-slate-400">({b?.balls ?? 0})</span></div>
    </div>
  );
}

export function BattersCard({ inn }: { inn: InningsState }) {
  return (
    <div className="card flex flex-col gap-2">
      <div className="label !mb-0">Batters</div>
      <BatterRow inn={inn} id={inn.strikerId} strike />
      <BatterRow inn={inn} id={inn.nonStrikerId} strike={false} />
    </div>
  );
}

export function BowlerCard({ inn }: { inn: InningsState }) {
  const b = inn.bowling.find((x) => x.id === inn.bowlerId);
  return (
    <div className="card">
      <div className="label">Bowler</div>
      <div className="flex items-baseline justify-between">
        <div className="text-lg font-bold">{b?.name ?? <span className="text-slate-500">— select bowler —</span>}</div>
        <div className="text-xl font-black">{b ? `${b.overs}-${b.maidens}-${b.runs}-${b.wickets}` : '0-0-0-0'}<span className="ml-2 text-xs font-normal text-slate-400">Econ {(b?.economy ?? 0).toFixed(2)}</span></div>
      </div>
      <div className="mt-3 flex min-h-[32px] flex-wrap gap-1.5">
        {inn.currentOver.length === 0 && <span className="text-sm text-slate-500">New over</span>}
        {inn.currentOver.map((r) => <BallChip key={r.eventId} label={r.label} kind={r.kind} />)}
      </div>
    </div>
  );
}

export function PartnershipCard({ inn }: { inn: InningsState }) {
  const p = inn.partnership;
  return (
    <div className="card">
      <div className="label">Partnership</div>
      <div className="text-xl font-black">{p.runs} <span className="text-sm font-normal text-slate-400">({p.balls} balls)</span></div>
      <div className="mt-1 text-xs text-slate-400">{p.batters.map((b) => `${b.name} ${b.runs} (${b.balls})`).join('  ·  ')}</div>
    </div>
  );
}

export function Timeline({ inn, onEdit }: { inn: InningsState; onEdit: (eventId: number) => void }) {
  const balls = [...inn.timeline].reverse().slice(0, 30);
  return (
    <div className="card">
      <div className="label">Recent balls — click to edit</div>
      <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
        {balls.length === 0 && <span className="text-sm text-slate-500">No balls yet</span>}
        {balls.map((b) => (
          <button key={b.eventId} title={`${b.overLabel} ${b.bowlerName} to ${b.strikerName}`} onClick={() => onEdit(b.eventId)} className="rounded-lg p-0.5 hover:bg-ink-600">
            <div className="text-center text-[9px] text-slate-500">{b.overLabel}</div>
            <BallChip label={b.label} kind={b.kind} />
          </button>
        ))}
      </div>
    </div>
  );
}
