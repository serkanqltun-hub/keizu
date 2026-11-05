// Operations on several topics at once (multi-select), and the format
// painter. Like the rest of the model, every function is pure and returns a
// new map, so one bulk change is one undo step.

import {
  cloneWithNewIds,
  findParent,
  findTopic,
  floatTopic,
  moveTopic,
  removeTopic,
  updateStyle,
  updateTopic,
  type MindMap,
  type Point,
  type Topic,
  type TopicStyle,
} from './model';

/** Ids of every topic in document order (roots first, depth first). */
export function documentOrder(map: MindMap): string[] {
  const out: string[] = [];
  const walk = (t: Topic) => {
    out.push(t.id);
    t.children.forEach(walk);
  };
  map.roots.forEach(walk);
  return out;
}

/**
 * The selected topics that are not inside another selected topic, in
 * document order. Moving, copying or deleting these carries the rest along.
 */
export function topLevel(map: MindMap, ids: Iterable<string>): string[] {
  const set = new Set(ids);
  const out: string[] = [];
  const walk = (t: Topic) => {
    if (set.has(t.id)) return void out.push(t.id);
    t.children.forEach(walk);
    for (const s of t.summaries ?? []) if (set.has(s.topic.id)) out.push(s.topic.id);
  };
  map.roots.forEach(walk);
  return out;
}

/** Applies a style change to every listed topic. */
export function updateStyles(map: MindMap, ids: Iterable<string>, patch: TopicStyle): MindMap {
  let next = map;
  for (const id of ids) next = updateStyle(next, id, patch);
  return next;
}

/** Turns a marker on or off on every listed topic (one marker per group). */
export function setMarker(map: MindMap, ids: Iterable<string>, marker: string, on: boolean): MindMap {
  const group = marker.split('-')[0];
  let next = map;
  for (const id of ids) {
    const t = findTopic(next, id);
    if (!t) continue;
    const cur = t.markers ?? [];
    const markers = on ? [...cur.filter((m) => m.split('-')[0] !== group), marker] : cur.filter((m) => m !== marker);
    if (markers.length === cur.length && markers.every((m, i) => m === cur[i])) continue;
    next = updateTopic(next, id, { markers: markers.length ? markers : undefined });
  }
  return next;
}

/** Collapses (true) or expands (false) every listed topic that has children. */
export function setCollapsed(map: MindMap, ids: Iterable<string>, collapsed: boolean): MindMap {
  let next = map;
  for (const id of ids) {
    const t = findTopic(next, id);
    if (!t || !t.children.length || id === next.roots[0]?.id || !!t.collapsed === collapsed) continue;
    next = updateTopic(next, id, { collapsed });
  }
  return next;
}

/** Gives every listed topic the same branch layout (undefined: inherit). */
export function setLayouts(map: MindMap, ids: Iterable<string>, layout: Topic['layout']): MindMap {
  let next = map;
  for (const id of ids) if (findTopic(next, id)) next = updateTopic(next, id, { layout });
  return next;
}

/** Removes several topics (never the main one). Returns what to select next. */
export function removeTopics(map: MindMap, ids: Iterable<string>): { map: MindMap; nextId: string } {
  const main = map.roots[0]?.id;
  const list = topLevel(map, [...ids].filter((id) => id !== main));
  if (!list.length) return { map, nextId: map.roots[0].id };
  // Select the parent of the first removed topic that survives.
  const removed = new Set(list);
  let nextId = map.roots[0].id;
  for (let p = findParent(map, list[0]); p; p = findParent(map, p.id)) {
    if (!removed.has(p.id)) {
      nextId = p.id;
      break;
    }
  }
  let next = map;
  for (const id of list) next = removeTopic(next, id).map;
  return { map: next, nextId };
}

/** Moves several topics under a new parent, keeping their order. */
export function moveTopics(map: MindMap, ids: Iterable<string>, parentId: string): MindMap {
  const main = map.roots[0]?.id;
  let next = map;
  for (const id of topLevel(map, [...ids].filter((i) => i !== main))) next = moveTopic(next, id, parentId);
  return next;
}

/**
 * Floats several topics, each moved by the same offset from where it is
 * drawn now (`at` gives that current centre).
 */
export function floatTopics(map: MindMap, ids: Iterable<string>, at: (id: string) => Point | undefined, delta: Point): MindMap {
  let next = map;
  const main = map.roots[0]?.id;
  for (const id of topLevel(map, [...ids].filter((i) => i !== main))) {
    const p = at(id);
    if (!p) continue;
    next = floatTopic(next, id, { x: Math.round(p.x + delta.x), y: Math.round(p.y + delta.y) });
  }
  return next;
}

/** Pastes copies of several topics (fresh ids) as the last children of a parent. */
export function pasteTopics(map: MindMap, parentId: string, topics: Topic[]): { map: MindMap; ids: string[] } {
  const parent = findTopic(map, parentId);
  if (!parent || !topics.length) return { map, ids: [] };
  const copies = topics.map(cloneWithNewIds);
  const next = updateTopic(map, parentId, { collapsed: false });
  return { map: replaceChildren(next, parentId, (c) => [...c, ...copies]), ids: copies.map((c) => c.id) };
}

function replaceChildren(map: MindMap, id: string, fn: (children: Topic[]) => Topic[]): MindMap {
  const walk = (t: Topic): Topic => {
    if (t.id === id) return { ...t, children: fn(t.children) };
    let changed = false;
    const children = t.children.map((c) => {
      const n = walk(c);
      if (n !== c) changed = true;
      return n;
    });
    return changed ? { ...t, children } : t;
  };
  const roots = map.roots.map(walk);
  return { ...map, roots, updatedAt: new Date().toISOString() };
}

// ---------- format painter ----------

/** The look of a topic that the format painter copies. */
export function copyableStyle(t: Topic): TopicStyle {
  const { showNote: _ignored, ...style } = t.style ?? {};
  return style;
}

/**
 * Gives topics the copied look: shape, fill, text colour, size, bold and
 * italic all become the source's (missing ones go back to automatic).
 * Whether a note is shown inside the topic is the topic's own choice and stays.
 */
export function applyStyle(map: MindMap, ids: Iterable<string>, style: TopicStyle): MindMap {
  let next = map;
  for (const id of ids) {
    const t = findTopic(next, id);
    if (!t) continue;
    const merged: TopicStyle = { ...style };
    if (t.style?.showNote) merged.showNote = true;
    for (const k of Object.keys(merged) as (keyof TopicStyle)[]) if (merged[k] === undefined) delete merged[k];
    const same = JSON.stringify(merged) === JSON.stringify(t.style ?? {});
    if (same) continue;
    next = updateTopic(next, id, { style: Object.keys(merged).length ? merged : undefined });
  }
  return next;
}
