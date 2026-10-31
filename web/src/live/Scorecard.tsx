import type { InningsState, LiveState } from '@engine/types';

export function BallChip({ label, kind }: { label: string; kind: string }) {
  const style: Record<string, string> = {
    dot: 'bg-ink-600 text-slate-300', run: 'bg-slate-200 text-ink-950', four: 'bg-emerald-500 text-white', six: 'bg-violet-500 text-white',
    wicket: 'bg-red-600 text-white', wide: 'bg-amber-400 text-ink-950', noball: 'bg-orange-500 text-white', bye: 'bg-sky-400 text-ink-950', legbye: 'bg-sky-400 text-ink-950', dead: 'bg-ink-500 text-white',
  };
  return <span className={`chip ${style[kind] ?? style.run}`}>{label}</span>;
}

export function InningsCard({ inn, state }: { inn: InningsState; state: LiveState }) {
  const batted = inn.batting.filter((b) => b.status !== 'yet to bat');
  const yet = inn.batting.filter((b) => b.status === 'yet to bat');
  const e = inn.extras;
  return (
    <div className="mb-6">
      <h3 className="mb-2 flex items-baseline justify-between text-base font-bold">
        <span>{inn.battingTeam}{inn.superOver ? ' (Super Over)' : ''}</span>
        <span>{inn.runs}/{inn.wickets} <span className="text-sm font-normal text-slate-400">({inn.overs} ov)</span></span>
      </h3>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase text-slate-400"><tr><th className="py-1 text-left">Batter</th><th className="text-right">R</th><th className="text-right">B</th><th className="text-right">4s</th><th className="text-right">6s</th><th className="text-right">SR</th></tr></thead>
        <tbody>
          {batted.map((b) => (
            <tr key={b.id} className="border-t border-ink-700">
              <td className="py-1.5"><div className="font-semibold">{b.name}{b.onStrike ? ' *' : ''}</div><div className="text-xs text-slate-400">{b.howOut || b.status}</div></td>
              <td className="text-right font-bold">{b.runs}</td><td className="text-right">{b.balls}</td><td className="text-right">{b.fours}</td><td className="text-right">{b.sixes}</td><td className="text-right">{b.strikeRate.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-sm"><b>Extras</b> {e.total} <span className="text-slate-400">(wd {e.wd}, nb {e.nb}, b {e.b}, lb {e.lb}, pen {e.pen})</span></p>
      {yet.length > 0 && <p className="mt-1 text-xs text-slate-400">Yet to bat: {yet.map((b) => b.name).join(', ')}</p>}
      <table className="mt-3 w-full text-sm">
        <thead className="text-xs uppercase text-slate-400"><tr><th className="py-1 text-left">Bowler</th><th className="text-right">O</th><th className="text-right">M</th><th className="text-right">R</th><th className="text-right">W</th><th className="text-right">Econ</th><th className="text-right">Wd</th><th className="text-right">Nb</th></tr></thead>
        <tbody>
          {inn.bowling.map((b) => (
            <tr key={b.id} className="border-t border-ink-700"><td className="py-1.5 font-semibold">{b.name}</td><td className="text-right">{b.overs}</td><td className="text-right">{b.maidens}</td><td className="text-right">{b.runs}</td><td className="text-right font-bold">{b.wickets}</td><td className="text-right">{b.economy.toFixed(2)}</td><td className="text-right">{b.wides}</td><td className="text-right">{b.noBalls}</td></tr>
          ))}
        </tbody>
      </table>
      {inn.fow.length > 0 && <p className="mt-3 text-xs text-slate-300"><b>Fall of wickets:</b> {inn.fow.map((f) => f.text).join(' · ')}</p>}
      <p className="sr-only">{state.title}</p>
    </div>
  );
}
