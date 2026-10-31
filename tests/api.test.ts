import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crickey-test-'));
process.env.CRICKEY_DATA = tmp;
delete process.env.PIN;

type Ctx = Awaited<ReturnType<typeof import('../server/context').createContext>>;
let ctx: Ctx;
let base = '';
let close: () => void;
let matchId = 0;
let ids: Record<string, string> = {};

async function api(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
}
const ball = (b: object) => api('POST', `/api/matches/${matchId}/events`, { type: 'BALL', ...b });

beforeAll(async () => {
  const { createContext } = await import('../server/context');
  const { createApp } = await import('../server/app');
  const { seedDemo } = await import('../server/seed-data');
  ctx = await createContext(tmp);
  const app = createApp(ctx);
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  close = app.close;
  matchId = seedDemo(ctx).matchId;
  const state = ctx.matches.state(matchId);
  ids = { a1: state.rosters.A[0].id, a2: state.rosters.A[1].id, a3: state.rosters.A[2].id, b1: state.rosters.B[0].id, b2: state.rosters.B[1].id };
  await api('POST', `/api/matches/${matchId}/events`, { type: 'START_INNINGS' });
  await api('POST', `/api/matches/${matchId}/events`, { type: 'SET_BATTERS', striker: ids.a1, nonStriker: ids.a2 });
  await api('POST', `/api/matches/${matchId}/events`, { type: 'SET_BOWLER', bowler: ids.b1 });
});

afterAll(() => {
  close();
  ctx.store.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('REST API', () => {
  it('serves the live state for the active match', async () => {
    const r = await api('GET', '/api/state');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ matchId: String(matchId), status: 'live', current: { runs: 0, strikerId: ids.a1 } });
    expect((await api('GET', `/api/state?match=${matchId}`)).json.current.number).toBe(1);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('scores balls, rejects invalid input with friendly errors, and supports undo and edit', async () => {
    let r = await ball({ runs: 1 });
    expect(r.json.state.current).toMatchObject({ runs: 1, strikerId: ids.a2 });
    r = await ball({ runs: 99 });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ code: 'VALIDATION' });
    expect(r.json.error).toContain('runs');
    r = await ball({ extra: 'noball' });
    expect(r.json.state.current.freeHit).toBe(true);
    r = await ball({ wicket: { kind: 'bowled' } });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('INVALID_DISMISSAL');
    r = await api('POST', `/api/matches/${matchId}/undo`);
    expect(r.json.state.current).toMatchObject({ runs: 1, freeHit: false });
    const events = (await api('GET', `/api/matches/${matchId}/events`)).json as { id: number; type: string }[];
    const firstBall = events.find((e) => e.type === 'BALL')!;
    const before = (await api('GET', '/api/state')).json.current.runs;
    const preview = await api('POST', `/api/matches/${matchId}/events/${firstBall.id}/preview`, { type: 'BALL', runs: 4 });
    expect(preview.json.state.current.runs).toBe(before + 3);
    expect((await api('GET', '/api/state')).json.current.runs).toBe(before);
    const badPreview = await api('POST', `/api/matches/${matchId}/events/${firstBall.id}/preview`, { type: 'BALL', wicket: { kind: 'bowled', incoming: 'nope' } });
    expect(badPreview.status).toBe(409);
    r = await api('PATCH', `/api/matches/${matchId}/events/${firstBall.id}`, { type: 'BALL', runs: 4 });
    expect(r.json.state.current).toMatchObject({ runs: 4, strikerId: ids.a1 });
    const bad = await api('PATCH', `/api/matches/${matchId}/events/${firstBall.id}`, { type: 'BALL', wicket: { kind: 'bowled', incoming: 'nope' } });
    expect(bad.status).toBe(409);
    expect((await api('GET', '/api/state')).json.current.runs).toBe(4);
  });

  it('exports the scorecard as CSV and JSON', async () => {
    const csv = await api('GET', `/api/matches/${matchId}/export.csv`);
    expect(csv.text).toContain('Batting');
    expect((await api('GET', `/api/matches/${matchId}/export.json`)).json.events.length).toBeGreaterThan(3);
  });
});

describe('vMix data sources', () => {
  it('exposes flat JSON, XML and CSV feeds', async () => {
    const j = await api('GET', '/api/vmix/state.json');
    expect(j.json).toMatchObject({ team_a_short: 'RIV', score: '4/0', striker_name: 'Aarav Menon', bowler_name: 'Liam Carter', status_text: expect.any(String) });
    const x = await api('GET', '/api/vmix/state.xml');
    expect(x.text).toContain('<striker_name>Aarav Menon</striker_name>');
    const c = (await api('GET', '/api/vmix/state.csv')).text.split('\n');
    expect(c[0]).toContain('"striker_name"');
    expect(c[1]).toContain('"Aarav Menon"');
  });
});

describe('overlays and triggers', () => {
  it('a six auto-fires the six overlay, which hides itself and can be shown manually', async () => {
    await ball({ runs: 6 });
    let o = (await api('GET', '/api/overlays')).json.overlays;
    expect(o.six.visible).toBe(true);
    expect(o.six.payload).toMatchObject({ name: 'Aarav Menon' });
    await api('POST', '/api/overlays/six/hide');
    expect((await api('GET', '/api/overlays')).json.overlays.six.visible).toBe(false);
    await api('POST', '/api/overlays/scorebug/show');
    o = (await api('POST', '/api/overlays/lower-third/show', { data: { headline: 'Hello', subhead: 'World' } })).json.overlays;
    expect(o['lower-third']).toMatchObject({ visible: true, payload: { headline: 'Hello' } });
    await api('POST', '/api/overlays/hide-all');
    expect((await api('GET', '/api/overlays')).json.overlays.scorebug.visible).toBe(false);
    expect((await api('POST', '/api/overlays/nope/show')).status).toBe(404);
  });
});

describe('realtime', () => {
  it('websocket: connect, receive state, score a ball, receive the update', async () => {
    const ws = new WebSocket(base.replace('http', 'ws') + `/ws?overlay=scorebug`);
    const messages: any[] = [];
    ws.on('message', (m) => messages.push(JSON.parse(m.toString())));
    await new Promise((r) => ws.on('open', r));
    await new Promise((r) => setTimeout(r, 100));
    const first = messages.find((m) => m.type === 'state');
    expect(first.state.current.runs).toBeGreaterThanOrEqual(0);
    const before = first.state.current.runs;
    await ball({ runs: 2 });
    await new Promise((r) => setTimeout(r, 100));
    const states = messages.filter((m) => m.type === 'state');
    expect(states[states.length - 1].state.current.runs).toBe(before + 2);
    expect(messages.some((m) => m.type === 'clients' && m.byOverlay.scorebug === 1)).toBe(true);
    ws.close();
  });

  it('server-sent events deliver the same state', async () => {
    const data = await new Promise<string>((resolve) => {
      const req = http.get(base + '/events', (res) => {
        res.setEncoding('utf8');
        let buf = '';
        res.on('data', (c) => { buf += c; if (buf.includes('event: state')) { req.destroy(); resolve(buf); } });
      });
    });
    expect(data).toContain('event: state');
    expect(data).toContain('"matchId"');
  });
});

describe('settings', () => {
  it('serves the auto-hide defaults so the UI does not keep its own copy', async () => {
    const r = await api('GET', '/api/settings');
    expect(r.json.autoHideDefaults).toMatchObject({ four: 5000, wicket: 6000, 'over-summary': 7000 });
  });
});

describe('overlay view settings', () => {
  it('keeps theme, position, size and scale between requests and merges partial updates', async () => {
    expect((await api('GET', '/api/settings')).json.view).toEqual({ position: 'bottom', scale: 1, size: '1920x1080', follow: 'active' });
    await api('PUT', '/api/settings', { theme: 'neon', view: { position: 'top' } });
    await api('PUT', '/api/settings', { view: { size: '1280x720', scale: 1.25 } });
    const s = (await api('GET', '/api/settings')).json;
    expect(s.theme).toBe('neon');
    expect(s.view).toEqual({ position: 'top', scale: 1.25, size: '1280x720', follow: 'active' });
    await api('PUT', '/api/settings', { theme: 'classic', view: { position: 'bottom', scale: 1, size: '1920x1080' } });
  });
});

describe('vMix API push', () => {
  it('sends SetText for mapped fields and triggers overlays, and never blocks scoring when vMix is down', async () => {
    const calls: string[] = [];
    const mock = http.createServer((req, res) => { calls.push(req.url ?? ''); res.end('<vmix/>'); });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
    const host = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
    await api('PUT', '/api/settings', {
      vmix: {
        enabled: true, host,
        mappings: [{ input: 'Scorebug', field: 'Score.Text', template: '{batting_team_short} {score}' }, { input: 'Scorebug', field: 'Over.Text', template: 'overs' }],
        events: { six: { input: 'SixGraphic', overlay: 2, action: 'in', durationMs: 5000 } },
      },
    });
    expect((await api('POST', '/api/vmix/test')).json.ok).toBe(true);
    await ball({ runs: 0 });
    await ball({ runs: 6 });
    await new Promise((r) => setTimeout(r, 300));
    const joined = calls.map(decodeURIComponent).join('\n');
    const total = (await api('GET', '/api/state')).json.current.runs;
    expect(joined).toContain(`Function=SetText&Input=Scorebug&SelectedName=Score.Text&Value=RIV ${total}/0`);
    expect(joined).toContain('SelectedName=Over.Text&Value=0.');
    expect(joined).toContain('Function=OverlayInput2In&Input=SixGraphic');
    mock.close();
    const down = await api('PUT', '/api/settings', { vmix: { host: 'http://127.0.0.1:1' } });
    expect(down.status).toBe(200);
    const t0 = Date.now();
    const r = await ball({ runs: 1 });
    expect(r.status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect((await api('POST', '/api/vmix/test')).json.ok).toBe(false);
    await api('PUT', '/api/settings', { vmix: { enabled: false } });
  });
});

describe('catalog and PIN', () => {
  it('creates teams and bulk players, validates, and locks squads of used teams', async () => {
    const t = await api('POST', '/api/teams', { name: 'Test XI', shortName: 'tst', color: '#112233' });
    expect(t.status).toBe(201);
    expect(t.json.shortName).toBe('TST');
    expect((await api('POST', '/api/teams', { name: 'Bad', shortName: 'x', color: 'red' })).status).toBe(400);
    const p = await api('POST', `/api/teams/${t.json.id}/players`, { names: ['One', 'Two', ' ', 'Three'] });
    expect(p.json).toHaveLength(3);
    const del = await api('DELETE', `/api/teams/${(await api('GET', '/api/teams')).json[0].id}`);
    expect(del.status).toBe(409);
  });

  it('adds a guest player mid-match and the roster picks it up', async () => {
    const r = await api('POST', `/api/matches/${matchId}/guest-player`, { side: 'A', name: 'Guest Star' });
    expect(r.json.state.rosters.A.some((p: { name: string }) => p.name === 'Guest Star')).toBe(true);
  });

  it('protects writes with the PIN while reads stay open', async () => {
    await api('PUT', '/api/settings', { pin: '4321' });
    expect((await api('GET', '/api/state')).status).toBe(200);
    expect((await api('POST', '/api/overlays/scorebug/show')).status).toBe(401);
    expect((await api('POST', '/api/overlays/scorebug/show', undefined, { 'x-pin': '4321' })).status).toBe(200);
    expect((await api('POST', '/api/auth', { pin: 'bad' }, { 'x-pin': '4321' })).status).toBe(401);
    const login = await api('POST', '/api/auth', { pin: '4321' });
    expect(login.headers.get('set-cookie')).toContain('crickey_pin=4321');
    expect((await api('GET', '/api/settings')).json.pin).toBe('');
    await api('PUT', '/api/settings', { pin: '' }, { 'x-pin': '4321' });
    expect((await api('POST', '/api/overlays/scorebug/hide')).status).toBe(200);
  });
});

describe('simulator', () => {
  it('plays random balls through the engine and keeps invariants', async () => {
    const m = await api('POST', '/api/matches', { title: 'Sim', venue: '', teamAId: 1, teamBId: 2, overs: 2, playersPerSide: 11, tossWinner: 'A', tossDecision: 'bat' });
    expect(m.status).toBe(201);
    await api('POST', '/api/sim/start', { matchId: m.json.id, balls: 40, speedMs: 50 });
    await new Promise((r) => setTimeout(r, 2500));
    const s = (await api('GET', `/api/state?match=${m.json.id}`)).json;
    expect(s.invariantErrors).toEqual([]);
    expect(s.innings.length).toBeGreaterThanOrEqual(1);
    await api('POST', '/api/sim/stop');
  });
});
