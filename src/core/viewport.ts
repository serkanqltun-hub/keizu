// Viewport culling: which parts of a laid-out map are on screen. Large maps
// (thousands of topics) stay fast because only these get drawn.

import type { MapLayout, NodeBox } from './layout';

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const overlaps = (a: Rect, minX: number, minY: number, maxX: number, maxY: number) =>
  maxX >= a.minX && minX <= a.maxX && maxY >= a.minY && minY <= a.maxY;

export function boxInRect(b: NodeBox, r: Rect): boolean {
  return overlaps(r, b.x - b.w / 2, b.y - b.h / 2, b.x + b.w / 2, b.y + b.h / 2);
}

export interface Visible {
  /** Topics whose box touches the rectangle. */
  nodes: NodeBox[];
  /** Child topics whose connector to the parent touches the rectangle. */
  edges: NodeBox[];
}

/** Everything that needs drawing inside `r` (all of it when `r` is undefined). */
export function visibleIn(layout: MapLayout, r?: Rect): Visible {
  if (!r) return { nodes: layout.nodes, edges: layout.nodes.filter((b) => b.parentId) };
  const nodes: NodeBox[] = [];
  const edges: NodeBox[] = [];
  for (const b of layout.nodes) {
    if (boxInRect(b, r)) nodes.push(b);
    if (!b.parentId) continue;
    const p = layout.byId.get(b.parentId)!;
    // A connector stays inside the box spanned by the two centres.
    if (overlaps(r, Math.min(p.x, b.x) - b.w / 2, Math.min(p.y, b.y) - b.h / 2, Math.max(p.x, b.x) + b.w / 2, Math.max(p.y, b.y) + b.h / 2)) edges.push(b);
  }
  return { nodes, edges };
}

/**
 * The map-space rectangle a canvas of `width` x `height` pixels shows at
 * pan (x, y) and zoom k, grown by a margin and snapped to a coarse grid, so
 * small pans keep returning the same rectangle and nothing re-renders.
 */
export function snappedViewport(view: { x: number; y: number; k: number }, width: number, height: number): Rect {
  const step = 400 / view.k;
  const minX = -view.x / view.k, minY = -view.y / view.k;
  const maxX = minX + width / view.k, maxY = minY + height / view.k;
  const down = (v: number) => Math.floor(v / step) * step - step;
  const up = (v: number) => Math.ceil(v / step) * step + step;
  return { minX: down(minX), minY: down(minY), maxX: up(maxX), maxY: up(maxY) };
}
