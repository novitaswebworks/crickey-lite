import type { GoalKind, HockeyState } from '@engine/hockey';
import type { Side } from '@engine/types';
import { useState } from 'react';
import { Field, Modal } from '../../ui';

interface Props {
  state: HockeyState;
  onClose: () => void;
  onConfirm: (payload: {
    teamSide: Side;
    scorerId: string;
    assistId?: string;
    kind: GoalKind;
  }) => void;
}

export function GoalWizard({ state, onClose, onConfirm }: Props) {
  const [side, setSide] = useState<Side>('A');
  const [kind, setKind] = useState<GoalKind>('FG');
  const [scorerId, setScorerId] = useState<string>('');
  const [assistId, setAssistId] = useState<string>('');

  const currentRoster = state.rosters[side] ?? [];
  const team = state.teams[side];

  // Auto-pick first player on roster or reset if invalid
  const effectiveScorer = scorerId || (kind === 'OG' ? 'OG' : currentRoster[0]?.id ?? '');

  const submit = () => {
    onConfirm({
      teamSide: side,
      scorerId: kind === 'OG' ? 'OG' : effectiveScorer,
      assistId: kind === 'OG' ? undefined : assistId || undefined,
      kind,
    });
    onClose();
  };

  return (
    <Modal title="⚽ Record Goal" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {/* Team selector tabs */}
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
                  setScorerId('');
                  setAssistId('');
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

        {/* Goal Type */}
        <Field label="Goal Type">
          <div className="grid grid-cols-4 gap-2">
            {[
              { id: 'FG' as GoalKind, label: 'Field Goal' },
              { id: 'PC' as GoalKind, label: 'Penalty Corner' },
              { id: 'PS' as GoalKind, label: 'Penalty Stroke' },
              { id: 'OG' as GoalKind, label: 'Own Goal' },
            ].map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => {
                  setKind(k.id);
                  if (k.id === 'OG') {
                    setScorerId('OG');
                    setAssistId('');
                  } else if (scorerId === 'OG') {
                    setScorerId('');
                  }
                }}
                className={`btn !min-h-[44px] text-xs font-bold ${
                  kind === k.id ? '!bg-accent !text-ink-950 font-black' : 'btn-ghost'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
        </Field>

        {/* Scorer Picker */}
        {kind !== 'OG' && (
          <Field label="Goal Scorer">
            <select
              className="input"
              value={effectiveScorer}
              onChange={(e) => setScorerId(e.target.value)}
            >
              {currentRoster.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.shortName ? `(${p.shortName})` : ''}
                </option>
              ))}
            </select>
          </Field>
        )}

        {/* Assist Picker */}
        {kind !== 'OG' && (
          <Field label="Assist (Optional)">
            <select
              className="input"
              value={assistId}
              onChange={(e) => setAssistId(e.target.value)}
            >
              <option value="">None (Solo goal / Direct)</option>
              {currentRoster
                .filter((p) => p.id !== effectiveScorer)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </Field>
        )}

        <button
          type="button"
          onClick={submit}
          className="btn btn-primary !min-h-[48px] mt-2 w-full text-base font-black shadow-lg"
        >
          Confirm Goal for {team?.name}
        </button>
      </div>
    </Modal>
  );
}
