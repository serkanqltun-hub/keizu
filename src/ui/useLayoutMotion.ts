// Smooth layout changes: when the laid-out map changes (a topic added,
// moved, collapsed, a new layout picked), topics slide from where they were
// to where they now belong. New topics grow out of their parent and fade
// in; removed ones slide into their parent and fade out.

import { useLayoutEffect, useRef, useState } from 'react';
import type { MapLayout, NodeBox } from '../core/layout';
import { DUR, easeStandard, reducedMotion } from './motion';

/** Above this many topics changes are shown at once: smoothness over spectacle. */
const MAX_ANIMATED = 2000;

export interface LayoutFrame {
  layout: MapLayout;
  /** Opacity of topics fading in or out, by id (absent = fully shown). */
  fade?: Map<string, number>;
}

interface Track {
  box: NodeBox;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  /** +1 fading in, -1 fading out, 0 steady. */
  dir: 1 | -1 | 0;
}

/** Plans the move from one layout to the next; null when nothing moves. */
export function planLayoutMotion(prev: MapLayout, next: MapLayout): Track[] | null {
  const tracks: Track[] = [];
  let moving = false;
  for (const n of next.nodes) {
    const p = prev.byId.get(n.id);
    if (p) {
      if (p.x !== n.x || p.y !== n.y) moving = true;
      tracks.push({ box: n, fx: p.x, fy: p.y, tx: n.x, ty: n.y, dir: 0 });
      continue;
    }
    // New: start at the nearest ancestor that was already on the map.
    let a = n.parentId;
    while (a && !prev.byId.has(a)) a = next.byId.get(a)?.parentId;
    const from = a ? prev.byId.get(a)! : n;
    tracks.push({ box: n, fx: from.x, fy: from.y, tx: n.x, ty: n.y, dir: 1 });
    moving = true;
  }
  const ghosts: Track[] = [];
  for (const p of prev.nodes) {
    if (next.byId.has(p.id)) continue;
    // Gone (collapsed or deleted): slide into the nearest ancestor still shown.
    let a = p.parentId;
    while (a && !next.byId.has(a)) a = prev.byId.get(a)?.parentId;
    const to = a ? next.byId.get(a)! : p;
    ghosts.push({ box: p, fx: p.x, fy: p.y, tx: to.x, ty: to.y, dir: -1 });
    moving = true;
  }
  // Ghosts go first so they are drawn under everything else.
  return moving ? [...ghosts, ...tracks] : null;
}

/** The layout as drawn at progress `t` (0..1, already eased) of a planned move. */
export function frameAt(next: MapLayout, tracks: Track[], t: number): LayoutFrame {
  const nodes: NodeBox[] = [];
  const byId = new Map<string, NodeBox>();
  const fade = new Map<string, number>();
  for (const tr of tracks) {
    const b = { ...tr.box, x: tr.fx + (tr.tx - tr.fx) * t, y: tr.fy + (tr.ty - tr.fy) * t };
    nodes.push(b);
    byId.set(b.id, b);
    if (tr.dir === 1) fade.set(b.id, Math.min(1, t * 1.4));
    else if (tr.dir === -1) fade.set(b.id, Math.max(0, 1 - t * 1.4));
  }
  return { layout: { ...next, nodes, byId }, fade };
}

/**
 * Returns the layout to draw. `scope` changes (another map) show the new
 * layout at once.
 */
export function useLayoutMotion(layout: MapLayout, scope: string): LayoutFrame {
  const [frame, setFrame] = useState<LayoutFrame>({ layout });
  const shown = useRef<MapLayout>(layout);
  const lastScope = useRef(scope);
  const raf = useRef(0);

  useLayoutEffect(() => {
    cancelAnimationFrame(raf.current);
    const prev = shown.current;
    const sameMap = lastScope.current === scope;
    lastScope.current = scope;
    const tracks = sameMap && prev !== layout && !reducedMotion() && layout.nodes.length <= MAX_ANIMATED ? planLayoutMotion(prev, layout) : null;
    if (!tracks) {
      shown.current = layout;
      setFrame({ layout });
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / DUR.layout);
      if (p >= 1) {
        shown.current = layout;
        setFrame({ layout });
        return;
      }
      const f = frameAt(layout, tracks, easeStandard(p));
      shown.current = f.layout;
      setFrame(f);
      raf.current = requestAnimationFrame(step);
    };
    const first = frameAt(layout, tracks, 0);
    shown.current = first.layout;
    setFrame(first);
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [layout, scope]);

  return frame;
}
