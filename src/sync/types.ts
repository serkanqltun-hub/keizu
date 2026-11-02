// Storage and sync contracts. The editor only talks to a MapStore; where the
// maps actually live (browser storage, desktop files, Keizu Server, WebDAV)
// is decided by the adapter behind it.

import type { MindMap } from '../core/model';

export interface MapSummary {
  id: string;
  title: string;
  version: number;
  updatedAt: string;
}

export interface MapStore {
  list(): Promise<MapSummary[]>;
  get(id: string): Promise<MindMap | undefined>;
  save(map: MindMap): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Thrown by a remote when the server holds a newer version. */
export class ConflictError extends Error {
  constructor(public remote: MindMap) {
    super('Sunucuda daha yeni bir sürüm var.');
  }
}

/**
 * A remote sync target. Implemented later by the Keizu Server and WebDAV
 * adapters; `push` must reject with ConflictError when `baseVersion` is
 * older than what the server holds.
 */
export interface SyncAdapter {
  readonly kind: 'keizu' | 'webdav';
  list(): Promise<MapSummary[]>;
  pull(id: string): Promise<MindMap>;
  push(map: MindMap, baseVersion: number): Promise<{ version: number }>;
  remove(id: string): Promise<void>;
}
