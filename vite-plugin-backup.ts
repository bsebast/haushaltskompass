import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';

const NAME = /^haushaltskompass-(\d{4}-\d{2}-\d{2})(?:_v(\d+))?\.hkb$/;
const MAX_BYTES = 64 * 1024 * 1024;
const KEEP_BEFORE_IMPORT = 5;

/** Neueste Sicherung nach Datum und Versionsnummer im Dateinamen. */
export function newestBackupName(names: string[]): string | null {
  const rank = (n: string) => {
    const m = NAME.exec(n);
    return m ? { date: m[1], version: Number(m[2] ?? 0) } : null;
  };
  let best: string | null = null;
  for (const n of names) {
    const r = rank(n);
    if (!r) continue;
    const b = best ? rank(best)! : null;
    if (!b || r.date > b.date || (r.date === b.date && r.version > b.version)) best = n;
  }
  return best;
}

function latest(dir: string) {
  if (!existsSync(dir)) return null;
  const name = newestBackupName(readdirSync(dir));
  if (!name) return null;
  const data = readFileSync(join(dir, name));
  return { name, data, sha256: createHash('sha256').update(data).digest('hex') };
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BYTES) {
        fail(new Error('zu groß'));
        req.destroy();
      } else parts.push(c);
    });
    req.on('end', () => ok(Buffer.concat(parts)));
    req.on('error', fail);
  });
}

function keepBeforeImport(dir: string, data: Buffer) {
  const target = join(dir, 'vor-import');
  mkdirSync(target, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(join(target, `vor-import-${stamp}.hkb`), data);
  const old = readdirSync(target).filter((n) => /^vor-import-.*\.hkb$/.test(n)).sort();
  for (const n of old.slice(0, Math.max(0, old.length - KEEP_BEFORE_IMPORT))) rmSync(join(target, n));
}

/**
 * Nur im Dev-Server: stellt die neueste Sicherung aus privat/ der App bereit.
 * Die Routen antworten ausschließlich Anfragen der eigenen Seite.
 */
export function backupImport(): Plugin {
  return {
    name: 'haushaltskompass-backup-import',
    apply: 'serve',
    configureServer(server) {
      const dir = resolve(server.config.root, 'privat');
      let timer: NodeJS.Timeout | undefined;
      server.watcher.on('all', (_event, file) => {
        if (resolve(dirname(file)) !== dir || !NAME.test(file.split(/[\\/]/).pop() ?? '')) return;
        clearTimeout(timer);
        timer = setTimeout(() => server.ws.send({ type: 'custom', event: 'hk:backup' }), 1000);
      });

      server.middlewares.use('/__hk/backup', async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.headers['sec-fetch-site'] !== 'same-origin') {
          res.statusCode = 403;
          res.end();
          return;
        }
        try {
          const url = new URL(req.url ?? '/', 'http://localhost');
          if (req.method === 'GET' && url.pathname === '/latest') {
            const l = latest(dir);
            res.setHeader('Cache-Control', 'no-store');
            if (!l) {
              res.statusCode = 204;
              res.end();
            } else {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ name: l.name, sha256: l.sha256 }));
            }
          } else if (req.method === 'GET' && url.pathname === '/file') {
            const l = latest(dir);
            res.setHeader('Cache-Control', 'no-store');
            if (!l || l.sha256 !== url.searchParams.get('sha256')) {
              res.statusCode = 409;
              res.end();
            } else {
              res.setHeader('Content-Type', 'application/octet-stream');
              res.end(l.data);
            }
          } else if (req.method === 'POST' && url.pathname === '/before-import') {
            keepBeforeImport(dir, await readBody(req));
            res.statusCode = 204;
            res.end();
          } else next();
        } catch (e) {
          server.config.logger.error(`Sicherung: ${(e as Error).message}`);
          res.statusCode = 500;
          res.end();
        }
      });
    },
  };
}
