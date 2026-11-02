// Map storage. The server treats a map as an opaque JSON document with an
// id and a title; it never needs to understand topics. Every save gets a new
// server version number, and a save based on an older version is refused
// (the client then merges or keeps a copy).

import { createHash } from 'node:crypto';
import { nextSeq, tx, type Db } from './db.ts';

const BLOB = 'blob:';

/** Moves embedded pictures into the blob table; returns the slimmed JSON. */
function stripBlobs(db: Db, userId: number, doc: { resources?: Record<string, unknown> }): string {
  if (doc.resources && typeof doc.resources === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(doc.resources)) {
      if (typeof v !== 'string' || v.length < 256) {
        out[k] = v;
        continue;
      }
      const hash = createHash('sha256').update(v).digest('hex');
      db.prepare('INSERT OR IGNORE INTO blobs (user_id, hash, size, data) VALUES (?, ?, ?, ?)').run(userId, hash, Buffer.byteLength(v), v);
      out[k] = BLOB + hash;
    }
    doc.resources = out;
  }
  return JSON.stringify(doc);
}

/** Puts the pictures back into a stored map. */
export function hydrate(db: Db, userId: number, data: string): string {
  if (!data.includes(`"${BLOB}`)) return data;
  const doc = JSON.parse(data);
  for (const [k, v] of Object.entries(doc.resources ?? {})) {
    if (typeof v !== 'string' || !v.startsWith(BLOB)) continue;
    const row = db.prepare('SELECT data FROM blobs WHERE user_id = ? AND hash = ?').get(userId, v.slice(BLOB.length)) as { data: string } | undefined;
    if (row) doc.resources[k] = row.data;
    else delete doc.resources[k];
  }
  return JSON.stringify(doc);
}

/** Deletes pictures no map or version refers to any more. */
export function collectBlobs(db: Db): number {
  const r = db
    .prepare(
      `DELETE FROM blobs WHERE NOT EXISTS (
         SELECT 1 FROM maps m, json_each(m.data, '$.resources') j
         WHERE m.user_id = blobs.user_id AND m.data IS NOT NULL AND j.value = 'blob:' || blobs.hash
       ) AND NOT EXISTS (
         SELECT 1 FROM map_versions v, json_each(v.data, '$.resources') j
         WHERE v.user_id = blobs.user_id AND j.value = 'blob:' || blobs.hash
       )`,
    )
    .run();
  return Number(r.changes);
}

/** Versions of each map kept for history on the server. */
export const KEEP_VERSIONS = 50;
/** Days a deleted map stays in the trash. */
export const TRASH_DAYS = 30;

export interface MapMeta {
  id: string;
  title: string;
  version: number;
  updatedAt: string;
  size: number;
}

export type PutResult =
  | { ok: true; version: number; updatedAt: string }
  | { ok: false; reason: 'conflict'; current: { version: number; data: string } }
  | { ok: false; reason: 'exists'; current: { version: number; data: string } }
  | { ok: false; reason: 'quota'; used: number; quota: number }
  | { ok: false; reason: 'image'; size: number; max: number }
  | { ok: false; reason: 'full' }
  | { ok: false; reason: 'invalid'; message: string };

const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
export const validId = (id: string) => ID_RE.test(id);

export function listMaps(db: Db, userId: number): MapMeta[] {
  return db
    .prepare('SELECT id, title, version, updated_at AS updatedAt, size FROM maps WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC')
    .all(userId) as unknown as MapMeta[];
}

export function getMap(db: Db, userId: number, id: string): { version: number; data: string; updatedAt: string } | undefined {
  const row = db
    .prepare('SELECT version, data, updated_at AS updatedAt FROM maps WHERE user_id = ? AND id = ? AND deleted_at IS NULL')
    .get(userId, id) as { version: number; data: string; updatedAt: string } | undefined;
  return row && { ...row, data: hydrate(db, userId, row.data) };
}

/** Everything the server stores: maps, trash and history, for all users. */
export function totalBytes(db: Db): number {
  const sum = (table: string) => Number((db.prepare(`SELECT COALESCE(SUM(size), 0) AS n FROM ${table}`).get() as { n: number }).n);
  return sum('maps') + sum('map_versions') + sum('blobs');
}

/** Size in bytes of the largest embedded picture (data URLs in `resources`). */
export function largestImage(doc: { resources?: unknown }): number {
  let max = 0;
  if (doc.resources && typeof doc.resources === 'object') {
    for (const v of Object.values(doc.resources as Record<string, unknown>)) {
      if (typeof v !== 'string') continue;
      const comma = v.indexOf(',');
      const b64 = comma >= 0 ? v.slice(comma + 1) : v;
      max = Math.max(max, Math.floor((b64.length * 3) / 4));
    }
  }
  return max;
}

export interface Limits {
  /** Per-user quota for live maps (0 = none). */
  quotaBytes: number;
  /** Largest picture allowed in a map (0 = none). */
  maxImageBytes?: number;
  /** Cap on everything stored on the server (0 = none). */
  totalBytes?: number;
  /** Free disk space under which writes stop. */
  minFreeBytes?: number;
  /** Free space on the data disk right now. */
  freeBytes?: () => number;
}

/** A user's live maps plus their pictures. */
export function usedBytes(db: Db, userId: number, exceptId?: string): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(size), 0) AS n FROM maps WHERE user_id = ? AND deleted_at IS NULL AND id != ?')
    .get(userId, exceptId ?? '') as { n: number };
  const blobs = db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM blobs WHERE user_id = ?').get(userId) as { n: number };
  return Number(row.n) + Number(blobs.n);
}

/**
 * Saves a map. `baseVersion` is the server version the client started from,
 * or null when it believes the map is new here.
 */
export function putMap(
  db: Db,
  userId: number,
  id: string,
  body: string,
  baseVersion: number | null,
  opts: { device: string } & Limits,
): PutResult {
  let title: string;
  let image = 0;
  let doc: { id?: unknown; title?: unknown; roots?: unknown; resources?: Record<string, unknown> };
  try {
    doc = JSON.parse(body);
    if (!doc || typeof doc !== 'object' || doc.id !== id || !Array.isArray(doc.roots)) {
      return { ok: false, reason: 'invalid', message: 'Geçerli bir Keizu haritası değil (id adresle aynı olmalı).' };
    }
    title = String(doc.title ?? '').slice(0, 300);
    image = largestImage(doc);
  } catch {
    return { ok: false, reason: 'invalid', message: 'Gövde JSON değil.' };
  }
  if (opts.maxImageBytes && image > opts.maxImageBytes) return { ok: false, reason: 'image', size: image, max: opts.maxImageBytes };
  if (opts.freeBytes && opts.minFreeBytes && opts.freeBytes() - Buffer.byteLength(body) * 2 < opts.minFreeBytes) return { ok: false, reason: 'full' };
  try {
    return tx(db, (): PutResult => {
      const row = db.prepare('SELECT version, data, deleted_at FROM maps WHERE user_id = ? AND id = ?').get(userId, id) as
        | { version: number; data: string; deleted_at: string | null }
        | undefined;
      const live = row && !row.deleted_at;
      if (live && baseVersion === null) return { ok: false, reason: 'exists', current: { version: row.version, data: hydrate(db, userId, row.data) } };
      if (live && baseVersion !== row.version) return { ok: false, reason: 'conflict', current: { version: row.version, data: hydrate(db, userId, row.data) } };
      // Pictures go in first, so the limits below see only what is really new.
      const data = stripBlobs(db, userId, doc);
      const stored = Buffer.byteLength(data);
      if (opts.quotaBytes > 0) {
        const used = usedBytes(db, userId, id);
        if (used + stored > opts.quotaBytes) throw new Refused({ ok: false, reason: 'quota', used, quota: opts.quotaBytes });
      }
      // A save adds the map and one history entry.
      if (opts.totalBytes && totalBytes(db) - (row?.data ? Buffer.byteLength(row.data) : 0) + stored * 2 > opts.totalBytes) {
        throw new Refused({ ok: false, reason: 'full' });
      }
      const version = (row?.version ?? 0) + 1;
      const now = new Date().toISOString();
      const seq = nextSeq(db, userId);
      db.prepare(
        `INSERT INTO maps (user_id, id, title, version, seq, updated_at, size, data, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT (user_id, id) DO UPDATE SET title = excluded.title, version = excluded.version, seq = excluded.seq,
           updated_at = excluded.updated_at, size = excluded.size, data = excluded.data, deleted_at = NULL`,
      ).run(userId, id, title, version, seq, now, stored, data);
      db.prepare('INSERT OR REPLACE INTO map_versions (user_id, map_id, version, saved_at, device, size, data) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        userId,
        id,
        version,
        now,
        opts.device,
        stored,
        data,
      );
      db.prepare('DELETE FROM map_versions WHERE user_id = ? AND map_id = ? AND version <= ?').run(userId, id, version - KEEP_VERSIONS);
      return { ok: true, version, updatedAt: now };
    });
  } catch (e) {
    if (e instanceof Refused) return e.result;
    throw e;
  }
}

/** Rolls the transaction back (pictures included) and reports why. */
class Refused extends Error {
  result: PutResult;
  constructor(result: PutResult) {
    super('refused');
    this.result = result;
  }
}

/** Moves a map to the trash. Returns false when there is no such map. */
export function deleteMap(db: Db, userId: number, id: string): boolean {
  return tx(db, () => {
    const seq = nextSeq(db, userId);
    const r = db
      .prepare('UPDATE maps SET deleted_at = ?, seq = ? WHERE user_id = ? AND id = ? AND deleted_at IS NULL')
      .run(new Date().toISOString(), seq, userId, id);
    return Number(r.changes) > 0;
  });
}

export function restoreMap(db: Db, userId: number, id: string): boolean {
  return tx(db, () => {
    const seq = nextSeq(db, userId);
    const r = db
      .prepare('UPDATE maps SET deleted_at = NULL, seq = ?, updated_at = ? WHERE user_id = ? AND id = ? AND deleted_at IS NOT NULL AND data IS NOT NULL')
      .run(seq, new Date().toISOString(), userId, id);
    return Number(r.changes) > 0;
  });
}

export function listTrash(db: Db, userId: number) {
  return db
    .prepare('SELECT id, title, version, deleted_at AS deletedAt, size FROM maps WHERE user_id = ? AND deleted_at IS NOT NULL AND data IS NOT NULL ORDER BY deleted_at DESC')
    .all(userId);
}

/**
 * Everything that changed after `since` (a cursor from an earlier call), with
 * deletions marked. A client that keeps the cursor only downloads what's new.
 */
export function changesSince(db: Db, userId: number, since: number) {
  const rows = db
    .prepare('SELECT id, title, version, updated_at AS updatedAt, seq, deleted_at AS deletedAt FROM maps WHERE user_id = ? AND seq > ? ORDER BY seq')
    .all(userId, since) as { id: string; title: string; version: number; updatedAt: string; seq: number; deletedAt: string | null }[];
  const cursor = rows.length ? rows[rows.length - 1].seq : since;
  return {
    cursor,
    changes: rows.map((r) => ({ id: r.id, title: r.title, version: r.version, updatedAt: r.updatedAt, deleted: !!r.deletedAt })),
  };
}

export function listVersions(db: Db, userId: number, mapId: string) {
  return db
    .prepare('SELECT version, saved_at AS savedAt, device, size FROM map_versions WHERE user_id = ? AND map_id = ? ORDER BY version DESC')
    .all(userId, mapId);
}

export function getVersion(db: Db, userId: number, mapId: string, version: number): string | undefined {
  const row = db.prepare('SELECT data FROM map_versions WHERE user_id = ? AND map_id = ? AND version = ?').get(userId, mapId, version) as
    | { data: string }
    | undefined;
  return row && hydrate(db, userId, row.data);
}

/** Empties trash older than TRASH_DAYS and drops its history. */
export function purgeTrash(db: Db, now = Date.now()): number {
  const cutoff = new Date(now - TRASH_DAYS * 86400e3).toISOString();
  return tx(db, () => {
    const old = db.prepare('SELECT user_id, id FROM maps WHERE deleted_at IS NOT NULL AND deleted_at < ? AND data IS NOT NULL').all(cutoff) as {
      user_id: number;
      id: string;
    }[];
    for (const r of old) {
      // Keep a data-less row so other devices still learn about the deletion.
      db.prepare('UPDATE maps SET data = NULL, size = 0 WHERE user_id = ? AND id = ?').run(r.user_id, r.id);
      db.prepare('DELETE FROM map_versions WHERE user_id = ? AND map_id = ?').run(r.user_id, r.id);
    }
    collectBlobs(db);
    return old.length;
  });
}
