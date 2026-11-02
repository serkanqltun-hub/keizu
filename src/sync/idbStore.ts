// IndexedDB storage: the map library, the local version history and links
// to files on disk. Used on the web and inside the desktop shell. Unlike
// localStorage it holds large maps with images and does not block the UI.

import { contentHash, versionsToDrop } from '../core/versions';
import { countAll, normalizeMap, type MindMap } from '../core/model';
import type { FileLink, LibraryStore, MapSummary, SyncRecord, VersionInfo, VersionReason } from './types';

const DB_NAME = 'keizu';
const DB_VERSION = 2;
const LEGACY_PREFIX = 'keizu:map:';

interface VersionRow extends Omit<VersionInfo, 'id'> {
  id?: number;
  map: MindMap;
}

interface LinkRow {
  mapId: string;
  link: FileLink;
  path?: string;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('İşlem iptal edildi.'));
  });
}

export function openKeizuDb(factory: IDBFactory = indexedDB, legacy?: Storage): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = (e) => {
      const db = open.result;
      if (e.oldVersion < 1) {
        const maps = db.createObjectStore('maps', { keyPath: 'id' });
        const versions = db.createObjectStore('versions', { keyPath: 'id', autoIncrement: true });
        versions.createIndex('mapId', 'mapId');
        const links = db.createObjectStore('links', { keyPath: 'mapId' });
        links.createIndex('path', 'path');
        // Bring over maps saved by the first release (localStorage). The old
        // copies stay where they are, as a fallback.
        try {
          const ls = legacy ?? globalThis.localStorage;
          for (let i = 0; ls && i < ls.length; i++) {
            const key = ls.key(i);
            if (!key?.startsWith(LEGACY_PREFIX)) continue;
            try {
              maps.put(normalizeMap(JSON.parse(ls.getItem(key)!)));
            } catch {
              /* skip unreadable entries */
            }
          }
        } catch {
          /* no localStorage */
        }
      }
      if (e.oldVersion < 2) db.createObjectStore('sync', { keyPath: 'id' });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('Keizu başka bir sekmede güncelleniyor; o sekmeyi kapatıp yeniden dene.'));
  });
}

export class IdbStore implements LibraryStore {
  constructor(private db: IDBDatabase) {}

  static async open(factory?: IDBFactory, legacy?: Storage): Promise<IdbStore> {
    return new IdbStore(await openKeizuDb(factory, legacy));
  }

  private store(name: string, mode: IDBTransactionMode = 'readonly') {
    return this.db.transaction(name, mode).objectStore(name);
  }

  // ---------- maps ----------

  async list(): Promise<MapSummary[]> {
    const [maps, links] = await Promise.all([
      req(this.store('maps').getAll()) as Promise<MindMap[]>,
      req(this.store('links').getAll()) as Promise<LinkRow[]>,
    ]);
    const names = new Map(links.map((l) => [l.mapId, l.link.name]));
    return maps
      .map((m) => ({ id: m.id, title: m.title, version: m.version, updatedAt: m.updatedAt, fileName: names.get(m.id) }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<MindMap | undefined> {
    const m = (await req(this.store('maps').get(id))) as MindMap | undefined;
    return m ? normalizeMap(m) : undefined;
  }

  async save(map: MindMap): Promise<void> {
    const tx = this.db.transaction('maps', 'readwrite');
    tx.objectStore('maps').put(map);
    await done(tx);
  }

  async remove(id: string): Promise<void> {
    const tx = this.db.transaction(['maps', 'versions', 'links'], 'readwrite');
    tx.objectStore('maps').delete(id);
    tx.objectStore('links').delete(id);
    const idx = tx.objectStore('versions').index('mapId');
    const keys = await req(idx.getAllKeys(id));
    keys.forEach((k) => tx.objectStore('versions').delete(k));
    await done(tx);
  }

  // ---------- version history ----------

  async listVersions(mapId: string): Promise<VersionInfo[]> {
    const rows = (await req(this.store('versions').index('mapId').getAll(mapId))) as VersionRow[];
    return rows
      .map(({ map: _m, ...info }) => info as VersionInfo)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async getVersion(id: number): Promise<MindMap | undefined> {
    const row = (await req(this.store('versions').get(id))) as VersionRow | undefined;
    return row ? normalizeMap(row.map) : undefined;
  }

  async addVersion(map: MindMap, reason: VersionReason): Promise<boolean> {
    const hash = contentHash(map);
    const existing = await this.listVersions(map.id);
    if (existing[0]?.hash === hash) return false;
    const tx = this.db.transaction('versions', 'readwrite');
    const os = tx.objectStore('versions');
    const row: VersionRow = { mapId: map.id, savedAt: new Date().toISOString(), title: map.title, topics: countAll(map), reason, hash, map };
    os.add(row);
    const stamps = [{ id: -1, savedAt: row.savedAt }, ...existing];
    for (const id of versionsToDrop(stamps)) if (id !== -1) os.delete(id);
    await done(tx);
    return true;
  }

  // ---------- file links ----------

  async getLink(mapId: string): Promise<FileLink | undefined> {
    const row = (await req(this.store('links').get(mapId))) as LinkRow | undefined;
    return row?.link;
  }

  async setLink(mapId: string, link: FileLink | undefined): Promise<void> {
    const tx = this.db.transaction('links', 'readwrite');
    if (link) tx.objectStore('links').put({ mapId, link, path: link.kind === 'path' ? link.path : undefined } satisfies LinkRow);
    else tx.objectStore('links').delete(mapId);
    await done(tx);
  }

  async findByPath(path: string): Promise<string | undefined> {
    const row = (await req(this.store('links').index('path').get(path))) as LinkRow | undefined;
    return row?.mapId;
  }

  // ---------- sync state ----------

  async listSync(): Promise<SyncRecord[]> {
    return (await req(this.store('sync').getAll())) as SyncRecord[];
  }

  async putSync(record: SyncRecord): Promise<void> {
    const tx = this.db.transaction('sync', 'readwrite');
    tx.objectStore('sync').put(record);
    await done(tx);
  }

  async deleteSync(id: string): Promise<void> {
    const tx = this.db.transaction('sync', 'readwrite');
    tx.objectStore('sync').delete(id);
    await done(tx);
  }

  async clearSync(): Promise<void> {
    const tx = this.db.transaction('sync', 'readwrite');
    tx.objectStore('sync').clear();
    await done(tx);
  }
}
