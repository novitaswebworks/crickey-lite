import { execFileSync } from 'node:child_process';
import { createApp } from './app';
import { lanUrls } from './api-catalog';
import { createContext } from './context';
import { log, pruneLogs } from './logger';
import { DATA_DIR } from './paths';
import { OVERLAY_NAMES } from './settings';

const PORT = Number(process.env.PORT ?? 3000);

/** Who is listening on the port, for the "port in use" message (empty when it cannot be found). */
function portOwner(port: number): string {
  try {
    const pid = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).split('\n')[0]?.trim();
    if (!pid) return '';
    const cmd = execFileSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' }).trim();
    return ` It is held by pid ${pid}: ${cmd}.`;
  } catch {
    return '';
  }
}

async function main(): Promise<void> {
  pruneLogs();
  const ctx = await createContext(DATA_DIR);
  const { server } = createApp(ctx);
  server.on('error', (e: NodeJS.ErrnoException) => {
    log.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use.${portOwner(PORT)} Stop it, or set PORT=<number> to use another port.` : e.message);
    process.exit(1);
  });
  server.listen(PORT, '0.0.0.0', () => {
    const lan = lanUrls(PORT);
    const base = ctx.settings.get().publicBaseUrl || `http://localhost:${PORT}`;
    const lines = [
      '', '  Crickey Lite is running', '',
      `  Operator panel : http://localhost:${PORT}`,
      ...lan.map((u) => `  On your network: ${u}`),
      '', '  Overlay URLs (add as a vMix Web Browser input or an OBS Browser Source, 1920x1080):',
      ...OVERLAY_NAMES.map((n) => `    ${n.padEnd(13)} ${base}/overlays/${n}.html`),
      '', `  Add ?match=<id>&theme=classic|neon|minimal&position=top|bottom&scale=1&debug=1 as needed.`, '',
    ];
    console.log(lines.join('\n'));
    log.info(`Listening on port ${PORT}`);
  });
  const shutdown = () => { ctx.store.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  log.error(e);
  process.exit(1);
});
