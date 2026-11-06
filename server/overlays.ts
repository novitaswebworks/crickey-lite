import { EventEmitter } from 'node:events';
import { OVERLAY_NAMES, OverlayName, SettingsService, TRANSIENT } from './settings';
import { Store } from './store';

export interface OverlayEntry {
  visible: boolean;
  triggerId: number;
  payload: unknown;
  durationMs: number | null;
  startedAt: number | null;
}

export type OverlayMap = Record<OverlayName, OverlayEntry>;

// Timed event graphics share the scorebug's on-air area, so temporarily duck it.
const SCOREBUG_DUCKS: Partial<Record<OverlayName, OverlayName>> = {
  four: 'scorebug', six: 'scorebug', wicket: 'scorebug',
  'new-batter': 'scorebug', 'over-summary': 'scorebug', milestone: 'scorebug',
  'hockey/goal': 'hockey/scorebug', 'hockey/card': 'hockey/scorebug',
  'hockey/penalty-corner': 'hockey/scorebug', 'hockey/starting11': 'hockey/scorebug',
  'hockey/substitutes': 'hockey/scorebug', 'hockey/scoreboard-banner': 'hockey/scorebug',
};

export interface Trigger {
  id: number;
  overlay: OverlayName;
  matchId: number | null;
  payload: unknown;
  at: number;
  action?: 'show' | 'fire' | 'hide' | 'hide-all';
}

export function isOverlayName(n: string): n is OverlayName {
  return (OVERLAY_NAMES as readonly string[]).includes(n);
}

export class OverlayService extends EventEmitter {
  private map: OverlayMap;
  private timers = new Map<OverlayName, NodeJS.Timeout>();
  private seq = 0;
  private recent: Trigger[];
  private scorebugDucks = new Map<OverlayName, { overlays: Set<OverlayName>; wasVisible: boolean; manuallyOverridden: boolean }>();

  constructor(private store: Store, private settings: SettingsService) {
    super();
    const saved = store.kvGet<Partial<OverlayMap>>('overlays') ?? {};
    this.recent = store.kvGet<Trigger[]>('overlay-history') ?? [];
    this.seq = this.recent.reduce((highest, item) => Math.max(highest, item.id), 0);
    this.map = Object.fromEntries(OVERLAY_NAMES.map((n) => {
      const s = saved[n];
      // Transient overlays never come back on air after a restart.
      return [n, { visible: !!s?.visible && !TRANSIENT.includes(n), triggerId: 0, payload: s?.payload ?? null, durationMs: null, startedAt: null }];
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

  history(limit = 50): Trigger[] {
    return this.recent.slice(0, Math.max(1, Math.min(200, limit)));
  }

  private record(entry: Trigger): void {
    this.recent.unshift(entry);
    this.recent = this.recent.slice(0, 200);
    this.store.kvSet('overlay-history', this.recent);
  }

  private clearTimer(name: OverlayName): void {
    const t = this.timers.get(name);
    if (t) clearTimeout(t);
    this.timers.delete(name);
  }

  /** Puts an overlay on air. Transient ones hide themselves after their duration. */
  show(name: OverlayName, payload?: unknown, matchId: number | null = null, action: 'show' | 'fire' = 'show'): Trigger {
    const entry = this.map[name];
    const at = Date.now();

    const duckTarget = SCOREBUG_DUCKS[name];
    if (duckTarget && !entry.visible) {
      let duck = this.scorebugDucks.get(duckTarget);
      if (!duck) {
        duck = { overlays: new Set(), wasVisible: this.map[duckTarget].visible, manuallyOverridden: false };
        this.scorebugDucks.set(duckTarget, duck);
      }
      duck.overlays.add(name);
      if (this.map[duckTarget].visible) {
        this.map[duckTarget].visible = false;
        this.map[duckTarget].startedAt = null;
        this.clearTimer(duckTarget);
      }
    }
    // An operator can explicitly override the automatic return during a cue.
    if (name === 'scorebug' || name === 'hockey/scorebug') {
      const duck = this.scorebugDucks.get(name);
      if (duck) duck.manuallyOverridden = true;
    }

    const durationMs = TRANSIENT.includes(name) ? this.settings.autoHide(name) : null;
    entry.visible = true;
    entry.triggerId = ++this.seq;
    if (payload !== undefined) entry.payload = payload;
    entry.durationMs = durationMs;
    entry.startedAt = at;
    this.clearTimer(name);
    if (durationMs) this.timers.set(name, setTimeout(() => this.hide(name), durationMs));
    const trigger: Trigger = { id: entry.triggerId, overlay: name, matchId, payload: entry.payload, at, action };
    this.record(trigger);
    this.changed();
    this.emit('trigger', trigger);
    return trigger;
  }

  hide(name: OverlayName): void {
    this.clearTimer(name);
    if (name === 'scorebug' || name === 'hockey/scorebug') {
      const duck = this.scorebugDucks.get(name);
      if (duck) duck.manuallyOverridden = true;
    }
    const wasVisible = this.map[name].visible;
    if (!wasVisible) return;
    this.map[name].visible = false;
    this.map[name].startedAt = null;
    this.record({ id: ++this.seq, overlay: name, matchId: null, payload: null, at: Date.now(), action: 'hide' });

    const duckTarget = SCOREBUG_DUCKS[name];
    if (duckTarget) {
      const duck = this.scorebugDucks.get(duckTarget);
      if (duck) {
        duck.overlays.delete(name);
        if (!duck.overlays.size) {
          if (duck.wasVisible && !duck.manuallyOverridden) {
            const scorebug = this.map[duckTarget];
            scorebug.visible = true;
            scorebug.triggerId = ++this.seq;
            scorebug.durationMs = null;
            scorebug.startedAt = Date.now();
            this.record({ id: scorebug.triggerId, overlay: duckTarget, matchId: null, payload: scorebug.payload, at: scorebug.startedAt, action: 'show' });
          }
          this.scorebugDucks.delete(duckTarget);
        }
      }
    }
    this.changed();
  }

  hideAll(): void {
    this.scorebugDucks.clear();
    for (const n of OVERLAY_NAMES) {
      this.clearTimer(n);
      this.map[n].visible = false;
      this.map[n].startedAt = null;
    }
    this.record({ id: ++this.seq, overlay: 'scorebug', matchId: null, payload: null, at: Date.now(), action: 'hide-all' });
    this.changed();
  }
}
