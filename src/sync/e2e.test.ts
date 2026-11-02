import { describe, expect, it } from 'vitest';
import { createMap, updateTopic } from '../core/model';
import { decryptMap, DecryptError, EncryptingAdapter, encryptMap, isEncrypted, newSalt } from './e2e';
import { syncOnce } from './engine';
import { ConflictError, type RemoteMap, type SyncAdapter } from './types';
import { IDBFactory } from 'fake-indexeddb';
import { IdbStore } from './idbStore';

class MemoryRemote implements SyncAdapter {
  readonly kind = 'keizu' as const;
  maps = new Map<string, RemoteMap>();
  async list() {
    return [...this.maps.values()].map((r) => ({ id: r.map.id, title: r.map.title, rev: r.rev }));
  }
  async pull(id: string) {
    return this.maps.get(id);
  }
  async push(map: RemoteMap['map'], base: string | null) {
    const cur = this.maps.get(map.id);
    if ((cur?.rev ?? null) !== base) throw new ConflictError(cur!);
    const rev = String(Number(cur?.rev ?? 0) + 1);
    this.maps.set(map.id, { map: JSON.parse(JSON.stringify(map)), rev });
    return { rev };
  }
  async remove(id: string) {
    this.maps.delete(id);
  }
}

describe('end-to-end encryption', () => {
  it('round-trips and hides the content', async () => {
    const map = updateTopic(createMap('Gizli plan'), createMap().roots[0].id, {});
    const salt = newSalt();
    const enc = await encryptMap(map, 'uzun-bir-parola', salt);
    expect(isEncrypted(enc)).toBe(true);
    expect(JSON.stringify(enc)).not.toContain('Gizli plan');
    expect(enc.id).toBe(map.id);
    const back = await decryptMap(enc, 'uzun-bir-parola');
    expect(back.title).toBe('Gizli plan');
    expect(back.roots).toEqual(map.roots);
    await expect(decryptMap(enc, 'yanlis-parola')).rejects.toBeInstanceOf(DecryptError);
  });

  it('syncs two devices through a server that only sees ciphertext', async () => {
    const remote = new MemoryRemote();
    const salt1 = newSalt(), salt2 = newSalt();
    const a = await IdbStore.open(new IDBFactory()), b = await IdbStore.open(new IDBFactory());
    const map = createMap('Şifreli harita');
    await a.save(map);
    await syncOnce(a, new EncryptingAdapter(remote, 'ortak-parola-1', salt1), { policy: 'merge' });
    expect(JSON.stringify([...remote.maps.values()])).not.toContain('Şifreli harita');
    await syncOnce(b, new EncryptingAdapter(remote, 'ortak-parola-1', salt2), { policy: 'merge' });
    expect((await b.get(map.id))?.title).toBe('Şifreli harita');
  });
});
