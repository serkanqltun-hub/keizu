// Keizu document model. Every operation is pure: it returns a new map and
// never mutates its input, which keeps undo/redo a simple snapshot stack.
//
// A map is a graph, not a single tree: it holds one or more root topics
// (the first is the main one, the rest float freely on the canvas) plus
// relations, which are labelled links between any two topics. How a tree is
// drawn (mind map, logic chart, org chart) is a view setting, not data.

export type LayoutKind = 'mindmap' | 'logic' | 'org' | 'concept' | 'timeline' | 'fishbone' | 'matrix' | 'flow';

/** Every layout, in the order the app offers them. */
export const LAYOUT_KINDS: LayoutKind[] = ['mindmap', 'logic', 'org', 'concept', 'timeline', 'fishbone', 'matrix', 'flow'];
export type TopicShape = 'rounded' | 'pill' | 'rect' | 'underline' | 'none';
export type BranchStyle = 'curve' | 'elbow' | 'straight';

export interface TopicStyle {
  shape?: TopicShape;
  fill?: string;
  textColor?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  /** Draw the note inside the topic, below its text. */
  showNote?: boolean;
}

export interface Point {
  x: number;
  y: number;
}

/** A picture shown above a topic's text. `res` keys into MindMap.resources. */
export interface TopicImage {
  res: string;
  width: number;
  height: number;
}

export interface Topic {
  id: string;
  text: string;
  image?: TopicImage;
  /** Canvas position of a root topic's centre. Ignored on non-roots. */
  pos?: Point;
  /**
   * Layout override for this topic's branch (or, on a root, its whole tree).
   * Children inherit it until another topic overrides it again.
   */
  layout?: LayoutKind;
  note?: string;
  /** Words on the connector from the parent to this topic (concept maps). */
  linkLabel?: string;
  /**
   * A link to open from this topic: another Keizu map ("keizu:map/<id>",
   * optionally "#<topicId>") or a web address.
   */
  href?: string;
  markers?: string[];
  /** Free words for filtering, without "#" ("acil", "fikir"). */
  tags?: string[];
  /** Task mode: the topic has a checkbox. Progress of a branch is counted from these. */
  task?: 'todo' | 'done';
  /** Task due date, YYYY-MM-DD. */
  due?: string;
  /** Who the task is for. */
  assignee?: string;
  collapsed?: boolean;
  style?: TopicStyle;
  /**
   * This topic belongs to its parent's inner map: it is drawn only when you
   * enter the parent, not on the canvas around it.
   */
  inside?: boolean;
  /** Layout of this topic's inner map (when it has one). */
  innerLayout?: LayoutKind;
  /**
   * What kind of inner view the topic opens. Unset means a map made of its
   * `inside` children; other kinds (such as a free drawing canvas) keep their
   * own data and plug into the same enter/exit flow.
   */
  innerKind?: string;
  /** View only, never stored: how many topics the hidden inner map holds. */
  innerSize?: number;
  children: Topic[];
  /** Outlines drawn around runs of this topic's children. */
  boundaries?: Boundary[];
  /** Summary topics, each bracketing a run of this topic's children. */
  summaries?: Summary[];
}

/**
 * A run of sibling topics, from `from` to `to` (child ids of the owner,
 * either order; the same id for a single branch).
 */
export interface ChildRange {
  from: string;
  to: string;
}

/** A labelled outline around a run of sibling branches. */
export interface Boundary extends ChildRange {
  id: string;
  label?: string;
  /** Outline colour; the first branch's colour when unset. */
  color?: string;
}

/** A bracket over a run of sibling branches, with a topic that sums them up. */
export interface Summary extends ChildRange {
  /** Has no children of its own. */
  topic: Topic;
}

export interface Relation {
  id: string;
  from: string;
  to: string;
  label?: string;
  /**
   * 'flow': a step of a flow chart, so `to` gets one more way in (paths
   * merging). Drawn as a solid arrow in flow charts. Plain relations are
   * dashed annotations.
   */
  kind?: 'flow';
}

export interface MindMap {
  format: 'keizu/1';
  id: string;
  title: string;
  version: number;
  updatedAt: string;
  theme: string;
  layout: LayoutKind;
  branchStyle: BranchStyle;
  multicolor: boolean;
  /**
   * Notebook mode: every topic with a note shows its full note inside the
   * topic, as a card. A view setting, saved with the map.
   */
  notebook?: boolean;
  /** roots[0] is the main topic; any others float on the canvas. */
  roots: Topic[];
  relations: Relation[];
  /**
   * Embedded files (topic images), as data URLs keyed by resource id. In a
   * .keizu package they are stored as separate files under resources/.
   */
  resources?: Record<string, string>;
}

let counter = 0;
export function newId(prefix = 't'): string {
  counter = (counter + 1) % 1e6;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

export function createTopic(text: string, children: Topic[] = []): Topic {
  return { id: newId(), text, children };
}

export function createMap(title = 'Yeni harita', mainLabel = 'Ana konu'): MindMap {
  return {
    format: 'keizu/1',
    id: newId('m'),
    title,
    version: 0,
    updatedAt: new Date().toISOString(),
    theme: 'imza',
    layout: 'mindmap',
    branchStyle: 'elbow',
    multicolor: true,
    relations: [],
    roots: [
      createTopic(title, [
      createTopic(`${mainLabel} 1`),
      createTopic(`${mainLabel} 2`),
      createTopic(`${mainLabel} 3`),
      createTopic(`${mainLabel} 4`),
      ]),
    ],
  };
}

// ---------- queries ----------

/** The main (first) root topic. */
export const mainRoot = (map: MindMap): Topic => map.roots[0];

const VIRTUAL = '__roots__';
const virtualRoot = (map: MindMap): Topic => ({ id: VIRTUAL, text: '', children: map.roots });

function findIn(t: Topic, id: string): Topic | undefined {
  if (t.id === id) return t;
  for (const c of t.children) {
    const hit = findIn(c, id);
    if (hit) return hit;
  }
  if (t.summaries) for (const s of t.summaries) if (s.topic.id === id) return s.topic;
  return undefined;
}

function parentIn(t: Topic, id: string): Topic | undefined {
  for (const c of t.children) {
    if (c.id === id) return t;
    const hit = parentIn(c, id);
    if (hit) return hit;
  }
  return undefined;
}

export function findTopic(map: MindMap, id: string): Topic | undefined {
  for (const r of map.roots) {
    const hit = findIn(r, id);
    if (hit) return hit;
  }
  return undefined;
}

/** Parent topic, or undefined for roots and unknown ids. */
export function findParent(map: MindMap, id: string): Topic | undefined {
  const p = parentIn(virtualRoot(map), id);
  return p && p.id !== VIRTUAL ? p : undefined;
}

export function isRoot(map: MindMap, id: string): boolean {
  return map.roots.some((r) => r.id === id);
}

/** The root topic whose tree contains `id`. */
export function rootOf(map: MindMap, id: string): Topic | undefined {
  return map.roots.find((r) => !!findIn(r, id));
}

export function isDescendant(map: MindMap, ancestorId: string, id: string): boolean {
  const anc = findTopic(map, ancestorId);
  return !!anc && anc.id !== id && !!findIn(anc, id);
}

/** The topic whose summary `id` is, with that summary; undefined for ordinary topics. */
export function summaryOwner(map: MindMap, id: string): { owner: Topic; summary: Summary } | undefined {
  const walk = (t: Topic): { owner: Topic; summary: Summary } | undefined => {
    const s = t.summaries?.find((x) => x.topic.id === id);
    if (s) return { owner: t, summary: s };
    for (const c of t.children) {
      const hit = walk(c);
      if (hit) return hit;
    }
    return undefined;
  };
  for (const r of map.roots) {
    const hit = walk(r);
    if (hit) return hit;
  }
  return undefined;
}

export const isSummaryTopic = (map: MindMap, id: string) => !!summaryOwner(map, id);

/** Child indices a range covers in its owner, lowest first; undefined if an end is gone. */
export function rangeIndices(owner: Topic, r: ChildRange): [number, number] | undefined {
  const a = owner.children.findIndex((c) => c.id === r.from);
  const b = owner.children.findIndex((c) => c.id === r.to);
  if (a < 0 || b < 0) return undefined;
  return a <= b ? [a, b] : [b, a];
}

export function countTopics(t: Topic): number {
  return 1 + t.children.reduce((n, c) => n + countTopics(c), 0);
}

export function countAll(map: MindMap): number {
  return map.roots.reduce((n, r) => n + countTopics(r), 0);
}

function collectIds(t: Topic, out = new Set<string>()): Set<string> {
  out.add(t.id);
  t.children.forEach((c) => collectIds(c, out));
  t.summaries?.forEach((s) => out.add(s.topic.id));
  return out;
}

// ---------- updates ----------

function mapTree(t: Topic, id: string, fn: (t: Topic) => Topic): Topic {
  if (t.id === id) return fn(t);
  let changed = false;
  const children = t.children.map((c) => {
    const n = mapTree(c, id, fn);
    if (n !== c) changed = true;
    return n;
  });
  if (changed) return { ...t, children };
  // Summary topics are edited like any other topic.
  const si = t.summaries?.findIndex((s) => s.topic.id === id) ?? -1;
  if (si >= 0) {
    const summaries = [...t.summaries!];
    summaries[si] = { ...summaries[si], topic: { ...fn(summaries[si].topic), children: [] } };
    return { ...t, summaries };
  }
  return t;
}

/** Applies `fn` to topic `id` wherever it lives. */
function mapTopic(map: MindMap, id: string, fn: (t: Topic) => Topic): MindMap {
  let changed = false;
  const roots = map.roots.map((r) => {
    const n = mapTree(r, id, fn);
    if (n !== r) changed = true;
    return n;
  });
  return changed ? touch({ ...map, roots }) : map;
}

function touch(map: MindMap): MindMap {
  return { ...map, title: map.roots[0]?.text.trim() || map.title, updatedAt: new Date().toISOString() };
}

export function updateTopic(map: MindMap, id: string, patch: Partial<Omit<Topic, 'id' | 'children'>>): MindMap {
  return mapTopic(map, id, (t) => ({ ...t, ...patch }));
}

export function updateStyle(map: MindMap, id: string, patch: TopicStyle): MindMap {
  return mapTopic(map, id, (t) => ({ ...t, style: { ...t.style, ...patch } }));
}

export function toggleMarker(map: MindMap, id: string, marker: string): MindMap {
  const group = marker.split('-')[0];
  return mapTopic(map, id, (t) => {
    const cur = t.markers ?? [];
    if (cur.includes(marker)) return { ...t, markers: cur.filter((m) => m !== marker) };
    // One marker per group (e.g. a single priority).
    return { ...t, markers: [...cur.filter((m) => m.split('-')[0] !== group), marker] };
  });
}

export function addChild(map: MindMap, parentId: string, text = 'Alt konu'): { map: MindMap; id: string } {
  if (isSummaryTopic(map, parentId)) return { map, id: parentId }; // summaries have no branches
  const child = createTopic(text);
  return { map: mapTopic(map, parentId, (t) => ({ ...t, collapsed: false, children: [...t.children, child] })), id: child.id };
}

export function addSibling(map: MindMap, id: string, text = 'Konu', before = false): { map: MindMap; id: string } {
  const parent = findParent(map, id);
  if (!parent) return addChild(map, id, text); // roots grow children instead
  const sib = createTopic(text);
  const next = mapTopic(map, parent.id, (p) => {
    const i = p.children.findIndex((c) => c.id === id);
    const children = [...p.children];
    children.splice(before ? i : i + 1, 0, sib);
    return { ...p, children };
  });
  return { map: next, id: sib.id };
}

/** Adds a free-floating root topic at a canvas position. */
export function addFloating(map: MindMap, pos: Point, text = 'Serbest konu'): { map: MindMap; id: string } {
  const t: Topic = { ...createTopic(text), pos };
  return { map: touch({ ...map, roots: [...map.roots, t] }), id: t.id };
}

function dropRelations(map: MindMap, removed: Set<string>): Relation[] {
  return map.relations.filter((r) => !removed.has(r.from) && !removed.has(r.to));
}

/**
 * Flow charts: a step inside the branch being removed that another path
 * still leads to (a flow link from outside) is kept. It moves under that
 * path, and the link becomes its ordinary connector.
 */
function keepMergedSteps(map: MindMap, id: string): MindMap {
  for (let guard = 0; guard < 1000; guard++) {
    const node = findTopic(map, id);
    if (!node) return map;
    const inside = collectIds(node);
    const link = map.relations.find((r) => r.kind === 'flow' && r.to !== id && inside.has(r.to) && !inside.has(r.from));
    if (!link) return map;
    const moved = moveTopic({ ...map, relations: map.relations.filter((r) => r.id !== link.id) }, link.to, link.from);
    if (findParent(moved, link.to)?.id !== link.from) return map;
    map = moved;
  }
  return map;
}

/** Removes a topic and its subtree. Returns the id that should be selected next. */
export function removeTopic(map: MindMap, id: string): { map: MindMap; nextId: string } {
  if (map.roots[0]?.id === id) return { map, nextId: id }; // the main topic stays
  const sum = summaryOwner(map, id);
  if (sum) {
    const next = removeSummary(map, id);
    return { map: { ...next, relations: dropRelations(next, new Set([id])) }, nextId: sum.summary.to };
  }
  map = keepMergedSteps(map, id);
  const node = findTopic(map, id);
  if (!node) return { map, nextId: map.roots[0].id };
  const removed = collectIds(node);
  if (isRoot(map, id)) {
    const roots = map.roots.filter((r) => r.id !== id);
    return { map: touch({ ...map, roots, relations: dropRelations(map, removed) }), nextId: roots[0].id };
  }
  const parent = findParent(map, id)!;
  const i = parent.children.findIndex((c) => c.id === id);
  const rest = parent.children.filter((c) => c.id !== id);
  const nextId = rest[Math.min(i, rest.length - 1)]?.id ?? parent.id;
  const next = mapTopic(map, parent.id, (p) => ({ ...withoutChild(p, id), children: rest }));
  return { map: { ...next, relations: dropRelations(next, removed) }, nextId };
}

/**
 * Boundaries and summaries of `p` with child `id` taken out of their runs:
 * a run that ends at it shrinks by one, a run of just that child goes.
 */
function withoutChild(p: Topic, id: string): Topic {
  if (!p.boundaries?.length && !p.summaries?.length) return p;
  const i = p.children.findIndex((c) => c.id === id);
  const fix = <R extends ChildRange>(r: R): R | undefined => {
    if (r.from !== id && r.to !== id) return r;
    const ix = rangeIndices(p, r);
    if (!ix || ix[0] === ix[1]) return undefined;
    const [lo, hi] = ix;
    const nlo = i === lo ? lo + 1 : lo, nhi = i === hi ? hi - 1 : hi;
    return { ...r, from: p.children[nlo].id, to: p.children[nhi].id };
  };
  const boundaries = p.boundaries?.map(fix).filter((b): b is Boundary => !!b);
  const summaries = p.summaries?.map(fix).filter((s): s is Summary => !!s);
  return { ...p, boundaries: boundaries?.length ? boundaries : undefined, summaries: summaries?.length ? summaries : undefined };
}

/** Takes a topic out of the tree; returns the map without it and the topic. */
function detach(map: MindMap, id: string): { map: MindMap; node: Topic } | undefined {
  const node = findTopic(map, id);
  if (!node) return undefined;
  if (isRoot(map, id)) return { map: { ...map, roots: map.roots.filter((r) => r.id !== id) }, node };
  const parent = findParent(map, id)!;
  return { map: mapTopic(map, parent.id, (p) => ({ ...withoutChild(p, id), children: p.children.filter((c) => c.id !== id) })), node };
}

/** Moves `id` under `newParentId` at `index` (end when omitted). No-op on invalid moves. */
export function moveTopic(map: MindMap, id: string, newParentId: string, index?: number): MindMap {
  if (id === map.roots[0]?.id || id === newParentId) return map;
  if (isDescendant(map, id, newParentId) || !findTopic(map, newParentId)) return map;
  if (isSummaryTopic(map, id) || isSummaryTopic(map, newParentId)) return map;
  const s = siblingsOf(map, id);
  if (s?.parent?.id === newParentId && index !== undefined) {
    // A move among siblings keeps the topic inside the runs it belongs to.
    const children = [...s.parent.children];
    const [node] = children.splice(s.index, 1);
    children.splice(Math.max(0, Math.min(index, children.length)), 0, node);
    return mapTopic(map, newParentId, (p) => ({ ...p, collapsed: false, children }));
  }
  const d = detach(map, id);
  if (!d) return map;
  const node: Topic = { ...d.node, pos: undefined };
  return mapTopic(d.map, newParentId, (p) => {
    const children = [...p.children];
    const at = index === undefined ? children.length : Math.max(0, Math.min(index, children.length));
    children.splice(at, 0, node);
    return { ...p, collapsed: false, children };
  });
}

/** Turns a topic into a free-floating root at `pos`, or moves an existing one. */
export function floatTopic(map: MindMap, id: string, pos: Point): MindMap {
  if (id === map.roots[0]?.id || isSummaryTopic(map, id)) return map;
  if (isRoot(map, id)) return mapTopic(map, id, (t) => ({ ...t, pos }));
  const d = detach(map, id);
  if (!d) return map;
  return touch({ ...d.map, roots: [...d.map.roots, { ...d.node, pos }] });
}

export function toggleCollapse(map: MindMap, id: string): MindMap {
  const t = findTopic(map, id);
  if (!t || !t.children.length || id === map.roots[0]?.id) return map;
  return updateTopic(map, id, { collapsed: !t.collapsed });
}

export function setMapProps(map: MindMap, patch: Partial<Pick<MindMap, 'theme' | 'layout' | 'branchStyle' | 'multicolor' | 'title' | 'notebook'>>): MindMap {
  const next = { ...map, ...patch, updatedAt: new Date().toISOString() };
  if (!next.notebook) delete next.notebook;
  return next;
}

/** Sets or clears (undefined) the layout of a topic's branch. */
export function setBranchLayout(map: MindMap, id: string, layout: LayoutKind | undefined): MindMap {
  return mapTopic(map, id, (t) => ({ ...t, layout }));
}

/** Parent (undefined for roots), sibling list and index of a topic. */
export function siblingsOf(map: MindMap, id: string): { parent?: Topic; list: Topic[]; index: number } | undefined {
  const i = map.roots.findIndex((r) => r.id === id);
  if (i >= 0) return { list: map.roots, index: i };
  const parent = findParent(map, id);
  if (!parent) return undefined;
  return { parent, list: parent.children, index: parent.children.findIndex((c) => c.id === id) };
}

/** Outliner "indent": becomes the last child of its previous sibling. */
export function indentTopic(map: MindMap, id: string): MindMap {
  const s = siblingsOf(map, id);
  if (!s?.parent || s.index === 0) return map;
  return moveTopic(map, id, s.list[s.index - 1].id);
}

/** Outliner "outdent": moves up a level, right after its old parent. */
export function outdentTopic(map: MindMap, id: string): MindMap {
  const s = siblingsOf(map, id);
  if (!s?.parent) return map;
  const up = siblingsOf(map, s.parent.id);
  if (!up?.parent) return map; // the parent is a root: there is no level above
  return moveTopic(map, id, up.parent.id, up.index + 1);
}

/** Moves a topic up (-1) or down (+1) among its siblings. */
export function moveAmongSiblings(map: MindMap, id: string, delta: -1 | 1): MindMap {
  const s = siblingsOf(map, id);
  if (!s?.parent) return map;
  const to = s.index + delta;
  if (to < 0 || to >= s.list.length) return map;
  // After detaching, the old slot closes up, so `to` is right either way.
  return moveTopic(map, id, s.parent.id, to);
}

/** Expands every collapsed ancestor of a topic so it becomes visible. */
export function revealTopic(map: MindMap, id: string): MindMap {
  const path: Topic[] = [];
  const walk = (t: Topic): boolean => {
    if (t.id === id) return true;
    path.push(t);
    if (t.summaries?.some((s) => s.topic.id === id)) return true;
    for (const c of t.children) if (walk(c)) return true;
    path.pop();
    return false;
  };
  if (!map.roots.some(walk)) return map;
  let next = map;
  for (const t of path) if (t.collapsed) next = updateTopic(next, t.id, { collapsed: false });
  return next;
}

// ---------- images ----------

/** Attaches an image (a data URL) to a topic, replacing any previous one. */
export function setTopicImage(map: MindMap, id: string, dataUrl: string, width: number, height: number): MindMap {
  const res = newId('img');
  const withRes = { ...map, resources: { ...map.resources, [res]: dataUrl } };
  return mapTopic(withRes, id, (t) => ({ ...t, image: { res, width, height } }));
}

export function removeTopicImage(map: MindMap, id: string): MindMap {
  return mapTopic(map, id, (t) => ({ ...t, image: undefined }));
}

/**
 * Drops resources no topic points at any more. Done when writing a map out,
 * not on every edit, so undo and cut/paste keep their images.
 */
export function pruneResources(map: MindMap): MindMap {
  if (!map.resources) return map;
  const used = new Set<string>();
  const walk = (t: Topic) => {
    if (t.image) used.add(t.image.res);
    t.children.forEach(walk);
    t.summaries?.forEach((s) => walk(s.topic));
  };
  map.roots.forEach(walk);
  const keys = Object.keys(map.resources);
  if (keys.every((k) => used.has(k))) return map;
  const resources: Record<string, string> = {};
  for (const k of keys) if (used.has(k)) resources[k] = map.resources[k];
  return { ...map, resources: Object.keys(resources).length ? resources : undefined };
}

// ---------- relations ----------

export function addRelation(map: MindMap, from: string, to: string, label?: string): { map: MindMap; id: string } {
  const id = newId('r');
  if (from === to || !findTopic(map, from) || !findTopic(map, to)) return { map, id: '' };
  return { map: touch({ ...map, relations: [...map.relations, { id, from, to, label }] }), id };
}

/**
 * Flow charts: the path ending at `from` continues to `to`, which may
 * already be reached another way (paths merge). No-op when `to` already
 * follows `from`.
 */
export function addFlowLink(map: MindMap, from: string, to: string, label?: string): { map: MindMap; id: string } {
  if (from === to || !findTopic(map, from) || !findTopic(map, to)) return { map, id: '' };
  if (findParent(map, to)?.id === from) return { map, id: '' };
  if (map.relations.some((r) => r.kind === 'flow' && r.from === from && r.to === to)) return { map, id: '' };
  const id = newId('r');
  const rel: Relation = { id, from, to, kind: 'flow' };
  if (label) rel.label = label;
  return { map: touch({ ...map, relations: [...map.relations, rel] }), id };
}

export function updateRelation(map: MindMap, id: string, patch: Partial<Omit<Relation, 'id'>>): MindMap {
  return touch({ ...map, relations: map.relations.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
}

export function removeRelation(map: MindMap, id: string): MindMap {
  return touch({ ...map, relations: map.relations.filter((r) => r.id !== id) });
}

// ---------- boundaries and summaries ----------

/**
 * The owner and run for a set of sibling topics (one topic is a run of one).
 * Undefined for roots, summary topics or topics with different parents.
 */
export function siblingRun(map: MindMap, ids: string[]): { owner: Topic; range: ChildRange } | undefined {
  if (!ids.length) return undefined;
  const owner = findParent(map, ids[0]);
  if (!owner || ids.some((id) => findParent(map, id)?.id !== owner.id)) return undefined;
  const idx = ids.map((id) => owner.children.findIndex((c) => c.id === id)).sort((a, b) => a - b);
  return { owner, range: { from: owner.children[idx[0]].id, to: owner.children[idx[idx.length - 1]].id } };
}

/** Puts an outline around sibling topics. Returns the boundary id ('' when not possible). */
export function addBoundary(map: MindMap, ids: string[], label?: string): { map: MindMap; id: string } {
  const run = siblingRun(map, ids);
  if (!run) return { map, id: '' };
  const id = newId('b');
  const b: Boundary = { id, ...run.range, ...(label ? { label } : {}) };
  return { map: mapTopic(map, run.owner.id, (t) => ({ ...t, boundaries: [...(t.boundaries ?? []), b] })), id };
}

/** The topic owning boundary `id`, with the boundary. */
export function findBoundary(map: MindMap, id: string): { owner: Topic; boundary: Boundary } | undefined {
  const walk = (t: Topic): { owner: Topic; boundary: Boundary } | undefined => {
    const b = t.boundaries?.find((x) => x.id === id);
    if (b) return { owner: t, boundary: b };
    for (const c of t.children) {
      const hit = walk(c);
      if (hit) return hit;
    }
    return undefined;
  };
  for (const r of map.roots) {
    const hit = walk(r);
    if (hit) return hit;
  }
  return undefined;
}

export function updateBoundary(map: MindMap, id: string, patch: Partial<Pick<Boundary, 'label' | 'color'>>): MindMap {
  const f = findBoundary(map, id);
  if (!f) return map;
  return mapTopic(map, f.owner.id, (t) => ({
    ...t,
    boundaries: t.boundaries!.map((b) => {
      if (b.id !== id) return b;
      const n: Boundary = { ...b, ...patch };
      if (!n.label) delete n.label;
      if (!n.color) delete n.color;
      return n;
    }),
  }));
}

export function removeBoundary(map: MindMap, id: string): MindMap {
  const f = findBoundary(map, id);
  if (!f) return map;
  return mapTopic(map, f.owner.id, (t) => {
    const boundaries = t.boundaries!.filter((b) => b.id !== id);
    return { ...t, boundaries: boundaries.length ? boundaries : undefined };
  });
}

/**
 * Grows or shrinks a run by one sibling at one end: `end` 'start' or 'end'
 * (in child order), `delta` +1 grows outward, -1 shrinks. A run never
 * shrinks below one topic.
 */
function resizeRange<R extends ChildRange>(owner: Topic, r: R, end: 'start' | 'end', delta: 1 | -1): R {
  const ix = rangeIndices(owner, r);
  if (!ix) return r;
  let [lo, hi] = ix;
  if (end === 'start') lo = Math.max(0, Math.min(hi, lo - delta));
  else hi = Math.min(owner.children.length - 1, Math.max(lo, hi + delta));
  return { ...r, from: owner.children[lo].id, to: owner.children[hi].id };
}

export function resizeBoundary(map: MindMap, id: string, end: 'start' | 'end', delta: 1 | -1): MindMap {
  const f = findBoundary(map, id);
  if (!f) return map;
  const next = resizeRange(f.owner, f.boundary, end, delta);
  if (next.from === f.boundary.from && next.to === f.boundary.to) return map;
  return mapTopic(map, f.owner.id, (t) => ({ ...t, boundaries: t.boundaries!.map((b) => (b.id === id ? next : b)) }));
}

/** Adds a summary over sibling topics. Returns the new summary topic's id ('' when not possible). */
export function addSummary(map: MindMap, ids: string[], text = 'Özet'): { map: MindMap; id: string } {
  const run = siblingRun(map, ids);
  if (!run) return { map, id: '' };
  const topic = createTopic(text);
  const s: Summary = { ...run.range, topic };
  return { map: mapTopic(map, run.owner.id, (t) => ({ ...t, summaries: [...(t.summaries ?? []), s] })), id: topic.id };
}

/** Removes the summary whose topic is `topicId`. */
export function removeSummary(map: MindMap, topicId: string): MindMap {
  const f = summaryOwner(map, topicId);
  if (!f) return map;
  return mapTopic(map, f.owner.id, (t) => {
    const summaries = t.summaries!.filter((s) => s.topic.id !== topicId);
    return { ...t, summaries: summaries.length ? summaries : undefined };
  });
}

export function resizeSummary(map: MindMap, topicId: string, end: 'start' | 'end', delta: 1 | -1): MindMap {
  const f = summaryOwner(map, topicId);
  if (!f) return map;
  const next = resizeRange(f.owner, f.summary, end, delta);
  if (next.from === f.summary.from && next.to === f.summary.to) return map;
  return mapTopic(map, f.owner.id, (t) => ({ ...t, summaries: t.summaries!.map((s) => (s.topic.id === topicId ? next : s)) }));
}

// ---------- clipboard ----------

/** Deep copy with fresh ids, used for paste. */
export function cloneWithNewIds(t: Topic): Topic {
  const children = t.children.map(cloneWithNewIds);
  const ids = new Map(t.children.map((c, i) => [c.id, children[i].id]));
  const remap = <R extends ChildRange>(r: R): R => ({ ...r, from: ids.get(r.from) ?? r.from, to: ids.get(r.to) ?? r.to });
  const copy: Topic = { ...t, id: newId(), pos: undefined, children };
  if (t.boundaries) copy.boundaries = t.boundaries.map((b) => ({ ...remap(b), id: newId('b') }));
  if (t.summaries) copy.summaries = t.summaries.map((s) => ({ ...remap(s), topic: { ...s.topic, id: newId(), children: [] } }));
  return copy;
}

export function pasteTopic(map: MindMap, parentId: string, topic: Topic): { map: MindMap; id: string } {
  if (isSummaryTopic(map, parentId)) return { map, id: parentId };
  const copy = cloneWithNewIds(topic);
  return { map: mapTopic(map, parentId, (p) => ({ ...p, collapsed: false, children: [...p.children, copy] })), id: copy.id };
}

/** Pastes a copy as a new free-floating tree at a canvas position. */
export function pasteFloating(map: MindMap, pos: Point, topic: Topic): { map: MindMap; id: string } {
  const copy: Topic = { ...cloneWithNewIds(topic), pos };
  return { map: touch({ ...map, roots: [...map.roots, copy] }), id: copy.id };
}

// ---------- validation ----------

export function isMindMap(x: unknown): x is MindMap {
  const m = x as MindMap & { root?: Topic };
  if (!m || m.format !== 'keizu/1' || typeof m.id !== 'string') return false;
  if (Array.isArray(m.roots)) return m.roots.length > 0 && m.roots.every((r) => Array.isArray(r.children));
  return !!m.root && Array.isArray(m.root.children); // early single-root files
}

/** Fills in fields missing from older or hand-written files. */
export function normalizeMap(input: MindMap): MindMap {
  const { root, ...m } = input as MindMap & { root?: Topic };
  const roots = m.roots?.length ? m.roots : root ? [root] : [createTopic('Merkez konu')];
  return {
    ...m,
    roots,
    relations: m.relations ?? [],
    title: m.title || roots[0].text || 'Adsız',
    version: m.version ?? 0,
    updatedAt: m.updatedAt ?? new Date().toISOString(),
    theme: m.theme ?? 'fresh',
    layout: m.layout ?? 'mindmap',
    branchStyle: m.branchStyle ?? 'curve',
    multicolor: m.multicolor ?? true,
  };
}
