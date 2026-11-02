// SQLite storage. One file holds users, device tokens, pairing codes, the
// maps themselves and each map's recent versions. Node's built-in SQLite
// driver means the image needs no native modules.

import type { DatabaseSync as Sqlite } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    quota_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE tokens (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hash TEXT NOT NULL UNIQUE,
    device TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL
  );
  CREATE TABLE pair_codes (
    hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE maps (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    title TEXT NOT NULL,
    version INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    size INTEGER NOT NULL,
    data TEXT,
    deleted_at TEXT,
    PRIMARY KEY (user_id, id)
  );
  CREATE INDEX maps_seq ON maps(user_id, seq);
  CREATE TABLE map_versions (
    user_id INTEGER NOT NULL,
    map_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    saved_at TEXT NOT NULL,
    device TEXT NOT NULL,
    size INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (user_id, map_id, version),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  `
  CREATE TABLE invites (
    id INTEGER PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    is_admin INTEGER NOT NULL DEFAULT 0,
    quota_bytes INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  `,
  `
  -- Pictures are stored once per user and referenced from maps and their
  -- history as "blob:<sha256>", so old versions don't copy them again.
  CREATE TABLE blobs (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hash TEXT NOT NULL,
    size INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (user_id, hash)
  );
  `,
];

// Loaded this way so bundlers that don't know node:sqlite yet (the app's
// test runner) leave it alone.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

export type Db = Sqlite;

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

/** Runs fn inside one transaction. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** A per-user change counter, so clients can ask for "everything after N". */
export function nextSeq(db: Db, userId: number): number {
  const row = db.prepare('SELECT MAX(seq) AS s FROM maps WHERE user_id = ?').get(userId) as { s: number | null };
  return (row.s ?? 0) + 1;
}
