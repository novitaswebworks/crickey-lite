import type { HockeyState } from '@engine/hockey';

interface Props {
  state: HockeyState;
}

export function HockeyScorecard({ state }: Props) {
  const allGoals = [...state.teams.A.goals, ...state.teams.B.goals].sort((a, b) => a.at - b.at);
  const allCards = [...state.teams.A.cards, ...state.teams.B.cards].sort((a, b) => a.at - b.at);

  return (
    <div className="flex flex-col gap-4">
      {/* Penalty Corners count bar */}
      <div className="card flex items-center justify-between border border-ink-600 bg-ink-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: state.teams.A.color }}
          />
          <span className="font-bold">{state.teams.A.shortName}</span>
          <span className="rounded bg-ink-900 px-2 py-0.5 font-mono text-sm font-black text-accent border border-ink-700">
            {state.penaltyCorners.A} PCs
          </span>
        </div>

        <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
          Penalty Corners
        </span>

        <div className="flex items-center gap-2">
          <span className="rounded bg-ink-900 px-2 py-0.5 font-mono text-sm font-black text-accent border border-ink-700">
            {state.penaltyCorners.B} PCs
          </span>
          <span className="font-bold">{state.teams.B.shortName}</span>
          <span
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: state.teams.B.color }}
          />
        </div>
      </div>

      {/* Goals Timeline Table */}
      <div className="card flex flex-col gap-2 border border-ink-600 bg-ink-800 p-4">
        <div className="flex items-center justify-between border-b border-ink-700 pb-2">
          <h3 className="text-sm font-black uppercase tracking-wider text-slate-300">
            Goals Timeline ({allGoals.length})
          </h3>
          <span className="font-mono text-sm font-black text-accent">
            {state.teams.A.shortName} {state.scoreA} - {state.scoreB} {state.teams.B.shortName}
          </span>
        </div>

        {allGoals.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500">No goals recorded yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-ink-700 text-slate-400">
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3">Team</th>
                  <th className="py-2 pr-3">Scorer</th>
                  <th className="py-2 pr-3">Assist</th>
                  <th className="py-2">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700/50">
                {allGoals.map((g, i) => {
                  const team = state.teams[g.teamSide];
                  return (
                    <tr key={`${g.id}-${i}`} className="hover:bg-ink-700/40">
                      <td className="py-2 pr-3 font-mono font-bold text-slate-300">
                        {g.clockDisplay} (Q{g.period})
                      </td>
                      <td className="py-2 pr-3 font-bold">
                        <span className="flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: team?.color }}
                          />
                          {team?.shortName}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-black text-slate-100">{g.scorerName}</td>
                      <td className="py-2 pr-3 text-slate-400">{g.assistName || '—'}</td>
                      <td className="py-2">
                        <span className="rounded bg-ink-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-300 border border-ink-700">
                          {g.kind}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Disciplinary Cards Log */}
      <div className="card flex flex-col gap-2 border border-ink-600 bg-ink-800 p-4">
        <div className="flex items-center justify-between border-b border-ink-700 pb-2">
          <h3 className="text-sm font-black uppercase tracking-wider text-slate-300">
            Cards &amp; Penalties ({allCards.length})
          </h3>
        </div>

        {allCards.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500">No disciplinary cards issued</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-ink-700 text-slate-400">
                  <th className="py-2 pr-3">Card</th>
                  <th className="py-2 pr-3">Team</th>
                  <th className="py-2 pr-3">Player</th>
                  <th className="py-2">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700/50">
                {allCards.map((c, i) => {
                  const team = state.teams[c.teamSide];
                  const icon = c.kind === 'red' ? '🟥' : c.kind === 'yellow' ? '🟨' : '🟩';
                  const label =
                    c.kind === 'red'
                      ? 'Permanent'
                      : c.durationMs >= 60_000
                      ? `${Math.round(c.durationMs / 60_000)}m sin-bin`
                      : `${Math.round(c.durationMs / 1000)}s`;
                  return (
                    <tr key={`${c.id}-${i}`} className="hover:bg-ink-700/40">
                      <td className="py-2 pr-3 font-bold">
                        <span className="flex items-center gap-1">
                          <span>{icon}</span>
                          <span className="capitalize">{c.kind}</span>
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-bold">
                        <span className="flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: team?.color }}
                          />
                          {team?.shortName}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-bold text-slate-100">{c.playerName}</td>
                      <td className="py-2 text-slate-400">{label}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Shootout Rounds if any */}
      {state.shootout && state.shootout.rounds.length > 0 && (
        <div className="card flex flex-col gap-2 border border-ink-600 bg-ink-800 p-4">
          <div className="flex items-center justify-between border-b border-ink-700 pb-2">
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-300">
              Shootout Competition
            </h3>
            <span className="font-mono text-sm font-black text-accent">
              {state.shootout.scoreA} - {state.shootout.scoreB}
            </span>
          </div>

          <div className="grid gap-2 pt-1">
            {state.shootout.rounds.map((r) => (
              <div
                key={r.round}
                className="flex items-center justify-between rounded-lg bg-ink-900 px-3 py-2 text-xs border border-ink-700"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-400">R{r.round}</span>
                  {r.attemptA ? (
                    <span className="flex items-center gap-1 font-bold">
                      {r.attemptA.scored ? '🟢 Scored' : '🔴 Missed'}
                      {r.attemptA.takerName && (
                        <span className="text-slate-400">({r.attemptA.takerName})</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {r.attemptB ? (
                    <span className="flex items-center gap-1 font-bold">
                      {r.attemptB.scored ? '🟢 Scored' : '🔴 Missed'}
                      {r.attemptB.takerName && (
                        <span className="text-slate-400">({r.attemptB.takerName})</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
