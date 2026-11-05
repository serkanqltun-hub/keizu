import { describe, expect, it } from 'vitest';
import { docFromMap, materialize } from './crdt';
import { fromJSON, toJSON, toMarkdown } from './io';
import { BOUNDARY_PAD, approxMeasure, focusView, layoutMap, type NodeBox } from './layout';
import {
  addBoundary,
  addChild,
  addSummary,
  cloneWithNewIds,
  createMap,
  findBoundary,
  findTopic,
  moveAmongSiblings,
  moveTopic,
  removeTopic,
  resizeBoundary,
  resizeSummary,
  summaryOwner,
  updateBoundary,
  updateTopic,
  type MindMap,
} from './model';
import { mergeMaps } from '../sync/merge';

/** Main topic with four branches; the first branch has three children. */
function sample(layout: MindMap['layout'] = 'logic') {
  const m0 = createMap('Plan', 'Dal');
  const map0 = { ...m0, layout };
  const [a, b, c, d] = map0.roots[0].children.map((x) => x.id);
  let map = map0;
  const kids: string[] = [];
  for (const text of ['x', 'y', 'z']) {
    const r = addChild(map, a, text);
    map = r.map;
    kids.push(r.id);
  }
  return { map, a, b, c, d, kids };
}

const overlap = (p: NodeBox, q: NodeBox) =>
  Math.abs(p.x - q.x) < (p.w + q.w) / 2 - 0.5 && Math.abs(p.y - q.y) < (p.h + q.h) / 2 - 0.5;

describe('boundaries', () => {
  it('outlines a run of siblings and grows or shrinks it', () => {
    const { map, kids } = sample();
    const r = addBoundary(map, [kids[1]]);
    expect(r.id).not.toBe('');
    let m = resizeBoundary(r.map, r.id, 'start', 1);
    expect(findBoundary(m, r.id)!.boundary).toMatchObject({ from: kids[0], to: kids[1] });
    m = resizeBoundary(m, r.id, 'start', 1); // already at the first child
    m = resizeBoundary(m, r.id, 'end', 1);
    expect(findBoundary(m, r.id)!.boundary).toMatchObject({ from: kids[0], to: kids[2] });
    m = resizeBoundary(m, r.id, 'end', -1);
    expect(findBoundary(m, r.id)!.boundary.to).toBe(kids[1]);
    m = updateBoundary(m, r.id, { label: 'Q1' });
    expect(findBoundary(m, r.id)!.boundary.label).toBe('Q1');
  });

  it('cannot go around the main topic', () => {
    const { map } = sample();
    expect(addBoundary(map, [map.roots[0].id]).id).toBe('');
    expect(addSummary(map, [map.roots[0].id]).id).toBe('');
  });

  it('shrinks when an end topic is deleted or moved away, and goes with its last topic', () => {
    const { map, a, b, kids } = sample();
    const r = addBoundary(map, [kids[0], kids[2]]);
    let m = removeTopic(r.map, kids[0]).map;
    expect(findBoundary(m, r.id)!.boundary).toMatchObject({ from: kids[1], to: kids[2] });
    m = moveTopic(m, kids[2], b);
    expect(findBoundary(m, r.id)!.boundary).toMatchObject({ from: kids[1], to: kids[1] });
    m = removeTopic(m, kids[1]).map;
    expect(findBoundary(m, r.id)).toBeUndefined();
    expect(findTopic(m, a)!.boundaries).toBeUndefined();
  });

  it('keeps its topics when they are reordered', () => {
    const { map, kids } = sample();
    const r = addBoundary(map, [kids[0], kids[1]]);
    const m = moveAmongSiblings(r.map, kids[1], 1);
    expect(findBoundary(m, r.id)!.boundary).toMatchObject({ from: kids[0], to: kids[1] });
  });

  it('makes room in the layout so outlined branches do not touch their neighbours', () => {
    const { map, kids } = sample();
    const before = layoutMap(map, approxMeasure);
    const r = addBoundary(map, [kids[1]], 'Etiket');
    const l = layoutMap(r.map, approxMeasure);
    expect(l.boundaries).toHaveLength(1);
    expect(l.boundaries[0].members).toEqual([kids[1]]);
    const gap = (lay: typeof l) => lay.byId.get(kids[1])!.y - lay.byId.get(kids[0])!.y;
    expect(gap(l)).toBeGreaterThan(gap(before) + BOUNDARY_PAD);
  });
});

describe('summaries', () => {
  it('adds a summary topic that can be edited, resized and removed', () => {
    const { map, a, kids } = sample();
    const r = addSummary(map, [kids[0]], 'Toplam');
    expect(summaryOwner(r.map, r.id)!.owner.id).toBe(a);
    let m = updateTopic(r.map, r.id, { text: 'Hepsi' });
    expect(findTopic(m, r.id)!.text).toBe('Hepsi');
    m = resizeSummary(m, r.id, 'end', 1);
    expect(summaryOwner(m, r.id)!.summary).toMatchObject({ from: kids[0], to: kids[1] });
    // A summary has no branches of its own.
    expect(addChild(m, r.id).map).toBe(m);
    const gone = removeTopic(m, r.id);
    expect(summaryOwner(gone.map, r.id)).toBeUndefined();
    expect(findTopic(gone.map, kids[0])).toBeDefined();
  });

  it('is placed beside the run it sums up, clear of every topic', () => {
    const { map, kids } = sample();
    const r = addSummary(map, [kids[0], kids[2]], 'Özet');
    const l = layoutMap(r.map, approxMeasure);
    const s = l.byId.get(r.id)!;
    expect(s.summaryOf).toBeDefined();
    const run = kids.map((id) => l.byId.get(id)!);
    expect(s.x - s.w / 2).toBeGreaterThan(Math.max(...run.map((b) => b.x + b.w / 2)));
    expect(s.y).toBeGreaterThan(run[0].y);
    expect(s.y).toBeLessThan(run[2].y);
    for (const b of l.nodes) if (b !== s) expect(overlap(b, s)).toBe(false);
    expect(l.brackets).toEqual([expect.objectContaining({ id: r.id, orient: 'h', dir: 1 })]);
  });

  it('goes below the run in an org chart', () => {
    const { map, b, c } = sample('org');
    const r = addSummary(map, [b, c], 'Özet');
    const l = layoutMap(r.map, approxMeasure);
    const s = l.byId.get(r.id)!;
    expect(s.y).toBeGreaterThan(l.byId.get(b)!.y);
    expect(l.brackets[0].orient).toBe('v');
    for (const n of l.nodes) if (n !== s) expect(overlap(n, s)).toBe(false);
  });

  it('works on both sides of a mind map', () => {
    const { map, c, d } = sample('mindmap');
    const r = addSummary(map, [c, d], 'Sol');
    const l = layoutMap(r.map, approxMeasure);
    const s = l.byId.get(r.id)!;
    const side = l.byId.get(d)!.side;
    expect(l.brackets[0].dir).toBe(side);
    for (const n of l.nodes) if (n !== s) expect(overlap(n, s)).toBe(false);
  });
});

describe('saving and copying', () => {
  it('round-trips through JSON and the collaboration CRDT', () => {
    const { map, kids } = sample();
    let m = addBoundary(map, [kids[0], kids[1]], 'Grup').map;
    m = addSummary(m, [kids[2]], 'Son').map;
    const back = fromJSON(toJSON(m));
    expect(back.roots).toEqual(m.roots);
    const mat = materialize(docFromMap(m));
    expect(mat.roots).toEqual(JSON.parse(JSON.stringify(m.roots)));
  });

  it('gives a pasted copy its own ids, pointing at the copied children', () => {
    const { map, a, kids } = sample();
    let m = addBoundary(map, [kids[0], kids[1]]).map;
    m = addSummary(m, [kids[2]]).map;
    const src = findTopic(m, a)!;
    const copy = cloneWithNewIds(src);
    const ids = copy.children.map((c) => c.id);
    expect(copy.boundaries![0]).toMatchObject({ from: ids[0], to: ids[1] });
    expect(copy.boundaries![0].id).not.toBe(src.boundaries![0].id);
    expect(copy.summaries![0]).toMatchObject({ from: ids[2], to: ids[2] });
    expect(copy.summaries![0].topic.id).not.toBe(src.summaries![0].topic.id);
  });

  it('writes summaries into Markdown after the branches they sum up', () => {
    const { map, kids } = sample();
    const m = addSummary(map, [kids[0], kids[1]], 'İkisi').map;
    const md = toMarkdown(m);
    expect(md).toContain('  - y\n  - » İkisi\n  - z');
  });

  it('merges a boundary added on one device with an edit on another', () => {
    const { map, a, kids } = sample();
    const local = addBoundary(map, [kids[0]], 'B').map;
    const remote = updateTopic(map, kids[2], { text: 'zz' });
    const merged = mergeMaps(map, local, remote)!;
    expect(merged).not.toBeNull();
    expect(findTopic(merged, kids[2])!.text).toBe('zz');
    expect(findTopic(merged, a)!.boundaries).toHaveLength(1);
  });
});

describe('focus mode', () => {
  it('shows only the focused branch, drawn where it stood', () => {
    const { map, a, b, kids } = sample('mindmap');
    const full = layoutMap(map, approxMeasure);
    const at = full.byId.get(a)!;
    const l = layoutMap(map, approxMeasure, { id: a, anchor: { x: at.x, y: at.y }, color: at.color });
    expect(l.focusId).toBe(a);
    expect(new Set(l.nodes.map((n) => n.id))).toEqual(new Set([a, ...kids]));
    expect(l.byId.has(b)).toBe(false);
    const f = l.byId.get(a)!;
    expect([f.x, f.y, f.depth]).toEqual([at.x, at.y, 0]);
    // The branches keep the focused branch's colour.
    for (const id of kids) expect(l.byId.get(id)!.color).toBe(at.color);
  });

  it('opens a collapsed branch and keeps the layout it inherits', () => {
    const { map, a } = sample('org');
    const m = updateTopic(map, a, { collapsed: true });
    const v = focusView(m, a)!;
    expect(v.layout).toBe('org');
    expect(v.roots[0].collapsed).toBeUndefined();
    expect(layoutMap(m, approxMeasure, { id: a }).nodes).toHaveLength(4);
  });

  it('falls back to the whole map when the topic is gone', () => {
    const { map } = sample();
    const l = layoutMap(map, approxMeasure, { id: 'missing' });
    expect(l.focusId).toBeUndefined();
    expect(l.nodes.length).toBe(8);
  });
});
