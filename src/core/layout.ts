// Automatic layout. Pure functions: given a map and a text measurer, returns
// a box for every visible topic. Coordinates are box centres; the central
// topic sits at (0, 0).

import { MARKER_GAP, MARKER_SIZE } from './markers';
import type { LayoutKind, MindMap, Point, Topic, TopicShape } from './model';
export type { Point };
import { countTopics } from './model';
import { getTheme } from './themes';

export type Measure = (text: string, font: string) => number;

export interface NodeBox {
  id: string;
  /** Root topic of the tree this box belongs to. */
  rootId: string;
  /** Layout of that tree. */
  layout: LayoutKind;
  topic: Topic;
  parentId?: string;
  depth: number;
  /** +1 right of the root, -1 left, 0 the root itself (or org layout). */
  side: 1 | -1 | 0;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  shape: TopicShape;
  lines: string[];
  font: string;
  fontSize: number;
  lineHeight: number;
  padX: number;
  /** Children hidden by collapsing, 0 when expanded. */
  hidden: number;
}

export interface MapLayout {
  kind: LayoutKind;
  nodes: NodeBox[];
  byId: Map<string, NodeBox>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export const FONT_FAMILY = "'Plus Jakarta Sans', system-ui, sans-serif";

interface Metrics {
  fontSize: number;
  weight: number;
  padX: number;
  padY: number;
  minW: number;
  shape: TopicShape;
}

function metricsFor(depth: number, kind: LayoutKind, t: Topic): Metrics {
  const base: Metrics =
    depth === 0
      ? { fontSize: 20, weight: 700, padX: 24, padY: 16, minW: 120, shape: 'rounded' }
      : depth === 1
        ? { fontSize: 15, weight: 600, padX: 16, padY: 9, minW: 64, shape: 'rounded' }
        : { fontSize: 14, weight: 400, padX: 6, padY: 5, minW: 24, shape: kind === 'org' ? 'rounded' : 'underline' };
  const s = t.style ?? {};
  return {
    ...base,
    fontSize: s.fontSize ?? base.fontSize,
    weight: s.bold === undefined ? base.weight : s.bold ? 700 : 400,
    shape: s.shape ?? base.shape,
  };
}

function sizeNode(t: Topic, depth: number, kind: LayoutKind, measure: Measure) {
  const m = metricsFor(depth, kind, t);
  const font = `${t.style?.italic ? 'italic ' : ''}${m.weight} ${m.fontSize}px ${FONT_FAMILY}`;
  const lines = (t.text || ' ').split('\n');
  const textW = Math.max(...lines.map((l) => measure(l || ' ', font)));
  const lineHeight = Math.round(m.fontSize * 1.35);
  const icons = (t.markers?.length ?? 0) + (t.note ? 1 : 0);
  const iconW = icons * (MARKER_SIZE + MARKER_GAP);
  const w = Math.max(m.minW, Math.ceil(textW + iconW + m.padX * 2));
  const h = Math.max(lines.length * lineHeight, icons ? MARKER_SIZE : 0) + m.padY * 2;
  return { w, h, lines, font, fontSize: m.fontSize, lineHeight, padX: m.padX, shape: m.shape };
}

const H_GAP = (depth: number) => (depth === 0 ? 64 : 40);
const V_GAP = (depth: number) => (depth <= 1 ? 20 : 8);
const ORG_H_GAP = 24;
const ORG_V_GAP = 48;

export function layoutMap(map: MindMap, measure: Measure): MapLayout {
  const theme = getTheme(map.theme);
  const nodes: NodeBox[] = [];
  const byId = new Map<string, NodeBox>();
  const mainKind = map.layout;
  const palette = (i: number) => (map.multicolor ? theme.palette[i % theme.palette.length] : theme.mono);
  let colorIndex = map.roots[0]?.children.length ?? 0;

  map.roots.forEach((root, ri) => {
    const kind = root.layout ?? mainKind;
    // Floating roots are drawn one level down (like a main topic) so the
    // central topic stays visually unique.
    const baseDepth = ri === 0 ? 0 : 1;
    const rootColor = ri === 0 ? theme.mono : palette(colorIndex++);
    const tree = layoutTree(root, kind, baseDepth, rootColor, palette, theme.mono, measure);
    let pos = root.pos;
    if (!pos && ri > 0) {
      // No stored position: park it under everything laid out so far.
      const maxY = nodes.reduce((m, b) => Math.max(m, b.y + b.h / 2), 0);
      pos = { x: 0, y: maxY + 80 + (tree.root.y - tree.minY) };
    }
    const dx = pos?.x ?? 0, dy = pos?.y ?? 0;
    for (const b of tree.nodes) {
      b.x += dx;
      b.y += dy;
      b.rootId = root.id;
      b.layout = kind;
      nodes.push(b);
      byId.set(b.id, b);
    }
  });

  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const b of nodes) {
    bounds.minX = Math.min(bounds.minX, b.x - b.w / 2);
    bounds.maxX = Math.max(bounds.maxX, b.x + b.w / 2);
    bounds.minY = Math.min(bounds.minY, b.y - b.h / 2);
    bounds.maxY = Math.max(bounds.maxY, b.y + b.h / 2);
  }
  if (!nodes.length) Object.assign(bounds, { minX: 0, minY: 0, maxX: 0, maxY: 0 });
  return { kind: mainKind, nodes, byId, bounds };
}

/** Lays out one tree with its root at (0, 0). */
function layoutTree(
  root: Topic,
  kind: LayoutKind,
  baseDepth: number,
  rootColor: string,
  palette: (i: number) => string,
  mono: string,
  measure: Measure,
): { nodes: NodeBox[]; root: NodeBox; minY: number } {
  const nodes: NodeBox[] = [];
  const byId = new Map<string, NodeBox>();

  const build = (t: Topic, depth: number, color: string, parentId?: string) => {
    const size = sizeNode(t, depth, kind, measure);
    const hidden = t.collapsed && t.children.length ? countTopics(t) - 1 : 0;
    const box: NodeBox = { id: t.id, rootId: root.id, layout: kind, topic: t, parentId, depth, side: 0, x: 0, y: 0, color, hidden, ...size };
    nodes.push(box);
    byId.set(t.id, box);
    if (!hidden) {
      t.children.forEach((c, i) => build(c, depth + 1, depth === 0 ? palette(i) : color, t.id));
    }
  };
  build(root, baseDepth, baseDepth === 0 ? mono : rootColor);

  const kids = (t: Topic) => (byId.get(t.id)!.hidden ? [] : t.children);

  if (kind === 'org') {
    const subW = new Map<string, number>();
    const measureW = (t: Topic): number => {
      const b = byId.get(t.id)!;
      const cs = kids(t);
      const sum = cs.reduce((s, c) => s + measureW(c), 0) + ORG_H_GAP * Math.max(0, cs.length - 1);
      const w = Math.max(b.w, sum);
      subW.set(t.id, w);
      return w;
    };
    const place = (t: Topic, cx: number, cy: number) => {
      const b = byId.get(t.id)!;
      b.x = cx;
      b.y = cy;
      const cs = kids(t);
      if (!cs.length) return;
      const total = cs.reduce((s, c) => s + subW.get(c.id)!, 0) + ORG_H_GAP * (cs.length - 1);
      let left = cx - total / 2;
      const rowY = cy + b.h / 2 + ORG_V_GAP;
      for (const c of cs) {
        const w = subW.get(c.id)!;
        const cb = byId.get(c.id)!;
        place(c, left + w / 2, rowY + cb.h / 2);
        left += w + ORG_H_GAP;
      }
    };
    measureW(root);
    place(root, 0, 0);
  } else {
    const subH = new Map<string, number>();
    const measureH = (t: Topic): number => {
      const b = byId.get(t.id)!;
      const cs = kids(t);
      const sum = cs.reduce((s, c) => s + measureH(c), 0) + V_GAP(b.depth) * Math.max(0, cs.length - 1);
      const h = Math.max(b.h, sum);
      subH.set(t.id, h);
      return h;
    };
    const placeChildren = (parent: NodeBox, cs: Topic[], dir: 1 | -1) => {
      const gapV = V_GAP(parent.depth);
      const total = cs.reduce((s, c) => s + subH.get(c.id)!, 0) + gapV * Math.max(0, cs.length - 1);
      let yTop = parent.y - total / 2;
      for (const c of cs) {
        const cb = byId.get(c.id)!;
        const h = subH.get(c.id)!;
        cb.side = dir;
        cb.x = parent.x + dir * (parent.w / 2 + H_GAP(parent.depth) + cb.w / 2);
        cb.y = yTop + h / 2;
        placeChildren(cb, kids(c), dir);
        yTop += h + gapV;
      }
    };
    measureH(root);
    const rootBox = byId.get(root.id)!;
    const cs = kids(root);
    if (kind === 'logic') {
      placeChildren(rootBox, cs, 1);
    } else {
      // Fill the right side until it holds about half the height, then the
      // left side, going clockwise (left side listed bottom to top).
      const total = cs.reduce((s, c) => s + subH.get(c.id)!, 0);
      const right: Topic[] = [];
      let acc = 0;
      for (const c of cs) {
        if (right.length === 0 || (acc < total / 2 && right.length < Math.ceil(cs.length / 2))) {
          right.push(c);
          acc += subH.get(c.id)!;
        } else break;
      }
      placeChildren(rootBox, right, 1);
      placeChildren(rootBox, cs.slice(right.length).reverse(), -1);
    }
  }
  const minY = nodes.reduce((m, b) => Math.min(m, b.y - b.h / 2), 0);
  return { nodes, root: byId.get(root.id)!, minY };
}

/** Rough measurer for tests and non-browser contexts. */
export const approxMeasure: Measure = (text, font) => {
  const size = Number(/(\d+)px/.exec(font)?.[1] ?? 14);
  return text.length * size * 0.56;
};

// ---------- connectors ----------


/** Where a connector leaves the parent and reaches the child. */
export function edgePoints(p: NodeBox, c: NodeBox): { from: Point; to: Point } {
  if (c.layout === 'org') {
    return { from: { x: p.x, y: p.y + p.h / 2 }, to: { x: c.x, y: c.y - c.h / 2 } };
  }
  const dir = c.side || 1;
  const underlineP = p.depth >= 2 && p.shape === 'underline';
  const underlineC = c.shape === 'underline';
  const from = { x: p.x + (dir * p.w) / 2, y: underlineP ? p.y + p.h / 2 : p.y };
  const to = { x: c.x - (dir * c.w) / 2, y: underlineC ? c.y + c.h / 2 : c.y };
  return { from, to };
}

export function edgePath(kind: LayoutKind, style: 'curve' | 'elbow' | 'straight', a: Point, b: Point): string {
  if (style === 'straight') return `M${a.x} ${a.y}L${b.x} ${b.y}`;
  if (kind === 'org') {
    const my = (a.y + b.y) / 2;
    if (style === 'elbow') return `M${a.x} ${a.y}V${my}H${b.x}V${b.y}`;
    return `M${a.x} ${a.y}C${a.x} ${my} ${b.x} ${my} ${b.x} ${b.y}`;
  }
  const mx = (a.x + b.x) / 2;
  if (style === 'elbow') return `M${a.x} ${a.y}H${mx}V${b.y}H${b.x}`;
  return `M${a.x} ${a.y}C${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}`;
}

/** Point where the ray from the box centre towards `to` leaves the box. */
function borderPoint(b: NodeBox, to: Point): Point {
  const dx = to.x - b.x, dy = to.y - b.y;
  if (!dx && !dy) return { x: b.x, y: b.y };
  const sx = dx ? b.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy ? b.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: b.x + dx * s, y: b.y + dy * s };
}

/** A gently bowed curve between two topics, for relation arrows. */
export function relationPath(a: NodeBox, b: NodeBox): { d: string; mid: Point } {
  const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / dist, ny = (b.x - a.x) / dist;
  const bow = Math.min(120, dist * 0.25);
  const c1 = { x: a.x + (b.x - a.x) * 0.3 + nx * bow, y: a.y + (b.y - a.y) * 0.3 + ny * bow };
  const c2 = { x: a.x + (b.x - a.x) * 0.7 + nx * bow, y: a.y + (b.y - a.y) * 0.7 + ny * bow };
  const p1 = borderPoint(a, c1);
  const p2 = borderPoint(b, c2);
  const e1 = { x: p1.x + nx * 4, y: p1.y + ny * 4 }; // tiny offset keeps the start off the edge line
  const mid = {
    x: 0.125 * e1.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * p2.x,
    y: 0.125 * e1.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * p2.y,
  };
  return { d: `M${e1.x} ${e1.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`, mid };
}
