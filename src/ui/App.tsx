import { useCallback, useEffect, useState } from 'react';
import type { MindMap } from '../core/model';
import { IdbStore } from '../sync/idbStore';
import { LocalMapStore } from '../sync/localStore';
import type { LibraryStore } from '../sync/types';
import { sync, withSyncHooks } from '../sync/controller';
import { parseConnectLink } from '../sync/keizuServer';
import { SyncSettings } from './SyncSettings';
import { Editor } from './Editor';
import { Home } from './Home';
import { importIntoLibrary } from './library';
import { clearMeasureCache } from './measure';
import { isDesktop, onOpenFiles, readPath, takeOpenedFiles, type PickedFile } from './platform';
import { getLang, t, useLang } from '../i18n';

export function App() {
  const [store, setStore] = useState<LibraryStore | null>(null);
  const [open, setOpenState] = useState<{ map: MindMap; focusId?: string } | null>(null);
  const setOpen = useCallback((map: MindMap | null, focusId?: string) => setOpenState(map ? { map, focusId } : null), []);
  // Re-render everything when the interface language changes.
  useLang();
  useEffect(() => {
    document.documentElement.lang = getLang();
  }, []);
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped once web fonts load, so the layout re-measures text.
  const [fontsReady, setFontsReady] = useState(0);

  const [settings, setSettings] = useState(false);
  const [connectLink, setConnectLink] = useState<{ server: string; code?: string } | null>(null);

  useEffect(() => {
    IdbStore.open()
      .catch((): LibraryStore => new LocalMapStore())
      .then((raw) => {
        // Sync works on the raw library; the UI's saves nudge it.
        sync.attach(raw);
        setStore(withSyncHooks(raw, () => sync.nudge()));
      });
    // Ask the browser not to evict our storage when space runs low.
    navigator.storage?.persist?.().catch(() => {});
  }, []);

  useEffect(() => {
    const weights = ['400', '600', '700', 'italic 400'];
    Promise.all(weights.map((w) => document.fonts?.load(`${w} 16px 'Plus Jakarta Sans'`, 'Aağşİı'))).finally(() => {
      clearMeasureCache();
      setFontsReady((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    document.title = open ? `${open.map.title} · Keizu` : 'Keizu';
  }, [open]);

  // An open map is only pushed by sync, never replaced under the editor.
  const openId = open?.map.id;
  useEffect(() => {
    if (!openId) return;
    sync.setBusy(openId, true);
    return () => sync.setBusy(openId, false);
  }, [openId]);

  // keizu://connect?server=…&code=… links (desktop), or the same query on
  // the web app's address, open Settings with the server filled in.
  useEffect(() => {
    const handle = (urls: string[]) => {
      const link = urls.map(parseConnectLink).find(Boolean);
      if (!link) return;
      setOpen(null);
      setConnectLink(link);
      setSettings(true);
    };
    if (!isDesktop) {
      const q = new URLSearchParams(location.search);
      if (q.has('connect') && q.get('server')) {
        handle([location.href]);
        history.replaceState(null, '', location.pathname);
      }
      return;
    }
    let off = () => {};
    import('@tauri-apps/plugin-deep-link')
      .then(async (dl) => {
        const first = await dl.getCurrent();
        if (first) handle(first);
        off = await dl.onOpenUrl(handle);
      })
      .catch(() => {});
    return () => off();
  }, [setOpen]);

  /** Imports files and opens the first map. Returns an error message, if any. */
  const openFiles = useCallback(
    async (files: PickedFile[]): Promise<string | null> => {
      if (!store || !files.length) return null;
      const { maps, errors } = await importIntoLibrary(store, files);
      if (maps[0]) {
        setOpen(null); // remount the editor even when the same map is reopened
        setTimeout(() => setOpen(maps[0]), 0);
      }
      if (maps.length > 1) setNotice(t('home.imported', { n: maps.length }));
      return errors.length ? errors.join('\n') : null;
    },
    [store, setOpen],
  );

  // Desktop: files double-clicked in the file manager.
  useEffect(() => {
    if (!store) return;
    const openPaths = async () => {
      const paths = await takeOpenedFiles();
      if (!paths.length) return;
      const results = await Promise.allSettled(paths.map(readPath));
      const files = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      const err = await openFiles(files);
      if (err || files.length < paths.length) setNotice(err ?? t('home.someUnreadable'));
    };
    openPaths();
    let off = () => {};
    onOpenFiles(openPaths).then((f) => (off = f));
    return () => off();
  }, [store, openFiles]);

  if (!store) return null;
  if (settings && !open) {
    return (
      <SyncSettings
        link={connectLink}
        onBack={() => {
          setSettings(false);
          setConnectLink(null);
        }}
      />
    );
  }
  return open ? (
    <Editor key={open.map.id} initial={open.map} focusId={open.focusId} store={store} fontsReady={fontsReady} onBack={() => setOpen(null)} />
  ) : (
    <Home store={store} onOpen={setOpen} onSettings={() => setSettings(true)} onOpenFiles={openFiles} notice={notice} onNoticeShown={() => setNotice(null)} />
  );
}
