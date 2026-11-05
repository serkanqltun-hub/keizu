// Live collaboration data type (a CRDT). Every topic, relation and map
// setting is a set of last-writer-wins registers: each value carries a
// stamp (Lamport clock, author), and the higher stamp wins everywhere, in
// whatever order the changes arrive. A topic's place in the tree (parent and
// a sortable position key) is one register, so a move is atomic. Turning
// the registers back into a map is deterministic, so every copy that has
// seen the same changes shows the same map.
//
// This file is shared with Keizu Server (server/src/live.ts), so it has no
// imports and uses only syntax Node can run directly.

/** Lamport time and author: compared by time, then author. */
export type Stamp = [number, string];

export interface Reg {
  v: unknown;
  t: Stamp;
}

/** Where a topic sits: under parent `p` (null for a root), ordered by `o`. */
export interface Place {
  p: string | null;
  o: string;
}

export type Fields = Record<string, Reg>;

export interface CrdtDoc {
  /** Map settings: title, theme, layout, branchStyle, multicolor, main (id of the main topic), res:<id> pictures. */
  meta: Fields;
  /** Topic fields plus `place` and `del`. */
  topics: Record<string, Fields>;
  /** Relation fields (from, to, label, kind) plus `del`. */
  relations: Record<string, Fields>;
  /** Highest Lamport time seen. */
  clock: number;
}

export type OpKind = 'm' | 't' | 'r';

/** One register write. `v: null` clears the field. */
export interface Change {
  k: OpKind;
  id: string;
  f: string;
  v: unknown;
}

export interface Op extends Change {
  t: Stamp;
}

/** The parts of a map the CRDT keeps; ids, versions and dates stay local. */
export interface TopicLike {
  id: string;
  text: string;
  children: TopicLike[];
}

const fieldsOf = (t: TopicLike) => t as unknown as Record<string, unknown>;

export interface RelationLike {
  id: string;
  from: string;
  to: string;
  label?: string;
  kind?: 'flow';
}

export interface MapLike {
  title: string;
  theme: string;
  layout: string;
  branchStyle: string;
  multicolor: boolean;
  notebook?: boolean;
  canvasMode?: string;
  canvas?: CanvasLike;
  roots: TopicLike[];
  relations: RelationLike[];
  resources?: Record<string, string>;
}

/** A free drawing (see src/core/canvas.ts): elements with ids, topic positions. */
export interface CanvasLike {
  elements: { id: string; index?: string | null }[];
  topics?: Record<string, unknown>;
}

const META_FIELDS = ['title', 'theme', 'layout', 'branchStyle', 'multicolor', 'notebook', 'canvasMode'];
const RES = 'res:';
// A drawing is stored one register per element (and per topic position), so
// people drawing different shapes at the same time don't overwrite each other.
const CV = 'cv:';
const CVT = 'cvt:';

function expandCanvas(c: CanvasLike | undefined, out: Record<string, unknown>): Record<string, unknown> {
  for (const e of c?.elements ?? []) out[CV + e.id] = e;
  for (const [id, p] of Object.entries(c?.topics ?? {})) out[CVT + id] = p;
  return out;
}

/** Collects `cv:`/`cvt:` registers back into a drawing; undefined when empty. */
function collectCanvas(fields: Fields): CanvasLike | undefined {
  const elements: CanvasLike['elements'] = [];
  const topics: Record<string, unknown> = {};
  for (const [k, r] of Object.entries(fields)) {
    if (r.v === null || r.v === undefined) continue;
    if (k.startsWith(CV)) elements.push(r.v as CanvasLike['elements'][number]);
    else if (k.startsWith(CVT)) topics[k.slice(CVT.length)] = r.v;
  }
  if (!elements.length && !Object.keys(topics).length) return undefined;
  const key = (e: { id: string; index?: string | null }) => e.index ?? '';
  elements.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const c: CanvasLike = { elements };
  if (Object.keys(topics).length) c.topics = topics;
  return c;
}

const isCanvasKey = (k: string) => k.startsWith(CV) || k.startsWith(CVT);

export function emptyDoc(): CrdtDoc {
  return { meta: {}, topics: {}, relations: {}, clock: 0 };
}

export function newer(a: Stamp, b: Stamp): boolean {
  return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
}

function table(doc: CrdtDoc, k: OpKind, id: string, create: boolean): Fields | undefined {
  if (k === 'm') return doc.meta;
  const t = k === 't' ? doc.topics : doc.relations;
  if (!t[id] && create) t[id] = {};
  return t[id];
}

/** Applies one op. Returns whether it changed anything. */
export function applyOp(doc: CrdtDoc, op: Op): boolean {
  if (op.t[0] > doc.clock) doc.clock = op.t[0];
  const fields = table(doc, op.k, op.id, true)!;
  const cur = fields[op.f];
  if (cur && !newer(op.t, cur.t)) return false;
  fields[op.f] = { v: op.v, t: op.t };
  return true;
}

export function applyOps(doc: CrdtDoc, ops: Op[]): boolean {
  let changed = false;
  for (const op of ops) if (applyOp(doc, op)) changed = true;
  return changed;
}

/** Stamps local changes with the next Lamport time. */
export function stamp(doc: CrdtDoc, changes: Change[], actor: string): Op[] {
  if (!changes.length) return [];
  const t: Stamp = [doc.clock + 1, actor];
  return changes.map((c) => ({ ...c, t }));
}

/** Current value of a register (null when unset). */
export function valueOf(doc: CrdtDoc, k: OpKind, id: string, f: string): unknown {
  return table(doc, k, id, false)?.[f]?.v ?? null;
}

export function cloneDoc(doc: CrdtDoc): CrdtDoc {
  return JSON.parse(JSON.stringify(doc));
}

// ---------- position keys ----------

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** A key that sorts strictly between `a` and `b` (either may be open). Keys never end in "0", so there is always room. */
export function keyBetween(a: string | null, b: string | null): string {
  let out = '';
  for (let i = 0; ; i++) {
    const ca = a && i < a.length ? DIGITS.indexOf(a[i]) : 0;
    const cb = b !== null && i < b.length ? DIGITS.indexOf(b[i]) : DIGITS.length;
    if (ca === cb) {
      out += DIGITS[ca];
      continue;
    }
    const mid = Math.floor((ca + cb) / 2);
    if (mid > ca) return out + DIGITS[mid];
    // Adjacent digits: keep a's digit and look for room after it.
    out += DIGITS[ca];
    b = null;
  }
}

const cmpKey = (a: [string, string], b: [string, string]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);

/** Indexes of a longest strictly increasing run (not necessarily adjacent). */
function longestIncreasing(keys: ([string, string] | null)[]): Set<number> {
  const idx: number[] = [];
  const tails: number[] = [];
  const prev: number[] = new Array(keys.length).fill(-1);
  keys.forEach((k, i) => {
    if (!k) return;
    idx.push(i);
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cmpKey(keys[tails[mid]]!, k) < 0) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  });
  const keep = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) keep.add(i);
  return keep;
}

// ---------- local edits ----------

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function isLive(doc: CrdtDoc, k: 't' | 'r', id: string): boolean {
  const f = (k === 't' ? doc.topics : doc.relations)[id];
  return !!f && f.del?.v !== true && (k === 'r' || !!f.place);
}

/**
 * The register writes that turn the document into `next`. Unchanged parts
 * produce nothing, and siblings that kept their relative order keep their
 * position keys, so concurrent edits elsewhere are not overwritten.
 */
export function diff(doc: CrdtDoc, next: MapLike): Change[] {
  const out: Change[] = [];
  const set = (k: OpKind, id: string, f: string, v: unknown) => {
    const val = v === undefined ? null : v;
    if (!same(valueOf(doc, k, id, f), val)) out.push({ k, id, f, v: val });
  };

  // Map settings and pictures.
  for (const f of META_FIELDS) set('m', '', f, (next as unknown as Record<string, unknown>)[f]);
  set('m', '', 'main', next.roots[0]?.id ?? null);
  const res = next.resources ?? {};
  for (const [k, v] of Object.entries(res)) set('m', '', RES + k, v);
  for (const f of Object.keys(doc.meta)) if (f.startsWith(RES) && !(f.slice(RES.length) in res) && doc.meta[f].v !== null) set('m', '', f, null);
  const cv = expandCanvas(next.canvas, {});
  for (const [k, v] of Object.entries(cv)) set('m', '', k, v);
  for (const f of Object.keys(doc.meta)) if (isCanvasKey(f) && !(f in cv) && doc.meta[f].v !== null) set('m', '', f, null);

  // Topics: fields, then places.
  const seen = new Set<string>();
  const placeList = (parent: string | null, list: TopicLike[]) => {
    const keys = list.map((t): [string, string] | null => {
      const pl = valueOf(doc, 't', t.id, 'place') as Place | null;
      return pl && pl.p === parent && isLive(doc, 't', t.id) ? [pl.o, t.id] : null;
    });
    const keep = longestIncreasing(keys);
    let lo: string | null = null;
    for (let i = 0; i < list.length; i++) {
      if (keep.has(i)) {
        lo = keys[i]![0];
        continue;
      }
      // Next kept key to the right bounds the new ones.
      let hi: string | null = null;
      for (let j = i + 1; j < list.length; j++) if (keep.has(j)) {
        hi = keys[j]![0];
        break;
      }
      const o = keyBetween(lo, hi !== null && lo !== null && hi <= lo ? null : hi);
      out.push({ k: 't', id: list[i].id, f: 'place', v: { p: parent, o } });
      lo = o;
    }
  };
  const walk = (t: TopicLike) => {
    seen.add(t.id);
    if (valueOf(doc, 't', t.id, 'del') === true) out.push({ k: 't', id: t.id, f: 'del', v: false });
    const { canvas, ...plain } = fieldsOf(t);
    const own = expandCanvas(canvas as CanvasLike | undefined, plain);
    const names = new Set(Object.keys(own).filter((k) => k !== 'id' && k !== 'children'));
    for (const f of Object.keys(doc.topics[t.id] ?? {})) if (f !== 'place' && f !== 'del') names.add(f);
    for (const f of names) set('t', t.id, f, own[f]);
    placeList(t.id, t.children);
    for (const c of t.children) walk(c);
  };
  placeList(null, next.roots);
  for (const r of next.roots) walk(r);
  for (const id of Object.keys(doc.topics)) if (!seen.has(id) && isLive(doc, 't', id)) out.push({ k: 't', id, f: 'del', v: true });

  // Relations.
  const rels = new Set<string>();
  for (const r of next.relations) {
    rels.add(r.id);
    if (valueOf(doc, 'r', r.id, 'del') === true) out.push({ k: 'r', id: r.id, f: 'del', v: false });
    set('r', r.id, 'from', r.from);
    set('r', r.id, 'to', r.to);
    set('r', r.id, 'label', r.label);
    set('r', r.id, 'kind', r.kind);
  }
  for (const id of Object.keys(doc.relations)) if (!rels.has(id) && isLive(doc, 'r', id)) out.push({ k: 'r', id, f: 'del', v: true });
  return out;
}

/** A document holding `map`, every register written at time 0. */
export function docFromMap(map: MapLike, actor = ''): CrdtDoc {
  const doc = emptyDoc();
  for (const c of diff(doc, map)) applyOp(doc, { ...c, t: [0, actor] });
  return doc;
}

// ---------- reading ----------

/** The map the document describes. */
export function materialize(doc: CrdtDoc): MapLike {
  const live = new Map<string, Fields>();
  for (const [id, f] of Object.entries(doc.topics)) if (f.del?.v !== true && f.place) live.set(id, f);
  const kids = new Map<string | null, string[]>();
  for (const [id, f] of live) {
    const p = (f.place.v as Place).p;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p)!.push(id);
  }
  const order = (ids: string[]) =>
    ids.sort((a, b) => cmpKey([(live.get(a)!.place.v as Place).o, a], [(live.get(b)!.place.v as Place).o, b]));
  for (const list of kids.values()) order(list);

  const done = new Set<string>();
  const build = (id: string): TopicLike => {
    done.add(id);
    const f = live.get(id)!;
    const t: Record<string, unknown> = { id, text: '' };
    for (const [k, r] of Object.entries(f)) if (k !== 'place' && k !== 'del' && k !== 'id' && k !== 'children' && !isCanvasKey(k) && r.v !== null) t[k] = r.v;
    const canvas = collectCanvas(f);
    if (canvas) t.canvas = canvas;
    if (typeof t.text !== 'string') t.text = '';
    t.children = (kids.get(id) ?? []).filter((c) => !done.has(c)).map(build);
    return t as unknown as TopicLike;
  };
  const rootIds = [...(kids.get(null) ?? [])];
  const main = doc.meta.main?.v as string | undefined;
  const mi = main ? rootIds.indexOf(main) : -1;
  if (mi > 0) rootIds.unshift(...rootIds.splice(mi, 1));
  const roots = rootIds.map(build);

  // Concurrent moves can make a loop (A under B, B under A). Nobody can
  // reach it from a root, so lift the most recently moved topic of each loop
  // out as a floating topic. Topics under a deleted parent stay hidden.
  for (const id of live.keys()) {
    if (done.has(id)) continue;
    const path: string[] = [];
    const onPath = new Set<string>();
    let cur: string | null = id;
    while (cur !== null && live.has(cur) && !done.has(cur) && !onPath.has(cur)) {
      path.push(cur);
      onPath.add(cur);
      cur = (live.get(cur)!.place.v as Place).p;
    }
    if (cur === null || !onPath.has(cur)) continue; // orphan or reaches a placed tree (placed by an earlier pass)
    const loop = path.slice(path.indexOf(cur));
    let pick = loop[0];
    for (const l of loop) if (newer(live.get(l)!.place.t, live.get(pick)!.place.t)) pick = l;
    roots.push(build(pick));
  }
  if (!roots.length) roots.push({ id: main || 'root', text: '', children: [] });

  const relations: RelationLike[] = [];
  const shown = new Set<string>();
  const mark = (t: TopicLike) => {
    shown.add(t.id);
    t.children.forEach(mark);
  };
  roots.forEach(mark);
  for (const [id, f] of Object.entries(doc.relations)) {
    if (f.del?.v === true) continue;
    const from = f.from?.v as string, to = f.to?.v as string;
    if (!shown.has(from) || !shown.has(to)) continue;
    const r: RelationLike = { id, from, to };
    if (typeof f.label?.v === 'string') r.label = f.label.v;
    if (f.kind?.v === 'flow') r.kind = 'flow';
    relations.push(r);
  }
  relations.sort((a, b) => (a.id < b.id ? -1 : 1));

  const m = (f: string, d: unknown) => doc.meta[f]?.v ?? d;
  const resources: Record<string, string> = {};
  for (const [k, r] of Object.entries(doc.meta)) if (k.startsWith(RES) && typeof r.v === 'string') resources[k.slice(RES.length)] = r.v;
  return {
    title: String(m('title', roots[0].text || '')),
    theme: String(m('theme', 'fresh')),
    layout: String(m('layout', 'mindmap')),
    branchStyle: String(m('branchStyle', 'curve')),
    multicolor: m('multicolor', true) !== false,
    ...(m('notebook', false) === true ? { notebook: true } : {}),
    // Always present (maybe undefined) so a removed drawing clears the copy it is spread over.
    canvasMode: typeof doc.meta.canvasMode?.v === 'string' ? (doc.meta.canvasMode.v as string) : undefined,
    canvas: collectCanvas(doc.meta),
    roots,
    relations,
    resources: Object.keys(resources).length ? resources : undefined,
  };
}

/**
 * The writes that would undo `changes` (made just now on `before`): each
 * register goes back to the value it had in `before`.
 */
export function inverse(before: CrdtDoc, changes: Change[]): Change[] {
  return changes.map((c) => ({ ...c, v: valueOf(before, c.k, c.id, c.f) }));
}
