import type { LiveState } from '@engine/types';
import { useCallback, useEffect, useState } from 'react';
import { ApiFail, MatchSummary, del, get, post } from '../api';
import { Empty, toast } from '../ui';
import { ScorecardModal } from './Live';

export function History({ goto }: { goto: (p: string) => void }) {
  const [list, setList] = useState<MatchSummary[] | null>(null);
  const [card, setCard] = useState<LiveState | null>(null);
  const load = useCallback(async () => setList(await get<MatchSummary[]>('/api/matches')), []);
  useEffect(() => { void load(); }, [load]);

  const resume = async (id: number) => { try { await post(`/api/matches/${id}/activate`); goto('live'); } catch (e) { toast((e as ApiFail).message, 'error'); } };
  const remove = async (m: MatchSummary) => {
    if (!window.confirm(`Delete "${m.title || `Match #${m.id}`}" and its whole scorecard? This cannot be undone.`)) return;
    try { await del(`/api/matches/${m.id}`); await load(); toast('Match deleted'); } catch (e) { toast((e as ApiFail).message, 'error'); }
  };

  if (list && !list.length) return <Empty title="No matches yet" hint="Create a match to see it here."><button className="btn btn-primary" onClick={() => goto('setup')}>Create match</button></Empty>;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-3 p-4">
      <h1 className="text-2xl font-black">Match history</h1>
      {list?.map((m) => (
        <div key={m.id} className={`card flex flex-wrap items-center gap-4 ${m.active ? '!border-accent' : ''}`}>
          <div className="min-w-0 flex-1">
            <div className="font-bold">{m.title || `Match #${m.id}`}{' '}{m.active && <span className="ml-2 rounded bg-accent px-2 py-0.5 text-xs text-ink-950">ACTIVE</span>}{' '}<span className="rounded px-1.5 py-0.5 text-xs font-bold bg-ink-600 text-slate-300">{m.sport === 'hockey' ? '🏑 Hockey' : '🏏 Cricket'}</span></div>
            <div className="text-sm text-slate-300">{m.teamA.name} v {m.teamB.name}{m.sport === 'cricket' ? ` · ${m.overs} ov` : ''}{m.venue ? ` · ${m.venue}` : ''}</div>
            <div className="text-sm text-slate-400">{m.score || 'Not started'} · {m.statusText}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => void resume(m.id)}>{m.status === 'completed' ? 'Open' : 'Resume'}</button>
            <button className="btn" onClick={async () => setCard((await get<{ state: LiveState }>(`/api/matches/${m.id}/export.json`)).state)}>Scorecard</button>
            <a className="btn" href={`/api/matches/${m.id}/export.csv`}>CSV</a>
            <a className="btn" href={`/api/matches/${m.id}/export.json`}>JSON</a>
            <button className="btn !text-red-400" onClick={() => void remove(m)}>Delete</button>
          </div>
        </div>
      ))}
      {card && <ScorecardModal state={card} onClose={() => setCard(null)} />}
    </div>
  );
}
