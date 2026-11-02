// Presentation mode: the map full screen, one topic at a time. The camera
// glides to the current topic and its children; everything else fades back.

import { useEffect, useMemo, useRef, useState } from 'react';
import { layoutMap } from '../core/layout';
import { findParent, findTopic, type MindMap } from '../core/model';
import { expandAll, presentationSteps } from '../core/present';
import { getTheme } from '../core/themes';
import { t } from '../i18n';
import { MapSvg } from './MapSvg';
import { canvasMeasure } from './measure';

interface Props {
  map: MindMap;
  startId?: string | null;
  onClose(lastId: string): void;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PAD = 80;

export function Presentation({ map, startId, onClose }: Props) {
  const full = useMemo(() => expandAll(map), [map]);
  const layout = useMemo(() => layoutMap(full, canvasMeasure), [full]);
  const theme = getTheme(map.theme);
  const steps = useMemo(() => presentationSteps(full), [full]);
  const [i, setI] = useState(() => Math.max(0, steps.indexOf(startId ?? '')));
  const rootEl = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const current = steps[Math.min(i, steps.length - 1)];

  // Topics in focus: the current one, the path to it and its children.
  const focus = useMemo(() => {
    const s = new Set<string>([current]);
    for (let p = findParent(full, current); p; p = findParent(full, p.id)) s.add(p.id);
    findTopic(full, current)?.children.forEach((c) => s.add(c.id));
    return s;
  }, [full, current]);
  const dim = useMemo(() => new Set(layout.nodes.filter((b) => !focus.has(b.id)).map((b) => b.id)), [layout, focus]);

  const target = useMemo((): Box => {
    const ids = [current, ...(findTopic(full, current)?.children.map((c) => c.id) ?? [])];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
      const b = layout.byId.get(id);
      if (!b) continue;
      minX = Math.min(minX, b.x - b.w / 2);
      maxX = Math.max(maxX, b.x + b.w / 2);
      minY = Math.min(minY, b.y - b.h / 2);
      maxY = Math.max(maxY, b.y + b.h / 2);
    }
    if (!isFinite(minX)) return { x: -400, y: -300, w: 800, h: 600 };
    // Never zoom in more than 2x: a lone leaf topic shouldn't fill the screen.
    const w = Math.max(maxX - minX + PAD * 2, size.w / 2);
    const h = Math.max(maxY - minY + PAD * 2, size.h / 2);
    const k = Math.max(w / size.w, h / size.h);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return { x: cx - (size.w * k) / 2, y: cy - (size.h * k) / 2, w: size.w * k, h: size.h * k };
  }, [layout, full, current, size]);

  // Glide from the previous view to the new one.
  const [view, setView] = useState<Box>(target);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const from = viewRef.current;
    const start = performance.now();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const dur = reduce ? 0 : 450;
    let raf = 0;
    const tick = (now: number) => {
      const p = dur ? Math.min(1, (now - start) / dur) : 1;
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      setView({
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        w: from.w + (target.w - from.w) * e,
        h: from.h + (target.h - from.h) * e,
      });
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    rootEl.current?.requestFullscreen?.().catch(() => {});
    rootEl.current?.focus();
    return () => {
      window.removeEventListener('resize', onResize);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  const last = steps.length - 1;
  const go = (n: number) => setI(Math.max(0, Math.min(last, n)));
  const close = () => onClose(current);

  // Leaving full screen with the browser's own Esc ends the presentation too.
  useEffect(() => {
    let was = false;
    const onFs = () => {
      if (document.fullscreenElement) was = true;
      else if (was) close();
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  });

  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) go(i + 1);
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) go(i - 1);
    else if (k === 'Home') go(0);
    else if (k === 'End') go(last);
    else if (k === 'Escape') close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={rootEl}
      className="present"
      style={{ background: theme.canvas }}
      tabIndex={0}
      role="dialog"
      aria-label={t('present.label')}
      onKeyDown={onKey}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        go(i + 1);
      }}
    >
      <svg width="100%" height="100%" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <MapSvg map={full} layout={layout} theme={theme} dimIds={dim} selectedId={current} />
      </svg>
      <div className="present-bar">
        <button className="ib" aria-label={t('present.prev')} title={t('present.prev')} disabled={i === 0} onClick={() => go(i - 1)}>‹</button>
        <span>{t('present.step', { n: i + 1, total: steps.length })}</span>
        <button className="ib" aria-label={t('present.next')} title={t('present.next')} disabled={i === last} onClick={() => go(i + 1)}>›</button>
        <span className="sep" />
        <button className="ib" aria-label={t('present.exit')} title={t('present.exit')} onClick={close}>✕</button>
      </div>
    </div>
  );
}
