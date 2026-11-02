// Passwords, device tokens and pairing codes. Passwords are hashed with
// scrypt; tokens and pairing codes are stored only as SHA-256 hashes, so a
// copy of the database does not let anyone sign in.

import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.ts';

export interface User {
  id: number;
  username: string;
  is_admin: number;
  quota_bytes: number;
  created_at: string;
}

const SCRYPT_N = 16384;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, { N: SCRYPT_N, r: 8, p: 1 });
  return `scrypt$${SCRYPT_N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, n, salt, key] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const got = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: 8, p: 1 });
  return timingSafeEqual(expected, got);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const USERNAME_RE = /^[a-zA-Z0-9._-]{2,40}$/;

export function createUser(db: Db, username: string, password: string, opts: { admin?: boolean; quotaBytes?: number } = {}): User {
  if (!USERNAME_RE.test(username)) throw new Error('Kullanıcı adı 2-40 karakter olmalı: harf, rakam, nokta, tire, alt çizgi.');
  if (password.length < 8) throw new Error('Şifre en az 8 karakter olmalı.');
  const now = new Date().toISOString();
  const r = db
    .prepare('INSERT INTO users (username, password_hash, is_admin, quota_bytes, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(username, hashPassword(password), opts.admin ? 1 : 0, opts.quotaBytes ?? 0, now);
  return getUser(db, Number(r.lastInsertRowid))!;
}

export function getUser(db: Db, id: number): User | undefined {
  return db.prepare('SELECT id, username, is_admin, quota_bytes, created_at FROM users WHERE id = ?').get(id) as User | undefined;
}

export function findUser(db: Db, username: string): (User & { password_hash: string }) | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as (User & { password_hash: string }) | undefined;
}

export function setPassword(db: Db, userId: number, password: string) {
  if (password.length < 8) throw new Error('Şifre en az 8 karakter olmalı.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), userId);
  // A new password signs every device out.
  db.prepare('DELETE FROM tokens WHERE user_id = ?').run(userId);
}

// ---------- tokens ----------

export function issueToken(db: Db, userId: number, device: string): string {
  const token = `kz_${randomBytes(32).toString('base64url')}`;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO tokens (user_id, hash, device, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)').run(
    userId,
    sha256(token),
    device.slice(0, 80) || 'Cihaz',
    now,
    now,
  );
  return token;
}

export function userForToken(db: Db, token: string): { user: User; tokenId: number } | undefined {
  const row = db.prepare('SELECT id, user_id, last_used_at FROM tokens WHERE hash = ?').get(sha256(token)) as
    | { id: number; user_id: number; last_used_at: string }
    | undefined;
  if (!row) return undefined;
  const user = getUser(db, row.user_id);
  if (!user) return undefined;
  // Write "last used" at most once a minute.
  if (Date.now() - Date.parse(row.last_used_at) > 60_000) {
    db.prepare('UPDATE tokens SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
  }
  return { user, tokenId: row.id };
}

// ---------- pairing codes ----------

export const PAIR_TTL_MS = 10 * 60 * 1000;

/** A fresh 6-digit code that signs a new device in as this user, once. */
export function createPairCode(db: Db, userId: number): { code: string; expiresAt: number } {
  const now = Date.now();
  db.prepare('DELETE FROM pair_codes WHERE expires_at < ?').run(now);
  for (;;) {
    const code = String(randomInt(1_000_000)).padStart(6, '0');
    const expiresAt = now + PAIR_TTL_MS;
    try {
      db.prepare('INSERT INTO pair_codes (hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(code), userId, expiresAt);
      return { code, expiresAt };
    } catch {
      /* the same code is already active: draw again */
    }
  }
}

/** Uses up a pairing code. Returns the user it belongs to. */
export function redeemPairCode(db: Db, code: string): number | undefined {
  const clean = code.replace(/\D/g, '');
  if (clean.length !== 6) return undefined;
  const h = sha256(clean);
  const row = db.prepare('SELECT user_id, expires_at FROM pair_codes WHERE hash = ?').get(h) as { user_id: number; expires_at: number } | undefined;
  if (!row) return undefined;
  db.prepare('DELETE FROM pair_codes WHERE hash = ?').run(h);
  return row.expires_at >= Date.now() ? row.user_id : undefined;
}

// ---------- invitations ----------
//
// Nobody else ever learns a user's password: the admin hands out a one-time
// link, and the person picks their own username and password on it. A
// password reset works the same way, bound to an existing account.

export const INVITE_TTL_MS = 7 * 24 * 3600e3;

export interface Invite {
  id: number;
  kind: 'signup' | 'reset';
  user_id: number | null;
  is_admin: number;
  quota_bytes: number;
  note: string;
  created_at: string;
  expires_at: number;
}

export function createInvite(
  db: Db,
  opts: { kind: 'signup'; admin?: boolean; quotaBytes?: number; note?: string } | { kind: 'reset'; userId: number },
): { token: string; expiresAt: number } {
  const token = randomBytes(24).toString('base64url');
  const expiresAt = Date.now() + INVITE_TTL_MS;
  db.prepare('DELETE FROM invites WHERE expires_at < ?').run(Date.now());
  if (opts.kind === 'reset') db.prepare("DELETE FROM invites WHERE kind = 'reset' AND user_id = ?").run(opts.userId);
  db.prepare('INSERT INTO invites (hash, kind, user_id, is_admin, quota_bytes, note, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    sha256(token),
    opts.kind,
    opts.kind === 'reset' ? opts.userId : null,
    opts.kind === 'signup' && opts.admin ? 1 : 0,
    opts.kind === 'signup' ? (opts.quotaBytes ?? 0) : 0,
    opts.kind === 'signup' ? (opts.note ?? '').slice(0, 100) : '',
    new Date().toISOString(),
    expiresAt,
  );
  return { token, expiresAt };
}

export function findInvite(db: Db, token: string): Invite | undefined {
  const row = db.prepare('SELECT * FROM invites WHERE hash = ?').get(sha256(token)) as Invite | undefined;
  return row && row.expires_at >= Date.now() ? row : undefined;
}

/** Uses up an invitation: creates the account, or sets the new password. */
export function acceptInvite(db: Db, token: string, username: string, password: string): User {
  const inv = findInvite(db, token);
  if (!inv) throw new Error('Davet linki geçersiz, kullanılmış veya süresi dolmuş.');
  let user: User;
  if (inv.kind === 'reset') {
    setPassword(db, inv.user_id!, password);
    user = getUser(db, inv.user_id!)!;
  } else {
    if (findUser(db, username)) throw new Error('Bu kullanıcı adı alınmış; başka bir ad seç.');
    user = createUser(db, username, password, { admin: !!inv.is_admin, quotaBytes: inv.quota_bytes });
  }
  db.prepare('DELETE FROM invites WHERE id = ?').run(inv.id);
  return user;
}

export const inviteLink = (base: string, token: string) => `${base.replace(/\/+$/, '')}/#davet=${token}`;

// ---------- brute-force protection ----------

/** Counts failures per key in a sliding window. */
export class Limiter {
  private hits = new Map<string, number[]>();
  private max: number;
  private windowMs: number;
  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  blocked(key: string, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list.length >= this.max;
  }

  fail(key: string, now = Date.now()) {
    const list = this.hits.get(key) ?? [];
    list.push(now);
    this.hits.set(key, list);
  }

  reset(key: string) {
    this.hits.delete(key);
  }
}
