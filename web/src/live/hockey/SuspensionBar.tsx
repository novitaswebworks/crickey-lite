import type { HockeyState, HockeySuspension } from '@engine/hockey';
import { formatClock } from '@engine/hockey';

interface Props {
  state: HockeyState;
}

export function SuspensionBar({ state }: Props) {
  const activeSuspensions = (state.suspensions ?? []).filter((s) => s.active);

  if (activeSuspensions.length === 0) return null;

  const cardBadge = (kind: HockeySuspension['kind'], durationMs: number) => {
    if (kind === 'red' || durationMs < 0) {
      return (
        <span className="flex items-center gap-1 rounded bg-red-600 px-2 py-0.5 text-xs font-black text-white">
          <span>🟥</span> RED (Out)
        </span>
      );
    }
    if (kind === 'yellow') {
      const mins = Math.round(durationMs / 60_000);
      return (
        <span className="flex items-center gap-1 rounded bg-amber-400 px-2 py-0.5 text-xs font-black text-ink-950">
          <span>🟨</span> YELLOW ({mins}m)
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-xs font-black text-white">
        <span>🟩</span> GREEN (2m)
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-amber-600/50 bg-amber-950/30 p-3 shadow-inner">
      <div className="flex items-center justify-between text-xs font-black uppercase tracking-wider text-amber-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          Active Suspensions (Sin-Bin)
        </span>
        <span>{activeSuspensions.length} Player{activeSuspensions.length === 1 ? '' : 's'}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {activeSuspensions.map((s, idx) => {
          const team = state.teams[s.teamSide];
          return (
            <div
              key={`${s.playerId}-${idx}`}
              className="flex items-center gap-2.5 rounded-lg border border-ink-600 bg-ink-800 px-3 py-1.5 text-sm shadow"
            >
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: team?.color ?? '#888' }}
                title={team?.name}
              />
              <span className="font-bold text-slate-100">{s.playerName}</span>
              <span className="text-xs font-semibold text-slate-400">({team?.shortName})</span>
              {cardBadge(s.kind, s.durationMs)}
              {s.durationMs > 0 && (
                <span className="font-mono text-xs font-bold text-amber-300">
                  {formatClock(s.remainingMs)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
