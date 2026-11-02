// Sharing: a map can be opened by other accounts on this server, each with
// "view" or "edit" rights, and by anyone holding a read-only link. Shares are
// per map and per person; nobody ever sees another account's library.

import { randomBytes } from 'node:crypto';
import type { Db } from './db.ts';

export type Role = 'view' | 'edit';
/** What a user may do with a map: their own, shared with them, or nothing. */
export type Access = 'owner' | Role | undefined;

export const isRole = (r: unknown): r is Role => r === 'view' || r === 'edit';

export function accessTo(db: Db, userId: number, ownerId: number, mapId: string): Access {
  const live = db.prepare('SELECT 1 FROM maps WHERE user_id = ? AND id = ? AND deleted_at IS NULL').get(ownerId, mapId);
  if (!live) return undefined;
  if (userId === ownerId) return 'owner';
  const row = db.prepare('SELECT role FROM shares WHERE owner_id = ? AND map_id = ? AND user_id = ?').get(ownerId, mapId, userId) as
    | { role: string }
    | undefined;
  return row && isRole(row.role) ? row.role : undefined;
}

export function listShares(db: Db, ownerId: number, mapId: string): { username: string; role: Role; since: string }[] {
  return db
    .prepare(
      `SELECT u.username, s.role, s.created_at AS since FROM shares s JOIN users u ON u.id = s.user_id
       WHERE s.owner_id = ? AND s.map_id = ? ORDER BY u.username`,
    )
    .all(ownerId, mapId) as { username: string; role: Role; since: string }[];
}

export function setShare(db: Db, ownerId: number, mapId: string, userId: number, role: Role) {
  db.prepare(
    `INSERT INTO shares (owner_id, map_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (owner_id, map_id, user_id) DO UPDATE SET role = excluded.role`,
  ).run(ownerId, mapId, userId, role, new Date().toISOString());
}

export function removeShare(db: Db, ownerId: number, mapId: string, userId: number): boolean {
  return Number(db.prepare('DELETE FROM shares WHERE owner_id = ? AND map_id = ? AND user_id = ?').run(ownerId, mapId, userId).changes) > 0;
}

/** Maps other people shared with this user (deleted maps left out). */
export function sharedWith(db: Db, userId: number) {
  return db
    .prepare(
      `SELECT m.id, m.title, m.version, m.updated_at AS updatedAt, s.role, s.owner_id AS ownerId, u.username AS owner
       FROM shares s JOIN maps m ON m.user_id = s.owner_id AND m.id = s.map_id JOIN users u ON u.id = s.owner_id
       WHERE s.user_id = ? AND m.deleted_at IS NULL ORDER BY m.updated_at DESC`,
    )
    .all(userId) as { id: string; title: string; version: number; updatedAt: string; role: Role; ownerId: number; owner: string }[];
}

/** How many people each of the owner's maps is shared with (for the library). */
export function shareCounts(db: Db, ownerId: number): Record<string, number> {
  const rows = db.prepare('SELECT map_id AS id, COUNT(*) AS n FROM shares WHERE owner_id = ? GROUP BY map_id').all(ownerId) as { id: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.id, Number(r.n)]));
}

export function getViewLink(db: Db, ownerId: number, mapId: string): string | undefined {
  return (db.prepare('SELECT token FROM view_links WHERE owner_id = ? AND map_id = ?').get(ownerId, mapId) as { token: string } | undefined)?.token;
}

/** The map's read-only link token, made on first use. */
export function ensureViewLink(db: Db, ownerId: number, mapId: string): string {
  const cur = getViewLink(db, ownerId, mapId);
  if (cur) return cur;
  const token = randomBytes(18).toString('base64url');
  db.prepare('INSERT INTO view_links (token, owner_id, map_id, created_at) VALUES (?, ?, ?, ?)').run(token, ownerId, mapId, new Date().toISOString());
  return token;
}

export function removeViewLink(db: Db, ownerId: number, mapId: string) {
  db.prepare('DELETE FROM view_links WHERE owner_id = ? AND map_id = ?').run(ownerId, mapId);
}

export function viewLinkTarget(db: Db, token: string): { ownerId: number; mapId: string } | undefined {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) return undefined;
  const row = db.prepare('SELECT owner_id AS ownerId, map_id AS mapId FROM view_links WHERE token = ?').get(token) as
    | { ownerId: number; mapId: string }
    | undefined;
  return row;
}

/** The web app address that opens a read-only link. */
export const viewLinkUrl = (base: string, token: string) => `${base.replace(/\/+$/, '')}/#view=${token}`;
