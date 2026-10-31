import { LiveState } from '../engine';
import { Settings } from '../settings';
import { flatState, renderTemplate } from './feed';

export interface VmixStatus {
  enabled: boolean;
  state: 'disabled' | 'ok' | 'error' | 'idle';
  lastError: string | null;
  lastOkAt: string | null;
  pending: number;
}

export interface VmixLogEntry {
  at: string;
  url: string;
  ok: boolean;
  note: string;
}

type Cfg = () => Settings['vmix'];

/**
 * Pushes mapped title text and overlay triggers to the vMix HTTP API. Everything is asynchronous
 * and best effort: scoring never waits for vMix and a failure only schedules a retry.
 */
export class VmixPusher {
  private lastSent = new Map<string, string>();
  private latest = new Map<string, { input: string; field: string; value: string }>();
  private busy = false;
  private retryMs = 1000;
  private retryTimer: NodeJS.Timeout | null = null;
  private status: VmixStatus = { enabled: false, state: 'disabled', lastError: null, lastOkAt: null, pending: 0 };
  private entries: VmixLogEntry[] = [];

  constructor(private cfg: Cfg) {}

  getStatus(): VmixStatus {
    const c = this.cfg();
    return { ...this.status, enabled: c.enabled, state: c.enabled ? (this.status.state === 'disabled' ? 'idle' : this.status.state) : 'disabled', pending: this.latest.size };
  }

  getLog(): VmixLogEntry[] {
    return this.entries;
  }

  private note(url: string, ok: boolean, note: string): void {
    this.entries.push({ at: new Date().toISOString(), url, ok, note });
    if (this.entries.length > 200) this.entries.shift();
  }

  private api(path: string): string {
    return `${this.cfg().host.replace(/\/+$/, '')}/api/?${path}`;
  }

  private async call(url: string): Promise<boolean> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      this.note(url, res.ok, `HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.status = { ...this.status, state: 'ok', lastError: null, lastOkAt: new Date().toISOString() };
      return true;
    } catch (e) {
      const msg = (e as Error).message;
      this.note(url, false, msg);
      this.status = { ...this.status, state: 'error', lastError: msg };
      return false;
    }
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const ok = await this.call(`${this.cfg().host.replace(/\/+$/, '')}/api`);
    return { ok, message: ok ? 'Connected to vMix.' : this.status.lastError ?? 'Could not reach vMix.' };
  }

  /** Called after every state change; only changed values are sent. */
  onState(state: LiveState | null): void {
    const c = this.cfg();
    if (!c.enabled) return;
    const flat = flatState(state);
    for (const m of c.mappings) {
      if (!m.input || !m.field) continue;
      const value = renderTemplate(m.template, flat);
      const key = `${m.input}|${m.field}`;
      if (this.lastSent.get(key) === value && !this.latest.has(key)) continue;
      this.latest.set(key, { input: m.input, field: m.field, value });
    }
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.latest.size) {
        const [key, item] = this.latest.entries().next().value as [string, { input: string; field: string; value: string }];
        if (this.lastSent.get(key) === item.value) { this.latest.delete(key); continue; }
        const url = this.api(`Function=SetText&Input=${encodeURIComponent(item.input)}&SelectedName=${encodeURIComponent(item.field)}&Value=${encodeURIComponent(item.value)}`);
        const ok = await this.call(url);
        if (!ok) { this.scheduleRetry(); return; }
        this.lastSent.set(key, item.value);
        if (this.latest.get(key) === item) this.latest.delete(key);
        this.retryMs = 1000;
      }
    } finally {
      this.busy = false;
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.flush(); }, this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 30000);
  }

  /** Fires the vMix overlay mapped to a broadcast event (four / six / wicket). */
  fire(event: 'four' | 'six' | 'wicket'): void {
    const c = this.cfg();
    const m = c.events[event];
    if (!c.enabled || m.action === 'off' || !m.input) return;
    const base = `Input=${encodeURIComponent(m.input)}`;
    const fn = (suffix: string) => this.api(`Function=OverlayInput${m.overlay}${suffix}&${base}`);
    if (m.action === 'toggle') void this.call(fn(''));
    else if (m.action === 'in') void this.call(fn('In'));
    else {
      void this.call(fn('In'));
      setTimeout(() => void this.call(fn('Out')), m.durationMs);
    }
  }

  reset(): void {
    this.lastSent.clear();
  }
}
