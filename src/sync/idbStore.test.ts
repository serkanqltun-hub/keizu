import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { encodeKeizu } from '../core/archive';
import { createMap, updateTopic } from '../core/model';
import { importIntoLibrary } from '../ui/library';
import { IdbStore } from './idbStore';

class MemStorage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}

const fresh = (legacy = new MemStorage()) => IdbStore.open(new IDBFactory(), legacy as unknown as Storage);

describe('IndexedDB store', () => {
  it('saves, lists and removes maps', async () => {
    const s = await fresh();
    const a = createMap('A');
    const b = { ...createMap('B'), updatedAt: new Date(Date.now() + 1000).toISOString() };
    await s.save(a);
    await s.save(b);
    expect((await s.list()).map((m) => m.title)).toEqual(['B', 'A']);
    expect(await s.get(a.id)).toEqual(a);
    await s.remove(a.id);
    expect(await s.get(a.id)).toBeUndefined();
  });

  it('moves maps over from the first release (localStorage)', async () => {
    const legacy = new MemStorage();
    const old = createMap('Eski');
    legacy.setItem(`keizu:map:${old.id}`, JSON.stringify(old));
    legacy.setItem('keizu:map:broken', '{');
    const s = await fresh(legacy);
    expect((await s.list()).map((m) => m.id)).toEqual([old.id]);
  });

  it('keeps version snapshots, skipping unchanged content', async () => {
    const s = await fresh();
    const m = createMap('V');
    expect(await s.addVersion(m, 'open')).toBe(true);
    expect(await s.addVersion({ ...m, version: 3 }, 'auto')).toBe(false);
    const m2 = updateTopic(m, m.roots[0].id, { text: 'V2' });
    expect(await s.addVersion(m2, 'auto')).toBe(true);
    const list = await s.listVersions(m.id);
    expect(list).toHaveLength(2);
    expect((await s.getVersion(list[0].id))?.roots[0].text).toBe('V2');
    await s.save(m);
    await s.remove(m.id);
    expect(await s.listVersions(m.id)).toHaveLength(0);
  });

  it('remembers file links and finds maps by path', async () => {
    const s = await fresh();
    const m = createMap('L');
    await s.save(m);
    await s.setLink(m.id, { kind: 'path', path: '/tmp/l.keizu', name: 'l.keizu' });
    expect(await s.findByPath('/tmp/l.keizu')).toBe(m.id);
    expect((await s.list())[0].fileName).toBe('l.keizu');
    await s.setLink(m.id, undefined);
    expect(await s.getLink(m.id)).toBeUndefined();
  });
});

describe('importing into the library', () => {
  it('refreshes a map from its linked file and keeps the old copy in history', async () => {
    const s = await fresh();
    const m = createMap('Dosya');
    const link = { kind: 'path' as const, path: '/x/d.keizu', name: 'd.keizu' };
    await importIntoLibrary(s, [{ name: 'd.keizu', bytes: encodeKeizu(m), link }]);
    const edited = updateTopic(m, m.roots[0].id, { text: 'Dışarıda düzenlendi' });
    const { maps } = await importIntoLibrary(s, [{ name: 'd.keizu', bytes: encodeKeizu(edited), link }]);
    expect(maps[0].id).toBe(m.id);
    expect((await s.get(m.id))?.roots[0].text).toBe('Dışarıda düzenlendi');
    expect(await s.listVersions(m.id)).toHaveLength(1);
    expect(await s.list()).toHaveLength(1);
  });

  it('brings in an unlinked file with a taken id as a copy', async () => {
    const s = await fresh();
    const m = createMap('Kopya');
    await s.save(m);
    const { maps, errors } = await importIntoLibrary(s, [
      { name: 'k.keizu', bytes: encodeKeizu(m) },
      { name: 'bozuk.keizu', bytes: new TextEncoder().encode('{') },
    ]);
    expect(maps[0].id).not.toBe(m.id);
    expect(await s.list()).toHaveLength(2);
    expect(errors[0]).toMatch(/^bozuk\.keizu:/);
  });
});
