import type { HockeyEventPayload, HockeyState } from '@engine/hockey';
import type { Side } from '@engine/types';
import { useEffect, useState } from 'react';
import { ApiFail, post } from '../../api';
import { useRealtime } from '../../realtime';
import { isTyping, Modal, toast } from '../../ui';
import { CardTracker } from './CardTracker';
import { ClockControl } from './ClockControl';
import { GoalWizard } from './GoalWizard';
import { HockeyScorecard } from './HockeyScorecard';
import { ShootoutModal } from './ShootoutModal';
import { SuspensionBar } from './SuspensionBar';
import { LiveOverlayLinks } from '../LiveOverlayLinks';

type ModalKind = null | 'goal' | 'card' | 'shootout' | 'result' | 'pc';

export function HockeyLive() {
  const { state: rawState, matchId, clients } = useRealtime();
  const state = rawState as unknown as HockeyState | null;

  const [modal, setModal] = useState<ModalKind>(null);
  const [pcSide, setPcSide] = useState<Side>('A');
  const [resultKind, setResultKind] = useState<'won' | 'draw' | 'noresult'>('won');
  const [resultWinner, setResultWinner] = useState<Side>('A');
  const [resultText, setResultText] = useState<string>('');

  const sendEvent = async (payload: HockeyEventPayload) => {
    if (!matchId) return false;
    try {
      await post<{ state: HockeyState }>(`/api/matches/${matchId}/events`, payload);
      return true;
    } catch (e) {
      toast((e as ApiFail).message, 'error');
      return false;
    }
  };

  const onClockAction = async (action: 'start' | 'stop' | 'adjust', deltaMs?: number) => {
    if (!matchId) return;
    try {
      await post<{ state: HockeyState }>(`/api/matches/${matchId}/hockey/clock`, { action, deltaMs });
    } catch (e) {
      toast((e as ApiFail).message, 'error');
    }
  };

  const undo = async () => {
    if (!matchId) return;
    try {
      await post<{ state: HockeyState }>(`/api/matches/${matchId}/undo`);
      toast('Undone last action');
    } catch (e) {
      toast((e as ApiFail).message, 'error');
    }
  };

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTyping() || modal !== null || e.repeat) return;
      const k = e.key.toLowerCase();

      // Undo: Ctrl/Cmd+Z or U
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault();
        void undo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (k === 'u') {
        void undo();
        return;
      }

      // Space = Clock toggle
      if (e.code === 'Space') {
        e.preventDefault();
        if (state) {
          void onClockAction(state.clock.running ? 'stop' : 'start');
        }
        return;
      }

      // G = Goal
      if (k === 'g') {
        e.preventDefault();
        setModal('goal');
        return;
      }

      // P = Penalty Corner modal
      if (k === 'p') {
        e.preventDefault();
        setModal('pc');
        return;
      }

      // C = Card
      if (k === 'c') {
        e.preventDefault();
        setModal('card');
        return;
      }

      // S = Shootout
      if (k === 's') {
        e.preventDefault();
        setModal('shootout');
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [matchId, modal, state]);

  if (!state || matchId === null) {
    return (
      <div className="mx-auto max-w-xl p-8 text-center text-slate-400">
        Loading hockey match state...
      </div>
    );
  }

  const teamA = state.teams.A;
  const teamB = state.teams.B;

  if (state.status === 'completed') {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
        <header className="rounded-2xl border border-emerald-700 bg-ink-800 px-5 py-4 shadow-xl">
          <div className="text-xs font-bold uppercase tracking-widest text-emerald-300">Match completed · {state.title || 'Hockey Match'}</div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-center">
            <span className="text-2xl font-black">{teamA.shortName}</span>
            <span className="font-mono text-5xl font-black text-accent">{state.scoreA} – {state.scoreB}</span>
            <span className="text-2xl font-black">{teamB.shortName}</span>
          </div>
          <div className="mt-2 text-center text-lg font-bold text-slate-200">{state.result?.text ?? state.statusText}</div>
        </header>
        <HockeyScorecard state={state} />
        <div className="flex justify-center">
          <button className="btn" onClick={() => void undo()}>Undo match finish</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-4">
      {/* Top Header Bar */}
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-ink-700 bg-ink-800 px-5 py-4 shadow-xl">
        <div className="flex flex-col">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
            <span>🏑 {state.title || 'Hockey Match'}</span>
            {state.venue && <span>· {state.venue}</span>}
          </div>
          <div className="mt-1 flex items-center gap-3">
            <span
              className="h-3.5 w-3.5 rounded-full shadow"
              style={{ backgroundColor: teamA.color }}
            />
            <span className="text-2xl font-black text-slate-100">{teamA.shortName}</span>
            <span className="font-mono text-3xl font-black text-accent">{state.scoreA}</span>
            <span className="text-xl font-bold text-slate-500">-</span>
            <span className="font-mono text-3xl font-black text-accent">{state.scoreB}</span>
            <span className="text-2xl font-black text-slate-100">{teamB.shortName}</span>
            <span
              className="h-3.5 w-3.5 rounded-full shadow"
              style={{ backgroundColor: teamB.color }}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span
            title="Connected overlays"
            className={`flex items-center gap-1.5 text-xs font-semibold ${
              clients.total ? 'text-emerald-400' : 'text-slate-500'
            }`}
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                clients.total ? 'bg-emerald-400' : 'bg-slate-600'
              }`}
            />
            {clients.total} overlay{clients.total === 1 ? '' : 's'}
          </span>
          <span
            className={`rounded-lg px-3 py-1.5 text-xs font-black tracking-wider ${
              state.status === 'live'
                ? 'bg-red-600 text-white animate-pulse'
                : 'bg-ink-700 text-slate-300'
            }`}
          >
            {state.statusText.toUpperCase()}
          </span>
          <button
            onClick={() => setModal('result')}
            className="btn !min-h-[36px] !px-3 text-xs text-slate-300 hover:text-white"
          >
            Finish Match…
          </button>
        </div>
      </header>

      <LiveOverlayLinks matchId={matchId} sport="hockey" />

      {/* Main Scoring Grid */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {/* Left Column: Clock and Action Bar */}
        <div className="flex flex-col gap-4">
          {/* Clock Control */}
          <ClockControl
            state={state}
            onClockAction={onClockAction}
            onSetPeriod={(period) => void sendEvent({ type: 'SET_PERIOD', period })}
            onEndPeriod={() => void sendEvent({ type: 'END_PERIOD' })}
          />

          {/* Active Sin-Bin Suspension Strip */}
          <SuspensionBar state={state} />

          {/* Quick Action Scoring Bar */}
          <div className="card flex flex-col gap-3 border border-ink-600 bg-ink-800 p-4 shadow-lg">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-400">
              Scoring Actions
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <button
                type="button"
                onClick={() => setModal('goal')}
                className="btn !min-h-[58px] flex flex-col items-center justify-center gap-1 !bg-emerald-700 hover:!bg-emerald-600 text-white shadow-lg"
              >
                <span className="text-xl">⚽</span>
                <span className="font-black text-sm">Goal (G)</span>
              </button>

              <button
                type="button"
                onClick={() => setModal('pc')}
                className="btn !min-h-[58px] flex flex-col items-center justify-center gap-1 !bg-sky-700 hover:!bg-sky-600 text-white shadow-lg"
              >
                <span className="text-xl">🚩</span>
                <span className="font-black text-sm">Corner (P)</span>
              </button>

              <button
                type="button"
                onClick={() => setModal('card')}
                className="btn !min-h-[58px] flex flex-col items-center justify-center gap-1 !bg-amber-600 hover:!bg-amber-500 text-white shadow-lg"
              >
                <span className="text-xl">🟨</span>
                <span className="font-black text-sm">Card (C)</span>
              </button>

              <button
                type="button"
                onClick={() => setModal('shootout')}
                className="btn !min-h-[58px] flex flex-col items-center justify-center gap-1 !bg-violet-700 hover:!bg-violet-600 text-white shadow-lg"
              >
                <span className="text-xl">🎯</span>
                <span className="font-black text-sm">Shootout (S)</span>
              </button>
            </div>

            <div className="flex items-center justify-between border-t border-ink-700/80 pt-3">
              <span className="text-xs text-slate-400">
                Hotkeys: <kbd className="kbd">Space</kbd> Clock · <kbd className="kbd">G</kbd> Goal · <kbd className="kbd">P</kbd> Corner · <kbd className="kbd">C</kbd> Card · <kbd className="kbd">U</kbd> Undo
              </span>
              <button
                type="button"
                onClick={undo}
                disabled={state.eventCount === 0}
                className="btn !min-h-[36px] text-xs font-bold text-slate-300 hover:text-white"
              >
                ↶ Undo (U)
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Scorecard & Timelines */}
        <div className="flex flex-col gap-4">
          <HockeyScorecard state={state} />
        </div>
      </div>

      {/* Modals */}
      {modal === 'goal' && (
        <GoalWizard
          state={state}
          onClose={() => setModal(null)}
          onConfirm={({ teamSide, scorerId, assistId, kind }) => {
            void sendEvent({
              type: 'GOAL',
              teamSide,
              scorerId,
              assistId,
              kind,
              at: Date.now(),
            });
            toast(`Goal recorded for ${state.teams[teamSide].shortName}!`);
          }}
        />
      )}

      {modal === 'card' && (
        <CardTracker
          state={state}
          onClose={() => setModal(null)}
          onConfirm={({ teamSide, playerId, kind, durationMs }) => {
            void sendEvent({
              type: 'CARD',
              teamSide,
              playerId,
              kind,
              durationMs,
              at: Date.now(),
            });
            toast(`${kind.toUpperCase()} card issued!`);
          }}
        />
      )}

      {modal === 'shootout' && (
        <ShootoutModal
          state={state}
          onClose={() => setModal(null)}
          onConfirm={({ teamSide, round, scored, takerId }) => {
            void sendEvent({
              type: 'SHOOTOUT_ATTEMPT',
              teamSide,
              round,
              scored,
              takerId,
            });
            toast(`Shootout round ${round} attempt saved!`);
          }}
        />
      )}

      {modal === 'pc' && (
        <Modal title="🚩 Award Penalty Corner" onClose={() => setModal(null)}>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-300">
              Select which team earned the Penalty Corner (PC):
            </p>
            <div className="grid grid-cols-2 gap-3">
              {(['A', 'B'] as Side[]).map((s) => {
                const t = state.teams[s];
                const isSelected = pcSide === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setPcSide(s)}
                    className={`flex items-center justify-center gap-2.5 rounded-xl border p-4 font-bold transition-all ${
                      isSelected
                        ? '!border-accent !bg-ink-700 text-white shadow-lg'
                        : 'border-ink-700 bg-ink-900 text-slate-400 hover:bg-ink-800'
                    }`}
                  >
                    <span
                      className="h-3.5 w-3.5 rounded-full"
                      style={{ backgroundColor: t?.color }}
                    />
                    <span>{t?.name}</span>
                    <span className="text-xs font-normal">({t?.shortName})</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => {
                void sendEvent({ type: 'PENALTY_CORNER', teamSide: pcSide, at: Date.now() });
                setModal(null);
                toast(`Penalty corner awarded to ${state.teams[pcSide].shortName}!`);
              }}
              className="btn btn-primary !min-h-[48px] mt-2 w-full text-base font-black shadow-lg"
            >
              Confirm Penalty Corner for {state.teams[pcSide].name}
            </button>
          </div>
        </Modal>
      )}

      {modal === 'result' && (
        <Modal title="🏁 Match Result" onClose={() => setModal(null)}>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'won' as const, label: 'Team Won' },
                { id: 'draw' as const, label: 'Drawn' },
                { id: 'noresult' as const, label: 'Abandoned' },
              ].map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setResultKind(k.id)}
                  className={`btn !min-h-[40px] text-xs font-bold ${
                    resultKind === k.id ? '!bg-accent !text-ink-950 font-black' : 'btn-ghost'
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>

            {resultKind === 'won' && (
              <div className="grid grid-cols-2 gap-2">
                {(['A', 'B'] as Side[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setResultWinner(s)}
                    className={`btn !min-h-[40px] text-xs font-bold ${
                      resultWinner === s ? '!bg-accent !text-ink-950 font-black' : 'btn-ghost'
                    }`}
                  >
                    {state.teams[s].name} won
                  </button>
                ))}
              </div>
            )}

            <input
              className="input"
              placeholder="Custom result text (e.g. India won by shootouts 4-2)"
              value={resultText}
              onChange={(e) => setResultText(e.target.value)}
            />

            <button
              type="button"
              onClick={async () => {
                const saved = await sendEvent({
                  type: 'MATCH_RESULT',
                  kind: resultKind,
                  winner: resultKind === 'won' ? resultWinner : undefined,
                  text: resultText || undefined,
                  at: Date.now(),
                });
                if (!saved) return;
                setModal(null);
                toast('Match finished');
              }}
              className="btn btn-primary !min-h-[48px] mt-2 w-full text-base font-black shadow-lg"
            >
              Complete Match
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
