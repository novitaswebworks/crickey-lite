import fs from 'node:fs';
import path from 'node:path';
import { EngineEvent, EventPayload } from './engine';
import { log } from './logger';

export type Doc<T> = T & { id: number };

export interface Store {
  readonly kind: 'sqlite' | 'json';
  list<T>(coll: string, parent?: number): Doc<T>[];
  get<T>(coll: string, id: number): Doc<T> | undefined;
  insert<T extends object>(coll: string, data: T, parent?: number): Doc<T>;
  update<T extends object>(coll: string, id: number, patch: Partial<T>): Doc<T> | undefined;
  remove(coll: string, id: number): void;
  removeByParent(coll: string, parent: number): void;
  replaceByParent<T extends object>(coll: string, parent: number, rows: T[]): void;
  events: {
    list(matchId: number): EngineEvent[];
    append(matchId: number, payload: EventPayload): EngineEvent;
    removeLast(matchId: number): EngineEvent | undefined;
    replacePayload(matchId: number, eventId: number, payload: EventPayload): void;
    clear(matchId: number): void;
  };
  kvGet<T>(key: string): T | undefined;
  kvSet(key: string, value: unknown): void;
  close(): void;
}

type Row = { coll: string; id: number; parent: number | null; data: string };

class SqliteStore implements Store {
  readonly kind = 'sqlite' as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private db: any) {
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS docs (coll TEXT NOT NULL, id INTEGER NOT NULL, parent INTEGER, data TEXT NOT NULL, PRIMARY KEY (coll, id));
      CREATE INDEX IF NOT EXISTS docs_parent ON docs (coll, parent);
      CREATE TABLE IF NOT EXISTS events (id INTEGER NOT NULL, match_id INTEGER NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (match_id, seq));
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
    `);
  }
  private parse<T>(r: Row): Doc<T> {
    return { ...JSON.parse(r.data), id: r.id };
  }
  list<T>(coll: string, parent?: number): Doc<T>[] {
    const rows = (parent === undefined
      ? this.db.prepare('SELECT * FROM docs WHERE coll = ? ORDER BY id').all(coll)
      : this.db.prepare('SELECT * FROM docs WHERE coll = ? AND parent = ? ORDER BY id').all(coll, parent)) as Row[];
    return rows.map((r) => this.parse<T>(r));
  }
  get<T>(coll: string, id: number): Doc<T> | undefined {
    const r = this.db.prepare('SELECT * FROM docs WHERE coll = ? AND id = ?').get(coll, id) as Row | undefined;
    return r ? this.parse<T>(r) : undefined;
  }
  insert<T extends object>(coll: string, data: T, parent?: number): Doc<T> {
    const next = (this.db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM docs WHERE coll = ?').get(coll) as { n: number }).n;
    this.db.prepare('INSERT INTO docs (coll, id, parent, data) VALUES (?, ?, ?, ?)').run(coll, next, parent ?? null, JSON.stringify(data));
    return { ...data, id: next };
  }
  update<T extends object>(coll: string, id: number, patch: Partial<T>): Doc<T> | undefined {
    const cur = this.get<T>(coll, id);
    if (!cur) return undefined;
    const { id: _id, ...rest } = { ...cur, ...patch } as Doc<T>;
    this.db.prepare('UPDATE docs SET data = ? WHERE coll = ? AND id = ?').run(JSON.stringify(rest), coll, id);
    return { ...rest, id } as Doc<T>;
  }
  remove(coll: string, id: number): void {
    this.db.prepare('DELETE FROM docs WHERE coll = ? AND id = ?').run(coll, id);
  }
  removeByParent(coll: string, parent: number): void {
    this.db.prepare('DELETE FROM docs WHERE coll = ? AND parent = ?').run(coll, parent);
  }
  replaceByParent<T extends object>(coll: string, parent: number, rows: T[]): void {
    this.db.transaction(() => {
      this.removeByParent(coll, parent);
      for (const r of rows) this.insert(coll, r, parent);
    })();
  }
  events = {
    list: (matchId: number): EngineEvent[] =>
      (this.db.prepare('SELECT seq, payload_json FROM events WHERE match_id = ? ORDER BY seq').all(matchId) as { seq: number; payload_json: string }[])
        .map((r) => ({ ...JSON.parse(r.payload_json), id: r.seq }) as EngineEvent),
    append: (matchId: number, payload: EventPayload): EngineEvent => {
      const seq = (this.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM events WHERE match_id = ?').get(matchId) as { n: number }).n;
      this.db.prepare('INSERT INTO events (id, match_id, seq, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(seq, matchId, seq, payload.type, JSON.stringify(payload), new Date().toISOString());
      return { ...payload, id: seq } as EngineEvent;
    },
    removeLast: (matchId: number): EngineEvent | undefined => {
      const r = this.db.prepare('SELECT seq, payload_json FROM events WHERE match_id = ? ORDER BY seq DESC LIMIT 1').get(matchId) as { seq: number; payload_json: string } | undefined;
      if (!r) return undefined;
      this.db.prepare('DELETE FROM events WHERE match_id = ? AND seq = ?').run(matchId, r.seq);
      return { ...JSON.parse(r.payload_json), id: r.seq } as EngineEvent;
    },
    replacePayload: (matchId: number, eventId: number, payload: EventPayload): void => {
      this.db.prepare('UPDATE events SET type = ?, payload_json = ? WHERE match_id = ? AND seq = ?').run(payload.type, JSON.stringify(payload), matchId, eventId);
    },
    clear: (matchId: number): void => {
      this.db.prepare('DELETE FROM events WHERE match_id = ?').run(matchId);
    },
  };
  kvGet<T>(key: string): T | undefined {
    const r = this.db.prepare('SELECT value_json FROM kv WHERE key = ?').get(key) as { value_json: string } | undefined;
    return r ? (JSON.parse(r.value_json) as T) : undefined;
  }
  kvSet(key: string, value: unknown): void {
    this.db.prepare('INSERT INTO kv (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json').run(key, JSON.stringify(value));
  }
  close(): void {
    this.db.close();
  }
}

interface JsonData {
  docs: Record<string, { id: number; parent: number | null; data: object }[]>;
  events: Record<string, EngineEvent[]>;
  kv: Record<string, unknown>;
}

/** Fallback used only when the native SQLite module cannot be loaded. */
class JsonStore implements Store {
  readonly kind = 'json' as const;
  private d: JsonData = { docs: {}, events: {}, kv: {} };
  constructor(private file: string) {
    if (file !== ':memory:' && fs.existsSync(file)) this.d = JSON.parse(fs.readFileSync(file, 'utf8')) as JsonData;
  }
  private save(): void {
    if (this.file === ':memory:') return;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.d));
    fs.renameSync(tmp, this.file);
  }
  private rows(coll: string) {
    return (this.d.docs[coll] ??= []);
  }
  list<T>(coll: string, parent?: number): Doc<T>[] {
    return this.rows(coll).filter((r) => parent === undefined || r.parent === parent).map((r) => ({ ...(r.data as T), id: r.id }));
  }
  get<T>(coll: string, id: number): Doc<T> | undefined {
    const r = this.rows(coll).find((x) => x.id === id);
    return r ? { ...(r.data as T), id } : undefined;
  }
  insert<T extends object>(coll: string, data: T, parent?: number): Doc<T> {
    const rows = this.rows(coll);
    const id = rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
    rows.push({ id, parent: parent ?? null, data: { ...data } });
    this.save();
    return { ...data, id };
  }
  update<T extends object>(coll: string, id: number, patch: Partial<T>): Doc<T> | undefined {
    const r = this.rows(coll).find((x) => x.id === id);
    if (!r) return undefined;
    r.data = { ...r.data, ...patch };
    this.save();
    return { ...(r.data as T), id };
  }
  remove(coll: string, id: number): void {
    this.d.docs[coll] = this.rows(coll).filter((r) => r.id !== id);
    this.save();
  }
  removeByParent(coll: string, parent: number): void {
    this.d.docs[coll] = this.rows(coll).filter((r) => r.parent !== parent);
    this.save();
  }
  replaceByParent<T extends object>(coll: string, parent: number, rows: T[]): void {
    this.removeByParent(coll, parent);
    for (const r of rows) this.insert(coll, r, parent);
  }
  private ev(matchId: number): EngineEvent[] {
    return (this.d.events[matchId] ??= []);
  }
  events = {
    list: (matchId: number): EngineEvent[] => this.ev(matchId).map((e) => ({ ...e })),
    append: (matchId: number, payload: EventPayload): EngineEvent => {
      const list = this.ev(matchId);
      const e = { ...payload, id: (list[list.length - 1]?.id ?? 0) + 1 } as EngineEvent;
      list.push(e);
      this.save();
      return { ...e };
    },
    removeLast: (matchId: number): EngineEvent | undefined => {
      const e = this.ev(matchId).pop();
      this.save();
      return e;
    },
    replacePayload: (matchId: number, eventId: number, payload: EventPayload): void => {
      const list = this.ev(matchId);
      const i = list.findIndex((e) => e.id === eventId);
      if (i >= 0) list[i] = { ...payload, id: eventId } as EngineEvent;
      this.save();
    },
    clear: (matchId: number): void => {
      this.d.events[matchId] = [];
      this.save();
    },
  };
  kvGet<T>(key: string): T | undefined {
    return this.d.kv[key] as T | undefined;
  }
  kvSet(key: string, value: unknown): void {
    this.d.kv[key] = value;
    this.save();
  }
  close(): void {
    this.save();
  }
}

export async function openStore(dir: string): Promise<Store> {
  if (dir === ':memory:') return new SqliteStore(new (await import('better-sqlite3')).default(':memory:'));
  fs.mkdirSync(dir, { recursive: true });
  try {
    const Database = (await import('better-sqlite3')).default;
    const store = new SqliteStore(new Database(path.join(dir, 'crickey.db')));
    log.info('Storage: SQLite', path.join(dir, 'crickey.db'));
    return store;
  } catch (e) {
    log.warn('SQLite unavailable, falling back to a JSON file store:', (e as Error).message);
    return new JsonStore(path.join(dir, 'store.json'));
  }
}

export { JsonStore };
