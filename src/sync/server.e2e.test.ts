// The app's Keizu Server adapter against the real server (server/), in one
// process: discovery, sign-in, pairing, and two devices syncing.
import { IDBFactory } from 'fake-indexeddb';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server/src/app';
import { createUser } from '../../server/src/auth';
import { openDb } from '../../server/src/db';
import { createMap, mainRoot, updateTopic } from '../core/model';
import { syncOnce } from './engine';
import { IdbStore } from './idbStore';
import { discover, KeizuServerAdapter, login, pair } from './keizuServer';

const db = openDb(':memory:');
const server = createApp({ db, backupDir: '/tmp/unused', trustProxy: false, maxBodyBytes: 1 << 22, defaultQuotaBytes: 0 });
let base = '';
const f = (input: string, init?: RequestInit) => fetch(input, init);

beforeAll(async () => {
  createUser(db, 'serkan', 'cok-gizli-sifre');
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

describe('Keizu Server end to end', () => {
  it('discovers, signs in, pairs a second device and syncs', async () => {
    const info = await discover(f, base);
    expect(info.compat).toBe('ok');
    expect(info.api).toBe(`${base}/api/v1`);
    await expect(login(f, info.api, 'serkan', 'yanlis', 'test')).rejects.toThrow(/yanlış/);
    const s1 = await login(f, info.api, 'serkan', 'cok-gizli-sifre', 'Laptop');
    const laptopRemote = new KeizuServerAdapter(f, info.api, s1.token, 'Laptop');
    const { code } = await laptopRemote.pairCode();
    const s2 = await pair(f, info.api, code, 'Telefon');
    const phoneRemote = new KeizuServerAdapter(f, info.api, s2.token, 'Telefon');

    const [laptop, phone] = [await IdbStore.open(new IDBFactory()), await IdbStore.open(new IDBFactory())];
    const map = createMap('Uçtan uca', 'Konu');
    const [a, b] = mainRoot(map).children;
    await laptop.save(map);
    await syncOnce(laptop, laptopRemote, { policy: 'merge' });
    await syncOnce(phone, phoneRemote, { policy: 'merge' });
    expect((await phone.get(map.id))!.title).toBe('Uçtan uca');

    await laptop.save(updateTopic(map, a.id, { text: 'Laptop' }));
    await phone.save(updateTopic((await phone.get(map.id))!, b.id, { text: 'Telefon' }));
    await syncOnce(laptop, laptopRemote, { policy: 'merge' });
    const r = await syncOnce(phone, phoneRemote, { policy: 'merge' });
    expect(r.events.map((e) => e.action)).toEqual(['merged']);
    await syncOnce(laptop, laptopRemote, { policy: 'merge' });
    const final = (await laptop.get(map.id))!;
    expect(mainRoot(final).children.slice(0, 2).map((c) => c.text)).toEqual(['Laptop', 'Telefon']);

    const versions = await laptopRemote.versions(map.id);
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(versions[0].device).toBe('Telefon');
  });
});
