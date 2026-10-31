import crypto from 'node:crypto';
import WebSocket from 'ws';
import { log } from '../logger';
import { Settings } from '../settings';

type Cfg = () => Settings['obs'];

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('base64');

/** Minimal obs-websocket v5 client: connect on demand, identify, run requests, close. */
async function withObs<T>(cfg: Settings['obs'], fn: (request: (type: string, data?: object) => Promise<Record<string, unknown>>) => Promise<T>): Promise<T> {
  const ws = new WebSocket(`ws://${cfg.host}:${cfg.port}`);
  const pending = new Map<string, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out connecting to OBS')), 4000);
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    ws.on('close', () => { clearTimeout(timer); reject(new Error('OBS closed the connection')); });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as { op: number; d: Record<string, unknown> };
      if (msg.op === 0) {
        const auth = msg.d.authentication as { challenge: string; salt: string } | undefined;
        const d: Record<string, unknown> = { rpcVersion: 1 };
        if (auth) d.authentication = sha256(sha256(cfg.password + auth.salt) + auth.challenge);
        ws.send(JSON.stringify({ op: 1, d }));
      } else if (msg.op === 2) {
        clearTimeout(timer);
        resolve();
      } else if (msg.op === 7) {
        const id = msg.d.requestId as string;
        const p = pending.get(id);
        pending.delete(id);
        const status = msg.d.requestStatus as { result: boolean; comment?: string };
        if (status.result) p?.resolve((msg.d.responseData as Record<string, unknown>) ?? {});
        else p?.reject(new Error(status.comment ?? 'OBS request failed'));
      }
    });
  });
  try {
    await ready;
    const request = (type: string, data: object = {}) => new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = crypto.randomUUID();
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ op: 6, d: { requestType: type, requestId: id, requestData: data } }));
    });
    return await fn(request);
  } finally {
    ws.removeAllListeners();
    ws.on('error', () => undefined);
    ws.close();
  }
}

export class ObsController {
  constructor(private cfg: Cfg) {}

  async test(): Promise<{ ok: boolean; message: string; version?: string }> {
    try {
      return await withObs(this.cfg(), async (req) => {
        const v = await req('GetVersion');
        return { ok: true, message: 'Connected to OBS.', version: String(v.obsVersion ?? '') };
      });
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async scenes(): Promise<{ scenes: string[]; current: string }> {
    return withObs(this.cfg(), async (req) => {
      const r = await req('GetSceneList');
      const scenes = ((r.scenes as { sceneName: string }[]) ?? []).map((s) => s.sceneName).reverse();
      return { scenes, current: String(r.currentProgramSceneName ?? '') };
    });
  }

  /** Switches to the rule's scene for N seconds, then returns. Never throws. */
  fire(event: 'wicket' | 'four' | 'six'): void {
    const c = this.cfg();
    if (!c.enabled) return;
    for (const rule of c.rules.filter((r) => r.event === event && r.scene)) {
      withObs(c, async (req) => {
        const before = String((await req('GetCurrentProgramScene')).currentProgramSceneName ?? '');
        await req('SetCurrentProgramScene', { sceneName: rule.scene });
        await new Promise((r) => setTimeout(r, rule.seconds * 1000));
        if (before) await req('SetCurrentProgramScene', { sceneName: before });
      }).catch((e: Error) => log.warn('[obs]', e.message));
    }
  }
}
