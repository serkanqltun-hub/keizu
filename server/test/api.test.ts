import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, readdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { createUser, Limiter } from '../src/auth.ts';
import { backupNow, pruneBackups } from '../src/backup.ts';
import { collectBlobs, getMap, getVersion, purgeTrash, putMap } from '../src/maps.ts';

const dir = mkdtempSync(join(tmpdir(), 'keizu-test-'));
const db = openDb(join(dir, 'k.db'));
const server = createApp({ db, backupDir: join(dir, 'b'), trustProxy: false, maxBodyBytes: 1 << 20, defaultQuotaBytes: 0 });
let base = '';

before(async () => {
  createUser(db, 'ayse', 'gizli-sifre-1', { admin: true });
  createUser(db, 'mehmet', 'gizli-sifre-2', { quotaBytes: 2000 });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(base + path, { ...init, headers });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

async function login(username: string, password: string) {
  const r = await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ username, password, device: 'test' }) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.token as string;
}

const mapDoc = (id: string, title: string, extra = '') => JSON.stringify({ format: 'keizu/1', id, title, roots: [{ id: 'r', text: title + extra, children: [] }], relations: [] });

test('discovery is public and CORS-enabled', async () => {
  const r = await api('/.well-known/keizu');
  assert.equal(r.status, 200);
  assert.equal(r.json.keizu, 'server');
  assert.equal(r.json.api, '/api/v1');
  assert.equal(r.json.apiVersion, 1);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  const pre = await fetch(base + '/api/v1/maps', { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers') ?? '', /If-Match/);
});

test('sign-in rejects bad passwords and protects routes', async () => {
  const bad = await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ username: 'ayse', password: 'yanlis' }) });
  assert.equal(bad.status, 401);
  assert.equal((await api('/api/v1/maps')).status, 401);
  assert.equal((await api('/api/v1/maps', { token: 'kz_nope' })).status, 401);
  const token = await login('AYSE', 'gizli-sifre-1'); // usernames ignore case
  const me = await api('/api/v1/me', { token });
  assert.equal(me.json.user.username, 'ayse');
  assert.equal(me.json.user.admin, true);
});

test('maps: create, read, update with versions, conflicts, delete, restore', async () => {
  const token = await login('ayse', 'gizli-sifre-1');
  const put = (id: string, body: string, headers: Record<string, string>) => api(`/api/v1/maps/${id}`, { method: 'PUT', token, body, headers });

  assert.equal((await put('m1', mapDoc('m1', 'Bir'), {})).status, 428);
  assert.equal((await put('m1', mapDoc('m2', 'Bir'), { 'If-None-Match': '*' })).status, 400, 'id must match the URL');

  const c = await put('m1', mapDoc('m1', 'Bir'), { 'If-None-Match': '*' });
  assert.equal(c.status, 200);
  assert.equal(c.json.version, 1);
  assert.equal((await put('m1', mapDoc('m1', 'Bir'), { 'If-None-Match': '*' })).status, 412, 'creating twice is refused');

  const g = await api('/api/v1/maps/m1', { token });
  assert.equal(g.json.title, 'Bir');
  assert.equal(g.headers.get('x-keizu-version'), '1');

  const u = await put('m1', mapDoc('m1', 'Bir v2'), { 'If-Match': '"1"' });
  assert.equal(u.json.version, 2);

  const stale = await put('m1', mapDoc('m1', 'Eski'), { 'If-Match': '1' });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.version, 2);
  assert.equal(stale.json.map.title, 'Bir v2');

  const list = await api('/api/v1/maps', { token });
  assert.deepEqual(
    list.json.maps.map((m: any) => [m.id, m.title, m.version]),
    [['m1', 'Bir v2', 2]],
  );

  const versions = await api('/api/v1/maps/m1/versions', { token });
  assert.deepEqual(versions.json.versions.map((v: any) => v.version), [2, 1]);
  const v1 = await api('/api/v1/maps/m1/versions/1', { token });
  assert.equal(v1.json.title, 'Bir');

  const ch0 = await api('/api/v1/changes?since=0', { token });
  const cursor = ch0.json.cursor;
  assert.equal((await api('/api/v1/maps/m1', { method: 'DELETE', token })).status, 200);
  assert.equal((await api('/api/v1/maps/m1', { token })).status, 404);
  const ch = await api(`/api/v1/changes?since=${cursor}`, { token });
  assert.deepEqual(ch.json.changes.map((x: any) => [x.id, x.deleted]), [['m1', true]]);
  assert.equal((await api('/api/v1/trash', { token })).json.maps.length, 1);

  assert.equal((await api('/api/v1/maps/m1/restore', { method: 'POST', token })).status, 200);
  assert.equal((await api('/api/v1/maps/m1', { token })).json.title, 'Bir v2');

  // After a delete, a device may recreate the map; versions keep counting.
  await api('/api/v1/maps/m1', { method: 'DELETE', token });
  const again = await put('m1', mapDoc('m1', 'Yeniden'), { 'If-None-Match': '*' });
  assert.equal(again.json.version, 3);
});

test('each user only sees their own maps; quotas apply', async () => {
  const a = await login('ayse', 'gizli-sifre-1');
  const m = await login('mehmet', 'gizli-sifre-2');
  await api('/api/v1/maps/gizli', { method: 'PUT', token: a, body: mapDoc('gizli', 'Ayşe'), headers: { 'If-None-Match': '*' } });
  assert.equal((await api('/api/v1/maps/gizli', { token: m })).status, 404);
  assert.equal((await api('/api/v1/maps', { token: m })).json.maps.length, 0);
  // Mehmet may write his own map with the same id.
  assert.equal((await api('/api/v1/maps/gizli', { method: 'PUT', token: m, body: mapDoc('gizli', 'M'), headers: { 'If-None-Match': '*' } })).status, 200);
  const big = mapDoc('buyuk', 'B', 'x'.repeat(3000));
  const r = await api('/api/v1/maps/buyuk', { method: 'PUT', token: m, body: big, headers: { 'If-None-Match': '*' } });
  assert.equal(r.status, 413);
  assert.equal(r.json.error, 'quota');
});

test('pairing codes sign a device in once', async () => {
  const token = await login('ayse', 'gizli-sifre-1');
  const p = await api('/api/v1/pair-codes', { method: 'POST', token });
  assert.match(p.json.code, /^\d{6}$/);
  assert.match(p.json.link, /^keizu:\/\/connect\?server=http/);
  assert.match(p.json.qrSvg, /^<svg/);
  const ok = await api('/api/v1/auth/pair', { method: 'POST', body: JSON.stringify({ code: p.json.code.slice(0, 3) + ' ' + p.json.code.slice(3), device: 'Telefon' }) });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.username, 'ayse');
  assert.equal((await api('/api/v1/me', { token: ok.json.token })).status, 200);
  const twice = await api('/api/v1/auth/pair', { method: 'POST', body: JSON.stringify({ code: p.json.code }) });
  assert.equal(twice.status, 401);

  const devices = await api('/api/v1/devices', { token });
  const phone = devices.json.devices.find((d: any) => d.device === 'Telefon');
  assert.ok(phone);
  await api(`/api/v1/devices/${phone.id}`, { method: 'DELETE', token });
  assert.equal((await api('/api/v1/me', { token: ok.json.token })).status, 401, 'revoked device is signed out');
});

test('accounts are made by invitation; the invitee picks the password', async () => {
  const a = await login('ayse', 'gizli-sifre-1');
  const m = await login('mehmet', 'gizli-sifre-2');
  assert.equal((await api('/api/v1/admin/users', { token: m })).status, 403);
  assert.equal((await api('/api/v1/admin/invites', { method: 'POST', token: m, body: '{}' })).status, 403);

  const inv = await api('/api/v1/admin/invites', { method: 'POST', token: a, body: JSON.stringify({ quotaMb: 100, note: 'Zeynep' }) });
  assert.equal(inv.status, 201);
  const token = inv.json.link.split('#davet=')[1];
  assert.ok(token.length > 20);
  assert.equal((await api('/api/v1/admin/invites', { token: a })).json.invites[0].note, 'Zeynep');

  assert.equal((await api('/api/v1/invites/yanlis')).status, 404);
  assert.equal((await api(`/api/v1/invites/${token}`)).json.kind, 'signup');
  const taken = await api(`/api/v1/invites/${token}`, { method: 'POST', body: JSON.stringify({ username: 'mehmet', password: 'zeynep-sifre' }) });
  assert.equal(taken.status, 400, 'existing usernames are refused');
  const weak = await api(`/api/v1/invites/${token}`, { method: 'POST', body: JSON.stringify({ username: 'zeynep', password: 'kisa' }) });
  assert.equal(weak.status, 400);
  const ok = await api(`/api/v1/invites/${token}`, { method: 'POST', body: JSON.stringify({ username: 'zeynep', password: 'zeynep-sifre' }) });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.username, 'zeynep');
  assert.equal((await api(`/api/v1/invites/${token}`, { method: 'POST', body: JSON.stringify({ username: 'z2', password: 'zeynep-sifre' }) })).status, 404, 'one use only');
  await login('zeynep', 'zeynep-sifre');

  const users = await api('/api/v1/admin/users', { token: a });
  assert.deepEqual(users.json.users.map((u: any) => u.username), ['ayse', 'mehmet', 'zeynep']);
  const z = users.json.users.find((u: any) => u.username === 'zeynep');
  assert.equal(z.quotaMb, 100);

  // A reset is a link too; the admin never sees the new password.
  const reset = await api(`/api/v1/admin/users/${z.id}`, { method: 'PATCH', token: a, body: JSON.stringify({ resetPassword: true }) });
  assert.equal(reset.json.password, undefined);
  const rt = reset.json.resetLink.split('#davet=')[1];
  assert.equal((await api(`/api/v1/invites/${rt}`)).json.username, 'zeynep');
  assert.equal((await api(`/api/v1/invites/${rt}`, { method: 'POST', body: JSON.stringify({ password: 'yepyeni-sifre' }) })).status, 200);
  await login('zeynep', 'yepyeni-sifre');

  assert.equal((await api(`/api/v1/admin/users/${z.id}`, { method: 'DELETE', token: a })).status, 200);
  const backup = await fetch(base + '/api/v1/admin/backup', { headers: { Authorization: `Bearer ${a}` } });
  assert.equal(backup.status, 200);
  const bytes = Buffer.from(await backup.arrayBuffer());
  assert.equal(bytes.subarray(0, 15).toString(), 'SQLite format 3');
});

test('panel page is served with a strict CSP', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  assert.match(await r.text(), /Keizu Server/);
});

test('backups rotate and old trash is purged', () => {
  const bdir = join(dir, 'rot');
  for (let i = 0; i < 4; i++) {
    const f = backupNow(db, bdir, new Date(Date.UTC(2026, 0, 1 + i)));
    utimesSync(f, new Date(Date.UTC(2026, 0, 1 + i)), new Date(Date.UTC(2026, 0, 1 + i)));
  }
  pruneBackups(bdir, 2);
  assert.deepEqual(readdirSync(bdir).sort(), ['keizu-2026-01-03-00-00-00.db', 'keizu-2026-01-04-00-00-00.db']);
  // m1 was deleted in an earlier test... restore state: delete something fresh.
  const uid = (db.prepare("SELECT id FROM users WHERE username = 'ayse'").get() as { id: number }).id;
  db.prepare("UPDATE maps SET deleted_at = '2000-01-01T00:00:00.000Z' WHERE user_id = ? AND id = 'gizli'").run(uid);
  assert.equal(purgeTrash(db), 1);
  const row = db.prepare("SELECT data, deleted_at FROM maps WHERE user_id = ? AND id = 'gizli'").get(uid) as { data: string | null; deleted_at: string };
  assert.equal(row.data, null);
  assert.ok(row.deleted_at, 'tombstone stays so other devices learn of the deletion');
});

test('limits: picture size, server total, free disk', () => {
  const uid = (db.prepare("SELECT id FROM users WHERE username = 'ayse'").get() as { id: number }).id;
  const withImage = (kb: number) =>
    JSON.stringify({ format: 'keizu/1', id: 'img', title: 'G', roots: [{ id: 'r', text: 'x', children: [] }], relations: [], resources: { a: 'data:image/png;base64,' + 'A'.repeat(kb * 1365) } });
  const big = putMap(db, uid, 'img', withImage(200), null, { device: 't', quotaBytes: 0, maxImageBytes: 100 * 1024 });
  assert.equal(big.ok, false);
  assert.equal(!big.ok && big.reason, 'image');
  assert.equal(putMap(db, uid, 'img', withImage(50), null, { device: 't', quotaBytes: 0, maxImageBytes: 100 * 1024 }).ok, true);
  const full = putMap(db, uid, 'img2', mapDoc('img2', 'x'), null, { device: 't', quotaBytes: 0, totalBytes: 1000 });
  assert.equal(!full.ok && full.reason, 'full');
  const disk = putMap(db, uid, 'img3', mapDoc('img3', 'x'), null, { device: 't', quotaBytes: 0, minFreeBytes: 1e9, freeBytes: () => 5e8 });
  assert.equal(!disk.ok && disk.reason, 'full');
});

test('pictures are stored once across versions', () => {
  const uid = (db.prepare("SELECT id FROM users WHERE username = 'mehmet'").get() as { id: number }).id;
  const pic = 'data:image/png;base64,' + 'QUJD'.repeat(200);
  const doc = (text: string) => JSON.stringify({ format: 'keizu/1', id: 'pic', title: 'P', roots: [{ id: 'r', text, image: { res: 'a', width: 1, height: 1 }, children: [] }], relations: [], resources: { a: pic } });
  const blobs = () => (db.prepare('SELECT COUNT(*) AS n FROM blobs WHERE user_id = ?').get(uid) as { n: number }).n;
  const before = blobs();
  assert.equal(putMap(db, uid, 'pic', doc('bir'), null, { device: 't', quotaBytes: 0 }).ok, true);
  assert.equal(putMap(db, uid, 'pic', doc('iki'), 1, { device: 't', quotaBytes: 0 }).ok, true);
  assert.equal(blobs(), before + 1);
  const stored = db.prepare("SELECT data, size FROM map_versions WHERE user_id = ? AND map_id = 'pic' AND version = 1").get(uid) as { data: string; size: number };
  assert.ok(stored.size < 300, 'history rows hold a reference, not the picture');
  assert.equal(JSON.parse(getMap(db, uid, 'pic')!.data).resources.a, pic);
  assert.equal(JSON.parse(getVersion(db, uid, 'pic', 1)!).resources.a, pic);
  assert.equal(collectBlobs(db), 0, 'still referenced');
  db.prepare("DELETE FROM map_versions WHERE user_id = ? AND map_id = 'pic'").run(uid);
  db.prepare("DELETE FROM maps WHERE user_id = ? AND id = 'pic'").run(uid);
  assert.equal(collectBlobs(db) >= 1, true);
  assert.equal(blobs(), before);
});

test('limiter blocks after too many failures', () => {
  const l = new Limiter(3, 1000);
  for (let i = 0; i < 3; i++) l.fail('k', 0);
  assert.equal(l.blocked('k', 10), true);
  assert.equal(l.blocked('k', 2000), false);
});
