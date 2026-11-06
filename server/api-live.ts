import { Express } from 'express';
import { z } from 'zod';
import { Context } from './context';
import { EventPayload, LiveState } from './engine';
import { HockeyEventPayload, HockeyState } from './engine/hockey';
import { ApiError } from './matches';
import { eventSchema, hockeyEventSchema } from './schemas';
import { isOverlayName } from './overlays';
import { DEFAULT_AUTO_HIDE, TRANSIENT } from './settings';
import { exportCsv } from './export';
import { MatchRow, PlayerRow } from './types';
import { payloadFor } from './triggers';
import { flatState, toCsv, toXml } from './vmix/feed';

const num = (v: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new ApiError(400, 'BAD_ID', 'Invalid id.');
  return n;
};

export function registerLiveRoutes(app: Express, ctx: Context): void {
  const { matches, overlays, settings, store, vmix, obs, sim } = ctx;

  const stateFor = (q: unknown): LiveState => {
    const id = q !== undefined && q !== '' ? num(String(q)) : matches.activeId();
    if (id === null) throw new ApiError(404, 'NO_ACTIVE_MATCH', 'There is no active match yet.');
    return matches.state(id);
  };

  app.get('/api/state', (req, res) => res.json(stateFor(req.query.match)));

  // ---- scoring -----------------------------------------------------------------------------
  const parseEvent = (matchId: number, body: unknown): EventPayload => {
    const m = store.get<MatchRow>('matches', matchId);
    if (!m) throw new ApiError(404, 'NOT_FOUND', 'Match not found.');
    if ((m.sport ?? 'cricket') === 'hockey') {
      return hockeyEventSchema.parse(body) as unknown as EventPayload;
    }
    return eventSchema.parse(body) as EventPayload;
  };

  app.get('/api/matches/:id/events', (req, res) => res.json(matches.events(num(req.params.id))));
  app.post('/api/matches/:id/events', (req, res) => {
    const id = num(req.params.id);
    const payload = parseEvent(id, req.body);
    res.json({ state: matches.append(id, payload) });
  });
  app.post('/api/matches/:id/undo', (req, res) => res.json({ state: matches.undo(num(req.params.id)) }));
  app.post('/api/matches/:id/events/:eventId/preview', (req, res) => {
    const id = num(req.params.id);
    const payload = parseEvent(id, req.body);
    res.json({ state: matches.previewEdit(id, num(req.params.eventId), payload) });
  });
  app.patch('/api/matches/:id/events/:eventId', (req, res) => {
    const id = num(req.params.id);
    const payload = parseEvent(id, req.body);
    res.json({ state: matches.edit(id, num(req.params.eventId), payload) });
  });

  // Clock control endpoint for hockey
  app.post('/api/matches/:id/hockey/clock', (req, res) => {
    const id = num(req.params.id);
    const m = store.get<MatchRow>('matches', id);
    if (!m) throw new ApiError(404, 'NOT_FOUND', 'Match not found.');
    if ((m.sport ?? 'cricket') !== 'hockey') {
      throw new ApiError(400, 'NOT_HOCKEY', 'Match is not a hockey match.');
    }
    const body = z.object({
      action: z.enum(['start', 'stop', 'adjust']),
      deltaMs: z.number().int().optional(),
    }).parse(req.body);

    const now = Date.now();
    let payload: HockeyEventPayload;
    if (body.action === 'start') {
      payload = { type: 'START_CLOCK', at: now };
    } else if (body.action === 'stop') {
      payload = { type: 'STOP_CLOCK', at: now };
    } else {
      payload = { type: 'ADJUST_CLOCK', deltaMs: body.deltaMs ?? 0, at: now };
    }

    const state = matches.append(id, payload as unknown as EventPayload);
    res.json({ state });
  });

  // Clock tick broadcast: every 500ms, if any hockey match is live and clock is running, broadcast updated state via hub
  let wasHockeyClockRunning = false;
  setInterval(() => {
    const active = matches.activeId();
    if (active === null) return;
    try {
      const m = store.get<MatchRow>('matches', active);
      if (m && (m.sport ?? 'cricket') === 'hockey') {
        const state = matches.state(active) as unknown as HockeyState;
        const isRunning = !!state?.clock?.running;
        if (isRunning || wasHockeyClockRunning) {
          ctx.hub.broadcastState(active, state);
        }
        wasHockeyClockRunning = isRunning;
      }
    } catch {
      // ignore
    }
  }, 500);

  app.post('/api/matches/:id/guest-player', (req, res) => {
    const id = num(req.params.id);
    const body = z.object({ side: z.enum(['A', 'B']), name: z.string().trim().min(1).max(60) }).parse(req.body);
    const cfg = matches.buildConfig(id);
    const teamId = Number(cfg.teams[body.side].id);
    const order = store.list<PlayerRow>('players', teamId).reduce((m, p) => Math.max(m, p.orderIdx), 0) + 1;
    const row = store.insert<PlayerRow>('players', { teamId, name: body.name, shortName: '', shirtNo: '', role: 'Guest', orderIdx: order }, teamId);
    try {
      res.json({ state: matches.append(id, { type: 'ADD_PLAYER', side: body.side, player: { id: String(row.id), name: body.name } }), playerId: String(row.id) });
    } catch (e) {
      store.remove('players', row.id);
      throw e;
    }
  });

  app.post('/api/matches/:id/rename-player', (req, res) => {
    const id = num(req.params.id);
    const body = z.object({ playerId: z.string(), name: z.string().trim().min(1).max(60) }).parse(req.body);
    const state = matches.append(id, { type: 'RENAME_PLAYER', playerId: body.playerId, name: body.name });
    store.update<PlayerRow>('players', Number(body.playerId), { name: body.name });
    res.json({ state });
  });

  app.get('/api/matches/:id/export.json', (req, res) => {
    const id = num(req.params.id);
    res.setHeader('Content-Disposition', `attachment; filename="match-${id}.json"`);
    res.json({ state: matches.state(id), events: matches.events(id) });
  });
  app.get('/api/matches/:id/export.csv', (req, res) => {
    const id = num(req.params.id);
    res.setHeader('Content-Disposition', `attachment; filename="match-${id}-scorecard.csv"`);
    res.type('text/csv').send(exportCsv(matches.state(id)));
  });

  // ---- overlays ----------------------------------------------------------------------------
  const overlayName = (v: string) => {
    if (!isOverlayName(v)) throw new ApiError(404, 'UNKNOWN_OVERLAY', `Unknown overlay "${v}".`);
    return v;
  };
  const dataOf = (body: unknown): Record<string, unknown> | undefined =>
    z.object({ data: z.record(z.string(), z.unknown()).optional() }).parse(body ?? {}).data;

  app.get('/api/overlays', (_req, res) => res.json({ overlays: overlays.snapshot(), clients: ctx.hub.counts() }));
  app.get('/api/overlays/history', (req, res) => {
    const requested = Number(req.query.limit ?? 50);
    const limit = Number.isInteger(requested) ? requested : 50;
    res.json(overlays.history(limit));
  });
  app.post('/api/overlays/hide-all', (_req, res) => {
    overlays.hideAll();
    res.json({ overlays: overlays.snapshot() });
  });
  const putOnAir = (rawName: string, body: unknown, action: 'show' | 'fire' = 'show') => {
    const name = overlayName(rawName);
    const data = dataOf(body);
    const active = matches.activeId();
    const payload = TRANSIENT.includes(name) && active !== null ? payloadFor(name, matches.state(active), data) : data;
    overlays.show(name, payload, active, action);
    return overlays.snapshot();
  };
  app.post('/api/overlays/:name/show', (req, res) => res.json({ overlays: putOnAir(req.params.name, req.body) }));
  app.post('/api/overlays/:name/trigger', (req, res) => res.json({ overlays: putOnAir(req.params.name, req.body, 'fire') }));
  app.post('/api/overlays/:name/hide', (req, res) => {
    overlays.hide(overlayName(req.params.name));
    res.json({ overlays: overlays.snapshot() });
  });

  // Hockey overlay names contain a slash (for example `hockey/goal`). Express' `:name`
  // parameter only captures one path segment, so expose the nested form used by the
  // Broadcast page as well as the legacy single-segment cricket routes above.
  app.post(/^\/api\/overlays\/([^/]+)\/([^/]+)\/(show|trigger|hide)$/, (req, res) => {
    const params = req.params as unknown as Record<number, string>;
    const group = params[0];
    const leaf = params[1];
    const action = params[2];
    const name = overlayName(`${group}/${leaf}`);
    if (action === 'hide') {
      overlays.hide(name);
      return void res.json({ overlays: overlays.snapshot() });
    }
    return void res.json({ overlays: putOnAir(name, req.body, action === 'trigger' ? 'fire' : 'show') });
  });

  app.get('/api/clients', (_req, res) => res.json(ctx.hub.counts()));

  // ---- settings ----------------------------------------------------------------------------
  const masked = () => {
    const s = settings.get();
    return { ...s, autoHideDefaults: DEFAULT_AUTO_HIDE, pin: '', pinSet: !!settings.pin(), obs: { ...s.obs, password: '', passwordSet: !!s.obs.password } };
  };
  app.get('/api/settings', (_req, res) => res.json(masked()));
  app.put('/api/settings', (req, res) => {
    const patch = { ...(req.body as Record<string, unknown>) };
    delete patch.pinSet;
    delete patch.autoHideDefaults;
    if (patch.obs && typeof patch.obs === 'object') {
      const obsPatch = { ...(patch.obs as Record<string, unknown>) };
      delete obsPatch.passwordSet;
      patch.obs = obsPatch;
    }
    settings.update(patch);
    vmix.reset();
    const active = matches.activeId();
    if (active !== null) vmix.onState(matches.state(active));
    res.json(masked());
  });

  // ---- vMix data sources and integration ---------------------------------------------------
  const flat = (req: { query: { match?: unknown } }) => flatState(stateFor(req.query.match));
  app.get('/api/vmix/state.json', (req, res) => res.json(flat(req)));
  app.get('/api/vmix/state.xml', (req, res) => res.type('application/xml').send(toXml(flat(req))));
  app.get('/api/vmix/state.csv', (req, res) => res.type('text/csv').send(toCsv(flat(req))));
  app.get('/api/vmix/status', (_req, res) => res.json(vmix.getStatus()));
  app.get('/api/vmix/log', (_req, res) => res.json(vmix.getLog()));
  app.post('/api/vmix/test', async (_req, res) => res.json(await vmix.testConnection()));
  app.post('/api/vmix/resend', (_req, res) => {
    vmix.reset();
    const active = matches.activeId();
    if (active !== null) vmix.onState(matches.state(active));
    res.json({ ok: true });
  });

  // ---- OBS ---------------------------------------------------------------------------------
  app.post('/api/obs/test', async (_req, res) => res.json(await obs.test()));
  app.get('/api/obs/scenes', async (_req, res) => {
    try {
      res.json(await obs.scenes());
    } catch (e) {
      throw new ApiError(502, 'OBS_UNREACHABLE', (e as Error).message);
    }
  });

  // ---- simulation --------------------------------------------------------------------------
  app.get('/api/sim', (_req, res) => res.json(sim.status()));
  app.post('/api/sim/start', (req, res) => {
    const b = z.object({ matchId: z.number().int(), balls: z.number().int().min(1).max(2000).default(60), speedMs: z.number().int().min(50).max(5000).default(800) }).parse(req.body);
    matches.state(b.matchId);
    sim.start(b.matchId, b.balls, b.speedMs);
    res.json(sim.status());
  });
  app.post('/api/sim/stop', (_req, res) => {
    sim.stop();
    res.json(sim.status());
  });
}
