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
export type VersionReason = 'auto' | 'open' | 'close' | 'restore' | 'sync';

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

/**
 * What this device remembers about a map it has synced: the server's
 * revision, a fingerprint of the content as last synced, and that content
 * itself (the common ancestor for a three-way merge).
 */
export interface SyncRecord {
  id: string;
  rev: string;
  hash: string;
  base: MindMap;
  syncedAt: string;
}

export interface SyncStateStore {
  listSync(): Promise<SyncRecord[]>;
  putSync(record: SyncRecord): Promise<void>;
  deleteSync(id: string): Promise<void>;
  clearSync(): Promise<void>;
}

/** Everything the app keeps on this device. */
export type LibraryStore = MapStore & VersionStore & LinkStore & SyncStateStore;

/** A map as a remote lists it. `rev` is opaque: a version number or an ETag. */
export interface RemoteSummary {
  id: string;
  title: string;
  rev: string;
  updatedAt?: string;
}

export interface RemoteMap {
  map: MindMap;
  rev: string;
}

/** Thrown by a remote when it holds a different revision than the one the push started from. */
export class ConflictError extends Error {
  constructor(public remote: RemoteMap) {
    super('Sunucuda daha yeni bir sürüm var.');
  }
}

/** Thrown when the server refuses the request because of who we are (signed out, revoked). */
export class AuthError extends Error {}

/** Thrown when the remote can't be reached at all (offline, DNS, TLS, CORS). */
export class NetworkError extends Error {}

/**
 * A remote sync target: Keizu Server or a WebDAV folder. `push` with a null
 * base creates the map and must reject with ConflictError when it already
 * exists; with a base it must reject when the remote has moved on.
 */
export interface SyncAdapter {
  readonly kind: 'keizu' | 'webdav';
  list(): Promise<RemoteSummary[]>;
  /** Undefined when the map is not (or no longer) on the remote. */
  pull(id: string): Promise<RemoteMap | undefined>;
  push(map: MindMap, baseRev: string | null): Promise<{ rev: string }>;
  remove(id: string): Promise<void>;
}
