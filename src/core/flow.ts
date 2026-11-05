// Flow chart layout: a layered ("Sugiyama-style") drawing of a directed
// graph. A flow chart is a tree of steps plus flow links (Relation.kind
// 'flow') that let a step be reached from more than one path, so many
// paths can branch out and later meet again in one step.
//
// Steps run left to right in columns: a step sits one column after the
// last step that leads to it, so a step where paths meet comes after all of
// them. Within a column, steps are ordered to keep crossings low and placed
// next to the steps they connect to.

import type { Point } from './model';

export interface FlowNodeIn {
  id: string;
  w: number;
  h: number;
}

export interface FlowEdgeIn {
  /** Tree edges: 't:' + child id. Flow links: the relation id. */
  key: string;
  from: string;
  to: string;
}

/**
 * How one edge is drawn: it leaves its source to the right, turns at
 * `gaps[0]` (the middle of the gap after the source's column), runs along
 * `lanes[0]` through the next column, turns at `gaps[1]`, and so on, and
 * finally comes in level with the target. Coordinates are relative to the
 * flow chart's first step.
 */
export interface FlowRoute {
  gaps: number[];
  lanes: number[];
}

export interface FlowResult {
  /** Centre of every step, the first one at (0, 0). */
  pos: Map<string, Point>;
  routes: Map<string, FlowRoute>;
  /** Edges that lead back to an earlier step (loops), drawn as plain curves. */
  back: Set<string>;
}

export const FLOW_COL_GAP = 96;
const SEP_NODE = 18;
const SEP_DUMMY = 12;
const SEP_LANE = 10;

interface Item {
  id: string;
  /** Real steps carry their size; lane points (dummies) are 0 x 0. */
  w: number;
  h: number;
  dummy: boolean;
  layer: number;
  order: number;
  y: number;
  /** DFS visit index of the step (or of a dummy's edge source), for stable first ordering. */
  rank: number;
}

/**
 * Lays out the steps. `nodes[0]` is the first step; `edges` go from a step
 * to the next one (tree edges should come before flow links).
 */
export function layeredLayout(nodes: FlowNodeIn[], edges: FlowEdgeIn[]): FlowResult {
  const pos = new Map<string, Point>();
  const routes = new Map<string, FlowRoute>();
  const back = new Set<string>();
  if (!nodes.length) return { pos, routes, back };
  const start = nodes[0].id;
  const ids = new Set(nodes.map((n) => n.id));

  // 1. Keep edges that don't close a loop; tree edges are always kept.
  const out = new Map<string, string[]>();
  for (const n of nodes) out.set(n.id, []);
  const reaches = (a: string, b: string) => {
    const seen = new Set<string>([a]);
    const stack = [a];
    while (stack.length) {
      const x = stack.pop()!;
      if (x === b) return true;
      for (const y of out.get(x)!) if (!seen.has(y)) (seen.add(y), stack.push(y));
    }
    return false;
  };
  const kept: FlowEdgeIn[] = [];
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    const tree = e.key.startsWith('t:');
    if (e.to === start || (!tree && reaches(e.to, e.from))) {
      back.add(e.key);
      continue;
    }
    out.get(e.from)!.push(e.to);
    kept.push(e);
  }

  // 2. Columns: longest path from the start (Kahn's order).
  const indeg = new Map<string, number>();
  for (const n of nodes) indeg.set(n.id, 0);
  for (const e of kept) indeg.set(e.to, indeg.get(e.to)! + 1);
  const layer = new Map<string, number>();
  for (const n of nodes) layer.set(n.id, 0);
  const queue = nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id);
  while (queue.length) {
    const x = queue.shift()!;
    for (const y of out.get(x)!) {
      layer.set(y, Math.max(layer.get(y)!, layer.get(x)! + 1));
      indeg.set(y, indeg.get(y)! - 1);
      if (!indeg.get(y)) queue.push(y);
    }
  }

  // DFS visit order: the order the steps were written in.
  const rank = new Map<string, number>();
  const visit = (x: string) => {
    if (rank.has(x)) return;
    rank.set(x, rank.size);
    for (const y of out.get(x)!) visit(y);
  };
  visit(start);
  for (const n of nodes) visit(n.id);

  // 3. Items per column, with a lane point wherever an edge passes a column.
  const items = new Map<string, Item>();
  const layers: Item[][] = [];
  const add = (it: Item) => {
    items.set(it.id, it);
    (layers[it.layer] ??= []).push(it);
  };
  for (const n of nodes) add({ id: n.id, w: n.w, h: n.h, dummy: false, layer: layer.get(n.id)!, order: 0, y: 0, rank: rank.get(n.id)! });
  /** Each kept edge as a chain of item ids, source first. */
  const chains = new Map<string, string[]>();
  for (const e of kept) {
    const a = layer.get(e.from)!, b = layer.get(e.to)!;
    const chain = [e.from];
    for (let l = a + 1; l < b; l++) {
      const id = `~${e.key}~${l}`;
      add({ id, w: 0, h: 0, dummy: true, layer: l, order: 0, y: 0, rank: rank.get(e.from)! + (l - a) * 1e-3 });
      chain.push(id);
    }
    chain.push(e.to);
    chains.set(e.key, chain);
  }
  for (let l = 0; l < layers.length; l++) layers[l] ??= [];
  const preds = new Map<string, string[]>(), succs = new Map<string, string[]>();
  for (const id of items.keys()) (preds.set(id, []), succs.set(id, []));
  for (const chain of chains.values()) {
    for (let i = 1; i < chain.length; i++) {
      succs.get(chain[i - 1])!.push(chain[i]);
      preds.get(chain[i])!.push(chain[i - 1]);
    }
  }

  // 4. Order within columns: barycentre sweeps, keeping the best found.
  for (const col of layers) {
    col.sort((p, q) => p.rank - q.rank);
    col.forEach((it, i) => (it.order = i));
  }
  const crossings = () => {
    let n = 0;
    for (let l = 0; l + 1 < layers.length; l++) {
      const segs: [number, number][] = [];
      for (const it of layers[l]) for (const s of succs.get(it.id)!) segs.push([it.order, items.get(s)!.order]);
      for (let i = 0; i < segs.length; i++)
        for (let j = i + 1; j < segs.length; j++) if ((segs[i][0] - segs[j][0]) * (segs[i][1] - segs[j][1]) < 0) n++;
    }
    return n;
  };
  const snapshot = () => new Map([...items.values()].map((it) => [it.id, it.order]));
  let best = snapshot(), bestN = crossings();
  const sweep = (down: boolean) => {
    const range = down ? layers.map((_, l) => l).slice(1) : layers.map((_, l) => l).slice(0, -1).reverse();
    for (const l of range) {
      const bary = new Map<string, number>();
      for (const it of layers[l]) {
        const ns = (down ? preds : succs).get(it.id)!;
        bary.set(it.id, ns.length ? ns.reduce((s, n) => s + items.get(n)!.order, 0) / ns.length : it.order);
      }
      layers[l].sort((p, q) => bary.get(p.id)! - bary.get(q.id)! || p.order - q.order);
      layers[l].forEach((it, i) => (it.order = i));
    }
  };
  for (let i = 0; i < 6 && bestN > 0; i++) {
    sweep(i % 2 === 0);
    const n = crossings();
    if (n < bestN) (bestN = n), (best = snapshot());
  }
  for (const col of layers) {
    for (const it of col) it.order = best.get(it.id)!;
    col.sort((p, q) => p.order - q.order);
  }

  // 5. Heights: each item near the items it connects to, without overlaps.
  const sep = (a: Item, b: Item) =>
    a.dummy && b.dummy ? SEP_LANE : a.dummy || b.dummy ? (a.h + b.h) / 2 + SEP_DUMMY : (a.h + b.h) / 2 + SEP_NODE;
  const placeColumn = (col: Item[], want: (it: Item) => number) => {
    if (!col.length) return;
    // Least-squares fit to the wanted heights, keeping order and spacing:
    // isotonic regression (pool adjacent violators) on shifted values.
    const offs: number[] = [0];
    for (let i = 1; i < col.length; i++) offs.push(offs[i - 1] + sep(col[i - 1], col[i]));
    const blocks: { sum: number; wsum: number; n: number }[] = [];
    col.forEach((it, i) => {
      const w = it.dummy ? 0.5 : 1;
      blocks.push({ sum: (want(it) - offs[i]) * w, wsum: w, n: 1 });
      while (blocks.length > 1) {
        const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
        if (a.sum / a.wsum <= b.sum / b.wsum) break;
        blocks.splice(-2, 2, { sum: a.sum + b.sum, wsum: a.wsum + b.wsum, n: a.n + b.n });
      }
    });
    let i = 0;
    for (const b of blocks) for (let k = 0; k < b.n; k++, i++) col[i].y = b.sum / b.wsum + offs[i];
  };
  for (const col of layers) placeColumn(col, () => 0);
  const mean = (ns: string[]) => ns.reduce((s, n) => s + items.get(n)!.y, 0) / ns.length;
  const pull = (down: boolean) => {
    const range = down ? layers.map((_, l) => l).slice(1) : layers.map((_, l) => l).slice(0, -1).reverse();
    for (const l of range) {
      placeColumn(layers[l], (it) => {
        const ns = (down ? preds : succs).get(it.id)!;
        return ns.length ? mean(ns) : it.y;
      });
    }
  };
  for (let i = 0; i < 4; i++) (pull(true), pull(false));
  pull(true);

  // 6. Columns left to right, steps centred in theirs.
  const colW = layers.map((col) => Math.max(0, ...col.filter((it) => !it.dummy).map((it) => it.w)));
  const colX: number[] = [];
  let x = 0;
  for (let l = 0; l < layers.length; l++) {
    colX.push(x + colW[l] / 2);
    x += colW[l] + FLOW_COL_GAP;
  }
  const s = items.get(start)!;
  const ox = colX[s.layer], oy = s.y;
  for (const n of nodes) {
    const it = items.get(n.id)!;
    pos.set(n.id, { x: colX[it.layer] - ox, y: it.y - oy });
  }
  for (const [key, chain] of chains) {
    const a = layer.get(chain[0])!;
    const gaps: number[] = [], lanes: number[] = [];
    for (let i = 0; i + 1 < chain.length; i++) {
      const l = a + i;
      gaps.push(colX[l] + colW[l] / 2 + FLOW_COL_GAP / 2 - ox);
      if (i > 0) lanes.push(items.get(chain[i])!.y - oy);
    }
    routes.set(key, { gaps, lanes });
  }
  return { pos, routes, back };
}

/**
 * Corner points of an edge drawn from `a` (the source's right side) to `b`
 * (the target's left side) along `route`, already shifted to map space.
 */
export function routePoints(a: Point, b: Point, route: FlowRoute, dx = 0, dy = 0): Point[] {
  const pts: Point[] = [a];
  let y = a.y;
  route.gaps.forEach((g, i) => {
    const gx = g + dx;
    const ny = i < route.lanes.length ? route.lanes[i] + dy : b.y;
    pts.push({ x: gx, y });
    pts.push({ x: gx, y: ny });
    y = ny;
  });
  pts.push(b);
  // Drop repeated points and straight-through corners.
  const clean: Point[] = [];
  for (const p of pts) {
    const last = clean[clean.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    const prev = clean[clean.length - 2];
    if (prev && last && ((Math.abs(prev.x - last.x) < 0.01 && Math.abs(last.x - p.x) < 0.01) || (Math.abs(prev.y - last.y) < 0.01 && Math.abs(last.y - p.y) < 0.01))) {
      clean[clean.length - 1] = p;
      continue;
    }
    clean.push(p);
  }
  return clean;
}

/** An orthogonal polyline with rounded corners. */
export function roundedPath(pts: Point[], radius = 10): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1], c = pts[i], n = pts[i + 1];
    const l1 = Math.hypot(c.x - p.x, c.y - p.y), l2 = Math.hypot(n.x - c.x, n.y - c.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    if (r < 0.5) {
      d += `L${c.x} ${c.y}`;
      continue;
    }
    const a = { x: c.x - ((c.x - p.x) / l1) * r, y: c.y - ((c.y - p.y) / l1) * r };
    const b = { x: c.x + ((n.x - c.x) / l2) * r, y: c.y + ((n.y - c.y) / l2) * r };
    d += `L${a.x} ${a.y}Q${c.x} ${c.y} ${b.x} ${b.y}`;
  }
  const last = pts[pts.length - 1];
  return `${d}L${last.x} ${last.y}`;
}
