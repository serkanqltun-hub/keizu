// Three-way, topic-level merge for when two devices changed the same map
// while apart. Each topic is compared field by field against the last synced
// copy (the base): a field changed on one side only takes that side's value.
// When both sides changed the same field differently, a topic was deleted on
// one side but edited on the other, or the result would no longer be a tree,
// the merge gives up (null) and the caller keeps a conflicting copy instead.

import type { MindMap, Relation, Topic } from '../core/model';

const TOPIC_FIELDS = ['text', 'image', 'pos', 'layout', 'note', 'markers', 'collapsed', 'style'] as const;
const MAP_FIELDS = ['title', 'theme', 'layout', 'branchStyle', 'multicolor'] as const;
const ROOT = '\u0000root';

interface Flat {
  parent: string;
  fields: Record<string, string | undefined>;
  /** The topic itself, minus children. */
  topic: Omit<Topic, 'children'>;
}

interface Flattened {
  topics: Map<string, Flat>;
  /** Children ids per parent id, in order; roots under ROOT. */
  order: Map<string, string[]>;
}

const key = (v: unknown) => (v === undefined ? undefined : JSON.stringify(v));

function flatten(map: MindMap): Flattened {
  const topics = new Map<string, Flat>();
  const order = new Map<string, string[]>();
  const walk = (list: Topic[], parent: string) => {
    order.set(
      parent,
      list.map((t) => t.id),
    );
    for (const t of list) {
      const { children, ...rest } = t;
      const fields: Record<string, string | undefined> = {};
      for (const f of TOPIC_FIELDS) fields[f] = key(rest[f]);
      topics.set(t.id, { parent, fields, topic: rest });
      walk(children, t.id);
    }
  };
  walk(map.roots, ROOT);
  return { topics, order };
}

class Conflict extends Error {}

/** Picks the value of one field: unchanged side loses, equal changes agree. */
function pick<T>(base: T, local: T, remote: T, same: (a: T, b: T) => boolean): T {
  if (same(local, remote)) return local;
  if (same(local, base)) return remote;
  if (same(remote, base)) return local;
  throw new Conflict();
}
const eq = (a: unknown, b: unknown) => a === b;

function mergeTopic(b: Flat | undefined, l: Flat | undefined, r: Flat | undefined): Flat | undefined {
  if (!b) {
    // Added on one side (or, rarely, both with the same id).
    if (l && r) {
      if (l.parent !== r.parent || TOPIC_FIELDS.some((f) => l.fields[f] !== r.fields[f])) throw new Conflict();
      return l;
    }
    return l ?? r;
  }
  const unchanged = (x: Flat) => x.parent === b.parent && TOPIC_FIELDS.every((f) => x.fields[f] === b.fields[f]);
  if (!l && !r) return undefined;
  if (!l) {
    if (unchanged(r!)) return undefined;
    throw new Conflict();
  }
  if (!r) {
    if (unchanged(l)) return undefined;
    throw new Conflict();
  }
  const parent = pick(b.parent, l.parent, r.parent, eq);
  const topic: Record<string, unknown> = { id: b.topic.id };
  const fields: Record<string, string | undefined> = {};
  for (const f of TOPIC_FIELDS) {
    const k = pick(b.fields[f], l.fields[f], r.fields[f], eq);
    fields[f] = k;
    const src = k === l.fields[f] ? l.topic : r.topic;
    if (src[f] !== undefined) topic[f] = src[f];
  }
  return { parent, fields, topic: topic as Flat['topic'] };
}

/**
 * Order of one parent's children. The side that reordered the children both
 * had leads; the other side's new children go in after their nearest earlier
 * sibling.
 */
function mergeOrder(present: Set<string>, base: string[], local: string[], remote: string[]): string[] {
  const inBase = new Set(base);
  const common = (list: string[]) => list.filter((id) => inBase.has(id) && present.has(id));
  const baseCommon = common(base).join();
  const [lead, other] = common(local).join() !== baseCommon ? [local, remote] : [remote, local];
  const out = lead.filter((id) => present.has(id));
  const placed = new Set(out);
  for (let i = 0; i < other.length; i++) {
    const id = other[i];
    if (placed.has(id) || !present.has(id)) continue;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.indexOf(other[j]);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, id);
    placed.add(id);
  }
  return out;
}

function mergeRelations(base: Relation[], local: Relation[], remote: Relation[], topics: Map<string, Flat>): Relation[] {
  const by = (list: Relation[]) => new Map(list.map((r) => [r.id, r]));
  const [b, l, r] = [by(base), by(local), by(remote)];
  const ids = [...new Set([...local.map((x) => x.id), ...remote.map((x) => x.id), ...base.map((x) => x.id)])];
  const out: Relation[] = [];
  for (const id of ids) {
    const [bb, ll, rr] = [b.get(id), l.get(id), r.get(id)];
    let rel: Relation | undefined;
    if (!bb) rel = ll ?? rr;
    else if (!ll || !rr) {
      const kept = ll ?? rr;
      // Deleted on one side: stays deleted unless the other side edited it.
      if (kept && key(kept) !== key(bb)) throw new Conflict();
      rel = undefined;
    } else rel = pick(bb, ll, rr, (x, y) => key(x) === key(y));
    if (rel && topics.has(rel.from) && topics.has(rel.to)) out.push(rel);
  }
  return out;
}

/** Merges two edited copies of a map. Returns null when they truly conflict. */
export function mergeMaps(base: MindMap, local: MindMap, remote: MindMap): MindMap | null {
  try {
    const [B, L, R] = [flatten(base), flatten(local), flatten(remote)];
    const ids = new Set([...L.topics.keys(), ...R.topics.keys(), ...B.topics.keys()]);
    const merged = new Map<string, Flat>();
    for (const id of ids) {
      const m = mergeTopic(B.topics.get(id), L.topics.get(id), R.topics.get(id));
      if (m) merged.set(id, m);
    }
    // Children per parent, then rebuild the tree from the roots.
    const kids = new Map<string, Set<string>>();
    for (const [id, f] of merged) {
      if (f.parent !== ROOT && !merged.has(f.parent)) throw new Conflict(); // parent deleted on the other side
      if (!kids.has(f.parent)) kids.set(f.parent, new Set());
      kids.get(f.parent)!.add(id);
    }
    let built = 0;
    const build = (parent: string, depth: number): Topic[] => {
      if (depth > 10_000) throw new Conflict();
      const present = kids.get(parent) ?? new Set<string>();
      const order = mergeOrder(present, B.order.get(parent) ?? [], L.order.get(parent) ?? [], R.order.get(parent) ?? []);
      return order.map((id) => {
        built++;
        return { ...merged.get(id)!.topic, children: build(id, depth + 1) } as Topic;
      });
    };
    const roots = build(ROOT, 0);
    if (built !== merged.size || !roots.length) throw new Conflict(); // a cycle cut topics off
    const out: MindMap = { ...remote, roots };
    for (const f of MAP_FIELDS) (out as unknown as Record<string, unknown>)[f] = pick(base[f], local[f], remote[f], eq);
    out.relations = mergeRelations(base.relations, local.relations, remote.relations, merged);
    const resources = { ...remote.resources, ...local.resources };
    const used = new Set([...merged.values()].map((f) => f.topic.image?.res).filter(Boolean));
    const kept = Object.fromEntries(Object.entries(resources).filter(([k]) => used.has(k)));
    if (Object.keys(kept).length) out.resources = kept;
    else delete out.resources;
    out.version = Math.max(local.version, remote.version) + 1;
    out.updatedAt = new Date().toISOString();
    return out;
  } catch (e) {
    if (e instanceof Conflict) return null;
    throw e;
  }
}
