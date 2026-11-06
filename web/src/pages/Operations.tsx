import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiFail, MatchSummary, del, get, post, put } from '../api';
import { Empty, Field, toast } from '../ui';

type ScheduleStatus = 'scheduled' | 'ready' | 'on-air' | 'complete' | 'cancelled';
type Schedule = { id: number; matchId: number; scheduledAt: string; status: ScheduleStatus; productionNotes: string; match: MatchSummary | null };
type RundownRow = { time: string; item: string; owner: string; status: 'pending' | 'complete' };
type CheckRow = { id: number; system: string; item: string; critical: boolean; status: 'pending' | 'pass' | 'fail' | 'na'; note: string; checkedAt: string | null };
type Incident = { id: number; matchId: number; occurredAt: string; severity: 'low' | 'medium' | 'high' | 'critical'; category: string; description: string; owner: string; status: 'open' | 'investigating' | 'resolved'; resolution: string; createdAt: string; updatedAt: string };
type IncidentDraft = Pick<Incident, 'occurredAt' | 'severity' | 'category' | 'description' | 'owner' | 'status' | 'resolution'>;
type Report = { matchId: number; score: string; result: string; statusText: string; eventCount: number; events: Array<{ id: number; type: string; [key: string]: unknown }>; incidents: Incident[]; status: 'draft' | 'approved'; preparedAt: string; approvedAt: string | null; stale: boolean };
type Tab = 'rundown' | 'preflight' | 'incidents' | 'report';

const FAIL = (e: unknown) => toast((e as ApiFail).message, 'error');
const emptyIncident = (): IncidentDraft => ({ occurredAt: new Date().toISOString(), severity: 'medium', category: 'Technical', description: '', owner: '', status: 'open', resolution: '' });
const EVENT_LABELS: Record<string, string> = { GOAL: 'Goal', CARD: 'Card', PENALTY_CORNER: 'Penalty corner', MATCH_RESULT: 'Final result', START_CLOCK: 'Clock started', STOP_CLOCK: 'Clock stopped', BALL: 'Delivery', WICKET: 'Wicket', END_PERIOD: 'Period ended' };

export function Operations() {
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('rundown');
  const [loading, setLoading] = useState(true);
  const [scheduledMatch, setScheduledMatch] = useState<number | ''>('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [productionNotes, setProductionNotes] = useState('');
  const [rundown, setRundown] = useState<RundownRow[]>([]);
  const [checks, setChecks] = useState<CheckRow[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentDraft, setIncidentDraft] = useState(emptyIncident());
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);

  const loadIndex = useCallback(async () => {
    setLoading(true);
    try {
      const [m, s] = await Promise.all([get<MatchSummary[]>('/api/matches'), get<Schedule[]>('/api/operations/schedules')]);
      setMatches(m); setSchedules(s);
      setSelectedId((old) => old && s.some((row) => row.id === old) ? old : (s[0]?.id ?? null));
      setScheduledMatch((old) => old || m.find((row) => row.status !== 'completed' && !s.some((item) => item.matchId === row.id))?.id || '');
    } catch (e) { FAIL(e); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadIndex(); }, [loadIndex]);

  const selected = schedules.find((row) => row.id === selectedId) ?? null;
  const loadDetails = useCallback(async (id: number) => {
    try {
      const [r, c, i] = await Promise.all([
        get<RundownRow[]>(`/api/operations/schedules/${id}/rundown`),
        get<CheckRow[]>(`/api/operations/schedules/${id}/checks`),
        get<Incident[]>(`/api/operations/schedules/${id}/incidents`),
      ]);
      setRundown(r); setChecks(c); setIncidents(i);
      setReport(null);
      const schedule = schedules.find((row) => row.id === id);
      if (schedule?.match?.status === 'completed') {
        try { setReport(await get<Report>(`/api/operations/matches/${schedule.matchId}/report`)); } catch { /* no final report has been approved */ }
      }
    } catch (e) { FAIL(e); }
  }, [schedules]);
  useEffect(() => { if (selectedId !== null) void loadDetails(selectedId); else { setRundown([]); setChecks([]); setIncidents([]); setReport(null); } }, [selectedId, loadDetails]);

  const readiness = useMemo(() => {
    const critical = checks.filter((check) => check.critical);
    const passed = critical.filter((check) => check.status === 'pass' || check.status === 'na').length;
    return { passed, total: critical.length, ready: critical.length > 0 && passed === critical.length };
  }, [checks]);

  const scheduleMatch = async () => {
    if (!scheduledMatch || !scheduledAt) return;
    setBusy(true);
    try {
      const localDate = new Date(scheduledAt);
      if (Number.isNaN(localDate.getTime())) throw new Error('Choose a valid match date and time.');
      const row = await post<Schedule>('/api/operations/schedules', { matchId: scheduledMatch, scheduledAt: localDate.toISOString(), status: 'scheduled', productionNotes });
      await loadIndex();
      setSelectedId(row.id); setProductionNotes(''); setScheduledAt('');
      toast('Broadcast scheduled');
    } catch (e) { FAIL(e); } finally { setBusy(false); }
  };

  const saveScheduleStatus = async (status: ScheduleStatus) => {
    if (!selected) return;
    try {
      const updated = await put<Schedule>(`/api/operations/schedules/${selected.id}`, { matchId: selected.matchId, scheduledAt: selected.scheduledAt, status, productionNotes: selected.productionNotes });
      setSchedules((rows) => rows.map((row) => row.id === selected.id ? { ...row, ...updated } : row));
      toast(status === 'ready' ? 'Readiness approved' : `Broadcast marked ${status}`);
    } catch (e) { FAIL(e); }
  };
  const saveRundown = async () => {
    if (!selected) return;
    try { await put(`/api/operations/schedules/${selected.id}/rundown`, rundown); toast('Rundown saved'); } catch (e) { FAIL(e); }
  };
  const saveChecks = async () => {
    if (!selected) return;
    try {
      const rows = await put<CheckRow[]>(`/api/operations/schedules/${selected.id}/checks`, checks.map(({ id: _id, ...row }) => ({ ...row, checkedAt: row.status === 'pass' || row.status === 'fail' ? (row.checkedAt ?? new Date().toISOString()) : null })));
      setChecks(rows); toast('Preflight checks saved');
    } catch (e) { FAIL(e); }
  };
  const addIncident = async () => {
    if (!selected || !incidentDraft.description.trim()) return;
    try {
      await post(`/api/operations/schedules/${selected.id}/incidents`, incidentDraft);
      setIncidentDraft(emptyIncident());
      setIncidents(await get<Incident[]>(`/api/operations/schedules/${selected.id}/incidents`));
      toast('Incident logged');
    } catch (e) { FAIL(e); }
  };
  const updateIncident = async (incident: Incident, patch: Partial<Incident>) => {
    if (!selected) return;
    const next = { ...incident, ...patch };
    try {
      await put(`/api/operations/incidents/${incident.id}`, next);
      setIncidents(await get<Incident[]>(`/api/operations/schedules/${selected.id}/incidents`));
    } catch (e) { FAIL(e); }
  };
  const generateReport = async () => {
    if (!selected) return;
    setBusy(true);
    try { setReport(await post<Report>(`/api/operations/matches/${selected.matchId}/report`)); toast('Report draft generated for review'); }
    catch (e) { FAIL(e); } finally { setBusy(false); }
  };
  const approveReport = async () => {
    if (!selected) return;
    setBusy(true);
    try { setReport(await post<Report>(`/api/operations/matches/${selected.matchId}/report/approve`)); toast('Final report approved'); }
    catch (e) { FAIL(e); } finally { setBusy(false); }
  };
  const removeSchedule = async () => {
    if (!selected || !window.confirm('Remove this broadcast schedule and its rundown, checklist, incident log and report? The match and scoring record will remain.')) return;
    try {
      await del(`/api/operations/schedules/${selected.id}`);
      setSelectedId(null); await loadIndex(); toast('Broadcast schedule removed');
    } catch (e) { FAIL(e); }
  };

  const activeMatches = matches.filter((m) => m.status !== 'completed' && !schedules.some((s) => s.matchId === m.id));
  const tabRows: [Tab, string][] = [['rundown', 'Rundown'], ['preflight', 'Preflight'], ['incidents', `Incidents${incidents.some((x) => x.status !== 'resolved') ? ` · ${incidents.filter((x) => x.status !== 'resolved').length} open` : ''}`], ['report', 'Match report']];

  if (loading) return <div className="mx-auto max-w-6xl p-8 text-center text-slate-400">Loading broadcast operations…</div>;
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><div className="text-xs font-bold uppercase tracking-[.2em] text-accent">Production operations · local data</div><h1 className="text-2xl font-black">Broadcast Operations</h1><p className="mt-1 text-sm text-slate-400">Schedule, prepare and document each broadcast. These tools do not control live scoring or graphics.</p></div>
      </header>

      <section className="card">
        <h2 className="mb-3 font-bold">Schedule a match broadcast</h2>
        {!activeMatches.length ? <p className="text-sm text-slate-400">Create a new match in Match Setup before scheduling it here.</p> : <div className="grid items-end gap-3 md:grid-cols-[1.3fr_1fr_1.5fr_auto]">
          <Field label="Match"><select className="input" value={scheduledMatch} onChange={(e) => setScheduledMatch(Number(e.target.value))}><option value="">Select a match…</option>{activeMatches.map((m) => <option key={m.id} value={m.id}>{m.title || `Match #${m.id}`} · {m.teamA.name} v {m.teamB.name}</option>)}</select></Field>
          <Field label="Broadcast date & time"><input className="input" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></Field>
          <Field label="Production notes"><input className="input" placeholder="Call time, special coverage notes…" value={productionNotes} onChange={(e) => setProductionNotes(e.target.value)} /></Field>
          <button className="btn btn-primary" disabled={!scheduledMatch || !scheduledAt || busy} onClick={() => void scheduleMatch()}>Add to schedule</button>
        </div>}
      </section>

      {!schedules.length ? <Empty title="No broadcast schedules yet" hint="Schedule a match above. Its rundown, technical checks and incident log will be kept here on this machine." /> : <div className="grid gap-4 xl:grid-cols-[310px_minmax(0,1fr)]">
        <aside className="card !p-2">
          <div className="px-2 py-2 text-xs font-bold uppercase tracking-wider text-slate-400">Scheduled broadcasts</div>
          <div className="flex flex-col gap-1">{schedules.map((row) => <button key={row.id} className={`rounded-lg border p-3 text-left ${selectedId === row.id ? 'border-accent bg-ink-700' : 'border-ink-700 hover:bg-ink-800'}`} onClick={() => setSelectedId(row.id)}>
            <span className="flex items-center justify-between gap-2"><b className="truncate">{row.match?.title || `${row.match?.teamA.name ?? 'Match'} v ${row.match?.teamB.name ?? ''}`}</b><span className={`shrink-0 text-[10px] font-black uppercase ${row.status === 'ready' ? 'text-emerald-400' : row.status === 'on-air' ? 'text-red-400' : 'text-slate-400'}`}>{row.status}</span></span>
            <span className="mt-1 block text-xs text-slate-400">{row.match?.teamA.name} v {row.match?.teamB.name}</span>
            <time className="mt-1 block text-xs text-slate-500">{new Date(row.scheduledAt).toLocaleString()}</time>
          </button>)}</div>
        </aside>

        {selected && <main className="flex min-w-0 flex-col gap-4">
          <section className="card flex flex-wrap items-center justify-between gap-3">
            <div><div className="text-xs font-bold uppercase tracking-widest text-slate-400">{selected.match?.sport.toUpperCase()} · Match #{selected.matchId}</div><h2 className="text-xl font-black">{selected.match?.teamA.name} v {selected.match?.teamB.name}</h2><div className="text-sm text-slate-400">{selected.match?.venue || 'Venue not set'} · {new Date(selected.scheduledAt).toLocaleString()}</div></div>
            <div className="no-print flex flex-wrap items-center gap-2"><span className={`rounded-lg px-3 py-2 text-xs font-black ${readiness.ready ? 'bg-emerald-800 text-emerald-100' : 'bg-amber-900 text-amber-100'}`}>{readiness.passed}/{readiness.total} critical checks passed</span>
              <button className="btn !min-h-[38px]" onClick={() => window.print()}>Print call sheet</button>
              <button className="btn !min-h-[38px] !text-red-300" onClick={() => void removeSchedule()}>Remove schedule</button>
              <select aria-label="Broadcast status" className="input !w-auto" value={selected.status} onChange={(e) => void saveScheduleStatus(e.target.value as ScheduleStatus)}><option value="scheduled">Scheduled</option><option value="ready">Ready for broadcast</option><option value="on-air">On air</option><option value="complete">Complete</option><option value="cancelled">Cancelled</option></select>
            </div>
          </section>

          <section data-print-sheet className="hidden">
            <div className="border-b-2 pb-4">
              <div className="text-sm font-bold uppercase tracking-widest">Broadcast call sheet</div>
              <h1 className="mt-2 text-3xl font-black">{selected.match?.title || `${selected.match?.teamA.name} v ${selected.match?.teamB.name}`}</h1>
              <div className="mt-1 text-lg">{selected.match?.teamA.name} v {selected.match?.teamB.name}</div>
              <div className="mt-1">{selected.match?.sport.toUpperCase()} · {selected.match?.venue || 'Venue not set'} · {new Date(selected.scheduledAt).toLocaleString()}</div>
              <div className="mt-2 text-sm">Broadcast status: <b>{selected.status.toUpperCase()}</b> · Preflight: <b>{readiness.passed}/{readiness.total} critical checks passed</b></div>
            </div>
            {selected.productionNotes && <div className="border-b py-3"><h2 className="font-bold">Production notes</h2><p className="mt-1 whitespace-pre-wrap">{selected.productionNotes}</p></div>}
            <div className="border-b py-3"><h2 className="font-bold">Production rundown</h2>{rundown.length ? <table className="mt-2 w-full border-collapse text-sm"><thead><tr className="border-b text-left"><th className="py-1 pr-3">Time</th><th className="py-1 pr-3">Item</th><th className="py-1 pr-3">Owner</th><th className="py-1">Status</th></tr></thead><tbody>{rundown.map((row, index) => <tr key={index} className="border-b"><td className="py-1 pr-3">{row.time || '—'}</td><td className="py-1 pr-3">{row.item}</td><td className="py-1 pr-3">{row.owner || '—'}</td><td className="py-1">{row.status === 'complete' ? 'Done' : 'Pending'}</td></tr>)}</tbody></table> : <p className="mt-1 text-sm">No rundown items added.</p>}</div>
            <div className="py-3"><h2 className="font-bold">Technical readiness</h2><table className="mt-2 w-full border-collapse text-sm"><thead><tr className="border-b text-left"><th className="py-1 pr-3">System</th><th className="py-1 pr-3">Check</th><th className="py-1 pr-3">Result</th><th className="py-1">Notes</th></tr></thead><tbody>{checks.map((row) => <tr key={row.id} className="border-b"><td className="py-1 pr-3">{row.system}</td><td className="py-1 pr-3">{row.item}{row.critical ? ' · Critical' : ''}</td><td className="py-1 pr-3">{row.status.toUpperCase()}</td><td className="py-1">{row.note || '—'}</td></tr>)}</tbody></table></div>
            <div className="mt-4 border-t pt-2 text-xs">Generated {new Date().toLocaleString()} · Use the Operations panel for current live status.</div>
          </section>

          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Selected broadcast tools">{tabRows.map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} className={`btn ${tab === key ? 'btn-primary' : ''}`} onClick={() => setTab(key)}>{label}</button>)}</div>

          {tab === 'rundown' && <section className="card">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold">Production rundown</h3><p className="text-xs text-slate-400">Add the planned sequence and the role responsible for each item.</p></div><button className="btn btn-primary" onClick={() => void saveRundown()}>Save rundown</button></div>
            <div className="grid grid-cols-[110px_minmax(0,1fr)_minmax(140px,.6fr)_100px_40px] gap-2 px-1 pb-2 text-[11px] font-bold uppercase text-slate-500"><span>Time</span><span>Item</span><span>Owner</span><span>Status</span><span /></div>
            {rundown.map((row, index) => <div key={index} className="mb-2 grid grid-cols-[110px_minmax(0,1fr)_minmax(140px,.6fr)_100px_40px] gap-2">
              <input className="input" type="time" value={row.time} onChange={(e) => setRundown((all) => all.map((x, i) => i === index ? { ...x, time: e.target.value } : x))} />
              <input className="input" aria-label="Rundown item" placeholder="Opening, team lineups, match coverage…" value={row.item} onChange={(e) => setRundown((all) => all.map((x, i) => i === index ? { ...x, item: e.target.value } : x))} />
              <input className="input" aria-label="Rundown owner" placeholder="Director / GFX…" value={row.owner} onChange={(e) => setRundown((all) => all.map((x, i) => i === index ? { ...x, owner: e.target.value } : x))} />
              <select className="input" value={row.status} onChange={(e) => setRundown((all) => all.map((x, i) => i === index ? { ...x, status: e.target.value as RundownRow['status'] } : x))}><option value="pending">Pending</option><option value="complete">Done</option></select>
              <button className="btn !px-2" aria-label="Remove rundown item" onClick={() => setRundown((all) => all.filter((_, i) => i !== index))}>×</button>
            </div>)}
            <button className="btn mt-2" onClick={() => setRundown((rows) => [...rows, { time: '', item: '', owner: '', status: 'pending' }])}>+ Add rundown item</button>
            {selected.productionNotes && <p className="mt-4 rounded-lg bg-ink-900 p-3 text-sm text-slate-300"><b>Production notes:</b> {selected.productionNotes}</p>}
          </section>}

          {tab === 'preflight' && <section className="card">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold">Technical readiness checklist</h3><p className="text-xs text-slate-400">Critical checks must pass before this schedule can be marked ready or on air.</p></div><button className="btn btn-primary" onClick={() => void saveChecks()}>Save checks</button></div>
            <div className="flex flex-col gap-2">{checks.map((row, index) => <div key={row.id} className={`grid gap-2 rounded-lg border p-3 md:grid-cols-[minmax(180px,.8fr)_minmax(220px,1.2fr)_140px_minmax(160px,.8fr)] ${row.critical ? 'border-amber-800/70' : 'border-ink-700'}`}>
              <div><div className="text-xs font-bold uppercase text-slate-400">{row.system}</div><div className="text-sm">{row.item}</div>{row.critical && <span className="text-[10px] font-black uppercase text-amber-400">Critical</span>}</div>
              <div className="flex items-center"><span className={`rounded px-2 py-1 text-xs font-bold ${row.status === 'pass' ? 'bg-emerald-900 text-emerald-200' : row.status === 'fail' ? 'bg-red-900 text-red-200' : 'bg-ink-700 text-slate-300'}`}>{row.status.toUpperCase()}</span></div>
              <select className="input" aria-label={`${row.system} status`} value={row.status} onChange={(e) => setChecks((all) => all.map((x, i) => i === index ? { ...x, status: e.target.value as CheckRow['status'], checkedAt: e.target.value === 'pass' || e.target.value === 'fail' ? new Date().toISOString() : null } : x))}><option value="pending">Not checked</option><option value="pass">Pass</option><option value="fail">Fail</option><option value="na">Not applicable</option></select>
              <input className="input" aria-label={`${row.system} note`} placeholder="Optional note" value={row.note} onChange={(e) => setChecks((all) => all.map((x, i) => i === index ? { ...x, note: e.target.value } : x))} />
            </div>)}</div>
            {checks.some((row) => row.critical && row.status === 'fail') && <p className="mt-3 rounded-lg border border-red-800 bg-red-950/50 p-3 text-sm text-red-200">A critical system is marked failed. Resolve it and update the check before marking the broadcast ready.</p>}
          </section>}

          {tab === 'incidents' && <section className="flex flex-col gap-4">
            <div className="card"><h3 className="mb-3 font-bold">Log a technical incident</h3><div className="grid gap-3 md:grid-cols-3">
              <Field label="Category"><select className="input" value={incidentDraft.category} onChange={(e) => setIncidentDraft((x) => ({ ...x, category: e.target.value }))}><option>Technical</option><option>Scoring / graphics</option><option>Video / camera</option><option>Audio / communications</option><option>Streaming / network</option><option>Production</option><option>Other</option></select></Field>
              <Field label="Severity"><select className="input" value={incidentDraft.severity} onChange={(e) => setIncidentDraft((x) => ({ ...x, severity: e.target.value as Incident['severity'] }))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></Field>
              <Field label="Owner"><input className="input" placeholder="Responsible role or person" value={incidentDraft.owner} onChange={(e) => setIncidentDraft((x) => ({ ...x, owner: e.target.value }))} /></Field>
              <Field label="What happened"><input className="input md:col-span-3" placeholder="Describe the issue and its broadcast impact" value={incidentDraft.description} onChange={(e) => setIncidentDraft((x) => ({ ...x, description: e.target.value }))} /></Field>
            </div><button className="btn btn-primary mt-3" disabled={!incidentDraft.description.trim()} onClick={() => void addIncident()}>Record incident</button></div>
            <div className="card"><h3 className="mb-3 font-bold">Incident log</h3>{!incidents.length ? <p className="text-sm text-slate-400">No incidents logged for this broadcast.</p> : <div className="flex flex-col gap-2">{incidents.map((incident) => <article key={incident.id} className="rounded-lg border border-ink-700 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><b>{incident.category}</b><span className={`rounded px-2 py-0.5 text-[10px] font-black uppercase ${incident.severity === 'critical' || incident.severity === 'high' ? 'bg-red-900 text-red-100' : 'bg-ink-700 text-slate-300'}`}>{incident.severity}</span></div><time className="text-xs text-slate-500">{new Date(incident.occurredAt).toLocaleString()}</time></div>
              <p className="mt-1 text-sm">{incident.description}</p><div className="mt-2 flex flex-wrap items-end gap-2"><span className="mr-auto text-xs text-slate-400">Owner: {incident.owner || 'Unassigned'}</span><input className="input !w-64" aria-label="Incident resolution" placeholder="Resolution / follow-up" value={incident.resolution} onChange={(e) => setIncidents((rows) => rows.map((x) => x.id === incident.id ? { ...x, resolution: e.target.value } : x))} />
                <select className="input !w-40" aria-label="Incident status" value={incident.status} onChange={(e) => void updateIncident(incident, { status: e.target.value as Incident['status'], resolution: incident.resolution })}><option value="open">Open</option><option value="investigating">Investigating</option><option value="resolved">Resolved</option></select>
                <button className="btn" onClick={() => void updateIncident(incident, { resolution: incident.resolution, status: incident.status })}>Save note</button>
              </div>
            </article>)}</div>}</div>
          </section>}

          {tab === 'report' && <section className="card">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold">Final match report</h3><p className="text-xs text-slate-400">Generated only after the match is marked complete. Regenerate after any score correction.</p></div>
              {selected.match?.status === 'completed' ? report && !report.stale && report.status === 'draft' ? <button className="btn btn-primary" disabled={busy} onClick={() => void approveReport()}>Approve reviewed report</button> : <button className="btn btn-primary" disabled={busy} onClick={() => void generateReport()}>{report?.stale ? 'Regenerate report draft' : report?.status === 'approved' ? 'Prepare updated report' : 'Generate report draft'}</button> : <span className="rounded bg-amber-900 px-3 py-2 text-xs text-amber-100">Complete and confirm the match in Live Scoring first</span>}
            </div>
            {report && <div className="mt-4 rounded-xl border border-ink-700 bg-ink-900 p-4">
              {report.stale && <p className="mb-3 rounded border border-amber-700 bg-amber-950/50 p-2 text-sm text-amber-100">Match events changed after this report was approved. Review and regenerate it.</p>}
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-400"><span className={`rounded px-2 py-1 font-black ${report.status === 'approved' ? 'bg-emerald-900 text-emerald-200' : 'bg-amber-900 text-amber-200'}`}>{report.status}</span><span>{report.status === 'approved' && report.approvedAt ? `Approved ${new Date(report.approvedAt).toLocaleString()}` : `Draft prepared ${new Date(report.preparedAt).toLocaleString()}`}</span></div><div className="mt-1 text-2xl font-black">{report.score}</div><div className="text-lg font-bold text-emerald-300">{report.result}</div><div className="mt-2 text-sm text-slate-400">{report.eventCount} recorded events · {report.incidents.length} related incidents</div>
              <h4 className="mt-4 text-xs font-bold uppercase tracking-wider text-slate-400">Match event log</h4><div className="mt-2 max-h-64 overflow-auto">{report.events.map((event, i) => <div key={`${event.id}-${i}`} className="flex gap-3 border-b border-ink-700 py-2 text-sm"><span className="w-10 shrink-0 text-slate-500">#{event.id}</span><span>{typeof event.summary === 'string' ? event.summary : EVENT_LABELS[event.type] ?? event.type.replaceAll('_', ' ')}</span><span className="ml-auto shrink-0 text-xs text-slate-500">{'at' in event && typeof event.at === 'number' ? new Date(event.at).toLocaleTimeString() : ''}</span></div>)}</div>
            </div>}
            {!report && selected.match?.status === 'completed' && <p className="mt-4 text-sm text-slate-400">No approved report yet. Generate one to save a snapshot of the final score, event history and related incidents.</p>}
          </section>}
        </main>}
      </div>}
    </div>
  );
}
