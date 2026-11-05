import { useEffect, useState } from 'react';
import type { HockeyState } from '@engine/hockey';
import { formatClock } from '@engine/hockey';

interface Props {
  state: HockeyState;
  onClockAction: (action: 'start' | 'stop' | 'adjust', deltaMs?: number) => void;
  onSetPeriod: (period: number) => void;
  onEndPeriod: () => void;
}

export function ClockControl({ state, onClockAction, onSetPeriod, onEndPeriod }: Props) {
  const isRunning = state.clock.running;
  const [localMs, setLocalMs] = useState(state.clock.displayMs);

  // Sync immediately when incoming state updates from the server
  useEffect(() => {
    setLocalMs(state.clock.displayMs);
  }, [state.clock.displayMs, state.clock.running]);

  // Smooth local ticker between 500ms server broadcasts
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      setLocalMs((prev) => Math.max(0, prev - 250));
    }, 250);
    return () => clearInterval(interval);
  }, [isRunning]);

  const timeStr = formatClock(localMs);

  return (
    <div className="card flex flex-col gap-4 border border-ink-600 bg-ink-800/80 p-5 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Period badge and selector */}
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-black uppercase tracking-wider text-accent border border-ink-700">
            {state.periodLabel}
          </span>
          <div className="flex items-center gap-1">
            {Array.from({ length: state.totalPeriods }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => onSetPeriod(p)}
                className={`btn !min-h-[32px] !px-2.5 text-xs font-bold ${
                  state.period === p ? '!bg-accent !text-ink-950 font-black' : 'btn-ghost'
                }`}
              >
                {state.totalPeriods === 2 ? `H${p}` : `Q${p}`}
              </button>
            ))}
          </div>
        </div>

        {/* End period button */}
        <button
          onClick={onEndPeriod}
          className="btn !min-h-[32px] !px-3 text-xs text-slate-400 hover:text-white"
          title="Fast-forward to 00:00"
        >
          End {state.periodLabel}
        </button>
      </div>

      {/* Main clock display and start/stop button */}
      <div className="flex flex-col items-center justify-center gap-4 py-2 sm:flex-row sm:justify-around">
        <div className="flex flex-col items-center">
          <div
            className={`font-mono text-6xl font-black tracking-widest tabular-nums ${
              isRunning ? 'text-emerald-400 drop-shadow-[0_0_12px_rgba(52,211,153,0.3)]' : 'text-slate-100'
            }`}
          >
            {timeStr}
          </div>
          <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-400">
            {isRunning ? '● Clock Running' : '○ Clock Stopped'}
          </div>
        </div>

        <button
          onClick={() => onClockAction(isRunning ? 'stop' : 'start')}
          className={`btn !min-h-[64px] !min-w-[200px] text-lg font-black shadow-xl transition-all ${
            isRunning
              ? '!bg-amber-600 hover:!bg-amber-500 text-white'
              : '!bg-emerald-600 hover:!bg-emerald-500 text-white'
          }`}
        >
          {isRunning ? '⏸ Pause (Space)' : '▶ Start (Space)'}
        </button>
      </div>

      {/* Fine adjustments */}
      <div className="flex flex-wrap items-center justify-center gap-2 border-t border-ink-700/80 pt-3">
        <span className="mr-2 text-xs font-semibold text-slate-400">Adjust:</span>
        <button
          onClick={() => onClockAction('adjust', -60_000)}
          className="btn !min-h-[30px] !px-2.5 text-xs"
          title="Subtract 1 minute"
        >
          -1m
        </button>
        <button
          onClick={() => onClockAction('adjust', -10_000)}
          className="btn !min-h-[30px] !px-2.5 text-xs"
          title="Subtract 10 seconds"
        >
          -10s
        </button>
        <button
          onClick={() => onClockAction('adjust', 10_000)}
          className="btn !min-h-[30px] !px-2.5 text-xs"
          title="Add 10 seconds"
        >
          +10s
        </button>
        <button
          onClick={() => onClockAction('adjust', 60_000)}
          className="btn !min-h-[30px] !px-2.5 text-xs"
          title="Add 1 minute"
        >
          +1m
        </button>
      </div>
    </div>
  );
}
