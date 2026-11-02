// Connects the editor to a live session on Keizu Server: always for a map
// someone shared with you, and for your own map once it is shared with
// someone. Without a connected server that supports it, nothing happens.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MapLike } from '../core/crdt';
import { normalizeMap, type MindMap } from '../core/model';
import { contentHash } from '../core/versions';
import { sync } from '../sync/controller';
import { KeizuServerAdapter } from '../sync/keizuServer';
import { LiveSession, type LivePeer, type LiveRole, type LiveState } from '../sync/live';
import { mergeMaps } from '../sync/merge';
import type { LibraryStore } from '../sync/types';
import { t } from '../i18n';

/** A map from another account, opened from "Shared with me". */
export interface SharedRef {
  ownerId: number;
  owner: string;
  role: 'view' | 'edit';
}

interface Args {
  mapId: string;
  shared?: SharedRef;
  store: LibraryStore;
  /** The editor's current map (read when needed, not a dependency). */
  current: () => MindMap;
  /** Replaces the editor's map with one that came from the session. */
  showRemote(map: MindMap): void;
  toast(msg: string): void;
}

export interface LiveApi {
  session: LiveSession | null;
  state: LiveState | 'off';
  peers: LivePeer[];
  role: LiveRole;
  /** Starts the session (e.g. right after the first share). */
  enable(): void;
}

export function useLive({ mapId, shared, store, current, showRemote, toast }: Args): LiveApi {
  const [want, setWant] = useState(!!shared);
  const [session, setSession] = useState<LiveSession | null>(null);
  const [state, setState] = useState<LiveState | 'off'>('off');
  const [peers, setPeers] = useState<LivePeer[]>([]);
  const [role, setRole] = useState<LiveRole>(shared?.role ?? 'owner');
  const cb = useRef({ current, showRemote, toast });
  cb.current = { current, showRemote, toast };

  // Own map: go live when it is already shared with someone.
  useEffect(() => {
    if (shared || !sync.liveTarget(true)) return;
    let alive = true;
    sync.adapter().then(async (a) => {
      if (!(a instanceof KeizuServerAdapter)) return;
      const info = await a.shares(mapId).catch(() => undefined);
      if (alive && info?.shares.length) setWant(true);
    });
    return () => {
      alive = false;
    };
  }, [mapId, shared]);

  useEffect(() => {
    const target = sync.liveTarget(!shared);
    if (!want || !target) return;
    const toMap = (m: MapLike): MindMap => {
      const cur = cb.current.current();
      return normalizeMap({ ...cur, ...m, roots: m.roots as MindMap['roots'], relations: m.relations, resources: m.resources } as MindMap);
    };
    const own = !shared;
    if (own) sync.setLive(mapId, true);
    const s = new LiveSession(
      { url: target.url, token: target.token, mapId, owner: shared?.ownerId },
      {
        onWelcome: async (w) => {
          setRole(w.role);
          const server = toMap(w.map);
          if (!own) return cb.current.showRemote(server);
          // Own map: edits made here since the last sync are merged in; the
          // rest comes from the server (it may hold other devices' edits).
          const local = cb.current.current();
          const rec = (await store.listSync().catch(() => [])).find((r) => r.id === mapId);
          if (!rec || rec.hash === contentHash(local)) return cb.current.showRemote(server);
          const merged = mergeMaps(rec.base, local, server);
          if (merged) {
            s.localChange(merged);
            cb.current.showRemote(toMap(s.snapshot() ?? w.map));
          } else {
            await store.addVersion(local, 'sync').catch(() => {});
            cb.current.showRemote(server);
            cb.current.toast(t('live.keptServer'));
          }
        },
        onRemote: (m) => cb.current.showRemote(toMap(m)),
        onPeers: (all, you) => setPeers(all.filter((p) => p.id !== you)),
        onState: setState,
        onRole: setRole,
        onSaved: (version, m) => {
          if (own) sync.recordSaved(toMap(m), String(version));
        },
        onError: (msg, fatal) => {
          cb.current.toast(msg);
          if (fatal) setWant(false);
        },
      },
    );
    setSession(s);
    return () => {
      s.close();
      setSession(null);
      setState('off');
      setPeers([]);
      if (own) sync.setLive(mapId, false);
    };
  }, [want, mapId, shared, store]);

  const enable = useCallback(() => setWant(true), []);
  return { session, state, peers, role, enable };
}
