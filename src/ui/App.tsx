import { useEffect, useMemo, useState } from 'react';
import type { MindMap } from '../core/model';
import { LocalMapStore } from '../sync/localStore';
import { Editor } from './Editor';
import { Home } from './Home';
import { clearMeasureCache } from './measure';

export function App() {
  const store = useMemo(() => new LocalMapStore(), []);
  const [open, setOpen] = useState<MindMap | null>(null);
  // Bumped once web fonts load, so the layout re-measures text.
  const [fontsReady, setFontsReady] = useState(0);

  useEffect(() => {
    const weights = ['400', '600', '700', 'italic 400'];
    Promise.all(weights.map((w) => document.fonts?.load(`${w} 16px 'Plus Jakarta Sans'`, 'Aağşİı'))).finally(() => {
      clearMeasureCache();
      setFontsReady((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    document.title = open ? `${open.title} · Keizu` : 'Keizu';
  }, [open]);

  return open ? (
    <Editor key={open.id} initial={open} store={store} fontsReady={fontsReady} onBack={() => setOpen(null)} />
  ) : (
    <Home store={store} onOpen={setOpen} />
  );
}
