import { useEffect, useState } from 'react';
import { ApiFail, onPinRequired, post } from './api';
import { Broadcast } from './pages/Broadcast';
import { History } from './pages/History';
import { Live } from './pages/Live';
import { MatchSetup } from './pages/MatchSetup';
import { Settings } from './pages/Settings';
import { Teams } from './pages/Teams';
import { startRealtime, useRealtime } from './realtime';
import { Modal, Toasts, toast } from './ui';

const PAGES = [
  ['live', 'Live scoring'], ['teams', 'Teams'], ['setup', 'Match setup'], ['broadcast', 'Overlays'], ['history', 'History'], ['settings', 'Settings'],
] as const;
type Page = (typeof PAGES)[number][0];

function readHash(): Page {
  const h = location.hash.replace('#/', '');
  return (PAGES.find(([k]) => k === h)?.[0] ?? 'live') as Page;
}

export function App() {
  const [page, setPage] = useState<Page>(readHash());
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState('');
  const { connected } = useRealtime();

  useEffect(() => { startRealtime(); }, []);
  useEffect(() => {
    const h = () => setPage(readHash());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  useEffect(() => onPinRequired(() => setPinOpen(true)), []);

  const goto = (p: string) => { location.hash = `#/${p}`; };

  const unlock = async () => {
    try { await post('/api/auth', { pin }); setPinOpen(false); setPin(''); toast('Unlocked — repeat your last action'); } catch (e) { toast((e as ApiFail).message, 'error'); }
  };

  return (
    <div className="flex min-h-full flex-col">
      <nav className="no-print sticky top-0 z-40 flex flex-wrap items-center gap-1 border-b border-ink-700 bg-ink-900/95 px-3 py-2 backdrop-blur">
        <span className="mr-3 flex items-center gap-2 text-lg font-black tracking-tight text-slate-100"><span className="h-3.5 w-3.5 rounded-full bg-accent shadow-[0_0_0_3px_rgba(240,138,75,0.25)]" />Crickey Lite</span>
        {PAGES.map(([k, label]) => (
          <button key={k} onClick={() => goto(k)} className={`btn !min-h-[40px] ${page === k ? '!border-transparent !bg-ink-700 !text-white shadow-[inset_0_-3px_0_#f08a4b]' : 'btn-ghost'}`}>{label}</button>
        ))}
        <span className={`ml-auto flex items-center gap-1.5 text-xs ${connected ? 'text-emerald-400' : 'text-red-400'}`}><span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-500'}`} />{connected ? 'Server connected' : 'Reconnecting…'}</span>
      </nav>
      <main className="flex-1">
        {page === 'live' && <Live goto={goto} />}
        {page === 'teams' && <Teams />}
        {page === 'setup' && <MatchSetup goto={goto} />}
        {page === 'broadcast' && <Broadcast />}
        {page === 'history' && <History goto={goto} />}
        {page === 'settings' && <Settings />}
      </main>
      <footer className="no-print border-t border-ink-700 py-3 text-center text-xs text-slate-500">
        Developed by <a className="font-semibold text-slate-300 underline decoration-ink-500 underline-offset-2 hover:text-accent" href="https://novitasweb.works" target="_blank" rel="noopener">Novitas WebWorks</a>
      </footer>
      {pinOpen && (
        <Modal title="Operator PIN required" onClose={() => setPinOpen(false)}>
          <input className="input" type="password" autoFocus placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void unlock()} />
          <button className="btn btn-primary mt-3 w-full" onClick={() => void unlock()}>Unlock</button>
        </Modal>
      )}
      <Toasts />
    </div>
  );
}
