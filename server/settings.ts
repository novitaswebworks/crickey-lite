import { z } from 'zod';
import { Store } from './store';

export const CRICKET_OVERLAY_NAMES = [
  'scorebug', 'batters', 'bowler', 'partnership', 'four', 'six', 'wicket', 'new-batter', 'over-summary',
  'target', 'scorecard', 'versus', 'result', 'lower-third', 'milestone',
] as const;

export const HOCKEY_OVERLAY_NAMES = [
  'hockey/scorebug', 'hockey/goal', 'hockey/card', 'hockey/penalty-corner', 'hockey/shootout',
] as const;

/** All overlays across both sports. */
export const OVERLAY_NAMES = [...CRICKET_OVERLAY_NAMES, ...HOCKEY_OVERLAY_NAMES] as const;
export type OverlayName = (typeof OVERLAY_NAMES)[number];

/** Cricket overlays that fire on a ball event and hide themselves after a timer. */
const CRICKET_TRANSIENT: OverlayName[] = ['four', 'six', 'wicket', 'new-batter', 'over-summary', 'milestone'];
/** Hockey overlays that fire on a game event and hide themselves after a timer. */
const HOCKEY_TRANSIENT: OverlayName[] = ['hockey/goal', 'hockey/card', 'hockey/penalty-corner'];

/** Overlays that fire on an event and hide themselves after a timer. */
export const TRANSIENT: OverlayName[] = [...CRICKET_TRANSIENT, ...HOCKEY_TRANSIENT];

const mapping = z.object({
  input: z.string().default(''),
  field: z.string().default(''),
  template: z.string().default(''),
});

const vmixEvent = z.object({
  input: z.string().default(''),
  overlay: z.number().int().min(1).max(8).default(1),
  action: z.enum(['off', 'in', 'toggle', 'inout']).default('off'),
  durationMs: z.number().int().min(500).max(60000).default(5000),
});

const obsRule = z.object({
  event: z.enum(['wicket', 'four', 'six']),
  scene: z.string().default(''),
  seconds: z.number().min(1).max(120).default(8),
});

export const settingsSchema = z.object({
  defaultOvers: z.number().int().min(1).max(100).default(20),
  powerplayOvers: z.number().int().min(0).max(50).default(6),
  limitBowlerOvers: z.boolean().default(true),
  theme: z.enum(['classic', 'neon', 'minimal']).default('classic'),
  publicBaseUrl: z.string().default(''),
  /** What the operator last picked on the Overlays page and the preview page (theme itself is `theme`). */
  view: z.object({
    position: z.enum(['bottom', 'top']).default('bottom'),
    scale: z.number().min(0.5).max(2).default(1),
    size: z.enum(['1920x1080', '1280x720']).default('1920x1080'),
    follow: z.enum(['active', 'fixed']).default('active'),
  }).prefault({}),
  autoHideMs: z.record(z.string(), z.number().int().min(500).max(60000)).prefault({}),
  autoTrigger: z.object({
    four: z.boolean().default(true),
    six: z.boolean().default(true),
    wicket: z.boolean().default(true),
    milestone: z.boolean().default(true),
    overSummary: z.boolean().default(false),
    newBatter: z.boolean().default(false),
  }).prefault({}),
  vmix: z.object({
    enabled: z.boolean().default(false),
    host: z.string().default('http://localhost:8088'),
    mappings: z.array(mapping).default([]),
    events: z.object({ four: vmixEvent.prefault({}), six: vmixEvent.prefault({}), wicket: vmixEvent.prefault({}) }).prefault({}),
  }).prefault({}),
  obs: z.object({
    enabled: z.boolean().default(false),
    host: z.string().default('localhost'),
    port: z.number().int().default(4455),
    password: z.string().default(''),
    rules: z.array(obsRule).default([]),
  }).prefault({}),
  pin: z.string().max(32).default(''),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_AUTO_HIDE: Record<string, number> = {
  four: 5000, six: 5000, wicket: 6000, 'new-batter': 6000, 'over-summary': 7000, milestone: 5000,
};

function deepMerge(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (Array.isArray(patch) || patch === null || typeof patch !== 'object') return patch;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) out[k] = deepMerge(out[k], v);
  return out;
}

export class SettingsService {
  private cache: Settings;
  constructor(private store: Store) {
    this.cache = settingsSchema.parse(store.kvGet('settings') ?? {});
  }
  get(): Settings {
    return this.cache;
  }
  /** The PIN from the environment wins over the stored one. */
  pin(): string {
    return process.env.PIN ?? this.cache.pin;
  }
  autoHide(name: string): number {
    return this.cache.autoHideMs[name] ?? DEFAULT_AUTO_HIDE[name] ?? 5000;
  }
  update(patch: unknown): Settings {
    this.cache = settingsSchema.parse(deepMerge(this.cache, patch));
    this.store.kvSet('settings', this.cache);
    return this.cache;
  }
}
