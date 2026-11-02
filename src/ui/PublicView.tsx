// What a read-only share link opens (https://server/#view=<token>): the map,
// view only, no account needed. It checks for updates every half minute.

import { useEffect, useMemo, useRef, useState } from 'react';
import { layoutMap } from '../core/layout';
import { normalizeMap, type MindMap } from '../core/model';
import { getTheme } from '../core/themes';
import { t } from '../i18n';
import * as I from './Icons';
import { MapCanvas, type CanvasHandle } from './MapCanvas';
import { canvasMeasure } from './measure';
import { Presentation } from './Presentation';

const REFRESH_MS = 30_000;

/** The token of a read-only link in the address, if this page was opened from one. */
export function viewToken(hash = globalThis.location?.hash ?? ''): string | undefined {
  return /^#view=([A-Za-z0-9_-]{10,64})$/.exec(hash)?.[1];
}

export function PublicView({ token }: { token: string }) {
  const [map, setMap] = useState<MindMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [zoom, setZoom] = useState(1);
  const canvas = useRef<CanvasHandle>(null);
  const version = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${location.origin}/api/v1/public/${token}`, { headers: { Accept: 'application/json' } });
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          throw new Error(j?.message ?? t('view.notFound'));
        }
        const v = res.headers.get('X-Keizu-Version');
        if (v && v === version.current) return;
        version.current = v;
        const m = normalizeMap(await res.json());
        if (alive) {
          setMap(m);
          setError(null);
          document.title = `${m.title} · Keizu`;
        }
      } catch (e) {
        if (alive) setError((e as Error).message || t('view.notFound'));
      }
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [token]);

  const layout = useMemo(() => (map ? layoutMap(map, canvasMeasure) : null), [map]);
  if (error && !map) {
    return (
      <div className="public-view empty">
        <I.Logo size={40} />
        <p>{error}</p>
      </div>
    );
  }
  if (!map || !layout) return null;
  const theme = getTheme(map.theme);
  const noop = () => {};
  return (
    <div className={`editor public-view ${theme.dark ? 'dark-map' : ''}`}>
      <header className="topbar">
        <div className="tb-left">
          <div className="logo-mark"><I.Logo size={28} /></div>
          <div className="doc-title">
            <span className="name">{map.title}</span>
            <span className="status saved">{t('view.readOnly')}</span>
          </div>
        </div>
        <div className="tb-right">
          <button className="btn" onClick={() => setPresenting(true)}>
            <I.Present size={16} /> {t('cmd.present')}
          </button>
        </div>
      </header>
      <div className="workspace">
        <main className="canvas-area">
          <MapCanvas
            ref={canvas}
            map={map}
            layout={layout}
            theme={theme}
            selectedId={selectedId}
            editingId={null}
            editSeed={null}
            selectedRelId={null}
            relationFrom={null}
            readOnly
            onSelect={setSelectedId}
            onSelectRelation={noop}
            onPickRelationTarget={noop}
            onFloat={noop}
            onCreateFloating={noop}
            onStartEdit={noop}
            onCommitEdit={noop}
            onCancelEdit={noop}
            onMove={noop}
            onToggleCollapse={(id) => setMap((m) => (m ? toggle(m, id) : m))}
            onZoomChange={setZoom}
          />
          <div className="zoom">
            <button className="ib" aria-label={t('cmd.zoomOut')} onClick={() => canvas.current?.zoomBy(1 / 1.2)}><I.Minus size={16} /></button>
            <span>{Math.round(zoom * 100)}%</span>
            <button className="ib" aria-label={t('cmd.zoomIn')} onClick={() => canvas.current?.zoomBy(1.2)}><I.Plus size={16} /></button>
            <span className="sep" />
            <button className="ib" aria-label={t('cmd.fit')} onClick={() => canvas.current?.fit()}><I.Target size={16} /></button>
          </div>
          <div className="chip stats">{t('view.madeWith')}</div>
        </main>
      </div>
      {presenting && <Presentation map={map} startId={selectedId} onClose={() => setPresenting(false)} />}
    </div>
  );
}

/** Collapsing in the viewer is local to the viewer. */
function toggle(map: MindMap, id: string): MindMap {
  const walk = (t: MindMap['roots'][0]): MindMap['roots'][0] =>
    t.id === id ? { ...t, collapsed: !t.collapsed } : { ...t, children: t.children.map(walk) };
  return { ...map, roots: map.roots.map(walk) };
}
