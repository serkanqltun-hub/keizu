// Two people editing one map live through the real server (server/), in
// one process: sharing, the live room, presence, offline edits and undo.
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server/src/app';
import { createUser } from '../../server/src/auth';
import { openDb } from '../../server/src/db';
import { getMap } from '../../server/src/maps';
import type { MapLike } from '../core/crdt';
import { addChild, createMap, updateTopic, type MindMap } from '../core/model';
import { discover, KeizuServerAdapter, liveUrl, login } from './keizuServer';
import { LiveSession, type LiveEvents, type LivePeer } from './live';

const db = openDb(':memory:');
const server = createApp({ db, backupDir: '/tmp/unused', trustProxy: false, maxBodyBytes: 1 << 22, defaultQuotaBytes: 0 });
let base = '';
const f = (input: string, init?: RequestInit) => fetch(input, init);

beforeAll(async () => {
  createUser(db, 'serkan', 'cok-gizli-sifre');
  createUser(db, 'deniz', 'baska-gizli-sifre');
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

/** A live session plus the map it currently shows. */
function person(url: string, token: string, mapId: string, owner?: number) {
  const st = { map: null as MapLike | null, peers: [] as LivePeer[], errors: [] as string[], saved: 0 };
  let ready: () => void;
  const welcomed = new Promise<void>((r) => (ready = r));
  const ev: LiveEvents = {
    onWelcome: (w) => {
      st.map = w.map;
      ready();
    },
    onRemote: (m) => (st.map = m),
    onPeers: (p) => (st.peers = p),
    onState: () => {},
    onRole: () => {},
    onSaved: (v) => (st.saved = v),
    onError: (m) => st.errors.push(m),
  };
  const s = new LiveSession({ url, token, mapId, owner }, ev);
  return { s, st, welcomed };
}

const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

const asMap = (m: MapLike, id: string) => ({ ...createMap(), ...m, id }) as MindMap;

describe('live collaboration end to end', () => {
  it('shares a map and edits it together', async () => {
    const info = await discover(f, base);
    expect(info.features).toContain('live');
    const s1 = await login(f, info.api, 'serkan', 'cok-gizli-sifre', 'Laptop');
    const s2 = await login(f, info.api, 'deniz', 'baska-gizli-sifre', 'Telefon');
    const serkan = new KeizuServerAdapter(f, info.api, s1.token, 'Laptop');
    const deniz = new KeizuServerAdapter(f, info.api, s2.token, 'Telefon');

    const map = createMap('Ortak plan');
    await serkan.push(map, null);
    expect(await deniz.sharedWithMe()).toEqual([]);
    await expect(serkan.share(map.id, 'yok-boyle', 'edit')).rejects.toThrow(/kullanıcı/);
    const info2 = await serkan.share(map.id, 'deniz', 'edit');
    expect(info2.shares).toEqual([expect.objectContaining({ username: 'deniz', role: 'edit' })]);
    const [shared] = await deniz.sharedWithMe();
    expect(shared).toMatchObject({ id: map.id, owner: 'serkan', role: 'edit' });

    const url = liveUrl(info.api);
    const a = person(url, s1.token, map.id);
    const b = person(url, s2.token, map.id, shared.ownerId);
    await Promise.all([a.welcomed, b.welcomed]);
    await until(() => a.st.peers.length === 2 && b.st.peers.length === 2);

    // Both edit different topics at the same time.
    const [t1, t2] = map.roots[0].children;
    a.s.localChange(updateTopic(asMap(a.st.map!, map.id), t1.id, { text: 'Serkan' }));
    b.s.localChange(addChild(asMap(b.st.map!, map.id), t2.id, 'Deniz ekledi').map);
    await until(() => a.st.map!.roots[0].children[1].children.length === 1 && b.st.map!.roots[0].children[0].text === 'Serkan');

    // Selection shows up for the other person.
    b.s.select(t2.id);
    await until(() => a.st.peers.some((p) => p.name === 'deniz' && p.sel === t2.id));

    // Undo touches only Serkan's own edit.
    const undone = a.s.undo()!;
    expect(undone.roots[0].children[0].text).toBe(t1.text);
    expect(undone.roots[0].children[1].children).toHaveLength(1);
    await until(() => b.st.map!.roots[0].children[0].text === t1.text);
    a.s.redo();
    await until(() => b.st.map!.roots[0].children[0].text === 'Serkan');

    // The room saves the map on the server.
    await until(() => a.st.saved > 1, 4000);
    expect(getMap(db, 1, map.id)!.data).toContain('Deniz ekledi');

    a.s.close();
    b.s.close();
  });

  it('a viewer gets the map but cannot change it', async () => {
    const info = await discover(f, base);
    const s1 = await login(f, info.api, 'serkan', 'cok-gizli-sifre', 'Laptop');
    const s2 = await login(f, info.api, 'deniz', 'baska-gizli-sifre', 'Telefon');
    const serkan = new KeizuServerAdapter(f, info.api, s1.token, 'Laptop');
    const map = createMap('Sadece bak');
    await serkan.push(map, null);
    await serkan.share(map.id, 'deniz', 'view');
    const v = person(liveUrl(info.api), s2.token, map.id, 1);
    await v.welcomed;
    expect(v.s.role).toBe('view');
    v.s.localChange(updateTopic(asMap(v.st.map!, map.id), map.roots[0].id, { text: 'değişmez' }));
    expect(v.st.map!.roots[0].text).toBe(map.roots[0].text);
    v.s.close();
  });
});
