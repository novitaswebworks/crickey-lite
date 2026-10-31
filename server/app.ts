import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { NextFunction, Request, Response } from 'express';
import { WebSocketServer } from 'ws';
import { ZodError } from 'zod';
import { registerCatalogRoutes } from './api-catalog';
import { registerLiveRoutes } from './api-live';
import { Context } from './context';
import { sseClient, wsClient } from './hub';
import { log } from './logger';
import { ApiError } from './matches';
import { OVERLAY_DIR, UPLOAD_DIR, WEB_DIST } from './paths';

const eq = (a: string, b: string) => {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
};

function cookie(req: Request, name: string): string | undefined {
  const m = (req.headers.cookie ?? '').split(';').map((s) => s.trim().split('=')).find(([k]) => k === name);
  return m ? decodeURIComponent(m.slice(1).join('=')) : undefined;
}

function matchParam(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

export function createApp(ctx: Context): { app: express.Express; server: http.Server; close: () => void } {
  const app = express();
  app.disable('x-powered-by');

  // Read endpoints are open to any origin so vMix / OBS browser sources and data sources can load them.
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'x-pin, content-type');
    }
    if (req.method === 'OPTIONS') return void res.sendStatus(204);
    next();
  });

  app.use('/api', express.json({ limit: '1mb' }));

  // Optional shared PIN: writes need it, reads (overlays, data feeds) never do.
  app.use('/api', (req, res, next) => {
    const pin = ctx.settings.pin();
    if (!pin || req.method === 'GET' || req.method === 'HEAD' || req.path === '/auth') return next();
    const given = req.get('x-pin') ?? cookie(req, 'crickey_pin') ?? '';
    if (eq(given, pin)) return next();
    res.status(401).json({ error: 'The operator PIN is required.', code: 'PIN_REQUIRED' });
  });

  app.post('/api/auth', (req, res) => {
    const pin = ctx.settings.pin();
    const given = String((req.body as { pin?: unknown })?.pin ?? '');
    if (pin && !eq(given, pin)) return void res.status(401).json({ error: 'Wrong PIN.', code: 'PIN_WRONG' });
    res.setHeader('Set-Cookie', `crickey_pin=${encodeURIComponent(given)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    res.json({ ok: true });
  });
  app.get('/api/auth', (req, res) => {
    const pin = ctx.settings.pin();
    const given = req.get('x-pin') ?? cookie(req, 'crickey_pin') ?? '';
    res.json({ pinRequired: !!pin, authorised: !pin || eq(given, pin) });
  });

  registerCatalogRoutes(app, ctx);
  registerLiveRoutes(app, ctx);

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1h' }));
  app.use('/overlays', express.static(OVERLAY_DIR, { maxAge: 0, etag: true }));
  if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    app.use(express.static(WEB_DIST));
  } else {
    app.get('/', (_req, res) => res.type('text').send('Operator UI is not built yet. Run "npm run build" (or "npm run dev").'));
  }

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route.', code: 'NOT_FOUND' }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const where = first.path.length ? `${first.path.join('.')}: ` : '';
      return void res.status(400).json({ error: `${where}${first.message}`, code: 'VALIDATION', issues: err.issues });
    }
    if (err instanceof ApiError) return void res.status(err.status).json({ error: err.message, code: err.code });
    if ((err as { type?: string }).type === 'entity.parse.failed') return void res.status(400).json({ error: 'Malformed JSON body.', code: 'BAD_JSON' });
    log.error('Unhandled error', err);
    res.status(500).json({ error: 'Something went wrong on the server.', code: 'INTERNAL' });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') return void socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      const client = wsClient(ws, matchParam(url.searchParams.get('match')), url.searchParams.get('overlay'));
      ctx.hub.add(client);
      ctx.hub.sendState(client);
      ctx.hub.broadcast({ type: 'overlay', overlays: ctx.overlays.snapshot() });
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as { type?: string; overlay?: string; match?: unknown };
          if (msg.type === 'hello') ctx.hub.hello(client, msg.overlay ?? null, matchParam(msg.match));
        } catch {
          /* ignore malformed client messages */
        }
      });
      ws.on('close', () => ctx.hub.remove(client));
      ws.on('error', () => ctx.hub.remove(client));
    });
  });

  app.get('/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    const client = sseClient(res, matchParam(req.query.match), typeof req.query.overlay === 'string' ? req.query.overlay : null);
    ctx.hub.add(client);
    ctx.hub.sendState(client);
    client.send({ type: 'overlay', overlays: ctx.overlays.snapshot() });
    req.on('close', () => ctx.hub.remove(client));
  });

  const pinger = setInterval(() => ctx.hub.ping(), 15000);
  pinger.unref();
  return { app, server, close: () => { clearInterval(pinger); wss.close(); server.close(); } };
}
