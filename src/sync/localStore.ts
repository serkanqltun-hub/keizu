// Browser storage for maps. localStorage keeps the first version simple;
// it is swapped for IndexedDB (web) and real files (desktop) later without
// touching the editor, since both sit behind MapStore.

import { normalizeMap, type MindMap } from '../core/model';
import type { MapStore, MapSummary } from './types';

const PREFIX = 'keizu:map:';

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export class LocalMapStore implements MapStore {
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
}
