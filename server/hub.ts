import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import type { WebSocket } from 'ws';

export type ServerMessage =
  | { type: 'state'; matchId: number | null; state: unknown }
  | { type: 'overlay'; overlays: unknown }
  | { type: 'trigger'; trigger: unknown }
  | { type: 'clients'; total: number; byOverlay: Record<string, number> }
  | { type: 'ping'; t: number };

export interface Client {
  id: number;
  matchId: number | null;
  overlay: string | null;
  send(msg: ServerMessage): void;
  close(): void;
}

let nextId = 1;

export function wsClient(ws: WebSocket, matchId: number | null, overlay: string | null): Client {
  return {
    id: nextId++, matchId, overlay,
    send: (msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); },
    close: () => ws.close(),
  };
}

export function sseClient(res: Response, matchId: number | null, overlay: string | null): Client {
  return {
    id: nextId++, matchId, overlay,
    send: (msg) => { res.write(`event: ${msg.type}\ndata: ${JSON.stringify(msg)}\n\n`); },
    close: () => res.end(),
  };
}

export class Hub extends EventEmitter {
  private clients = new Set<Client>();

  constructor(private activeId: () => number | null, private stateFor: (matchId: number) => unknown | null) {
    super();
  }

  add(c: Client): void {
    this.clients.add(c);
    this.announce();
  }

  /** An overlay introduced itself after connecting. */
  hello(c: Client, overlay: string | null, matchId: number | null): void {
    c.overlay = overlay;
    c.matchId = matchId;
    this.sendState(c);
    this.announce();
  }

  remove(c: Client): void {
    if (this.clients.delete(c)) this.announce();
  }

  resolve(c: Client): number | null {
    return c.matchId ?? this.activeId();
  }

  sendState(c: Client): void {
    const id = this.resolve(c);
    c.send({ type: 'state', matchId: id, state: id === null ? null : this.stateFor(id) });
  }

  /** Push a match's state to every client following it (explicitly, or via the active match). */
  broadcastState(matchId: number, state: unknown): void {
    for (const c of this.clients) if (this.resolve(c) === matchId) c.send({ type: 'state', matchId, state });
  }

  refreshAll(): void {
    for (const c of this.clients) this.sendState(c);
  }

  broadcast(msg: ServerMessage): void {
    for (const c of this.clients) c.send(msg);
  }

  counts(): { total: number; byOverlay: Record<string, number> } {
    const byOverlay: Record<string, number> = {};
    let total = 0;
    for (const c of this.clients) {
      if (!c.overlay) continue;
      total += 1;
      byOverlay[c.overlay] = (byOverlay[c.overlay] ?? 0) + 1;
    }
    return { total, byOverlay };
  }

  private announce(): void {
    this.broadcast({ type: 'clients', ...this.counts() });
  }

  ping(): void {
    this.broadcast({ type: 'ping', t: Date.now() });
  }
}
