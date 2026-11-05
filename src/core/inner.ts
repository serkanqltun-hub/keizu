// Inner maps ("iç ağaçlar"): a topic can hold a whole map of its own that is
// shown only when you enter the topic.
//
// The inner topics stay in the ordinary tree, as children of the topic with
// `inside: true`. So ids stay unique across the file, search, history, live
// collaboration and merging work as before, and an older Keizu simply shows
// them as normal children. What changes is the view: the editor works on a
// "view map" built by `viewOf` (the outer map with inner topics hidden, or
// one topic's inner map) and writes each edit back with `writeBack`.

import { cloneWithNewIds, findTopic, newId, type MindMap, type Relation, type Topic } from './model';

/** Path of topic ids, outermost first: the inner maps you are in. */
export type InnerPath = string[];

/** The topic opens an inner view: a map of `inside` children, or another kind. */
export const hasInner = (t: Topic | undefined): boolean => !!t && (!!t.innerKind || t.children.some((c) => c.inside));

/** Kind of inner view: 'map' for the built-in inner map. */
export const innerKindOf = (t: Topic): string => t.innerKind ?? 'map';

function count(t: Topic): number {
  return 1 + t.children.reduce((n, c) => n + count(c), 0);
}

/** Number of topics in a topic's inner map (0 when it has none). */
export function innerSize(t: Topic): number {
  return t.children.reduce((n, c) => (c.inside ? n + count(c) : n), 0);
}

/** The topic without its inner topics, marked with how many it hides. */
function strip(t: Topic): Topic {
  let changed = false;
  const kids: Topic[] = [];
  for (const c of t.children) {
    if (c.inside) {
      changed = true;
      continue;
    }
    const s = strip(c);
    if (s !== c) changed = true;
    kids.push(s);
  }
  const size = innerSize(t) || (t.innerKind ? 1 : 0);
  if (!changed && !size) return t;
  return size ? { ...t, innerSize: size, children: kids } : { ...t, children: kids };
}

function ids(roots: Topic[], out = new Set<string>()): Set<string> {
  const walk = (t: Topic) => {
    out.add(t.id);
    t.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

function anyInner(roots: Topic[]): boolean {
  const walk = (t: Topic): boolean => !!t.innerKind || t.children.some((c) => c.inside || walk(c));
  return roots.some(walk);
}

/** Keeps a path only as far as each step still exists and still holds an inner map. */
export function validPath(doc: MindMap, path: InnerPath): InnerPath {
  const out: InnerPath = [];
  for (const id of path) {
    const t = findTopic(doc, id);
    if (!hasInner(t)) break;
    out.push(id);
  }
  return out;
}

/**
 * The map the editor shows and edits: the outer map without inner topics,
 * or (inside a topic) that topic as the main topic with its inner map.
 */
export function viewOf(doc: MindMap, path: InnerPath): MindMap {
  const id = path[path.length - 1];
  const host = id ? findTopic(doc, id) : undefined;
  if (!host || !hasInner(host)) {
    if (!anyInner(doc.roots)) return doc;
    const roots = doc.roots.map(strip);
    const shown = ids(roots);
    return { ...doc, roots, relations: doc.relations.filter((r) => shown.has(r.from) && shown.has(r.to)) };
  }
  const root: Topic = {
    ...host,
    children: host.children.filter((c) => c.inside).map((c) => strip({ ...c, inside: undefined })),
  };
  delete root.layout;
  delete root.innerLayout;
  delete root.inside;
  delete root.pos;
  delete root.collapsed;
  const shown = ids([root]);
  return {
    ...doc,
    layout: host.innerLayout ?? doc.layout,
    roots: [root],
    relations: doc.relations.filter((r) => shown.has(r.from) && shown.has(r.to)),
  };
}

function index(roots: Topic[]): Map<string, Topic> {
  const out = new Map<string, Topic>();
  const walk = (t: Topic) => {
    out.set(t.id, t);
    t.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

function replaceIn(t: Topic, id: string, next: Topic): Topic {
  if (t.id === id) return next;
  let changed = false;
  const children = t.children.map((c) => {
    const n = replaceIn(c, id, next);
    if (n !== c) changed = true;
    return n;
  });
  return changed ? { ...t, children } : t;
}

/**
 * Puts an edited view map back into the document. Inner topics the view did
 * not show are kept under their (possibly moved) parents; topics deleted in
 * the view take their inner maps with them.
 */
export function writeBack(doc: MindMap, path: InnerPath, next: MindMap): MindMap {
  const before = viewOf(doc, path);
  if (next === before) return doc;
  if (before === doc) return next; // nothing hidden: the view is the document
  const old = index(doc.roots);
  const shownBefore = ids(before.roots);
  const shownNow = ids(next.roots);

  // `host`: the topic whose inner map is being shown, at the top of the view.
  const rebuild = (t: Topic, host: boolean): Topic => {
    const prev = old.get(t.id);
    let kids = t.children.map((c) => rebuild(c, false));
    if (host) kids = kids.map((k) => (k.inside ? k : { ...k, inside: true }));
    // Children the view hid: the outer ones of the host, the inner ones elsewhere.
    const hidden = (prev?.children ?? []).filter((c) => (host ? !c.inside : c.inside) && !shownNow.has(c.id));
    const out: Topic = { ...t, children: host ? [...hidden, ...kids] : [...kids, ...hidden] };
    delete out.innerSize;
    return out;
  };

  const hostId = path.length && before.roots[0].id === path[path.length - 1] ? path[path.length - 1] : undefined;
  let roots: Topic[];
  let layout = doc.layout;
  let title = next.title;
  if (hostId) {
    // Edits inside follow the inner main topic's text into the title: not ours.
    title = doc.title;
    const prev = old.get(hostId)!;
    const [main, ...extra] = next.roots;
    const top = rebuild(main, true);
    // Floating topics can't live in an inner map: keep them as inner topics.
    for (const f of extra) top.children.push({ ...rebuild(f, false), inside: true, pos: undefined });
    const innerLayout = top.layout ?? (next.layout !== doc.layout || prev.innerLayout ? next.layout : undefined);
    const host: Topic = { ...top, layout: prev.layout, inside: prev.inside, pos: prev.pos, collapsed: prev.collapsed, innerLayout };
    for (const k of ['layout', 'inside', 'pos', 'collapsed', 'innerLayout'] as const) if (host[k] === undefined) delete host[k];
    roots = doc.roots.map((r) => replaceIn(r, hostId, host));
  } else {
    roots = next.roots.map((r) => rebuild(r, false));
    layout = next.layout;
  }

  const live = ids(roots);
  const relations: Relation[] = [
    ...doc.relations.filter((r) => !(shownBefore.has(r.from) && shownBefore.has(r.to))),
    ...next.relations,
  ].filter((r) => live.has(r.from) && live.has(r.to));
  return { ...next, title, layout, roots, relations };
}

/** Topic ids to enter, outermost first, to see `id` (empty when it is on the outer map). */
export function innerPathTo(doc: MindMap, id: string): InnerPath | undefined {
  const walk = (t: Topic, path: InnerPath): InnerPath | undefined => {
    if (t.id === id) return path;
    for (const c of t.children) {
      const hit = walk(c, c.inside ? [...path, t.id] : path);
      if (hit) return hit;
    }
    return undefined;
  };
  for (const r of doc.roots) {
    const hit = walk(r, []);
    if (hit) return hit;
  }
  return undefined;
}

function mapTopic(doc: MindMap, id: string, fn: (t: Topic) => Topic): MindMap {
  const t = findTopic(doc, id);
  if (!t) return doc;
  const next = fn(t);
  if (next === t) return doc;
  return { ...doc, roots: doc.roots.map((r) => replaceIn(r, id, next)), updatedAt: new Date().toISOString() };
}

/** "Dalı iç haritaya çevir": the topic's branch moves into its inner map. */
export function branchToInner(doc: MindMap, id: string): MindMap {
  return mapTopic(doc, id, (t) => {
    if (!t.children.some((c) => !c.inside)) return t;
    const { collapsed: _c, ...rest } = t;
    return { ...rest, children: t.children.map((c) => (c.inside ? c : { ...c, inside: true })) };
  });
}

/** "İç haritayı dala aç": the inner map's topics become the topic's branch again. */
export function innerToBranch(doc: MindMap, id: string): MindMap {
  return mapTopic(doc, id, (t) => {
    if (!hasInner(t)) return t;
    const outer = t.children.filter((c) => !c.inside);
    const inner = t.children.filter((c) => c.inside).map((c) => {
      const { inside: _i, ...rest } = c;
      return rest as Topic;
    });
    const { innerLayout: _l, ...rest } = t;
    return { ...rest, children: [...outer, ...inner] };
  });
}

/** "Konuya iç harita ekle": an empty inner map with one topic to start from. */
export function addInner(doc: MindMap, id: string, text: string): { map: MindMap; id: string } {
  const child: Topic = { id: newId(), text, inside: true, children: [] };
  const map = mapTopic(doc, id, (t) => (hasInner(t) ? t : { ...t, children: [...t.children, child] }));
  return { map, id: map === doc ? '' : child.id };
}

/**
 * Adds another map as one topic whose inner map holds the rest of it: its
 * main topic becomes the new topic, its other topics the inner map. Ids are
 * renewed so the two maps can't collide; relations and pictures come along.
 * `parentId` null adds a floating topic at `pos`.
 */
export function insertMapAsTopic(
  doc: MindMap,
  other: MindMap,
  parentId: string | null,
  pos?: { x: number; y: number },
): { map: MindMap; id: string } {
  const renamed = new Map<string, string>();
  const copy = (t: Topic): Topic => {
    const c = cloneWithNewIds({ ...t, children: [] });
    renamed.set(t.id, c.id);
    return { ...c, children: t.children.map(copy) };
  };
  const [main, ...floating] = other.roots;
  const top = copy(main);
  const tail = floating.map(copy);
  const { innerSize: _s, ...clean } = top;
  const topic: Topic = {
    ...clean,
    innerLayout: other.layout !== doc.layout ? other.layout : undefined,
    children: [...top.children, ...tail].map((c) => ({ ...c, inside: true })),
  };
  if (!topic.innerLayout) delete topic.innerLayout;
  const rels: Relation[] = other.relations
    .filter((r) => renamed.has(r.from) && renamed.has(r.to))
    .map((r) => ({ ...r, id: newId('r'), from: renamed.get(r.from)!, to: renamed.get(r.to)! }));
  const resources = other.resources ? { ...(doc.resources ?? {}), ...other.resources } : doc.resources;
  let roots: Topic[];
  if (parentId && findTopic(doc, parentId)) {
    roots = doc.roots.map((r) => {
      const p = findTopic({ ...doc, roots: [r] }, parentId);
      return p ? replaceIn(r, parentId, { ...p, collapsed: undefined, children: [...p.children, topic] }) : r;
    });
  } else {
    roots = [...doc.roots, { ...topic, pos: pos ?? { x: 0, y: 0 } }];
  }
  return {
    map: { ...doc, roots, relations: [...doc.relations, ...rels], resources, updatedAt: new Date().toISOString() },
    id: topic.id,
  };
}
