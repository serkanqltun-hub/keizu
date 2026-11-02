// Storage and sync contracts. The editor only talks to a MapStore; where the
// maps actually live (browser storage, desktop files, Keizu Server, WebDAV)
// is decided by the adapter behind it.

import type { MindMap } from '../core/model';

export interface MapSummary {
  id: string;
  title: string;
  version: number;
  updatedAt: string;
  /** Name of the file on disk this map is kept in sync with, if any. */
  fileName?: string;
}

export interface MapStore {
  list(): Promise<MapSummary[]>;
  get(id: string): Promise<MindMap | undefined>;
  save(map: MindMap): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Why a snapshot was taken. */
export type VersionReason = 'auto' | 'open' | 'close' | 'restore';

export interface VersionInfo {
  id: number;
  mapId: string;
  savedAt: string;
  title: string;
  topics: number;
  reason: VersionReason;
  hash: string;
}

/** Automatic local version history, kept on this device only. */
export interface VersionStore {
  listVersions(mapId: string): Promise<VersionInfo[]>;
  getVersion(id: number): Promise<MindMap | undefined>;
  /** Stores a snapshot unless it matches the latest one. Returns whether it did. */
  addVersion(map: MindMap, reason: VersionReason): Promise<boolean>;
}

/**
 * Where a map is mirrored on disk. Desktop keeps a path; the web keeps a
 * File System Access handle (Chromium browsers), which survives reloads in
 * IndexedDB but needs the user's permission again in a new session.
 */
export type FileLink =
  | { kind: 'path'; path: string; name: string }
  | { kind: 'handle'; handle: FileSystemFileHandle; name: string };

export interface LinkStore {
  getLink(mapId: string): Promise<FileLink | undefined>;
  setLink(mapId: string, link: FileLink | undefined): Promise<void>;
  /** The map already linked to this desktop path, if any. */
  findByPath(path: string): Promise<string | undefined>;
}

/** Everything the app keeps on this device. */
export type LibraryStore = MapStore & VersionStore & LinkStore;

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
