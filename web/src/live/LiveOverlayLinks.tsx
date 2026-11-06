import { useEffect, useMemo, useState } from 'react';
import { ApiFail, Info, get, post } from '../api';
import { copyText, toast } from '../ui';

const OUTPUTS: Record<'cricket' | 'hockey', [string, string][]> = {
  cricket: [
    ['scorebug', 'Scorebug'], ['four', 'Four'], ['six', 'Six'], ['wicket', 'Wicket'],
    ['milestone', 'Milestone'], ['new-batter', 'New batter'], ['over-summary', 'Over summary'], ['result', 'Result'],
  ],
  hockey: [
    ['hockey/scorebug', 'Scorebug'], ['hockey/goal', 'Goal'], ['hockey/card', 'Card'],
    ['hockey/penalty-corner', 'Penalty corner'], ['hockey/shootout', 'Shootout'],
    ['hockey/scoreboard-banner', 'Scoreboard banner'],
  ],
};

export function LiveOverlayLinks({ matchId, sport }: { matchId: number; sport: 'cricket' | 'hockey' }) {
  const [base, setBase] = useState(location.origin);
  const [theme, setTheme] = useState('classic');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void get<Info>('/api/info').then((info) => { if (info.publicBaseUrl) setBase(info.publicBaseUrl.replace(/\/+$/, '')); }).catch(() => undefined);
    void get<{ theme: string }>('/api/settings').then((settings) => setTheme(settings.theme)).catch(() => undefined);
  }, []);

  const links = useMemo(() => OUTPUTS[sport].map(([name, label]) => {
    const query = new URLSearchParams({ match: String(matchId), theme });
    return { name, label, url: `${base}/overlays/${name}.html?${query}` };
  }), [base, matchId, sport, theme]);
  const scorebugName = sport === 'hockey' ? 'hockey/scorebug' : 'scorebug';
  const showScorebug = async () => {
    try {
      await post(`/api/overlays/${scorebugName}/show`);
      toast('Scorebug on air');
    } catch (error) {
      toast((error as ApiFail).message, 'error');
    }
  };

  return (
    <details className="card !p-0" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3">
        <span>
          <span className="block text-sm font-bold">Live match overlay URLs</span>
          <span className="block text-xs text-slate-400">Pinned to match #{matchId}. Add each URL as an OBS/vMix browser source.</span>
        </span>
        <span className="flex gap-2">
          <button type="button" className="btn !min-h-[34px] !px-3 text-xs" onClick={(event) => { event.preventDefault(); void copyText(links.map((link) => `${link.label}\t${link.url}`).join('\n')); }}>Copy all URLs</button>
          <button type="button" className="btn !min-h-[34px] !px-3 text-xs" onClick={(event) => { event.preventDefault(); void showScorebug(); }}>Show scorebug</button>
        </span>
      </summary>
      <div className="grid gap-x-4 border-t border-ink-700 px-4 py-2 md:grid-cols-2">
        {links.map((link) => (
          <div key={link.name} className="flex min-w-0 items-center justify-between gap-3 border-b border-ink-700/70 py-2">
            <span className="shrink-0 text-sm text-slate-200">{link.label}</span>
            <span className="min-w-0 truncate font-mono text-[11px] text-slate-500" title={link.url}>{link.url}</span>
            <button type="button" className="btn !min-h-[30px] !px-2 text-xs" onClick={() => void copyText(link.url)}>Copy</button>
          </div>
        ))}
      </div>
    </details>
  );
}
