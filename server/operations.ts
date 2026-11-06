import crypto from 'node:crypto';
import { Express } from 'express';
import { z } from 'zod';
import { Context } from './context';
import { EngineEvent, LiveState } from './engine';
import { HockeyState } from './engine/hockey';
import { ApiError } from './matches';
import { Doc } from './store';

type ScheduleStatus = 'scheduled' | 'ready' | 'on-air' | 'complete' | 'cancelled';
interface ScheduleRow { matchId: number; scheduledAt: string; status: ScheduleStatus; productionNotes: string; createdAt: string; updatedAt: string }
interface RundownRow { time: string; item: string; owner: string; status: 'pending' | 'complete' }
interface CheckRow { system: string; item: string; critical: boolean; status: 'pending' | 'pass' | 'fail' | 'na'; note: string; checkedAt: string | null }
interface IncidentRow { matchId: number; occurredAt: string; severity: 'low' | 'medium' | 'high' | 'critical'; category: string; description: string; owner: string; status: 'open' | 'investigating' | 'resolved'; resolution: string; createdAt: string; updatedAt: string }
interface ReportRow { matchId: number; scheduleId: number | null; score: string; result: string; statusText: string; eventCount: number; eventDigest: string; events: unknown[]; incidents: unknown[]; status: 'draft' | 'approved'; preparedAt: string; approvedAt: string | null }

const idParam = (raw: string): number => {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new ApiError(400, 'BAD_ID', 'Invalid id.');
  return value;
};
const scheduleSchema = z.object({
  matchId: z.number().int().positive(),
  scheduledAt: z.string().datetime({ offset: true }),
  status: z.enum(['scheduled', 'ready', 'on-air', 'complete', 'cancelled']).default('scheduled'),
  productionNotes: z.string().trim().max(2000).default(''),
});
const rundownSchema = z.array(z.object({
  time: z.string().trim().max(32).default(''),
  item: z.string().trim().min(1).max(180),
  owner: z.string().trim().max(100).default(''),
  status: z.enum(['pending', 'complete']).default('pending'),
})).max(80);
const checksSchema = z.array(z.object({
  system: z.string().trim().min(1).max(80),
  item: z.string().trim().min(1).max(180),
  critical: z.boolean().default(false),
  status: z.enum(['pending', 'pass', 'fail', 'na']).default('pending'),
  note: z.string().trim().max(500).default(''),
  checkedAt: z.string().datetime({ offset: true }).nullable().default(null),
})).max(100);
const incidentSchema = z.object({
  occurredAt: z.string().datetime({ offset: true }).default(() => new Date().toISOString()),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  category: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(1000),
  owner: z.string().trim().max(100).default(''),
  status: z.enum(['open', 'investigating', 'resolved']).default('open'),
  resolution: z.string().trim().max(1000).default(''),
});

const digestReport = (events: unknown[], incidents: unknown[]) => crypto.createHash('sha256').update(JSON.stringify({ events, incidents })).digest('hex');
function reportEventLog(events: EngineEvent[], state: LiveState): Array<Record<string, unknown>> {
  const hockey = (state as unknown as HockeyState).sport === 'hockey' ? state as unknown as HockeyState : null;
  if (hockey) {
    const goals = new Map([...hockey.teams.A.goals, ...hockey.teams.B.goals].map((goal) => [goal.id, goal]));
    const cards = new Map([...hockey.teams.A.cards, ...hockey.teams.B.cards].map((card) => [card.id, card]));
    return events.map((event) => {
      const e = event as unknown as Record<string, unknown>;
      const type = String(e.type);
      const side = e.teamSide === 'B' ? 'B' : 'A';
      const goal = goals.get(event.id);
      const card = cards.get(event.id);
      let summary = type.replaceAll('_', ' ').toLowerCase();
      if (goal) summary = `${hockey.teams[goal.teamSide].name}: ${goal.scorerName}${goal.assistName ? ` (assist: ${goal.assistName})` : ''} · ${goal.kind} · ${goal.clockDisplay} · Period ${goal.period}`;
      else if (card) summary = `${hockey.teams[card.teamSide].name}: ${card.kind} card · ${card.playerName} · period ${card.period}`;
      else if (type === 'PENALTY_CORNER') summary = `Penalty corner · ${hockey.teams[side].name}`;
      else if (type === 'SET_PERIOD') summary = `Period set to ${String(e.period)}`;
      else if (type === 'END_PERIOD') summary = `Period ${hockey.period} ended`;
      else if (type === 'SHOOTOUT_ATTEMPT') summary = `Shootout · ${hockey.teams[side].name} · ${e.scored ? 'scored' : 'missed'}`;
      else if (type === 'MATCH_RESULT') summary = hockey.result?.text ?? 'Match result recorded';
      else if (type === 'START_CLOCK') summary = 'Match clock started';
      else if (type === 'STOP_CLOCK') summary = 'Match clock stopped';
      return { ...e, summary };
    });
  }
  const cricket = state as LiveState;
  const balls = new Map(cricket.innings.flatMap((innings) => innings.timeline).map((ball) => [ball.eventId, ball]));
  return events.map((event) => {
    const e = event as unknown as Record<string, unknown>;
    const type = String(e.type);
    const ball = balls.get(event.id);
    let summary = type.replaceAll('_', ' ').toLowerCase();
    if (ball) summary = `${ball.overLabel} · ${ball.strikerName}: ${ball.label} · ${ball.scoreAfter}${ball.wicket ? ` · ${ball.wicket.outName} out (${ball.wicket.howOut})` : ''}`;
    else if (type === 'START_INNINGS') summary = 'Innings started';
    else if (type === 'MATCH_RESULT') summary = cricket.result?.text ?? 'Match result recorded';
    else if (type === 'END_INNINGS') summary = 'Innings ended';
    else if (type === 'SET_BOWLER') summary = `Bowler selected · ${String(e.bowler ?? '')}`;
    else if (type === 'SET_BATTERS') summary = `Openers selected · ${String(e.striker ?? '')} and ${String(e.nonStriker ?? '')}`;
    return { ...e, summary };
  });
}
const PREFLIGHT_TEMPLATE: Omit<CheckRow, 'checkedAt'>[] = [
  { system: 'Scoring', item: 'Correct match selected and scoring panel connected', critical: true, status: 'pending', note: '' },
  { system: 'Graphics', item: 'Required overlay sources loaded and showing current match', critical: true, status: 'pending', note: '' },
  { system: 'Switcher', item: 'OBS or vMix connected and program scene confirmed', critical: true, status: 'pending', note: '' },
  { system: 'Streaming', item: 'Stream destination and test signal confirmed', critical: true, status: 'pending', note: '' },
  { system: 'Audio', item: 'Commentary and program audio checked', critical: false, status: 'pending', note: '' },
  { system: 'Video', item: 'Camera sources checked', critical: false, status: 'pending', note: '' },
  { system: 'Replay', item: 'Replay system checked (if used)', critical: false, status: 'pending', note: '' },
];

export function registerOperationsRoutes(app: Express, ctx: Context): void {
  const { store, matches } = ctx;
  const getSchedule = (id: number): Doc<ScheduleRow> => {
    const row = store.get<ScheduleRow>('ops-schedules', id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Scheduled broadcast not found.');
    return row;
  };

  app.get('/api/operations/schedules', (_req, res) => {
    const summaries = new Map(matches.list().map((m) => [m.id, m]));
    res.json(store.list<ScheduleRow>('ops-schedules').map((s) => ({ ...s, match: summaries.get(s.matchId) ?? null }))
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)));
  });
  app.post('/api/operations/schedules', (req, res) => {
    const body = scheduleSchema.parse(req.body);
    if (body.status !== 'scheduled') throw new ApiError(400, 'BAD_SCHEDULE_STATUS', 'A new broadcast schedule must begin as scheduled.');
    if (!store.get('matches', body.matchId)) throw new ApiError(404, 'NOT_FOUND', 'Match not found. Create the match before scheduling its broadcast.');
    if (store.list<ScheduleRow>('ops-schedules').some((s) => s.matchId === body.matchId)) throw new ApiError(409, 'SCHEDULE_EXISTS', 'This match already has a broadcast schedule.');
    const now = new Date().toISOString();
    const schedule = store.insert<ScheduleRow>('ops-schedules', { ...body, createdAt: now, updatedAt: now });
    store.replaceByParent('ops-checks', schedule.id, PREFLIGHT_TEMPLATE.map((check) => ({ ...check, checkedAt: null })));
    const sport = matches.list().find((m) => m.id === body.matchId)?.sport;
    const rundown = sport === 'hockey'
      ? ['Pre-show and technical check', 'Team lineups', 'Opening whistle', 'Period break(s)', 'Final whistle and result']
      : ['Pre-show and technical check', 'Team lineups and toss', 'Match start', 'Innings break', 'Final result'];
    store.replaceByParent('ops-rundown', schedule.id, rundown.map((item) => ({ time: '', item, owner: '', status: 'pending' as const })));
    res.status(201).json(schedule);
  });
  app.put('/api/operations/schedules/:id', (req, res) => {
    const id = idParam(req.params.id);
    getSchedule(id);
    const body = scheduleSchema.parse(req.body);
    if (!store.get('matches', body.matchId)) throw new ApiError(404, 'NOT_FOUND', 'Match not found.');
    const duplicate = store.list<ScheduleRow>('ops-schedules').some((s) => s.matchId === body.matchId && s.id !== id);
    if (duplicate) throw new ApiError(409, 'SCHEDULE_EXISTS', 'This match already has a broadcast schedule.');
    if (body.status === 'ready' || body.status === 'on-air') {
      const checks = store.list<CheckRow>('ops-checks', id);
      if (checks.some((check) => check.critical && check.status !== 'pass' && check.status !== 'na')) throw new ApiError(409, 'PREFLIGHT_INCOMPLETE', 'Every critical preflight check must pass or be marked not applicable before marking the broadcast ready or on air.');
    }
    res.json(store.update<ScheduleRow>('ops-schedules', id, { ...body, updatedAt: new Date().toISOString() }));
  });
  app.delete('/api/operations/schedules/:id', (req, res) => {
    const id = idParam(req.params.id);
    getSchedule(id);
    store.removeByParent('ops-rundown', id);
    store.removeByParent('ops-checks', id);
    store.removeByParent('ops-incidents', id);
    const matchId = store.get<ScheduleRow>('ops-schedules', id)!.matchId;
    const report = store.list<ReportRow>('ops-reports').find((r) => r.matchId === matchId);
    if (report) store.remove('ops-reports', report.id);
    store.remove('ops-schedules', id);
    res.json({ ok: true });
  });

  app.get('/api/operations/schedules/:id/rundown', (req, res) => res.json(store.list<RundownRow>('ops-rundown', idParam(req.params.id)).map(({ id, ...row }) => row)));
  app.put('/api/operations/schedules/:id/rundown', (req, res) => {
    const id = idParam(req.params.id); getSchedule(id);
    const rows = rundownSchema.parse(req.body);
    store.replaceByParent('ops-rundown', id, rows);
    res.json(rows);
  });
  app.get('/api/operations/schedules/:id/checks', (req, res) => res.json(store.list<CheckRow>('ops-checks', idParam(req.params.id))));
  app.put('/api/operations/schedules/:id/checks', (req, res) => {
    const id = idParam(req.params.id); getSchedule(id);
    const rows = checksSchema.parse(req.body);
    store.replaceByParent('ops-checks', id, rows);
    res.json(store.list<CheckRow>('ops-checks', id));
  });
  app.get('/api/operations/schedules/:id/incidents', (req, res) => {
    const id = idParam(req.params.id); getSchedule(id);
    res.json(store.list<IncidentRow>('ops-incidents', id).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)));
  });
  app.post('/api/operations/schedules/:id/incidents', (req, res) => {
    const id = idParam(req.params.id); const schedule = getSchedule(id);
    const body = incidentSchema.parse(req.body); const now = new Date().toISOString();
    res.status(201).json(store.insert<IncidentRow>('ops-incidents', { ...body, matchId: schedule.matchId, createdAt: now, updatedAt: now }, id));
  });
  app.put('/api/operations/incidents/:id', (req, res) => {
    const id = idParam(req.params.id);
    const old = store.get<IncidentRow>('ops-incidents', id);
    if (!old) throw new ApiError(404, 'NOT_FOUND', 'Incident not found.');
    const body = incidentSchema.parse(req.body);
    res.json(store.update<IncidentRow>('ops-incidents', id, { ...body, updatedAt: new Date().toISOString() }));
  });

  app.get('/api/operations/matches/:id/report', (req, res) => {
    const matchId = idParam(req.params.id);
    const report = store.list<ReportRow>('ops-reports').find((r) => r.matchId === matchId);
    if (!report) throw new ApiError(404, 'NOT_FOUND', 'No report draft exists for this match yet.');
    const currentIncidents = report.scheduleId ? store.list<IncidentRow>('ops-incidents', report.scheduleId) : [];
    res.json({ ...report, stale: report.eventDigest !== digestReport(matches.events(matchId), currentIncidents) });
  });
  app.post('/api/operations/matches/:id/report', (req, res) => {
    const matchId = idParam(req.params.id);
    const state = matches.state(matchId) as unknown as { status?: string; statusText?: string; result?: { text?: string } };
    if (state.status !== 'completed') throw new ApiError(409, 'MATCH_NOT_COMPLETE', 'Confirm the match result in Live Scoring before generating the final report.');
    const summary = matches.list().find((m) => m.id === matchId);
    if (!summary) throw new ApiError(404, 'NOT_FOUND', 'Match not found.');
    const events = matches.events(matchId);
    const schedule = store.list<ScheduleRow>('ops-schedules').find((s) => s.matchId === matchId);
    const incidents = schedule ? store.list<IncidentRow>('ops-incidents', schedule.id) : [];
    const snapshot: ReportRow = {
      matchId, scheduleId: schedule?.id ?? null, score: summary.score,
      result: state.result?.text ?? state.statusText ?? 'Match completed', statusText: state.statusText ?? 'completed',
      eventCount: events.length, eventDigest: digestReport(events, incidents), events: reportEventLog(events, matches.state(matchId)),
      incidents,
      status: 'draft', preparedAt: new Date().toISOString(), approvedAt: null,
    };
    const existing = store.list<ReportRow>('ops-reports').find((r) => r.matchId === matchId);
    const saved = existing ? store.update<ReportRow>('ops-reports', existing.id, snapshot) : store.insert<ReportRow>('ops-reports', snapshot);
    res.status(existing ? 200 : 201).json({ ...saved, stale: false });
  });
  app.post('/api/operations/matches/:id/report/approve', (req, res) => {
    const matchId = idParam(req.params.id);
    const report = store.list<ReportRow>('ops-reports').find((r) => r.matchId === matchId);
    if (!report) throw new ApiError(404, 'NOT_FOUND', 'Generate a report draft before approving it.');
    const currentIncidents = report.scheduleId ? store.list<IncidentRow>('ops-incidents', report.scheduleId) : [];
    if (report.eventDigest !== digestReport(matches.events(matchId), currentIncidents)) throw new ApiError(409, 'STALE_REPORT', 'Match events or incident records changed. Regenerate and review the report before approval.');
    const state = matches.state(matchId) as unknown as { status?: string };
    if (state.status !== 'completed') throw new ApiError(409, 'MATCH_NOT_COMPLETE', 'The match must remain complete to approve its final report.');
    const approved = store.update<ReportRow>('ops-reports', report.id, { status: 'approved', approvedAt: new Date().toISOString() });
    res.json({ ...approved, stale: false });
  });
}
