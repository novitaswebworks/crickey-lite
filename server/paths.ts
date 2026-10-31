import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.CRICKEY_DATA ? path.resolve(process.env.CRICKEY_DATA) : path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const OVERLAY_DIR = path.join(ROOT, 'overlays');
export const WEB_DIST = path.join(ROOT, 'web', 'dist');
