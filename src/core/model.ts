// Keizu document model. Every operation is pure: it returns a new map and
// never mutates its input, which keeps undo/redo a simple snapshot stack.
//
// A map is a graph, not a single tree: it holds one or more root topics
// (the first is the main one, the rest float freely on the canvas) plus
// relations, which are labelled links between any two topics. How a tree is
// drawn (mind map, logic chart, org chart) is a view setting, not data.

export type LayoutKind = 'mindmap' | 'logic' | 'org' | 'concept' | 'timeline' | 'fishbone' | 'matrix';

/** Every layout, in the order the app offers them. */
export const LAYOUT_KINDS: LayoutKind[] = ['mindmap', 'logic', 'org', 'concept', 'timeline', 'fishbone', 'matrix'];
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
  collapsed?: boolean;
  style?: TopicStyle;
  children: Topic[];
}

export interface Relation {
  id: string;
  from: string;
  to: string;
  label?: string;
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

export function countTopics(t: Topic): number {
  return 1 + t.children.reduce((n, c) => n + countTopics(c), 0);
}

export function countAll(map: MindMap): number {
  return map.roots.reduce((n, r) => n + countTopics(r), 0);
}

function collectIds(t: Topic, out = new Set<string>()): Set<string> {
  out.add(t.id);
  t.children.forEach((c) => collectIds(c, out));
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
  return changed ? { ...t, children } : t;
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

/** Removes a topic and its subtree. Returns the id that should be selected next. */
export function removeTopic(map: MindMap, id: string): { map: MindMap; nextId: string } {
  if (map.roots[0]?.id === id) return { map, nextId: id }; // the main topic stays
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
  const next = mapTopic(map, parent.id, (p) => ({ ...p, children: rest }));
  return { map: { ...next, relations: dropRelations(next, removed) }, nextId };
}

/** Takes a topic out of the tree; returns the map without it and the topic. */
function detach(map: MindMap, id: string): { map: MindMap; node: Topic } | undefined {
  const node = findTopic(map, id);
  if (!node) return undefined;
  if (isRoot(map, id)) return { map: { ...map, roots: map.roots.filter((r) => r.id !== id) }, node };
  const parent = findParent(map, id)!;
  return { map: mapTopic(map, parent.id, (p) => ({ ...p, children: p.children.filter((c) => c.id !== id) })), node };
}

/** Moves `id` under `newParentId` at `index` (end when omitted). No-op on invalid moves. */
export function moveTopic(map: MindMap, id: string, newParentId: string, index?: number): MindMap {
  if (id === map.roots[0]?.id || id === newParentId) return map;
  if (isDescendant(map, id, newParentId) || !findTopic(map, newParentId)) return map;
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
  if (id === map.roots[0]?.id) return map;
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

export function setMapProps(map: MindMap, patch: Partial<Pick<MindMap, 'theme' | 'layout' | 'branchStyle' | 'multicolor' | 'title'>>): MindMap {
  return { ...map, ...patch, updatedAt: new Date().toISOString() };
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

export function updateRelation(map: MindMap, id: string, patch: Partial<Omit<Relation, 'id'>>): MindMap {
  return touch({ ...map, relations: map.relations.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
}

export function removeRelation(map: MindMap, id: string): MindMap {
  return touch({ ...map, relations: map.relations.filter((r) => r.id !== id) });
}

// ---------- clipboard ----------

/** Deep copy with fresh ids, used for paste. */
export function cloneWithNewIds(t: Topic): Topic {
  return { ...t, id: newId(), pos: undefined, children: t.children.map(cloneWithNewIds) };
}

export function pasteTopic(map: MindMap, parentId: string, topic: Topic): { map: MindMap; id: string } {
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
