import { useEffect, useMemo, useState } from 'react';
import { ApiFail, Info, MatchSummary, get, post, put } from '../api';
import { useRealtime } from '../realtime';
import { Field, copyText, toast } from '../ui';

const TRANSIENT = ['four', 'six', 'wicket', 'new-batter', 'over-summary', 'milestone', 'hockey/goal', 'hockey/card', 'hockey/penalty-corner'];
const LABELS: Record<string, string> = {
  // Cricket
  scorebug: 'Scorebug', batters: 'Batters', bowler: 'Bowler', partnership: 'Partnership', four: 'Four', six: 'Six', wicket: 'Wicket', 'new-batter': 'New batter',
  'over-summary': 'Over summary', target: 'Target / chase', scorecard: 'Scorecard', milestone: 'Milestone',
  // Shared
  versus: 'Versus (pre-match)', result: 'Result', 'lower-third': 'Lower third',
  // Hockey
  'hockey/scorebug': '🏑 Scorebug', 'hockey/goal': '🏑 Goal sting', 'hockey/card': '🏑 Card',
  'hockey/penalty-corner': '🏑 Penalty corner', 'hockey/shootout': '🏑 Shootout tracker',
};

/** Overlays that are always shown regardless of sport. */
const SHARED_OVERLAYS = new Set(['versus', 'result', 'lower-third']);
/** Overlays that belong to hockey only. */
const HOCKEY_OVERLAYS = new Set(['hockey/scorebug', 'hockey/goal', 'hockey/card', 'hockey/penalty-corner', 'hockey/shootout']);

const fail = (e: unknown) => toast((e as ApiFail).message, 'error');

export function Broadcast() {
  const { overlays, clients, state, matchId } = useRealtime();
  const [info, setInfo] = useState<Info | null>(null);
  const [theme, setTheme] = useState('classic');
  const [position, setPosition] = useState('bottom');
  const [scale, setScale] = useState('1');
  const [fixed, setFixed] = useState(false);
  const [lt, setLt] = useState({ headline: '', subhead: '' });
  const [note, setNote] = useState('');
  const [inn, setInn] = useState(1);
  const [sim, setSim] = useState({ balls: 60, speedMs: 600 });
  const [simStatus, setSimStatus] = useState<{ running: boolean; remaining: number }>({ running: false, remaining: 0 });
  const [vmix, setVmix] = useState<{ state: string; lastError: string | null; enabled: boolean } | null>(null);
  const [log, setLog] = useState<{ at: string; url: string; ok: boolean; note: string }[]>([]);
  const [matches, setMatches] = useState<MatchSummary[]>([]);

  // The theme / position / scale / follow choices live on the server so they survive reloads and restarts.
  useEffect(() => {
    void get<{ theme: string; view: { position: string; scale: number; follow: string } }>('/api/settings').then((s) => {
      setTheme(s.theme); setPosition(s.view.position); setScale(String(s.view.scale)); setFixed(s.view.follow === 'fixed');
    }).catch(fail);
  }, []);
  const save = (patch: object) => void put('/api/settings', patch).catch(fail);
  useEffect(() => { void get<Info>('/api/info').then(setInfo); void get<MatchSummary[]>('/api/matches').then(setMatches); }, []);
  useEffect(() => {
    const t = setInterval(() => { void get<{ running: boolean; remaining: number }>('/api/sim').then(setSimStatus); void get<typeof vmix>('/api/vmix/status').then(setVmix); }, 1500);
    return () => clearInterval(t);
  }, []);

  const base = info?.publicBaseUrl || location.origin;
  const allNames = info?.overlays ?? [];
  // Determine sport of the active match — fall back to cricket
  const activeMatch = matches.find((m) => m.id === matchId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeSport: 'cricket' | 'hockey' = (state as any)?.sport ?? activeMatch?.sport ?? 'cricket';
  // Filter overlay list: show sport-specific + shared overlays
  const names = allNames.filter((n) => {
    if (SHARED_OVERLAYS.has(n)) return true;
    if (HOCKEY_OVERLAYS.has(n)) return activeSport === 'hockey';
    return activeSport === 'cricket';
  });
  const url = (n: string) => {
    const q = new URLSearchParams();
    if (fixed && matchId !== null) q.set('match', String(matchId));
    q.set('theme', theme);
    if (position !== 'bottom') q.set('position', position);
    if (scale !== '1') q.set('scale', scale);
    return `${base}/overlays/${n}.html?${q}`;
  };
  const allUrls = useMemo(() => names.map((n) => `${LABELS[n] ?? n}\t${url(n)}`).join('\n'), [names, theme, position, scale, fixed, matchId, base]);

  const act = async (path: string, body?: unknown) => { try { await post(path, body); } catch (e) { fail(e); } };
  const setSimulate = async (start: boolean) => {
    try {
      if (start && matchId === null) return toast('Create a match first', 'error');
      setSimStatus(await post(start ? '/api/sim/start' : '/api/sim/stop', start ? { matchId, ...sim } : {}));
    } catch (e) { fail(e); }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-black">Broadcast &amp; overlays</h1>
        <div className="no-print flex gap-2">
          <button className="btn btn-danger" onClick={() => void act('/api/overlays/hide-all')}>Hide all</button>
          <a className="btn" href="/overlays/preview.html" target="_blank" rel="noreferrer">Preview all overlays ↗</a>
        </div>
      </div>

      <section className="card no-print grid gap-3 sm:grid-cols-5">
        <Field label="Theme"><select className="input" value={theme} onChange={(e) => { setTheme(e.target.value); save({ theme: e.target.value }); }}><option>classic</option><option>neon</option><option>minimal</option></select></Field>
        <Field label="Position"><select className="input" value={position} onChange={(e) => { setPosition(e.target.value); save({ view: { position: e.target.value } }); }}><option value="bottom">Bottom</option><option value="top">Top</option></select></Field>
        <Field label="Scale"><select className="input" value={scale} onChange={(e) => { setScale(e.target.value); save({ view: { scale: Number(e.target.value) } }); }}>{['0.8', '0.9', '1', '1.1', '1.25'].map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Follow"><select className="input" value={fixed ? 'fixed' : 'active'} onChange={(e) => { setFixed(e.target.value === 'fixed'); save({ view: { follow: e.target.value } }); }}><option value="active">Active match</option><option value="fixed">This match only</option></select></Field>
        <div className="flex items-end gap-2"><button className="btn w-full" onClick={() => void copyText(allUrls)}>Copy all vMix URLs</button></div>
      </section>

      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-400"><tr><th className="py-2">Overlay</th><th>URL</th><th className="no-print text-right">On air</th></tr></thead>
          <tbody>
            {names.map((n) => {
              const o = overlays[n];
              const transient = TRANSIENT.includes(n);
              return (
                <tr key={n} className="border-t border-ink-700 align-middle">
                  <td className="py-2 pr-3 font-semibold">{LABELS[n] ?? n}{clients.byOverlay[n] ? <span className="ml-2 text-xs font-normal text-emerald-400">● {clients.byOverlay[n]}</span> : null}</td>
                  <td className="max-w-[420px] truncate font-mono text-xs text-slate-300" title={url(n)}>{url(n)}</td>
                  <td className="no-print whitespace-nowrap py-1 text-right">
                    <button className="btn !min-h-[36px] !px-3" onClick={() => void copyText(url(n))}>Copy</button>{' '}
                    <a className="btn !min-h-[36px] !px-3" href={url(n) + '&debug=1&force=1'} target="_blank" rel="noreferrer">Open</a>{' '}
                    {transient && <button className="btn !min-h-[36px] !px-3" onClick={() => void act(`/api/overlays/${n}/trigger`, n === 'new-batter' && note ? { data: { note } } : {})}>Fire</button>}{' '}
                    <button className={`btn !min-h-[36px] w-24 ${o?.visible ? '!border-red-500 !bg-red-600' : ''}`} onClick={() => void act(`/api/overlays/${n}/${o?.visible ? 'hide' : 'show'}`, n === 'scorecard' ? { data: { innings: inn } } : {})}>{o?.visible ? '● ON AIR' : 'Show'}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="no-print mt-3 text-xs text-slate-400">Persistent overlays stay on until hidden; four, six, wicket, new batter, over summary and milestone hide themselves after their timer (Settings). Overlay on/off state lives on the server, so a refreshed browser source restores correctly.</p>
      </section>

      <section className="no-print grid gap-4 md:grid-cols-2">
        <div className="card flex flex-col gap-2">
          <div className="label !mb-0">Lower third (free text)</div>
          <input className="input" placeholder="Headline" value={lt.headline} onChange={(e) => setLt({ ...lt, headline: e.target.value })} />
          <input className="input" placeholder="Sub-headline" value={lt.subhead} onChange={(e) => setLt({ ...lt, subhead: e.target.value })} />
          <div className="flex gap-2"><button className="btn btn-primary flex-1" onClick={() => void act('/api/overlays/lower-third/show', { data: lt })}>Push on air</button><button className="btn" onClick={() => void act('/api/overlays/lower-third/hide')}>Hide</button></div>
        </div>
        {activeSport === 'cricket' && (
          <div className="card flex flex-col gap-2">
            <div className="label !mb-0">Other inputs (Cricket)</div>
            <input className="input" placeholder="New-batter career line, e.g. 4,210 ODI runs · Avg 38.2" value={note} onChange={(e) => setNote(e.target.value)} />
            <Field label="Scorecard shows innings">
              <select className="input" value={inn} onChange={(e) => setInn(Number(e.target.value))}>
                {((state as any)?.innings?.length ? (state as any).innings.map((i: any) => i.number) : [1]).map((n: number) => (
                  <option key={n} value={n}>Innings {n}</option>
                ))}
              </select>
            </Field>
            <button className="btn" onClick={() => void act('/api/overlays/scorecard/show', { data: { innings: inn } })}>Refresh scorecard on air</button>
          </div>
        )}
      </section>

      {activeSport === 'cricket' && (
        <section className="card no-print">
          <div className="label">Simulate (plays random balls through the real engine on the active match)</div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Balls"><input className="input !w-28" type="number" min={1} value={sim.balls} onChange={(e) => setSim({ ...sim, balls: Number(e.target.value) })} /></Field>
            <Field label="Speed (ms per ball)"><input className="input !w-36" type="number" min={50} value={sim.speedMs} onChange={(e) => setSim({ ...sim, speedMs: Number(e.target.value) })} /></Field>
            {simStatus.running ? <button className="btn btn-danger" onClick={() => void setSimulate(false)}>Stop ({simStatus.remaining} left)</button> : <button className="btn btn-primary" onClick={() => void setSimulate(true)}>Start simulation</button>}
            <span className="text-xs text-slate-400">Tip: use a demo match from <code>npm run seed</code>, or any test match — simulating changes that match's scoring.</span>
          </div>
          {matches.length > 0 && <p className="mt-2 text-xs text-slate-500">Active match: {matches.find((m) => m.id === matchId)?.title || `#${matchId}`}</p>}
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="card no-print">
          <div className="label">Operator panel on your network</div>
          {info?.lanUrls.length ? info.lanUrls.map((u) => (
            <div key={u} className="mb-3 flex items-center gap-3">
              <img alt="QR code" className="h-28 w-28 rounded bg-white p-1" src={`/api/qr.svg?text=${encodeURIComponent(u)}`} />
              <div><div className="font-mono text-sm">{u}</div><button className="btn mt-2 !min-h-[36px]" onClick={() => void copyText(u)}>Copy</button></div>
            </div>
          )) : <p className="text-sm text-slate-400">No network address found — connect to a LAN or Wi-Fi.</p>}
          <p className="text-xs text-slate-400">Remote vMix? See README → “Remote client access”, then set the Public base URL in Settings.</p>
        </div>
        <div className="card no-print">
          <div className="label">vMix push status</div>
          <div className="flex items-center gap-3">
            <span className={`rounded px-2 py-1 text-xs font-bold ${vmix?.state === 'ok' ? 'bg-emerald-600' : vmix?.state === 'error' ? 'bg-red-600' : 'bg-ink-500'}`}>{vmix?.enabled ? (vmix.state ?? '').toUpperCase() : 'DISABLED'}</span>
            <button className="btn !min-h-[36px]" onClick={async () => { try { const r = await post<{ ok: boolean; message: string }>('/api/vmix/test'); toast(r.message, r.ok ? 'ok' : 'error'); } catch (e) { fail(e); } }}>Test connection</button>
            <button className="btn !min-h-[36px]" onClick={() => void get<typeof log>('/api/vmix/log').then(setLog)}>Refresh log</button>
          </div>
          {vmix?.lastError && <p className="mt-2 text-xs text-red-400">{vmix.lastError}</p>}
          <details className="mt-3"><summary className="cursor-pointer text-sm text-slate-300">Debug log ({log.length})</summary>
            <div className="mt-2 max-h-40 overflow-y-auto font-mono text-[11px]">{log.slice().reverse().map((l, i) => <div key={i} className={l.ok ? 'text-slate-400' : 'text-red-400'}>{l.at.slice(11, 19)} {l.note} {decodeURIComponent(l.url).slice(0, 110)}</div>)}</div>
          </details>
        </div>
      </section>
      <button className="btn no-print self-start" onClick={() => window.print()}>Print overlay URL table</button>
    </div>
  );
}
