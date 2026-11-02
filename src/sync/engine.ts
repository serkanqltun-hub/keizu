// One sync pass between this device's library and a remote. Maps always live
// on the device first; a pass sends local changes, fetches remote ones and
// settles conflicts by the chosen policy. It never needs the network to be
// up for the app to work: a failed pass just tries again later.

import { contentHash } from '../core/versions';
import { newId, normalizeMap, type MindMap } from '../core/model';
import { AuthError, ConflictError, NetworkError, type LibraryStore, type RemoteMap, type SyncAdapter, type SyncRecord } from './types';
import { mergeMaps } from './merge';

/** What to do when both sides changed a map. */
export type ConflictPolicy = 'merge' | 'copy' | 'server';

export type SyncAction = 'pushed' | 'pulled' | 'merged' | 'copied' | 'keptRemote' | 'removedRemote' | 'removedLocal' | 'error';

export interface SyncEvent {
  at: string;
  mapId: string;
  title: string;
  action: SyncAction;
  rev?: string;
  message?: string;
}

export interface SyncOptions {
  policy: ConflictPolicy;
  /** Maps open in the editor: they are only pushed, never overwritten. */
  busy?: ReadonlySet<string>;
  /** Maps not touched at all this pass (open in a live session, which saves them itself). */
  skip?: ReadonlySet<string>;
  /** Title for a conflicting copy. */
  copyTitle?: (title: string) => string;
  onEvent?: (e: SyncEvent) => void;
}

export interface SyncResult {
  events: SyncEvent[];
  /** Maps whose local copy changed (pulled, merged, deleted). */
  changed: string[];
}

export async function syncOnce(store: LibraryStore, remote: SyncAdapter, opts: SyncOptions): Promise<SyncResult> {
  const events: SyncEvent[] = [];
  const changed = new Set<string>();
  const busy = opts.busy ?? new Set<string>();
  const copyTitle = opts.copyTitle ?? ((t: string) => `${t} (conflict)`);

  const emit = (map: { id: string; title: string }, action: SyncAction, extra: Partial<SyncEvent> = {}) => {
    const e: SyncEvent = { at: new Date().toISOString(), mapId: map.id, title: map.title, action, ...extra };
    events.push(e);
    opts.onEvent?.(e);
  };

  const record = (map: MindMap, rev: string) =>
    store.putSync({ id: map.id, rev, hash: contentHash(map), base: map, syncedAt: new Date().toISOString() });

  /** Stores a remote copy on this device, keeping the old one in history. */
  const adopt = async (incoming: RemoteMap, local: MindMap | undefined) => {
    const map = normalizeMap(incoming.map);
    if (local) await store.addVersion(local, 'sync').catch(() => {});
    await store.save({ ...map, version: Math.max(map.version, local?.version ?? 0) + 1 });
    await record(map, incoming.rev);
    changed.add(map.id);
  };

  const push = async (map: MindMap, base: string | null) => {
    const { rev } = await remote.push(map, base);
    await record(map, rev);
    emit(map, 'pushed', { rev });
  };

  /** Both sides changed `local`: settle it by the policy. */
  const resolve = async (local: MindMap, state: SyncRecord | undefined, theirs: RemoteMap) => {
    if (contentHash(local) === contentHash(theirs.map)) return record(local, theirs.rev);
    if (busy.has(local.id)) return; // settle once the editor lets go of it
    if (opts.policy === 'server') {
      await adopt(theirs, local);
      return emit(local, 'keptRemote', { rev: theirs.rev });
    }
    if (opts.policy === 'merge' && state) {
      const merged = mergeMaps(state.base, local, normalizeMap(theirs.map));
      if (merged) {
        const { rev } = await remote.push(merged, theirs.rev);
        await store.addVersion(local, 'sync').catch(() => {});
        await store.save(merged);
        await record(merged, rev);
        changed.add(local.id);
        return emit(local, 'merged', { rev });
      }
    }
    // Keep both: this device's version becomes a new map, the remote one
    // takes the original's place.
    const copy: MindMap = { ...local, id: newId('m'), title: copyTitle(local.title), updatedAt: new Date().toISOString() };
    await store.save(copy);
    await adopt(theirs, local);
    changed.add(copy.id);
    emit(local, 'copied', { rev: theirs.rev });
    await push(copy, null).catch(() => {}); // the next pass retries
  };

  const guard = async (map: { id: string; title: string }, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      if (err instanceof ConflictError) {
        const local = await store.get(map.id);
        const state = (await store.listSync()).find((s) => s.id === map.id);
        if (local) {
          try {
            await resolve(local, state, err.remote);
          } catch (e2) {
            if (e2 instanceof ConflictError) return; // moved again meanwhile: next pass
            emit(map, 'error', { message: (e2 as Error).message });
          }
        }
        return;
      }
      if (err instanceof AuthError || err instanceof NetworkError) throw err;
      emit(map, 'error', { message: (err as Error).message });
    }
  };

  const [remoteList, localList, states] = await Promise.all([remote.list(), store.list(), store.listSync()]);
  const remoteById = new Map(remoteList.map((r) => [r.id, r]));
  const stateById = new Map(states.map((s) => [s.id, s]));
  const localIds = new Set(localList.map((m) => m.id));

  for (const summary of localList) {
    if (opts.skip?.has(summary.id)) continue;
    await guard(summary, async () => {
      const local = await store.get(summary.id);
      if (!local) return;
      const st = stateById.get(local.id);
      const r = remoteById.get(local.id);
      const dirty = !st || st.hash !== contentHash(local);
      if (!st) {
        if (!r) return push(local, null);
        // On both sides but never synced here (e.g. the same file imported on two devices).
        const theirs = await remote.pull(local.id);
        if (theirs) return resolve(local, undefined, theirs);
        return push(local, null);
      }
      if (!r) {
        // Gone from the remote: deleted on another device (it sits in the
        // server's trash). Local edits since win and bring it back.
        if (dirty) return push(local, null);
        if (busy.has(local.id)) return;
        await store.addVersion(local, 'sync').catch(() => {});
        await store.remove(local.id);
        await store.deleteSync(local.id);
        changed.add(local.id);
        return emit(local, 'removedLocal');
      }
      const remoteChanged = r.rev !== st.rev;
      if (!dirty && !remoteChanged) return;
      if (dirty && !remoteChanged) return push(local, st.rev);
      if (busy.has(local.id)) return;
      const theirs = await remote.pull(local.id);
      if (!theirs) return;
      if (!dirty) {
        await adopt(theirs, local);
        return emit(local, 'pulled', { rev: theirs.rev });
      }
      return resolve(local, st, theirs);
    });
  }

  for (const r of remoteList) {
    if (localIds.has(r.id)) continue;
    await guard(r, async () => {
      if (stateById.has(r.id)) {
        // Deleted on this device since the last sync.
        if (stateById.get(r.id)!.rev === r.rev) {
          await remote.remove(r.id);
          await store.deleteSync(r.id);
          return emit(r, 'removedRemote');
        }
        // ...but changed elsewhere meanwhile: the newer content comes back.
      }
      const theirs = await remote.pull(r.id);
      if (!theirs) return;
      await adopt(theirs, undefined);
      emit(theirs.map, 'pulled', { rev: theirs.rev });
    });
  }

  // Forget maps that are gone on both sides.
  for (const s of states) if (!localIds.has(s.id) && !remoteById.has(s.id)) await store.deleteSync(s.id);

  return { events, changed: [...changed] };
}
