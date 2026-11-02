import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { createUser } from '../src/auth.ts';
import { getMap } from '../src/maps.ts';
import { applyOps, diff, materialize, stamp, type CrdtDoc, type Op } from '../../src/core/crdt.ts';

const dir = mkdtempSync(join(tmpdir(), 'keizu-share-'));
const db = openDb(join(dir, 'k.db'));
const server = createApp({ db, backupDir: join(dir, 'b'), trustProxy: false, maxBodyBytes: 1 << 20, defaultQuotaBytes: 0 });
let base = '';
let ws = '';
const tokens: Record<string, string> = {};

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

const doc = (id: string, title: string) =>
  JSON.stringify({ format: 'keizu/1', id, title, theme: 'fresh', layout: 'mindmap', branchStyle: 'curve', multicolor: true, roots: [{ id: 'root', text: title, children: [{ id: 'a', text: 'A', children: [] }] }], relations: [] });

before(async () => {
  for (const [u, p] of [['ayse', 'sifre-ayse-1'], ['mehmet', 'sifre-mehmet-1'], ['zeynep', 'sifre-zeynep-1']]) {
    createUser(db, u, p);
  }
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  ws = `ws://127.0.0.1:${port}/api/v1/live`;
  for (const [u, p] of [['ayse', 'sifre-ayse-1'], ['mehmet', 'sifre-mehmet-1'], ['zeynep', 'sifre-zeynep-1']]) {
    const r = await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p, device: 't' }) });
    tokens[u] = r.json.token;
  }
  const put = await api('/api/v1/maps/m1', { method: 'PUT', token: tokens.ayse, headers: { 'If-None-Match': '*' }, body: doc('m1', 'Plan') });
  assert.equal(put.status, 200);
  await api('/api/v1/maps/m2', { method: 'PUT', token: tokens.ayse, headers: { 'If-None-Match': '*' }, body: doc('m2', 'Gizli') });
});

after(() => {
  server.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('discovery lists the new features', async () => {
  const r = await api('/.well-known/keizu');
  assert.deepEqual(r.json.features, ['share', 'live', 'viewLinks']);
});

test('sharing is per map and per person', async () => {
  const none = await api('/api/v1/shared', { token: tokens.mehmet });
  assert.deepEqual(none.json.maps, []);
  const bad = await api('/api/v1/maps/m1/shares/kimse', { method: 'PUT', token: tokens.ayse, body: JSON.stringify({ role: 'edit' }) });
  assert.equal(bad.status, 404);
  const self = await api('/api/v1/maps/m1/shares/ayse', { method: 'PUT', token: tokens.ayse, body: JSON.stringify({ role: 'edit' }) });
  assert.equal(self.status, 400);
  const role = await api('/api/v1/maps/m1/shares/mehmet', { method: 'PUT', token: tokens.ayse, body: JSON.stringify({ role: 'owner' }) });
  assert.equal(role.status, 400);
  const ok = await api('/api/v1/maps/m1/shares/mehmet', { method: 'PUT', token: tokens.ayse, body: JSON.stringify({ role: 'edit' }) });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.shares.map((s: any) => [s.username, s.role]), [['mehmet', 'edit']]);
  await api('/api/v1/maps/m1/shares/zeynep', { method: 'PUT', token: tokens.ayse, body: JSON.stringify({ role: 'view' }) });

  // Mehmet sees only m1, never Ayşe's library.
  const list = await api('/api/v1/shared', { token: tokens.mehmet });
  assert.deepEqual(list.json.maps.map((m: any) => [m.id, m.role, m.owner]), [['m1', 'edit', 'ayse']]);
  const ownerId = list.json.maps[0].ownerId;
  const read = await api(`/api/v1/shared/${ownerId}/m1`, { token: tokens.mehmet });
  assert.equal(read.status, 200);
  assert.equal(read.headers.get('x-keizu-role'), 'edit');
  assert.equal((await api(`/api/v1/shared/${ownerId}/m2`, { token: tokens.mehmet })).status, 404);
  assert.equal((await api('/api/v1/maps/m1', { token: tokens.mehmet })).status, 404);
  // Only the owner manages shares.
  assert.equal((await api('/api/v1/maps/m1/shares', { token: tokens.mehmet })).status, 404);
  const mine = await api('/api/v1/maps', { token: tokens.ayse });
  assert.equal(mine.json.maps.find((m: any) => m.id === 'm1').sharedWith, 2);
});

test('read-only links can be made, used without an account, and revoked', async () => {
  const made = await api('/api/v1/maps/m1/link', { method: 'POST', token: tokens.ayse });
  assert.equal(made.status, 200);
  const link = made.json.link as string;
  assert.match(link, /\/#view=[A-Za-z0-9_-]+$/);
  const token = link.split('#view=')[1];
  // The same link comes back on a second call.
  assert.equal((await api('/api/v1/maps/m1/link', { method: 'POST', token: tokens.ayse })).json.link, link);
  const pub = await api(`/api/v1/public/${token}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.json.title, 'Plan');
  await api('/api/v1/maps/m1/link', { method: 'DELETE', token: tokens.ayse });
  assert.equal((await api(`/api/v1/public/${token}`)).status, 404);
});

interface Conn {
  ws: WebSocket;
  msgs: any[];
  next(type: string): Promise<any>;
}

function connect(token: string, map: string, owner?: number): Promise<Conn> {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(ws);
    const msgs: any[] = [];
    const waiters: { type: string; fn: (m: any) => void }[] = [];
    const conn: Conn = {
      ws: sock,
      msgs,
      next(type) {
        const i = msgs.findIndex((m) => m.type === type);
        if (i >= 0) return Promise.resolve(msgs.splice(i, 1)[0]);
        return new Promise((r, j) => {
          const timer = setTimeout(() => j(new Error(`no ${type}`)), 3000);
          waiters.push({ type, fn: (m) => (clearTimeout(timer), r(m)) });
        });
      },
    };
    sock.onopen = () => {
      sock.send(JSON.stringify({ type: 'hello', token, map, owner }));
      resolve(conn);
    };
    sock.onerror = () => reject(new Error('ws error'));
    sock.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      const w = waiters.findIndex((x) => x.type === m.type);
      if (w >= 0) waiters.splice(w, 1)[0].fn(m);
      else msgs.push(m);
    };
  });
}

test('live editing: owner and editor see each other, viewers cannot write, edits are saved', async () => {
  const ownerId = (await api('/api/v1/shared', { token: tokens.mehmet })).json.maps[0].ownerId;
  const a = await connect(tokens.ayse, 'm1');
  const wa = await a.next('welcome');
  assert.equal(wa.role, 'owner');
  const m = await connect(tokens.mehmet, 'm1', ownerId);
  const wm = await m.next('welcome');
  assert.equal(wm.role, 'edit');
  assert.equal(wm.peers.length, 2);
  const peers = await a.next('peers');
  assert.deepEqual(peers.peers.map((p: any) => p.name).sort(), ['ayse', 'mehmet']);

  // Mehmet renames topic A.
  const docM: CrdtDoc = wm.doc;
  const mapM = materialize(docM);
  mapM.roots[0].children[0].text = 'Mehmet yazdı';
  const ops: Op[] = stamp(docM, diff(docM, mapM), wm.actor);
  applyOps(docM, ops);
  m.ws.send(JSON.stringify({ type: 'ops', ops }));
  const got = await a.next('ops');
  const docA: CrdtDoc = wa.doc;
  applyOps(docA, got.ops);
  assert.equal(materialize(docA).roots[0].children[0].text, 'Mehmet yazdı');

  // Ops must carry the sender's own actor id.
  m.ws.send(JSON.stringify({ type: 'ops', ops: ops.map((o) => ({ ...o, t: [o.t[0] + 1, wa.actor] })) }));
  assert.equal((await m.next('error')).code, 'bad_ops');

  // Selection is shared.
  m.ws.send(JSON.stringify({ type: 'sel', id: 'a' }));
  assert.equal((await a.next('sel')).id, 'a');

  // A viewer joins and can't write.
  const z = await connect(tokens.zeynep, 'm1', ownerId);
  const wz = await z.next('welcome');
  assert.equal(wz.role, 'view');
  z.ws.send(JSON.stringify({ type: 'ops', ops: [] }));
  assert.equal((await z.next('error')).code, 'read_only');

  // Saved shortly after the last edit.
  const saved = await a.next('saved');
  assert.ok(saved.version > 1);
  assert.match(getMap(db, ownerId, 'm1')!.data, /Mehmet yazdı/);

  // A device saving over REST meanwhile is merged into the room.
  const cur = await api('/api/v1/maps/m1', { token: tokens.ayse });
  const next = { ...cur.json, roots: [{ ...cur.json.roots[0], children: [...cur.json.roots[0].children, { id: 'b', text: 'REST', children: [] }] }] };
  const put = await api('/api/v1/maps/m1', { method: 'PUT', token: tokens.ayse, headers: { 'If-Match': `"${cur.headers.get('x-keizu-version')}"` }, body: JSON.stringify(next) });
  assert.equal(put.status, 200);
  const merged = await m.next('ops');
  applyOps(docM, merged.ops);
  assert.deepEqual(materialize(docM).roots[0].children.map((c) => c.text), ['Mehmet yazdı', 'REST']);

  // Removing the share drops Mehmet from the room.
  const closed = new Promise<number>((r) => (m.ws.onclose = (e) => r(e.code)));
  await api('/api/v1/maps/m1/shares/mehmet', { method: 'DELETE', token: tokens.ayse });
  assert.equal(await closed, 4403);

  a.ws.close();
  z.ws.close();
});

test('live: strangers and bad tokens are refused', async () => {
  const s = await connect(tokens.zeynep, 'm2', 1);
  assert.equal((await s.next('error')).code, 'not_found');
  const b = await connect('nope', 'm1');
  assert.equal((await b.next('error')).code, 'unauthorized');
});
