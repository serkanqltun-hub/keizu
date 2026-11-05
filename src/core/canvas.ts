// Canvas mode ("Tuval"): a free drawing, Excalidraw style, for the outer map
// or for any topic's inner view.
//
// Where it lives: the outer map keeps its drawing in `MindMap.canvas` and its
// mode in `MindMap.canvasMode`; a topic keeps the drawing of its inner view in
// `Topic.canvas` and the mode in `Topic.innerKind`. The editor works on a view
// map (see inner.ts), so these helpers take the view and whether it is an
// inner one: inside a topic, that topic is the view's main topic.
//
// The drawing is a list of Excalidraw elements. Keizu treats each element as
// one unit: live collaboration and sync merge element by element (the higher
// `version` wins), so two people drawing different shapes never collide.

import type { CanvasData, CanvasElement, CanvasMode, MindMap, Point, Topic } from './model';

/** How a view is shown. */
export type ViewKind = 'map' | CanvasMode;
export const VIEW_KINDS: ViewKind[] = ['map', 'canvas', 'both'];

const isMode = (v: unknown): v is CanvasMode => v === 'canvas' || v === 'both';

/** How the view is shown: the map, the drawing, or both together. */
export function viewKind(view: MindMap, inner: boolean): ViewKind {
  const v = inner ? view.roots[0]?.innerKind : view.canvasMode;
  return isMode(v) ? v : 'map';
}

/** The view's drawing, if it has one. */
export function viewCanvas(view: MindMap, inner: boolean): CanvasData | undefined {
  return inner ? view.roots[0]?.canvas : view.canvas;
}

function withRoot(view: MindMap, fn: (t: Topic) => Topic): MindMap {
  const [main, ...rest] = view.roots;
  return { ...view, roots: [fn(main), ...rest], updatedAt: new Date().toISOString() };
}

/** Switches the view between map, drawing and both. */
export function setViewKind(view: MindMap, inner: boolean, kind: ViewKind): MindMap {
  if (viewKind(view, inner) === kind) return view;
  if (!inner) {
    const next = { ...view, canvasMode: kind === 'map' ? undefined : kind, updatedAt: new Date().toISOString() };
    if (!next.canvasMode) delete next.canvasMode;
    return next;
  }
  return withRoot(view, (t) => {
    const out: Topic = { ...t, innerKind: kind };
    // Back to the map: the topic still opens an inner view while it has
    // inner topics or a drawing; otherwise 'map' keeps it enterable.
    if (kind === 'map') {
      if (t.children.length) delete out.innerKind;
      else out.innerKind = 'map';
    }
    return out;
  });
}

/** Replaces the view's drawing. An empty drawing is removed. */
export function setViewCanvas(view: MindMap, inner: boolean, canvas: CanvasData | undefined): MindMap {
  const c = canvas && (canvas.elements.length || Object.keys(canvas.topics ?? {}).length) ? canvas : undefined;
  if (!inner) {
    const next = { ...view, canvas: c, updatedAt: new Date().toISOString() };
    if (!c) delete next.canvas;
    return next;
  }
  return withRoot(view, (t) => {
    const out = { ...t, canvas: c };
    if (!c) delete out.canvas;
    return out;
  });
}

/** Elements in drawing order (by fractional index, then id). */
export function sortElements(list: CanvasElement[]): CanvasElement[] {
  const key = (e: CanvasElement) => e.index ?? '';
  return [...list].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Of two copies of the same element, the one to keep: newer version, then a stable tie-break. */
export function newerElement(a: CanvasElement, b: CanvasElement): CanvasElement {
  if (a.version !== b.version) return a.version > b.version ? a : b;
  const na = Number(a.versionNonce ?? 0), nb = Number(b.versionNonce ?? 0);
  return na <= nb ? a : b;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Three-way merge of a drawing edited on two devices. Elements merge one by
 * one: edited on both sides, the newer version wins; deleted on one side
 * and untouched on the other, it stays deleted; added anywhere, it is kept.
 * Topic positions take whichever side moved them.
 */
export function mergeCanvas(base: CanvasData | undefined, local: CanvasData | undefined, remote: CanvasData | undefined): CanvasData | undefined {
  if (sameJson(local, remote)) return local;
  if (sameJson(base, local)) return remote;
  if (sameJson(base, remote)) return local;
  const by = (c: CanvasData | undefined) => new Map((c?.elements ?? []).map((e) => [e.id, e]));
  const [B, L, R] = [by(base), by(local), by(remote)];
  const out: CanvasElement[] = [];
  for (const id of new Set([...L.keys(), ...R.keys()])) {
    const b = B.get(id), l = L.get(id), r = R.get(id);
    if (l && r) out.push(newerElement(l, r));
    else {
      const kept = (l ?? r)!;
      // Gone on the other side: deleted there, unless it was edited here since.
      if (!b || kept.version > b.version) out.push(kept);
    }
  }
  const topics: Record<string, Point> = {};
  const bt = base?.topics ?? {}, lt = local?.topics ?? {}, rt = remote?.topics ?? {};
  for (const id of new Set([...Object.keys(lt), ...Object.keys(rt)])) {
    const l = lt[id], r = rt[id];
    // The side that moved (or removed) it wins; both moved: this device wins.
    const pick = sameJson(l, bt[id]) ? r : l;
    if (pick) topics[id] = pick;
  }
  const merged: CanvasData = { elements: sortElements(out) };
  if (Object.keys(topics).length) merged.topics = topics;
  return merged.elements.length || merged.topics ? merged : undefined;
}

/** Adds an empty drawing to a topic and makes its inner view a canvas. */
export function addCanvas(t: Topic): Topic {
  return { ...t, innerKind: 'canvas' };
}
