import { describe, expect, it } from 'vitest';
import { applyOps, cloneDoc, diff, docFromMap, inverse, keyBetween, materialize, stamp, type CrdtDoc, type MapLike, type Op } from './crdt';
import { addChild, addRelation, createMap, findTopic, moveTopic, removeTopic, updateTopic, type MindMap } from './model';

const asMap = (base: MindMap, m: MapLike): MindMap => ({ ...base, ...m }) as MindMap;

/** A replica: its document and the map it shows. */
class Replica {
  doc: CrdtDoc;
  constructor(public name: string, start: CrdtDoc, public base: MindMap) {
    this.doc = cloneDoc(start);
  }
  get map(): MindMap {
    return asMap(this.base, materialize(this.doc));
  }
  edit(fn: (m: MindMap) => MindMap): Op[] {
    const ops = stamp(this.doc, diff(this.doc, fn(this.map)), this.name);
    applyOps(this.doc, ops);
    return ops;
  }
}

/** Topic ids, depth first, with their parent: enough to compare two maps. */
function shape(m: MapLike): string {
  const out: string[] = [];
  const walk = (t: MapLike['roots'][0], p: string) => {
    out.push(`${p}>${t.id}:${t.text}`);
    t.children.forEach((c) => walk(c, t.id));
  };
  m.roots.forEach((r) => walk(r, '-'));
  return out.join('|') + '#' + m.relations.map((r) => `${r.from}-${r.to}`).join(',');
}

describe('position keys', () => {
  it('always fit between', () => {
    let lo: string | null = null;
    const keys: string[] = [];
    for (let i = 0; i < 200; i++) keys.push((lo = keyBetween(lo, null)));
    for (let i = 1; i < keys.length; i++) expect(keys[i] > keys[i - 1]).toBe(true);
    let hi: string | null = null;
    for (let i = 0; i < 200; i++) {
      const k = keyBetween(null, hi);
      if (hi !== null) expect(k < hi).toBe(true);
      hi = k;
    }
    for (let i = 0; i < 300; i++) {
      const a = keyBetween(null, null), b = keyBetween(a, null);
      const m = keyBetween(a, b);
      expect(a < m && m < b).toBe(true);
    }
    // Squeezing the same gap over and over keeps working.
    let a = 'V', b = 'W';
    for (let i = 0; i < 100; i++) {
      const m = keyBetween(a, b);
      expect(a < m && m < b).toBe(true);
      if (i % 2) a = m;
      else b = m;
    }
  });
});

describe('crdt', () => {
  it('round-trips a map', () => {
    const m = addRelation(createMap(), createMap().roots[0].id, createMap().roots[0].id).map;
    const map = createMap();
    const doc = docFromMap(map);
    const back = materialize(doc);
    expect(shape(back)).toBe(shape(map));
    expect(back.title).toBe(map.title);
    expect(diff(doc, map)).toEqual([]);
    expect(m).toBeTruthy();
  });

  it('merges concurrent edits to different topics', () => {
    const map = createMap();
    const start = docFromMap(map);
    const a = new Replica('a', start, map), b = new Replica('b', start, map);
    const [t1, t2] = map.roots[0].children;
    const opsA = a.edit((m) => updateTopic(m, t1.id, { text: 'from A' }));
    const opsB = b.edit((m) => addChild(m, t2.id, 'child of B').map);
    applyOps(a.doc, opsB);
    applyOps(b.doc, opsA);
    expect(shape(a.map)).toBe(shape(b.map));
    expect(findTopic(a.map, t1.id)!.text).toBe('from A');
    expect(findTopic(a.map, t2.id)!.children).toHaveLength(1);
  });

  it('keeps both inserts at the same spot, in the same order everywhere', () => {
    const map = createMap();
    const start = docFromMap(map);
    const a = new Replica('a', start, map), b = new Replica('b', start, map);
    const root = map.roots[0].id;
    const opsA = a.edit((m) => addChild(m, root, 'A').map);
    const opsB = b.edit((m) => addChild(m, root, 'B').map);
    applyOps(a.doc, opsB);
    applyOps(b.doc, opsA);
    expect(shape(a.map)).toBe(shape(b.map));
    expect(a.map.roots[0].children).toHaveLength(6);
  });

  it('resolves a move loop the same way on every replica', () => {
    const map = createMap();
    const start = docFromMap(map);
    const a = new Replica('a', start, map), b = new Replica('b', start, map);
    const [x, y] = map.roots[0].children;
    const opsA = a.edit((m) => moveTopic(m, x.id, y.id));
    const opsB = b.edit((m) => moveTopic(m, y.id, x.id));
    applyOps(a.doc, opsB);
    applyOps(b.doc, opsA);
    expect(shape(a.map)).toBe(shape(b.map));
    // Nothing vanished.
    expect(findTopic(a.map, x.id)).toBeTruthy();
    expect(findTopic(a.map, y.id)).toBeTruthy();
  });

  it('a topic added under a branch someone else deleted disappears with it', () => {
    const map = createMap();
    const start = docFromMap(map);
    const a = new Replica('a', start, map), b = new Replica('b', start, map);
    const x = map.roots[0].children[0];
    const opsA = a.edit((m) => removeTopic(m, x.id).map);
    const opsB = b.edit((m) => addChild(m, x.id, 'late').map);
    applyOps(a.doc, opsB);
    applyOps(b.doc, opsA);
    expect(shape(a.map)).toBe(shape(b.map));
    expect(findTopic(a.map, x.id)).toBeUndefined();
  });

  it('undo restores only what this user changed', () => {
    const map = createMap();
    const start = docFromMap(map);
    const a = new Replica('a', start, map), b = new Replica('b', start, map);
    const [t1, t2] = map.roots[0].children;
    const before = cloneDoc(a.doc);
    const changes = diff(a.doc, updateTopic(a.map, t1.id, { text: 'A typed' }));
    const opsA = stamp(a.doc, changes, 'a');
    applyOps(a.doc, opsA);
    applyOps(a.doc, b.edit((m) => updateTopic(m, t2.id, { text: 'B typed' })));
    applyOps(a.doc, stamp(a.doc, inverse(before, changes), 'a'));
    expect(findTopic(a.map, t1.id)!.text).toBe(t1.text);
    expect(findTopic(a.map, t2.id)!.text).toBe('B typed');
  });

  it('converges under random concurrent editing', () => {
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const map = createMap();
    const start = docFromMap(map);
    const reps = ['a', 'b', 'c'].map((n) => new Replica(n, start, map));
    const inbox: Op[][][] = reps.map(() => []);
    const all = (m: MindMap) => {
      const ids: string[] = [];
      const walk = (t: MindMap['roots'][0]) => {
        ids.push(t.id);
        t.children.forEach(walk);
      };
      m.roots.forEach(walk);
      return ids;
    };
    for (let step = 0; step < 400; step++) {
      const i = rnd(3);
      const r = reps[i];
      // Sometimes deliver what's waiting first.
      if (rnd(3) === 0) {
        for (const ops of inbox[i].splice(0)) applyOps(r.doc, ops);
      }
      const ids = all(r.map);
      const pick = () => ids[rnd(ids.length)];
      const op = rnd(5);
      const ops = r.edit((m) => {
        if (op === 0) return addChild(m, pick(), `n${step}`).map;
        if (op === 1) return updateTopic(m, pick(), { text: `t${step}` });
        if (op === 2) return moveTopic(m, pick(), pick());
        if (op === 3 && ids.length > 8) return removeTopic(m, pick()).map;
        return addRelation(m, pick(), pick(), `r${step}`).map;
      });
      reps.forEach((_, j) => j !== i && inbox[j].push(ops));
    }
    reps.forEach((r, j) => inbox[j].splice(0).forEach((ops) => applyOps(r.doc, ops)));
    const s = shape(materialize(reps[0].doc));
    expect(shape(materialize(reps[1].doc))).toBe(s);
    expect(shape(materialize(reps[2].doc))).toBe(s);
    // Each topic appears once.
    const ids = all(reps[0].map);
    expect(new Set(ids).size).toBe(ids.length);
    // A replica's own map round-trips without producing more changes.
    expect(diff(reps[0].doc, reps[0].map)).toEqual([]);
  });
});
