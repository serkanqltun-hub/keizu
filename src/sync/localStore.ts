// Fallback storage in localStorage, used only when IndexedDB is unavailable
// (some private browsing modes). It has no version history, and file links
// last for the session only.

import { normalizeMap, type MindMap } from '../core/model';
import type { FileLink, LibraryStore, MapSummary, SyncRecord, VersionInfo } from './types';

const PREFIX = 'keizu:map:';

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export class LocalMapStore implements LibraryStore {
  private links = new Map<string, FileLink>();
  private syncState = new Map<string, SyncRecord>();

  constructor(private storage: Storage = globalThis.localStorage) {}

  async list(): Promise<MapSummary[]> {
    const out: MapSummary[] = [];
    const n = safe(() => this.storage.length, 0);
    for (let i = 0; i < n; i++) {
      const key = safe(() => this.storage.key(i), null);
      if (!key?.startsWith(PREFIX)) continue;
      const m = await this.get(key.slice(PREFIX.length));
      if (m) out.push({ id: m.id, title: m.title, version: m.version, updatedAt: m.updatedAt });
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<MindMap | undefined> {
    const raw = safe(() => this.storage.getItem(PREFIX + id), null);
    if (!raw) return undefined;
    return safe(() => normalizeMap(JSON.parse(raw)), undefined);
  }

  async save(map: MindMap): Promise<void> {
    this.storage.setItem(PREFIX + map.id, JSON.stringify(map));
  }

  async remove(id: string): Promise<void> {
    safe(() => this.storage.removeItem(PREFIX + id), undefined);
  }

  async listVersions(): Promise<VersionInfo[]> {
    return [];
  }

  async getVersion(): Promise<MindMap | undefined> {
    return undefined;
  }

  async addVersion(): Promise<boolean> {
    return false;
  }

  async getLink(mapId: string) {
    return this.links.get(mapId);
  }

  async setLink(mapId: string, link: FileLink | undefined) {
    if (link) this.links.set(mapId, link);
    else this.links.delete(mapId);
  }

  async findByPath(path: string) {
    for (const [id, l] of this.links) if (l.kind === 'path' && l.path === path) return id;
    return undefined;
  }

  // Sync state lasts for the session only, like file links: after a reload
  // the next sync compares content and adopts identical maps.
  async listSync() {
    return [...this.syncState.values()];
  }

  async putSync(r: SyncRecord) {
    this.syncState.set(r.id, r);
  }

  async deleteSync(id: string) {
    this.syncState.delete(id);
  }

  async clearSync() {
    this.syncState.clear();
  }
}
