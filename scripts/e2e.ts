/**
 * End-to-end pass: boots the real server on a temp data folder, seeds the demo match, drives it through the API,
 * loads every overlay and operator page in headless Chromium at 1920x1080 and 1280x720 and saves screenshots to
 * data/screenshots. Exits non-zero if anything throws, any overlay logs a page error, or invariants break.
 */
import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, Page } from 'playwright-core';

const PORT = Number(process.env.E2E_PORT ?? 3917);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve('data/screenshots');
const OVERLAYS = ['scorebug', 'batters', 'bowler', 'partnership', 'four', 'six', 'wicket', 'new-batter', 'over-summary', 'target', 'scorecard', 'versus', 'result', 'lower-third', 'milestone'];

const api = async (method: string, url: string, body?: unknown) => {
  const res = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function startServer(dataDir: string): Promise<ChildProcess> {
  const child = spawn('npx', ['tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT), CRICKEY_DATA: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr?.on('data', (d) => process.stderr.write(d));
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) return child; } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('server did not start');
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crickey-e2e-'));
  let server = await startServer(dataDir);
  const errors: string[] = [];
  const browser = await chromium.launch();
  try {
    // Seed through the real seed script.
    await new Promise<void>((resolve, reject) => {
      const p = spawn('npx', ['tsx', 'server/seed.ts'], { env: { ...process.env, CRICKEY_DATA: dataDir }, stdio: 'inherit' });
      p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('seed failed'))));
    });
    server.kill();
    await sleep(300);
    server = await startServer(dataDir);

    const info = await api('GET', '/api/info');
    const matchId = info.activeMatchId as number;
    console.log('active match', matchId);
    await api('PUT', '/api/settings', { autoHideMs: { four: 30000, six: 30000, wicket: 30000, milestone: 30000, 'over-summary': 30000, 'new-batter': 30000 } });

    const ev = async (p: object) => (await api('POST', `/api/matches/${matchId}/events`, p)).state;
    let s = await ev({ type: 'START_INNINGS' });
    await ev({ type: 'SET_BATTERS', striker: s.rosters.A[0].id, nonStriker: s.rosters.A[1].id });
    s = await ev({ type: 'SET_BOWLER', bowler: s.rosters.B[0].id });
    const B = s.rosters.B.map((p: { id: string }) => p.id);
    const A = s.rosters.A.map((p: { id: string }) => p.id);
    // Over 1: runs, a wide, a no-ball + free hit, a bye, a four, a six.
    for (const b of [{ runs: 1 }, { extra: 'wide' }, { runs: 0 }, { extra: 'noball', runs: 0 }, { runs: 6 }, { extra: 'bye', runs: 1 }, { runs: 4 }, { runs: 2 }]) s = await ev({ type: 'BALL', ...b });
    s = await ev({ type: 'SET_BOWLER', bowler: B[1] });
    for (const b of [{ runs: 0 }, { runs: 1 }, { runs: 3 }]) s = await ev({ type: 'BALL', ...b });
    s = await ev({ type: 'BALL', wicket: { kind: 'caught', fielder: B[4], incoming: A[2] } });
    for (const b of [{ runs: 1 }, { runs: 1 }]) s = await ev({ type: 'BALL', ...b });
    console.log('score after demo balls', s.current.runs + '/' + s.current.wickets, s.current.overs);
    for (const n of ['scorebug', 'batters', 'bowler', 'partnership', 'target', 'scorecard', 'versus', 'result', 'lower-third']) {
      await api('POST', `/api/overlays/${n}/show`, n === 'lower-third' ? { data: { headline: 'Aarav Menon reaches 50', subhead: 'Riverside Rockets · 38 balls' } } : {});
    }
    const TRANSIENT = ['wicket', 'six', 'four', 'new-batter', 'over-summary', 'milestone'];
    const trigger = (n: string) => api('POST', `/api/overlays/${n}/trigger`, n === 'new-batter' ? { data: { note: '2,310 T20 runs · Avg 31.4' } } : {});

    for (const [w, h] of [[1920, 1080], [1280, 720]] as const) {
      for (const theme of ['classic', 'neon', 'minimal']) {
        for (const name of OVERLAYS) {
          const ctx = await browser.newContext({ viewport: { width: w, height: h } });
          const page = await ctx.newPage();
          page.on('pageerror', (e) => errors.push(`${name}@${w}: ${e.message}`));
          page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}@${w} console: ${m.text()}`); });
          await page.goto(`${BASE}/overlays/${name}.html?theme=${theme}&debug=${theme === 'classic' ? 1 : 0}`);
          await page.waitForTimeout(500);
          if (TRANSIENT.includes(name)) await trigger(name);
          await page.waitForTimeout(900);
          if (theme !== 'classic' && w === 1280) { await ctx.close(); continue; }
          await page.screenshot({ path: path.join(OUT, `overlay-${name}-${theme}-${w}.png`) });
          await ctx.close();
        }
      }
    }
    console.log('overlay screenshots saved');

    // Strike rotation must never move a name between slots.
    {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page: Page = await ctx.newPage();
      await page.goto(`${BASE}/overlays/scorebug.html?debug=1`);
      await page.waitForTimeout(800);
      const names = () => page.$$eval('#bat0 .nm, #bat1 .nm', (els) => els.map((e) => e.textContent));
      await ev({ type: 'SET_BOWLER', bowler: B[2] });
      await page.waitForTimeout(500);
      const before = await names();
      await ev({ type: 'BALL', runs: 1 });
      await page.waitForTimeout(500);
      const after = await names();
      if (JSON.stringify(before) !== JSON.stringify(after)) errors.push(`batter slots moved on strike change: ${before} -> ${after}`);
      await ev({ type: 'BALL', runs: 1 });
      await ctx.close();
    }

    // Quick repeated keyboard presses must all register (no click-style debounce on hotkeys).
    {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page: Page = await ctx.newPage();
      const timeline = async () => ((await api('GET', '/api/state')).current.timeline as unknown[]).length;
      await page.goto(`${BASE}/`);
      await page.waitForTimeout(800);
      const start = await timeline();
      await page.keyboard.press('0');
      await page.keyboard.press('0');
      await page.waitForTimeout(500);
      if ((await timeline()) !== start + 2) errors.push(`two quick "0" presses scored ${(await timeline()) - start} balls`);
      await page.keyboard.press('u');
      await page.keyboard.press('u');
      await page.waitForTimeout(500);
      if ((await timeline()) !== start) errors.push('two quick "u" presses did not undo both balls');
      await ctx.close();
    }

    // Overlays must recover after a server restart.
    {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/overlays/scorebug.html?debug=1`);
      await page.waitForTimeout(800);
      server.kill();
      await sleep(2500);
      await page.screenshot({ path: path.join(OUT, 'overlay-scorebug-disconnected.png') });
      server = await startServer(dataDir);
      await page.waitForTimeout(6000);
      const text = await page.textContent('#dbg');
      if (!text?.includes('connected via')) errors.push(`overlay did not reconnect: ${text}`);
      await page.screenshot({ path: path.join(OUT, 'overlay-scorebug-reconnected.png') });
      await ctx.close();
    }

    // Preview page and operator pages.
    for (const [w, h] of [[1920, 1080]] as const) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`ui: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`ui console: ${m.text()}`); });
      await page.goto(`${BASE}/overlays/preview.html`);
      await page.waitForTimeout(2500);
      await page.screenshot({ path: path.join(OUT, 'preview.png'), fullPage: true });
      for (const p of ['live', 'teams', 'setup', 'broadcast', 'history', 'settings']) {
        await page.goto(`${BASE}/#/${p}`);
        await page.reload();
        await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(OUT, `ui-${p}.png`), fullPage: p !== 'live' });
      }
      await ctx.close();
    }

    const final = await api('GET', `/api/state?match=${matchId}`);
    if (final.invariantErrors.length) errors.push(`invariants: ${final.invariantErrors.join('; ')}`);
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  if (errors.length) {
    console.error('E2E FAILURES:\n' + [...new Set(errors)].join('\n'));
    process.exit(1);
  }
  console.log('E2E passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
