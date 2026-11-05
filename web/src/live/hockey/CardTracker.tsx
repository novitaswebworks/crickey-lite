import type { CardKind, HockeyState } from '@engine/hockey';
import type { Side } from '@engine/types';
import { useState } from 'react';
import { Field, Modal } from '../../ui';

interface Props {
  state: HockeyState;
  onClose: () => void;
  onConfirm: (payload: {
    teamSide: Side;
    playerId: string;
    kind: CardKind;
    durationMs: number;
  }) => void;
}

export function CardTracker({ state, onClose, onConfirm }: Props) {
  const [side, setSide] = useState<Side>('A');
  const [kind, setKind] = useState<CardKind>('green');
  const [yellowDurationMins, setYellowDurationMins] = useState<5 | 10>(5);
  const [playerId, setPlayerId] = useState<string>('');

  const currentRoster = state.rosters[side] ?? [];
  const effectivePlayerId = playerId || currentRoster[0]?.id || '';

  const getDurationMs = (): number => {
    if (kind === 'red') return -1;
    if (kind === 'yellow') return yellowDurationMins * 60_000;
    return 2 * 60_000; // green = 2 minutes
  };

  const submit = () => {
    if (!effectivePlayerId) return;
    onConfirm({
      teamSide: side,
      playerId: effectivePlayerId,
      kind,
      durationMs: getDurationMs(),
    });
    onClose();
  };

  return (
    <Modal title="🟨 Disciplinary Card" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {/* Team Selector */}
        <div className="grid grid-cols-2 gap-2">
          {(['A', 'B'] as Side[]).map((s) => {
            const t = state.teams[s];
            const isSelected = side === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setSide(s);
                  setPlayerId('');
                }}
                className={`flex items-center justify-center gap-2.5 rounded-xl border p-3 font-bold transition-all ${
                  isSelected
                    ? '!border-accent !bg-ink-700 text-white shadow-lg'
                    : 'border-ink-700 bg-ink-900 text-slate-400 hover:bg-ink-800'
                }`}
              >
                <span
                  className="h-3.5 w-3.5 rounded-full"
                  style={{ backgroundColor: t?.color ?? '#888' }}
                />
                <span>{t?.name}</span>
                <span className="text-xs font-normal">({t?.shortName})</span>
              </button>
            );
          })}
        </div>

        {/* Player Picker */}
        <Field label="Offending Player">
          <select
            className="input"
            value={effectivePlayerId}
            onChange={(e) => setPlayerId(e.target.value)}
          >
            {currentRoster.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.shortName ? `(${p.shortName})` : ''}
              </option>
            ))}
          </select>
        </Field>

        {/* Card Kind */}
        <Field label="Card Penalty">
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setKind('green')}
              className={`flex flex-col items-center justify-center gap-1 rounded-xl border p-3 font-bold transition-all ${
                kind === 'green'
                  ? '!border-emerald-500 bg-emerald-950/60 text-emerald-300 ring-2 ring-emerald-500/50'
                  : 'border-ink-700 bg-ink-900 text-slate-400 hover:bg-ink-800'
              }`}
            >
              <span className="text-xl">🟩</span>
              <span>Green</span>
              <span className="text-xs font-normal">2 min suspension</span>
            </button>

            <button
              type="button"
              onClick={() => setKind('yellow')}
              className={`flex flex-col items-center justify-center gap-1 rounded-xl border p-3 font-bold transition-all ${
                kind === 'yellow'
                  ? '!border-amber-400 bg-amber-950/60 text-amber-300 ring-2 ring-amber-400/50'
                  : 'border-ink-700 bg-ink-900 text-slate-400 hover:bg-ink-800'
              }`}
            >
              <span className="text-xl">🟨</span>
              <span>Yellow</span>
              <span className="text-xs font-normal">5m or 10m sin-bin</span>
            </button>

            <button
              type="button"
              onClick={() => setKind('red')}
              className={`flex flex-col items-center justify-center gap-1 rounded-xl border p-3 font-bold transition-all ${
                kind === 'red'
                  ? '!border-red-600 bg-red-950/60 text-red-300 ring-2 ring-red-600/50'
                  : 'border-ink-700 bg-ink-900 text-slate-400 hover:bg-ink-800'
              }`}
            >
              <span className="text-xl">🟥</span>
              <span>Red</span>
              <span className="text-xs font-normal">Permanent ejection</span>
            </button>
          </div>
        </Field>

        {/* Yellow duration selector */}
        {kind === 'yellow' && (
          <Field label="Yellow Card Duration">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setYellowDurationMins(5)}
                className={`btn flex-1 !min-h-[40px] text-xs font-bold ${
                  yellowDurationMins === 5 ? '!bg-amber-400 !text-ink-950 font-black' : 'btn-ghost'
                }`}
              >
                5 Minutes (Standard technical foul)
              </button>
              <button
                type="button"
                onClick={() => setYellowDurationMins(10)}
                className={`btn flex-1 !min-h-[40px] text-xs font-bold ${
                  yellowDurationMins === 10 ? '!bg-amber-400 !text-ink-950 font-black' : 'btn-ghost'
                }`}
              >
                10 Minutes (Severe physical foul)
              </button>
            </div>
          </Field>
        )}

        <button
          type="button"
          onClick={submit}
          className="btn btn-primary !min-h-[48px] mt-2 w-full text-base font-black shadow-lg"
        >
          Issue Card to {currentRoster.find((p) => p.id === effectivePlayerId)?.name || 'Player'}
        </button>
      </div>
    </Modal>
  );
}
