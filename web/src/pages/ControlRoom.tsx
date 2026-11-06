import { useEffect, useMemo, useState } from 'react';
import type { Info, MatchSummary, OverlayActivity } from '../api';
import { ApiFail, get, post } from '../api';
import { useRealtime } from '../realtime';
import { copyText, toast } from '../ui';
import { Live } from './Live';

const LABELS: Record<string, string> = {
  scorebug: 'Scorebug', four: 'Four', six: 'Six', wicket: 'Wicket', 'new-batter': 'New batter', 'over-summary': 'Over summary', milestone: 'Milestone',
  'hockey/scorebug': 'Scorebug', 'hockey/goal': 'Goal', 'hockey/card': 'Card', 'hockey/penalty-corner': 'Penalty corner',
  'hockey/shootout': 'Shootout tracker', 'hockey/starting11': 'Starting 11', 'hockey/substitutes': 'Substitutes', 'hockey/scoreboard-banner': 'Full scoreboard',
};
const TRANSIENT = new Set([
  'four', 'six', 'wicket', 'new-batter', 'over-summary', 'milestone',
  'hockey/goal', 'hockey/card', 'hockey/penalty-corner', 'hockey/starting11', 'hockey/substitutes', 'hockey/scoreboard-banner',
]);
const fail = (e: unknown) => toast((e as ApiFail).message, 'error');

export function ControlRoom() {
  const { state, matchId, overlays, clients, connected } = useRealtime();
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [info, setInfo] = useState<Info | null>(null);
  const [activity, setActivity] = useState<OverlayActivity[]>([]);
  const [vmix, setVmix] = useState<{ enabled: boolean; state: string; lastError: string | null } | null>(null);
  const [obs, setObs] = useState<{ ok: boolean; message: string; version?: string; scene?: string } | null>(null);
  const [preview, setPreview] = useState('');
  const [desk, setDesk] = useState<'broadcast' | 'scoring'>('broadcast');
  const [side, setSide] = useState<'A' | 'B'>('A');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void get<MatchSummary[]>('/api/matches').then(setMatches).catch(fail);
    void get<Info>('/api/info').then(setInfo).catch(fail);
    const update = () => {
      void get<OverlayActivity[]>('/api/overlays/history?limit=12').then(setActivity).catch(() => undefined);
      void get<typeof vmix>('/api/vmix/status').then(setVmix).catch(() => undefined);
    };
    update();
    const t = setInterval(update, 2500);
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(c); };
  }, []);

  const sport = (state as any)?.sport === 'hockey' ? 'hockey' : 'cricket';
  const match = matches.find((m) => m.id === matchId);
  const sourceName = sport === 'hockey' ? 'hockey/scorebug' : 'scorebug';
  const onAir = overlays[sourceName];
  const names = useMemo(() => {
    const hockey = Object.keys(LABELS).filter((n) => n.startsWith('hockey/'));
    const cricket = ['scorebug', 'four', 'six', 'wicket', 'new-batter', 'over-summary', 'milestone'];
    return sport === 'hockey' ? hockey : cricket;
  }, [sport]);
  useEffect(() => { if (!names.includes(preview)) setPreview(sourceName); }, [names, preview, sourceName]);

  const base = info?.publicBaseUrl || location.origin;
  const previewUrl = useMemo(() => {
    if (!preview) return '';
    const q = new URLSearchParams({ theme: 'neon', debug: '1', force: '1' });
    if (matchId !== null) q.set('match', String(matchId));
    if (preview === 'hockey/starting11' || preview === 'hockey/substitutes') q.set('side', side);
    return `${location.origin}/overlays/${preview}.html?${q}`;
  }, [matchId, preview, side]);
  const outputUrl = useMemo(() => {
    if (!preview) return '';
    const q = new URLSearchParams({ theme: 'neon' });
    const teamGraphic = preview === 'hockey/starting11' || preview === 'hockey/substitutes';
    // Team graphics are persistent OBS/vMix sources. Let them follow the active
    // match instead of pinning the source to whichever match was selected today.
    if (!teamGraphic && matchId !== null) q.set('match', String(matchId));
    if (teamGraphic) q.set('side', side);
    return `${base}/overlays/${preview}.html?${q}`;
  }, [base, matchId, preview, side]);

  const act = async (name: string, action: 'show' | 'hide' | 'trigger', data?: unknown) => {
    try {
      await post(`/api/overlays/${name}/${action === 'trigger' ? 'trigger' : action}`, data ? { data } : {});
      const team = (data as { side?: 'A' | 'B' } | undefined)?.side;
      toast(`${action === 'hide' ? 'Hid' : action === 'trigger' ? 'Fired' : 'Showed'} ${LABELS[name] ?? name}${team ? ` · Team ${team}` : ''}`, 'ok');
    } catch (e) { fail(e); }
  };
  const checkObs = async () => {
    try {
      const health = await post<{ ok: boolean; message: string; version?: string }>('/api/obs/test');
      if (!health.ok) { setObs(health); return; }
      const scenes = await get<{ current: string }>('/api/obs/scenes');
      setObs({ ...health, scene: scenes.current });
      toast('OBS connected', 'ok');
    } catch (e) {
      setObs({ ok: false, message: (e as ApiFail).message });
    }
  };
  const openPreview = () => { if (previewUrl) window.open(previewUrl, '_blank', 'noopener,noreferrer'); };
  const copyUrl = () => { if (outputUrl) void copyText(outputUrl); };
  const remaining = (entry: (typeof overlays)[string] | undefined) => entry?.visible && entry.durationMs && entry.startedAt
    ? Math.max(0, Math.ceil((entry.startedAt + entry.durationMs - now) / 1000)) : null;
  const status = (state as any)?.status ?? 'no match';
  const score = sport === 'hockey'
    ? `${(state as any)?.scoreA ?? 0} – ${(state as any)?.scoreB ?? 0}`
    : (state as any)?.current ? `${(state as any).current.runs}/${(state as any).current.wickets}` : '—';
  const period = sport === 'hockey'
    ? (state as any)?.periodLabel ?? 'Prematch'
    : (state as any)?.current ? `INN ${(state as any).current.number}` : 'Prematch';
  const clock = sport === 'hockey'
    ? `${String(Math.floor(((state as any)?.clock?.displayMs ?? 0) / 60000)).padStart(2, '0')}:${String(Math.floor((((state as any)?.clock?.displayMs ?? 0) % 60000) / 1000)).padStart(2, '0')}`
    : (state as any)?.current ? `${(state as any).current.overs} ov` : '—';
  const fireSet = sport === 'hockey'
    ? ['hockey/goal', 'hockey/card', 'hockey/penalty-corner', 'hockey/starting11', 'hockey/substitutes', 'hockey/scoreboard-banner']
    : ['four', 'six', 'wicket', 'new-batter', 'over-summary', 'milestone'];
  const latestIncident = sport === 'hockey'
    ? (() => {
        const teams = (state as any)?.teams;
        const incidents = ['A', 'B'].flatMap((s) => [
          ...((teams?.[s]?.goals ?? []).map((x: any) => ({ ...x, kindLabel: 'Goal' }))),
          ...((teams?.[s]?.cards ?? []).map((x: any) => ({ ...x, kindLabel: `${x.kind} card` }))),
        ]).sort((a: any, b: any) => (b.at ?? 0) - (a.at ?? 0));
        const last = incidents[0];
        return last ? `${last.kindLabel} · ${last.scorerName ?? last.playerName} · ${teams?.[last.teamSide]?.shortName ?? ''}` : 'No goals or cards recorded';
      })()
    : ((state as any)?.current?.timeline?.slice(-1)[0]
      ? `Last ball · ${(state as any).current.timeline.slice(-1)[0].label} · ${(state as any).current.timeline.slice(-1)[0].scoreAfter}`
      : 'No deliveries recorded');
  const changeClock = async (action: 'start' | 'stop') => {
    if (matchId === null) return;
    try { await post(`/api/matches/${matchId}/hockey/clock`, { action }); } catch (e) { fail(e); }
  };

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><div className="text-xs font-bold uppercase tracking-[.2em] text-accent">Broadcast operations</div><h1 className="text-2xl font-black">Live Control Room</h1></div>
        <div className="flex flex-wrap gap-2">
          <span className={`rounded px-3 py-2 text-xs font-bold ${connected ? 'bg-emerald-800 text-emerald-100' : 'bg-red-900 text-red-100'}`}>{connected ? 'PANEL CONNECTED' : 'PANEL DISCONNECTED'}</span>
          <button className="btn btn-danger" onClick={() => void post('/api/overlays/hide-all').catch(fail)}>Dismiss all graphics</button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Control Room workspace">
        <button role="tab" aria-selected={desk === 'broadcast'} className={`btn ${desk === 'broadcast' ? 'btn-primary' : ''}`} onClick={() => setDesk('broadcast')}>Broadcast controls</button>
        <button role="tab" aria-selected={desk === 'scoring'} className={`btn ${desk === 'scoring' ? 'btn-primary' : ''}`} onClick={() => setDesk('scoring')}>Live match scoring</button>
      </div>

      {desk === 'scoring' ? <Live goto={(page) => { location.hash = `#/${page === 'live' ? 'control' : page}`; }} /> : <>

      {!state && <div className="card border-amber-700 text-amber-100">No active match. Select or create a match before using live cues.</div>}

      <section className="grid gap-3 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div className="card flex flex-col justify-center"><div className="label">Active match</div><div className="text-xl font-black">{state ? (state as any).title || match?.title || `Match #${matchId}` : 'No active match'}</div><div className="mt-1 text-xs text-slate-400">{match?.venue || (state as any)?.venue || 'Venue not set'} · {sport.toUpperCase()}</div></div>
        <Metric label="Score" value={score} /><Metric label={sport === 'hockey' ? 'Period' : 'Innings'} value={period} /><Metric label={sport === 'hockey' ? 'Clock' : 'Overs'} value={clock} />
      </section>

      <section className="card flex flex-wrap items-center justify-between gap-3">
        <div><div className="label">Latest incident</div><div className="text-sm font-semibold">{latestIncident}</div></div>
        {sport === 'hockey' && state ? (
          <button className={`btn min-w-40 ${((state as any).clock?.running) ? 'btn-danger' : 'btn-primary'}`} disabled={status === 'completed'} onClick={() => void changeClock((state as any).clock?.running ? 'stop' : 'start')}>
            {(state as any).clock?.running ? 'Pause match clock' : 'Start match clock'}
          </button>
        ) : <button className="btn btn-primary" onClick={() => setDesk('scoring')}>Open match scoring</button>}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,.9fr)]">
        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><div className="label">Operator cues</div><p className="text-xs text-slate-400">Select a cue to put its graphic on air. Persistent graphics stay on until dismissed.</p></div><a className="btn !min-h-[36px]" href="#/broadcast">Overlay setup &amp; URLs</a></div>
            <div className="mb-3 flex flex-wrap gap-2">
              <button className={`btn !min-h-[44px] ${onAir?.visible ? '!border-emerald-500 !bg-emerald-800' : 'btn-primary'}`} onClick={() => void act(sourceName, onAir?.visible ? 'hide' : 'show')}>
                {onAir?.visible ? '● Scorebug on air · Hide' : 'Show scorebug'}
              </button>
              {sport === 'hockey' && <button className="btn !min-h-[44px]" onClick={() => void act('hockey/shootout', overlays['hockey/shootout']?.visible ? 'hide' : 'show')}>{overlays['hockey/shootout']?.visible ? 'Hide shootout tracker' : 'Show shootout tracker'}</button>}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {fireSet.map((name) => {
                const isTransient = TRANSIENT.has(name);
                const teamGraphic = name === 'hockey/starting11' || name === 'hockey/substitutes';
                const noSubstitutes = name === 'hockey/substitutes' && !(state as any)?.teams?.[side]?.substitutes?.length;
                return <div key={name} className="flex min-w-0 items-stretch gap-1">
                  {teamGraphic && <select aria-label={`${LABELS[name]} team`} className="input !w-[4.5rem] !px-2" value={side} onChange={(e) => setSide(e.target.value as 'A' | 'B')}><option value="A">Team A</option><option value="B">Team B</option></select>}
                  <button className="btn min-h-[48px] flex-1 font-bold" disabled={!state || noSubstitutes} title={noSubstitutes ? `Add substitute players to Team ${side}'s match lineup first` : ''} onClick={() => void act(name, isTransient ? 'trigger' : 'show', teamGraphic ? { side } : undefined)}>{noSubstitutes ? `No Team ${side} substitutes` : isTransient ? `Fire ${LABELS[name]}` : `Show ${LABELS[name]}`}</button>
                </div>;
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ink-700 pt-3">
              <span className="text-xs text-slate-400">Last live action: {state ? (state as any).statusText : 'Waiting for match state'}</span>
              <button className="btn !min-h-[36px]" disabled={!matchId || !state || status === 'completed'} title="Undo the latest scoring or match action" onClick={() => {
                if (!window.confirm('Undo the latest match action? This changes the official score or match state.')) return;
                void post(`/api/matches/${matchId}/undo`).then(() => toast('Last match action undone', 'ok')).catch(fail);
              }}>Undo last match action</button>
            </div>
          </div>

          <div className="card">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><div className="label">On air</div><p className="text-xs text-slate-400">These are the server’s live overlay states and connected browser sources.</p></div><span className="text-xs text-slate-400">{clients.total} source{clients.total === 1 ? '' : 's'} connected</span></div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[sourceName, ...fireSet].map((name) => {
                const entry = overlays[name];
                return <div key={name} className="flex items-center justify-between gap-2 rounded-lg border border-ink-700 bg-ink-900/70 px-3 py-2">
                  <div className="min-w-0"><div className="truncate text-sm font-semibold">{LABELS[name]}</div><div className="text-[11px] text-slate-500">{clients.byOverlay[name] ?? 0} browser source{(clients.byOverlay[name] ?? 0) === 1 ? '' : 's'}</div></div>
                  <button className={`shrink-0 rounded px-2 py-1 text-[10px] font-black ${entry?.visible ? 'bg-emerald-700 text-white' : 'bg-ink-700 text-slate-300'}`} onClick={() => void act(name, entry?.visible ? 'hide' : 'show')}>{entry?.visible ? `ON AIR${remaining(entry) !== null ? ` · ${remaining(entry)}s` : ''}` : 'OFF AIR'}</button>
                </div>;
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><div className="label">Graphic preview</div><p className="text-xs text-slate-400">Preview is separate from the on-air state.</p></div><div className="flex gap-2"><button className="btn !min-h-[34px] !px-3" onClick={openPreview}>Open</button><button className="btn !min-h-[34px] !px-3" onClick={copyUrl}>Copy URL</button></div></div>
            <select className="input mb-3" value={preview} onChange={(e) => setPreview(e.target.value)}>{names.map((n) => <option key={n} value={n}>{LABELS[n]}</option>)}</select>
            <div className="aspect-video overflow-hidden rounded-lg border border-ink-600 bg-[linear-gradient(45deg,#333_25%,transparent_25%,transparent_75%,#333_75%),linear-gradient(45deg,#333_25%,#181818_25%,#181818_75%,#333_75%)] bg-[length:24px_24px] bg-[position:0_0,12px_12px]"><iframe key={previewUrl} title="Overlay preview" src={previewUrl} className="h-full w-full border-0" /></div>
          </div>

          <div className="card">
            <div className="mb-3 label">Output connections</div>
            <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-ink-700 p-3"><div><div className="font-bold">OBS Studio</div><div className="text-xs text-slate-400">{obs?.scene ? `Program scene: ${obs.scene}` : obs?.message ?? 'Not checked'}</div></div><button className="btn !min-h-[36px]" onClick={() => void checkObs()}>{obs?.ok ? 'Refresh' : 'Check'}</button></div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-ink-700 p-3"><div><div className="font-bold">vMix</div><div className="text-xs text-slate-400">{vmix?.lastError ?? (vmix?.enabled ? 'API push enabled' : 'API push not configured')}</div></div><span className={`rounded px-2 py-1 text-xs font-black ${vmix?.state === 'ok' ? 'bg-emerald-700' : vmix?.state === 'error' ? 'bg-red-700' : 'bg-ink-700'}`}>{vmix?.state?.toUpperCase() ?? 'UNKNOWN'}</span></div>
            <p className="mt-3 text-xs text-slate-500">Overlay cues update browser sources in OBS or vMix. OBS scene control and vMix native input control are separate integrations.</p>
          </div>

          <div className="card">
            <div className="mb-2 flex items-baseline justify-between gap-2"><div className="label">Recent cue history</div><span className="text-xs text-slate-500">Last {activity.length}</span></div>
            {activity.length ? <div className="max-h-48 divide-y divide-ink-700 overflow-y-auto">{activity.map((entry) => <div key={entry.id} className="flex justify-between gap-2 py-2 text-xs"><span>{entry.action === 'hide-all' ? 'Dismissed all graphics' : `${entry.action === 'hide' ? 'Hid' : entry.action === 'fire' ? 'Fired' : 'Showed'} ${LABELS[entry.overlay] ?? entry.overlay}`}</span><time className="shrink-0 text-slate-500">{new Date(entry.at).toLocaleTimeString()}</time></div>)}</div> : <p className="text-sm text-slate-400">No cues fired yet.</p>}
          </div>
        </div>
      </section>
      </>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="card flex flex-col justify-center"><div className="label">{label}</div><div className="font-mono text-2xl font-black tabular-nums">{value}</div></div>;
}
