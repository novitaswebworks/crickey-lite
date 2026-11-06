import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { Express } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { Context } from './context';
import { ApiError } from './matches';
import { UPLOAD_DIR } from './paths';
import { OVERLAY_NAMES } from './settings';
import { matchSchema, playerSchema, teamSchema } from './schemas';
import { Doc } from './store';
import { MatchRow, PlayerRow, TeamRow } from './types';

const num = (v: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new ApiError(400, 'BAD_ID', 'Invalid id.');
  return n;
};

export function lanUrls(port: number): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}`);
  }
  return out;
}

const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };

export function registerCatalogRoutes(app: Express, ctx: Context): void {
  const { store, matches } = ctx;

  const refreshMatches = () => {
    matches.invalidate();
    const active = matches.activeId();
    if (active) matches.reload(active);
  };
  const team = (id: number): Doc<TeamRow> => {
    const t = store.get<TeamRow>('teams', id);
    if (!t) throw new ApiError(404, 'NOT_FOUND', 'Team not found.');
    return t;
  };
  const teamInUse = (id: number) => store.list<MatchRow>('matches').some((m) => m.teamAId === id || m.teamBId === id);
  const teamSport = (t: Doc<TeamRow>): 'cricket' | 'hockey' => {
    if (t.sport) return t.sport;
    const usedBy = store.list<MatchRow>('matches')
      .filter((m) => m.teamAId === t.id || m.teamBId === t.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (usedBy[0]?.sport) return usedBy[0].sport;
    const roles = store.list<PlayerRow>('players', t.id).map((p) => p.role.toLowerCase());
    if (roles.some((r) => /goalkeeper|goalie|\bgk\b|defender|\bdef\b|midfielder|\bmid\b|forward|\bfwd\b/.test(r))) return 'hockey';
    return 'cricket';
  };

  app.get('/api/health', (_req, res) => res.json({ ok: true, storage: store.kind }));

  app.get('/api/info', (req, res) => {
    const port = req.socket.localPort ?? 3000;
    res.json({
      port, lanUrls: lanUrls(port), storage: store.kind, overlays: OVERLAY_NAMES,
      publicBaseUrl: ctx.settings.get().publicBaseUrl, pinRequired: !!ctx.settings.pin(), activeMatchId: matches.activeId(),
    });
  });

  app.get('/api/qr.svg', async (req, res) => {
    const text = String(req.query.text ?? '');
    if (!text || text.length > 400) throw new ApiError(400, 'BAD_QR', 'Give a short text to encode.');
    res.type('image/svg+xml').send(await QRCode.toString(text, { type: 'svg', margin: 1 }));
  });

  // ---- teams -------------------------------------------------------------------------------
  app.get('/api/teams', (req, res) => {
    const requestedSport = req.query.sport === 'hockey' ? 'hockey' : req.query.sport === 'cricket' ? 'cricket' : null;
    const rows = store.list<TeamRow>('teams').map((t) => ({ ...t, sport: teamSport(t), playerCount: store.list('players', t.id).length }));
    res.json(requestedSport ? rows.filter((t) => t.sport === requestedSport) : rows);
  });
  app.post('/api/teams', (req, res) => {
    const t = teamSchema.parse(req.body);
    res.status(201).json(store.insert<TeamRow>('teams', { ...t, logoPath: null }));
  });
  app.put('/api/teams/:id', (req, res) => {
    const id = num(req.params.id);
    team(id);
    const out = store.update<TeamRow>('teams', id, teamSchema.parse(req.body));
    refreshMatches();
    res.json(out);
  });
  app.delete('/api/teams/:id', (req, res) => {
    const id = num(req.params.id);
    team(id);
    if (teamInUse(id)) throw new ApiError(409, 'TEAM_IN_USE', 'This team is used in a match. Delete those matches first.');
    store.removeByParent('players', id);
    store.remove('teams', id);
    res.json({ ok: true });
  });
  app.post('/api/teams/:id/logo', express.raw({ type: 'image/*', limit: '4mb' }), (req, res) => {
    const id = num(req.params.id);
    const t = team(id);
    const ext = IMAGE_EXT[String(req.headers['content-type']).split(';')[0]];
    if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) throw new ApiError(400, 'BAD_IMAGE', 'Upload a PNG, JPEG, WebP, GIF or SVG image.');
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const name = `team-${id}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), req.body);
    if (t.logoPath) fs.rmSync(path.join(UPLOAD_DIR, path.basename(t.logoPath)), { force: true });
    const out = store.update<TeamRow>('teams', id, { logoPath: `/uploads/${name}` });
    refreshMatches();
    res.json(out);
  });
  app.delete('/api/teams/:id/logo', (req, res) => {
    const id = num(req.params.id);
    const t = team(id);
    if (t.logoPath) fs.rmSync(path.join(UPLOAD_DIR, path.basename(t.logoPath)), { force: true });
    const out = store.update<TeamRow>('teams', id, { logoPath: null });
    refreshMatches();
    res.json(out);
  });

  // ---- players -----------------------------------------------------------------------------
  const squad = (teamId: number) => store.list<PlayerRow>('players', teamId).sort((a, b) => a.orderIdx - b.orderIdx || a.id - b.id);
  app.get('/api/teams/:id/players', (req, res) => {
    const id = num(req.params.id);
    team(id);
    res.json(squad(id));
  });
  app.post('/api/teams/:id/players', (req, res) => {
    const id = num(req.params.id);
    team(id);
    const body = req.body as { names?: unknown };
    const inputs = Array.isArray(body.names)
      ? z.array(z.string()).max(60).parse(body.names).map((n) => n.trim()).filter(Boolean).map((name) => playerSchema.parse({ name }))
      : [playerSchema.parse(req.body)];
    if (!inputs.length) throw new ApiError(400, 'VALIDATION', 'Enter at least one player name.');
    let order = squad(id).reduce((m, p) => Math.max(m, p.orderIdx), 0);
    const created = inputs.map((p) => store.insert<PlayerRow>('players', { ...p, teamId: id, orderIdx: ++order }, id));
    res.status(201).json(created);
  });
  app.put('/api/teams/:id/players/order', (req, res) => {
    const id = num(req.params.id);
    const ids = z.array(z.number().int()).parse((req.body as { ids?: unknown }).ids);
    ids.forEach((pid, i) => store.update<PlayerRow>('players', pid, { orderIdx: i + 1 }));
    refreshMatches();
    res.json(squad(id));
  });
  app.put('/api/players/:id', (req, res) => {
    const id = num(req.params.id);
    if (!store.get('players', id)) throw new ApiError(404, 'NOT_FOUND', 'Player not found.');
    const out = store.update<PlayerRow>('players', id, playerSchema.parse(req.body));
    refreshMatches();
    res.json(out);
  });
  app.delete('/api/players/:id', (req, res) => {
    const id = num(req.params.id);
    const p = store.get<PlayerRow>('players', id);
    if (!p) throw new ApiError(404, 'NOT_FOUND', 'Player not found.');
    if (teamInUse(p.teamId)) throw new ApiError(409, 'TEAM_IN_USE', 'This team already has matches, so its squad is locked. Rename the player instead.');
    store.remove('players', id);
    res.json({ ok: true });
  });
  app.post('/api/players/:id/photo', express.raw({ type: 'image/*', limit: '4mb' }), (req, res) => {
    const id = num(req.params.id);
    const p = store.get<PlayerRow>('players', id);
    if (!p) throw new ApiError(404, 'NOT_FOUND', 'Player not found.');
    const ext = IMAGE_EXT[String(req.headers['content-type']).split(';')[0]];
    if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) throw new ApiError(400, 'BAD_IMAGE', 'Upload a PNG, JPEG, WebP, GIF or SVG image.');
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const name = `player-${id}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), req.body);
    if (p.photoPath) fs.rmSync(path.join(UPLOAD_DIR, path.basename(p.photoPath)), { force: true });
    const out = store.update<PlayerRow>('players', id, { photoPath: `/uploads/${name}` });
    refreshMatches();
    res.json(out);
  });
  app.delete('/api/players/:id/photo', (req, res) => {
    const id = num(req.params.id);
    const p = store.get<PlayerRow>('players', id);
    if (!p) throw new ApiError(404, 'NOT_FOUND', 'Player not found.');
    if (p.photoPath) fs.rmSync(path.join(UPLOAD_DIR, path.basename(p.photoPath)), { force: true });
    const out = store.update<PlayerRow>('players', id, { photoPath: null });
    refreshMatches();
    res.json(out);
  });

  // ---- matches -----------------------------------------------------------------------------
  app.get('/api/matches', (_req, res) => res.json(matches.list()));
  app.post('/api/matches', (req, res) => {
    const row = matches.create(matchSchema.parse(req.body));
    res.status(201).json({ ...row, state: matches.state(row.id) });
  });
  app.get('/api/matches/:id', (req, res) => {
    const id = num(req.params.id);
    const row = store.get<MatchRow>('matches', id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Match not found.');
    res.json({ ...row, state: matches.state(id), active: matches.activeId() === id });
  });
  app.put('/api/matches/:id', (req, res) => {
    const id = num(req.params.id);
    const row = matches.update(id, matchSchema.parse(req.body));
    res.json({ ...row, state: matches.state(id) });
  });
  app.delete('/api/matches/:id', (req, res) => {
    const id = num(req.params.id);
    if (store.list<{ matchId: number }>('ops-schedules').some((s) => s.matchId === id)) throw new ApiError(409, 'MATCH_SCHEDULED', 'Remove this match from Broadcast Operations before deleting it.');
    matches.remove(id);
    res.json({ ok: true });
  });
  app.post('/api/matches/:id/activate', (req, res) => {
    matches.setActive(num(req.params.id));
    res.json({ ok: true, activeMatchId: matches.activeId() });
  });
}
