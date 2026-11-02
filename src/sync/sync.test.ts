import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { addChild, addRelation, createMap, findTopic, mainRoot, moveTopic, removeTopic, setMapProps, updateTopic, type MindMap } from '../core/model';
import { syncOnce, type ConflictPolicy } from './engine';
import { IdbStore } from './idbStore';
import { normalizeServer, parseConnectLink } from './keizuServer';
import { mergeMaps } from './merge';
import { ConflictError, type RemoteMap, type RemoteSummary, type SyncAdapter } from './types';
import { parsePropfind } from './webdav';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** A server in memory with the same rules as Keizu Server. */
class FakeRemote implements SyncAdapter {
  readonly kind = 'keizu' as const;
  maps = new Map<string, { map: MindMap; v: number }>();
  list = async (): Promise<RemoteSummary[]> => [...this.maps.entries()].map(([id, m]) => ({ id, title: m.map.title, rev: String(m.v) }));
  pull = async (id: string): Promise<RemoteMap | undefined> => {
    const m = this.maps.get(id);
    return m && { map: clone(m.map), rev: String(m.v) };
  };
  push = async (map: MindMap, base: string | null) => {
    const cur = this.maps.get(map.id);
    if (cur && (base === null || String(cur.v) !== base)) throw new ConflictError({ map: clone(cur.map), rev: String(cur.v) });
    const v = (cur?.v ?? 0) + 1;
    this.maps.set(map.id, { map: clone(map), v });
    return { rev: String(v) };
  };
  remove = async (id: string) => {
    this.maps.delete(id);
  };
}

const device = () => IdbStore.open(new IDBFactory());
const run = (store: IdbStore, remote: SyncAdapter, policy: ConflictPolicy = 'merge', busy?: Set<string>) =>
  syncOnce(store, remote, { policy, busy, copyTitle: (t) => `${t} (kopya)` });
const texts = (m: MindMap) => mainRoot(m).children.map((c) => c.text);

describe('mergeMaps', () => {
  const base = createMap('Plan', 'Konu');
  const [a, b] = mainRoot(base).children;

  it('combines edits to different topics', () => {
    const local = updateTopic(base, a.id, { text: 'A yerel' });
    const remote = updateTopic(base, b.id, { note: 'uzak not' });
    const m = mergeMaps(base, local, remote)!;
    expect(findTopic(m, a.id)!.text).toBe('A yerel');
    expect(findTopic(m, b.id)!.note).toBe('uzak not');
  });

  it('keeps children added on both sides, in a sensible order', () => {
    const local = addChild(base, mainRoot(base).id, 'Yerel yeni').map;
    const remote = addChild(base, mainRoot(base).id, 'Uzak yeni').map;
    const m = mergeMaps(base, local, remote)!;
    expect(texts(m)).toEqual(['Konu 1', 'Konu 2', 'Konu 3', 'Konu 4', 'Yerel yeni', 'Uzak yeni']);
  });

  it('honours a reorder on one side', () => {
    const local = moveTopic(base, b.id, mainRoot(base).id, 0);
    const remote = updateTopic(base, a.id, { text: 'A uzak' });
    expect(texts(mergeMaps(base, local, remote)!)).toEqual(['Konu 2', 'A uzak', 'Konu 3', 'Konu 4']);
  });

  it('applies a delete when the other side left the topic alone', () => {
    const local = removeTopic(base, a.id).map;
    const remote = updateTopic(base, b.id, { text: 'B' });
    expect(texts(mergeMaps(base, local, remote)!)).toEqual(['B', 'Konu 3', 'Konu 4']);
  });

  it('gives up on a real conflict', () => {
    expect(mergeMaps(base, updateTopic(base, a.id, { text: 'X' }), updateTopic(base, a.id, { text: 'Y' }))).toBeNull();
    // Deleted here, edited there.
    expect(mergeMaps(base, removeTopic(base, a.id).map, updateTopic(base, a.id, { text: 'Y' }))).toBeNull();
    // A child added under a topic the other side deleted.
    expect(mergeMaps(base, removeTopic(base, a.id).map, addChild(base, a.id, 'alt').map)).toBeNull();
    // Moves that would make a cycle.
    expect(mergeMaps(base, moveTopic(base, a.id, b.id), moveTopic(base, b.id, a.id))).toBeNull();
  });

  it('merges map settings and relations', () => {
    const local = setMapProps(addRelation(base, a.id, b.id, 'bağ').map, { theme: 'night' });
    const remote = setMapProps(base, { title: 'Yeni ad' });
    const m = mergeMaps(base, local, remote)!;
    expect(m.theme).toBe('night');
    expect(m.title).toBe('Yeni ad');
    expect(m.relations.map((r) => r.label)).toEqual(['bağ']);
    // A relation whose end was deleted disappears.
    const cut = mergeMaps(base, addRelation(base, a.id, b.id).map, removeTopic(base, b.id).map)!;
    expect(cut.relations).toEqual([]);
  });
});

describe('syncOnce', () => {
  it('moves maps between two devices through the server', async () => {
    const server = new FakeRemote();
    const [laptop, phone] = [await device(), await device()];
    const map = createMap('Ortak', 'Konu');
    await laptop.save(map);
    const r1 = await run(laptop, server);
    expect(r1.events.map((e) => e.action)).toEqual(['pushed']);
    const r2 = await run(phone, server);
    expect(r2.events.map((e) => e.action)).toEqual(['pulled']);
    expect((await phone.get(map.id))!.title).toBe('Ortak');
    // Nothing to do the second time.
    expect((await run(phone, server)).events).toEqual([]);
    expect((await run(laptop, server)).events).toEqual([]);

    // An edit on the phone reaches the laptop.
    const onPhone = (await phone.get(map.id))!;
    await phone.save(updateTopic(onPhone, mainRoot(onPhone).id, { text: 'Telefondan' }));
    expect((await run(phone, server)).events.map((e) => e.action)).toEqual(['pushed']);
    expect((await run(laptop, server)).events.map((e) => e.action)).toEqual(['pulled']);
    expect(mainRoot((await laptop.get(map.id))!).text).toBe('Telefondan');
  });

  it('merges edits made on both devices while offline', async () => {
    const server = new FakeRemote();
    const [laptop, phone] = [await device(), await device()];
    const map = createMap('Ortak', 'Konu');
    const [a, b] = mainRoot(map).children;
    await laptop.save(map);
    await run(laptop, server);
    await run(phone, server);
    await laptop.save(updateTopic(map, a.id, { text: 'Laptop' }));
    await phone.save(updateTopic((await phone.get(map.id))!, b.id, { text: 'Telefon' }));
    await run(laptop, server);
    const r = await run(phone, server);
    expect(r.events.map((e) => e.action)).toEqual(['merged']);
    await run(laptop, server);
    for (const d of [laptop, phone]) expect(texts((await d.get(map.id))!).slice(0, 2)).toEqual(['Laptop', 'Telefon']);
    expect(server.maps.get(map.id)!.v).toBe(3);
  });

  it('keeps a conflicting copy when a merge is impossible', async () => {
    const server = new FakeRemote();
    const [laptop, phone] = [await device(), await device()];
    const map = createMap('Ortak', 'Konu');
    const a = mainRoot(map).children[0];
    await laptop.save(map);
    await run(laptop, server);
    await run(phone, server);
    await laptop.save(updateTopic(map, a.id, { text: 'Laptop' }));
    await phone.save(updateTopic((await phone.get(map.id))!, a.id, { text: 'Telefon' }));
    await run(laptop, server);
    const r = await run(phone, server);
    expect(r.events.map((e) => e.action)).toEqual(['copied', 'pushed']);
    const list = await phone.list();
    expect(list.map((m) => m.title).sort()).toEqual(['Ortak', 'Ortak (kopya)']);
    expect(texts((await phone.get(map.id))!)[0]).toBe('Laptop');
    const copy = list.find((m) => m.title.endsWith('(kopya)'))!;
    expect(texts((await phone.get(copy.id))!)[0]).toBe('Telefon');
    // Nothing is lost: the copy reaches the laptop too.
    await run(laptop, server);
    expect((await laptop.list()).length).toBe(2);
  });

  it("'server' policy keeps the server's version", async () => {
    const server = new FakeRemote();
    const [laptop, phone] = [await device(), await device()];
    const map = createMap('Ortak', 'Konu');
    const a = mainRoot(map).children[0];
    await laptop.save(map);
    await run(laptop, server);
    await run(phone, server);
    await laptop.save(updateTopic(map, a.id, { text: 'Laptop' }));
    await phone.save(updateTopic((await phone.get(map.id))!, a.id, { text: 'Telefon' }));
    await run(laptop, server);
    expect((await run(phone, server, 'server')).events.map((e) => e.action)).toEqual(['keptRemote']);
    expect(texts((await phone.get(map.id))!)[0]).toBe('Laptop');
  });

  it('carries deletions both ways', async () => {
    const server = new FakeRemote();
    const [laptop, phone] = [await device(), await device()];
    const m1 = createMap('Bir', 'K');
    const m2 = createMap('İki', 'K');
    await laptop.save(m1);
    await laptop.save(m2);
    await run(laptop, server);
    await run(phone, server);
    await laptop.remove(m1.id);
    expect((await run(laptop, server)).events.map((e) => e.action)).toEqual(['removedRemote']);
    expect((await run(phone, server)).events.map((e) => e.action)).toEqual(['removedLocal']);
    expect((await phone.list()).map((m) => m.title)).toEqual(['İki']);
    // A deleted map that was edited elsewhere comes back instead.
    await phone.save(updateTopic((await phone.get(m2.id))!, mainRoot(m2).id, { text: 'Düzenlendi' }));
    await laptop.remove(m2.id);
    await run(phone, server);
    await run(laptop, server);
    const back = await laptop.list();
    expect(back.map((m) => m.id)).toEqual([m2.id]);
    expect(mainRoot((await laptop.get(m2.id))!).text).toBe('Düzenlendi');
  });

  it('never overwrites a map open in the editor', async () => {
    const server = new FakeRemote();
    const [laptop, phone] = [await device(), await device()];
    const map = createMap('Açık', 'K');
    await laptop.save(map);
    await run(laptop, server);
    await run(phone, server);
    await phone.save(updateTopic((await phone.get(map.id))!, mainRoot(map).id, { text: 'Uzaktan' }));
    await run(phone, server);
    expect((await run(laptop, server, 'merge', new Set([map.id]))).events).toEqual([]);
    expect(mainRoot((await laptop.get(map.id))!).text).toBe('Açık');
    expect((await run(laptop, server)).events.map((e) => e.action)).toEqual(['pulled']);
  });

  it('adopts identical maps found on both sides without a copy', async () => {
    const server = new FakeRemote();
    const [laptop, phone] = [await device(), await device()];
    const map = createMap('Aynı', 'K');
    await laptop.save(map);
    await phone.save(clone(map));
    await run(laptop, server);
    expect((await run(phone, server)).events).toEqual([]);
    expect((await phone.list()).length).toBe(1);
  });
});

describe('addresses and links', () => {
  it('normalises server addresses', () => {
    expect(normalizeServer('keizu.ornek.com')).toBe('https://keizu.ornek.com');
    expect(normalizeServer(' https://keizu.ornek.com/ ')).toBe('https://keizu.ornek.com');
    expect(normalizeServer('http://192.168.1.5:8787')).toBe('http://192.168.1.5:8787');
    expect(normalizeServer('https://ornek.com/.well-known/keizu')).toBe('https://ornek.com');
    expect(() => normalizeServer('ftp://x')).toThrow();
  });

  it('reads keizu://connect links', () => {
    expect(parseConnectLink('keizu://connect?server=https%3A%2F%2Fkeizu.ornek.com&code=482917')).toEqual({ server: 'https://keizu.ornek.com', code: '482917' });
    expect(parseConnectLink('keizu://connect?code=1')).toBeUndefined();
  });

  it('parses a WebDAV PROPFIND reply', () => {
    const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
      <d:response><d:href>/dav/Keizu/</d:href><d:propstat><d:prop><d:getetag/></d:prop></d:propstat></d:response>
      <d:response><d:href>/dav/Keizu/m_abc.keizu.json</d:href><d:propstat><d:prop><d:getetag>&quot;e1&quot;</d:getetag><d:getlastmodified>Mon, 02 Nov 2026 10:00:00 GMT</d:getlastmodified></d:prop></d:propstat></d:response>
      <d:response><d:href>/dav/Keizu/notes.txt</d:href></d:response>
    </d:multistatus>`;
    expect(parsePropfind(xml)).toEqual([{ name: 'm_abc.keizu.json', etag: '"e1"', modified: 'Mon, 02 Nov 2026 10:00:00 GMT' }]);
  });
});
