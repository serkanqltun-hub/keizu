import { describe, expect, it } from 'vitest';
import { approxMeasure, layoutMap, type MapLayout } from './layout';
import {
  addChild,
  createMap,
  findParent,
  findTopic,
  indentTopic,
  moveAmongSiblings,
  moveTopic,
  outdentTopic,
  revealTopic,
  setBranchLayout,
  toggleCollapse,
  type MindMap,
} from './model';
import { outlineRows } from './outline';
import { fold, matchLabel, matchText, searchMap } from './search';
import { snappedViewport, visibleIn } from './viewport';

function noOverlaps(l: MapLayout) {
  const boxes = l.nodes;
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 0.5 && Math.abs(a.y - b.y) < (a.h + b.h) / 2 - 0.5;
      if (overlap) throw new Error(`"${a.topic.text}" overlaps "${b.topic.text}"`);
    }
}

/** A main topic with three children, each with two grandchildren. */
function branchy(): { map: MindMap; branch: string } {
  let m = createMap('Kök');
  const branch = m.roots[0].children[0].id;
  for (let i = 0; i < 3; i++) {
    const r = addChild(m, branch, `Çocuk ${i}`);
    m = addChild(addChild(r.map, r.id, `Torun ${i}a`).map, r.id, `Torun ${i}b`).map;
  }
  return { map: m, branch };
}

describe('per-branch layout', () => {
  it('lays one branch out as an org chart inside a mind map', () => {
    const { map, branch } = branchy();
    const m = setBranchLayout(map, branch, 'org');
    const l = layoutMap(m, approxMeasure);
    const b = l.byId.get(branch)!;
    expect(b.flow).toBe('down');
    for (const c of findTopic(m, branch)!.children) {
      const cb = l.byId.get(c.id)!;
      expect(cb.y).toBeGreaterThan(b.y); // children below
      expect(cb.layout).toBe('org'); // inherited
    }
    // The rest of the map is still a mind map.
    const other = l.byId.get(m.roots[0].children[1].id)!;
    expect(other.layout).toBe('mindmap');
    noOverlaps(l);
  });

  it('mirrors a logic branch placed on the left of a mind map', () => {
    let { map } = branchy();
    // The last main topic goes on the left side.
    const left = map.roots[0].children[3].id;
    map = addChild(map, left, 'Sol çocuk').map;
    map = setBranchLayout(map, left, 'logic');
    const l = layoutMap(map, approxMeasure);
    const b = l.byId.get(left)!;
    expect(b.side).toBe(-1);
    expect(b.flow).toBe('left');
    expect(l.byId.get(findTopic(map, left)!.children[0].id)!.x).toBeLessThan(b.x);
    noOverlaps(l);
  });

  it('lets a branch of an org chart grow sideways', () => {
    const { map, branch } = branchy();
    const m = setBranchLayout({ ...map, layout: 'org' }, branch, 'logic');
    const l = layoutMap(m, approxMeasure);
    const b = l.byId.get(branch)!;
    expect(b.flow).toBe('right');
    for (const c of findTopic(m, branch)!.children) expect(l.byId.get(c.id)!.x).toBeGreaterThan(b.x);
    noOverlaps(l);
  });

  it('keeps the branch layout when the topic is moved', () => {
    const { map, branch } = branchy();
    const m = setBranchLayout(map, branch, 'org');
    const moved = moveTopic(m, branch, m.roots[0].children[1].id);
    expect(findTopic(moved, branch)!.layout).toBe('org');
    expect(findTopic(setBranchLayout(m, branch, undefined), branch)!.layout).toBeUndefined();
  });

  it('draws the collapse badge on the side the children grow', () => {
    const { map, branch } = branchy();
    const m = toggleCollapse(setBranchLayout(map, branch, 'org'), branch);
    expect(layoutMap(m, approxMeasure).byId.get(branch)!.flow).toBe('down');
  });
});

describe('outline editing', () => {
  it('indents under the previous sibling and outdents back', () => {
    const m0 = createMap();
    const [a, b] = m0.roots[0].children;
    const m1 = indentTopic(m0, b.id);
    expect(findParent(m1, b.id)!.id).toBe(a.id);
    const m2 = outdentTopic(m1, b.id);
    expect(findParent(m2, b.id)!.id).toBe(m0.roots[0].id);
    expect(m2.roots[0].children.map((c) => c.id)).toEqual(m0.roots[0].children.map((c) => c.id));
    // The first child has nothing to indent under; main topics can't outdent.
    expect(indentTopic(m0, a.id)).toBe(m0);
    expect(outdentTopic(m0, a.id)).toBe(m0);
  });

  it('moves topics up and down among siblings', () => {
    const m0 = createMap();
    const ids = m0.roots[0].children.map((c) => c.id);
    const down = moveAmongSiblings(m0, ids[0], 1);
    expect(down.roots[0].children.map((c) => c.id)).toEqual([ids[1], ids[0], ids[2], ids[3]]);
    const up = moveAmongSiblings(m0, ids[3], -1);
    expect(up.roots[0].children.map((c) => c.id)).toEqual([ids[0], ids[1], ids[3], ids[2]]);
    expect(moveAmongSiblings(m0, ids[0], -1)).toBe(m0);
  });

  it('lists rows in reading order and hides collapsed children', () => {
    const { map, branch } = branchy();
    const rows = outlineRows(map);
    expect(rows).toHaveLength(1 + 4 + 3 + 6);
    expect(rows[1].topic.id).toBe(branch);
    expect(rows[2].depth).toBe(2);
    expect(outlineRows(toggleCollapse(map, branch))).toHaveLength(1 + 4);
  });

  it('reveals a topic hidden in collapsed branches', () => {
    const { map, branch } = branchy();
    const deep = findTopic(map, branch)!.children[1].children[0].id;
    const hidden = toggleCollapse(toggleCollapse(map, findTopic(map, branch)!.children[1].id), branch);
    const shown = revealTopic(hidden, deep);
    expect(outlineRows(shown).some((r) => r.topic.id === deep)).toBe(true);
    expect(revealTopic(shown, deep)).toBe(shown);
  });
});

describe('search', () => {
  it('ignores case and Turkish accents', () => {
    expect(fold('ŞIKİÇÖĞÜ')).toBe('sikicogu');
    expect(fold('İstanbul').length).toBe('İstanbul'.length);
    expect(matchText('sik', 'Çok Şık bir fikir')).toMatchObject({ start: 4, end: 7 });
    expect(matchText('ISTANBUL', 'istanbul')).toBeDefined();
    expect(matchText('xyz', 'abc')).toBeUndefined();
  });

  it('ranks word starts above inner matches', () => {
    expect(matchText('art', 'Art direction')!.score).toBeGreaterThan(matchText('art', 'Kart')!.score);
  });

  it('matches command labels loosely', () => {
    expect(matchLabel('alko', 'Alt konu ekle')).toBeDefined();
    expect(matchLabel('zzz', 'Alt konu ekle')).toBeUndefined();
  });

  it('finds topics by text and note, with their path', () => {
    let m = createMap('Plan');
    const a = m.roots[0].children[0].id;
    const r = addChild(m, a, 'Bütçe taslağı');
    m = r.map;
    m = { ...m, roots: [{ ...m.roots[0], note: 'bütçe notu' }] };
    const hits = searchMap(m, 'butce');
    expect(hits[0]).toMatchObject({ id: r.id, field: 'text', path: ['Plan', 'Ana konu 1'] });
    expect(hits.some((h) => h.field === 'note' && h.id === m.roots[0].id)).toBe(true);
  });
});

describe('viewport culling', () => {
  it('keeps only what is near the screen', () => {
    const { map } = branchy();
    const l = layoutMap(map, approxMeasure);
    const all = visibleIn(l);
    expect(all.nodes).toHaveLength(l.nodes.length);
    const far = visibleIn(l, { minX: 10000, minY: 10000, maxX: 11000, maxY: 11000 });
    expect(far.nodes).toHaveLength(0);
    expect(far.edges).toHaveLength(0);
    const right = visibleIn(l, { minX: 1, minY: -5000, maxX: 5000, maxY: 5000 });
    expect(right.nodes.length).toBeGreaterThan(0);
    expect(right.nodes.length).toBeLessThan(l.nodes.length);
  });

  it('snaps the viewport so small pans keep the same rectangle', () => {
    const a = snappedViewport({ x: 100, y: 50, k: 1 }, 1200, 800);
    const b = snappedViewport({ x: 110, y: 55, k: 1 }, 1200, 800);
    expect(b).toEqual(a);
    expect(a.minX).toBeLessThanOrEqual(-100);
    expect(a.maxX).toBeGreaterThanOrEqual(1100);
  });
});
