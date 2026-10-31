import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths';

const LOG_DIR = path.join(DATA_DIR, 'logs');
const KEEP_DAYS = 7;

function stamp(): string {
  return new Date().toISOString();
}

function write(level: string, args: unknown[]): void {
  const text = args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack ?? a.message : JSON.stringify(a))).join(' ');
  const line = `${stamp()} ${level} ${text}`;
  (level === 'ERROR' ? console.error : console.log)(line);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, `crickey-${stamp().slice(0, 10)}.log`), line + '\n');
  } catch {
    /* logging must never break scoring */
  }
}

export const log = {
  info: (...a: unknown[]) => write('INFO', a),
  warn: (...a: unknown[]) => write('WARN', a),
  error: (...a: unknown[]) => write('ERROR', a),
};

export function pruneLogs(): void {
  try {
    const cutoff = Date.now() - KEEP_DAYS * 86400000;
    for (const f of fs.readdirSync(LOG_DIR)) {
      const p = path.join(LOG_DIR, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
  } catch {
    /* no logs yet */
  }
}
