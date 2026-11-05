import type { HockeyState } from '@engine/hockey';
import type { Side } from '@engine/types';
import { useState } from 'react';
import { Field, Modal } from '../../ui';

interface Props {
  state: HockeyState;
  onClose: () => void;
  onConfirm: (payload: {
    teamSide: Side;
    round: number;
    scored: boolean;
    takerId?: string;
  }) => void;
}

export function ShootoutModal({ state, onClose, onConfirm }: Props) {
  const [side, setSide] = useState<Side>('A');
  const [round, setRound] = useState<number>(() => {
    const existing = state.shootout?.rounds ?? [];
    return Math.max(1, existing.length + 1);
  });
  const [scored, setScored] = useState<boolean>(true);
  const [takerId, setTakerId] = useState<string>('');

  const currentRoster = state.rosters[side] ?? [];
  const team = state.teams[side];

  const submit = () => {
    onConfirm({
      teamSide: side,
      round,
      scored,
      takerId: takerId || undefined,
    });
    onClose();
  };

  return (
    <Modal title="🎯 Penalty Shootout Attempt" onClose={onClose}>
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
                  setTakerId('');
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

        {/* Round number */}
        <Field label="Shootout Round">
          <input
            className="input"
            type="number"
            min={1}
            max={20}
            value={round}
            onChange={(e) => setRound(Math.max(1, Number(e.target.value)))}
          />
        </Field>

        {/* Taker Picker */}
        <Field label="Taker (Optional)">
          <select
            className="input"
            value={takerId}
            onChange={(e) => setTakerId(e.target.value)}
          >
            <option value="">Unspecified</option>
            {currentRoster.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>

        {/* Outcome */}
        <Field label="Attempt Outcome">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setScored(true)}
              className={`flex items-center justify-center gap-2 rounded-xl border p-4 font-black transition-all ${
                scored
                  ? '!border-emerald-500 bg-emerald-950/70 text-emerald-300 ring-2 ring-emerald-500/50'
                  : 'border-ink-700 bg-ink-900 text-slate-400 hover:bg-ink-800'
              }`}
            >
              <span className="text-2xl">🟢</span>
              <span>SCORED (Goal)</span>
            </button>

            <button
              type="button"
              onClick={() => setScored(false)}
              className={`flex items-center justify-center gap-2 rounded-xl border p-4 font-black transition-all ${
                !scored
                  ? '!border-red-600 bg-red-950/70 text-red-300 ring-2 ring-red-600/50'
                  : 'border-ink-700 bg-ink-900 text-slate-400 hover:bg-ink-800'
              }`}
            >
              <span className="text-2xl">🔴</span>
              <span>SAVED / MISSED</span>
            </button>
          </div>
        </Field>

        <button
          type="button"
          onClick={submit}
          className="btn btn-primary !min-h-[48px] mt-2 w-full text-base font-black shadow-lg"
        >
          Save Attempt for {team?.shortName}
        </button>
      </div>
    </Modal>
  );
}
