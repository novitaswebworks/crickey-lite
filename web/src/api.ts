import type { EventPayload, LiveState } from '@engine/types';

export class ApiFail extends Error {
  constructor(message: string, public code: string, public status: number) {
    super(message);
  }
}

type PinListener = () => void;
const pinListeners = new Set<PinListener>();
export const onPinRequired = (fn: PinListener) => {
  pinListeners.add(fn);
  return () => void pinListeners.delete(fn);
};

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiFail('Cannot reach the server. Is it still running?', 'NETWORK', 0);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    const j = (json ?? {}) as { error?: string; code?: string };
    if (res.status === 401 && j.code === 'PIN_REQUIRED') pinListeners.forEach((f) => f());
    throw new ApiFail(j.error ?? `Request failed (${res.status})`, j.code ?? 'ERROR', res.status);
  }
  return json as T;
}

export const get = <T,>(url: string) => api<T>('GET', url);
export const post = <T,>(url: string, body?: unknown) => api<T>('POST', url, body ?? {});
export const put = <T,>(url: string, body: unknown) => api<T>('PUT', url, body);
export const del = <T,>(url: string) => api<T>('DELETE', url);

export async function sendEvent(matchId: number, payload: EventPayload): Promise<LiveState> {
  return (await post<{ state: LiveState }>(`/api/matches/${matchId}/events`, payload)).state;
}

export async function uploadLogo(teamId: number, file: File): Promise<void> {
  const res = await fetch(`/api/teams/${teamId}/logo`, { method: 'POST', headers: { 'content-type': file.type }, body: file });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    if (res.status === 401) pinListeners.forEach((f) => f());
    throw new ApiFail(j.error ?? 'Upload failed', j.code ?? 'ERROR', res.status);
  }
}

export interface TeamDto { id: number; name: string; shortName: string; color: string; logoPath: string | null; playerCount?: number }
export interface PlayerDto { id: number; teamId: number; name: string; shortName: string; shirtNo: string; role: string; orderIdx: number }
export interface MatchSummary {
  id: number; title: string; venue: string; overs: number;
  teamA: { name: string; shortName: string; color: string }; teamB: { name: string; shortName: string; color: string };
  status: LiveState['status']; statusText: string; score: string; createdAt: string; active: boolean; eventCount: number;
}
export interface OverlayEntry { visible: boolean; triggerId: number; payload: unknown; durationMs: number | null }
export interface Info { port: number; lanUrls: string[]; storage: string; overlays: string[]; publicBaseUrl: string; pinRequired: boolean; activeMatchId: number | null }
