import { EventEmitter } from 'node:events';
import { OVERLAY_NAMES, OverlayName, SettingsService, TRANSIENT } from './settings';
import { Store } from './store';

export interface OverlayEntry {
  visible: boolean;
  triggerId: number;
  payload: unknown;
  durationMs: number | null;
}

export type OverlayMap = Record<OverlayName, OverlayEntry>;

export interface Trigger {
  id: number;
  overlay: OverlayName;
  matchId: number | null;
  payload: unknown;
  at: number;
}

export function isOverlayName(n: string): n is OverlayName {
  return (OVERLAY_NAMES as readonly string[]).includes(n);
}

export class OverlayService extends EventEmitter {
  private map: OverlayMap;
  private timers = new Map<OverlayName, NodeJS.Timeout>();
  private seq = 0;

  constructor(private store: Store, private settings: SettingsService) {
    super();
    const saved = store.kvGet<Partial<OverlayMap>>('overlays') ?? {};
    this.map = Object.fromEntries(OVERLAY_NAMES.map((n) => {
      const s = saved[n];
      // Transient overlays never come back on air after a restart.
      return [n, { visible: !!s?.visible && !TRANSIENT.includes(n), triggerId: 0, payload: s?.payload ?? null, durationMs: null }];
    })) as OverlayMap;
  }

  snapshot(): OverlayMap {
    return this.map;
  }

  private persist(): void {
    this.store.kvSet('overlays', this.map);
  }

  private changed(): void {
    this.persist();
    this.emit('overlay', this.map);
  }

  private clearTimer(name: OverlayName): void {
    const t = this.timers.get(name);
    if (t) clearTimeout(t);
    this.timers.delete(name);
  }

  /** Puts an overlay on air. Transient ones hide themselves after their duration. */
  show(name: OverlayName, payload?: unknown, matchId: number | null = null): Trigger {
    const entry = this.map[name];
    const durationMs = TRANSIENT.includes(name) ? this.settings.autoHide(name) : null;
    entry.visible = true;
    entry.triggerId = ++this.seq;
    if (payload !== undefined) entry.payload = payload;
    entry.durationMs = durationMs;
    this.clearTimer(name);
    if (durationMs) this.timers.set(name, setTimeout(() => this.hide(name), durationMs));
    const trigger: Trigger = { id: entry.triggerId, overlay: name, matchId, payload: entry.payload, at: Date.now() };
    this.changed();
    this.emit('trigger', trigger);
    return trigger;
  }

  hide(name: OverlayName): void {
    this.clearTimer(name);
    if (!this.map[name].visible) return;
    this.map[name].visible = false;
    this.changed();
  }

  hideAll(): void {
    for (const n of OVERLAY_NAMES) {
      this.clearTimer(n);
      this.map[n].visible = false;
    }
    this.changed();
  }
}
