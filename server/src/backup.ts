// Daily backups: a consistent copy of the SQLite file (VACUUM INTO), kept
// for a number of days in <data>/backups. Copying that folder elsewhere (for
// example to a Hetzner Storage Box) is left to the host; see the guide.

import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.ts';

export function backupNow(db: Db, dir: string, now = new Date()): string {
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const file = join(dir, `keizu-${stamp}.db`);
  rmSync(file, { force: true });
  db.prepare('VACUUM INTO ?').run(file);
  return file;
}

/** Deletes all but the newest `keep` backups. */
export function pruneBackups(dir: string, keep: number): string[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => /^keizu-.*\.db$/.test(f));
  } catch {
    return [];
  }
  const sorted = files.map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  const drop = sorted.slice(keep).map((x) => x.f);
  for (const f of drop) rmSync(join(dir, f), { force: true });
  return drop;
}
