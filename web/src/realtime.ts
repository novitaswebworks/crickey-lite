import type { LiveState } from '@engine/types';
import { useSyncExternalStore } from 'react';
import type { OverlayEntry } from './api';

interface Snapshot {
  state: LiveState | null;
  matchId: number | null;
  overlays: Record<string, OverlayEntry>;
  clients: { total: number; byOverlay: Record<string, number> };
  connected: boolean;
}

let snap: Snapshot = { state: null, matchId: null, overlays: {}, clients: { total: 0, byOverlay: {} }, connected: false };
const listeners = new Set<() => void>();

function set(patch: Partial<Snapshot>): void {
  snap = { ...snap, ...patch };
  listeners.forEach((l) => l());
}

let started = false;
let retry = 500;

function connect(): void {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => { retry = 500; set({ connected: true }); };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data as string) as { type: string; [k: string]: unknown };
    if (m.type === 'state') set({ state: (m.state as LiveState | null) ?? null, matchId: (m.matchId as number | null) ?? null });
    else if (m.type === 'overlay') set({ overlays: m.overlays as Snapshot['overlays'] });
    else if (m.type === 'clients') set({ clients: { total: m.total as number, byOverlay: m.byOverlay as Record<string, number> } });
  };
  ws.onclose = () => {
    set({ connected: false });
    setTimeout(connect, retry);
    retry = Math.min(retry * 2, 8000);
  };
}

export function startRealtime(): void {
  if (started) return;
  started = true;
  connect();
}

/** Applies a state returned by a POST right away; the WebSocket push then confirms it. */
export function applyState(state: LiveState): void {
  if (snap.matchId === null || String(snap.matchId) === state.matchId) set({ state });
}

export function useRealtime(): Snapshot {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => void listeners.delete(l); },
    () => snap,
  );
}
