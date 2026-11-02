import { describe, expect, it } from 'vitest';
import { initHistory, push, redo, undo } from './history';
import { fromMarkdown, fromJSON, toJSON, toMarkdown } from './io';
import { approxMeasure, layoutMap } from './layout';
import {
  addChild,
  addFloating,
  addRelation,
  floatTopic,
  isRoot,
  addSibling,
  countTopics,
  createMap,
  findParent,
  findTopic,
  moveTopic,
  removeTopic,
  toggleCollapse,
  toggleMarker,
  updateTopic,
} from './model';

describe('model', () => {
  it('adds children and siblings without mutating the original', () => {
    const m0 = createMap('Test');
    const first = m0.roots[0].children[0].id;
    const { map: m1, id: child } = addChild(m0, first, 'Çocuk');
    const { map: m2, id: sib } = addSibling(m1, child, 'Kardeş');
    expect(m0.roots[0].children[0].children).toHaveLength(0);
    expect(findParent(m2, sib)?.id).toBe(first);
    expect(findTopic(m2, first)!.children.map((c) => c.text)).toEqual(['Çocuk', 'Kardeş']);
  });

  it('removes a subtree and picks a sensible next selection', () => {
    const m0 = createMap();
    const [a, b] = m0.roots[0].children;
    const { map, nextId } = removeTopic(m0, a.id);
    expect(map.roots[0].children).toHaveLength(3);
    expect(nextId).toBe(b.id);
    expect(removeTopic(map, map.roots[0].id).map).toBe(map);
  });

  it('refuses to move a topic into its own subtree', () => {
    const m0 = createMap();
    const a = m0.roots[0].children[0].id;
    const { map: m1, id: child } = addChild(m0, a);
    expect(moveTopic(m1, a, child)).toBe(m1);
    const m2 = moveTopic(m1, child, m1.roots[0].children[1].id, 0);
    expect(findParent(m2, child)?.id).toBe(m1.roots[0].children[1].id);
    expect(countTopics(m2.roots[0])).toBe(countTopics(m1.roots[0]));
  });

  it('supports floating trees and relations', () => {
    let m = createMap('Ana');
    const a = m.roots[0].children[0].id;
    const f = addFloating(m, { x: 500, y: 300 }, 'Serbest');
    m = f.map;
    expect(m.roots).toHaveLength(2);
    expect(isRoot(m, f.id)).toBe(true);
    m = addChild(m, f.id, 'Alt').map;
    const rel = addRelation(m, a, f.id, 'besler');
    m = rel.map;
    expect(m.relations).toHaveLength(1);
    // Detach a branch into its own tree, then attach it back.
    m = floatTopic(m, a, { x: -400, y: 0 });
    expect(m.roots).toHaveLength(3);
    m = moveTopic(m, a, m.roots[0].id);
    expect(m.roots).toHaveLength(2);
    // Removing a tree drops relations that point into it.
    m = removeTopic(m, f.id).map;
    expect(m.roots).toHaveLength(1);
    expect(m.relations).toHaveLength(0);
    // The main topic can never be removed or floated.
    expect(removeTopic(m, m.roots[0].id).map).toBe(m);
    expect(floatTopic(m, m.roots[0].id, { x: 1, y: 1 })).toBe(m);
  });

  it('reads early single-root files', () => {
    const old = { format: 'keizu/1', id: 'm1', title: 'Eski', root: { id: 't1', text: 'Eski', children: [] } };
    const m = fromJSON(JSON.stringify(old));
    expect(m.roots[0].id).toBe('t1');
    expect(m.relations).toEqual([]);
  });

  it('keeps one marker per group and syncs root text to the title', () => {
    let m = createMap();
    const id = m.roots[0].children[0].id;
    m = toggleMarker(m, id, 'priority-1');
    m = toggleMarker(m, id, 'priority-3');
    m = toggleMarker(m, id, 'flag-red');
    expect(findTopic(m, id)!.markers).toEqual(['priority-3', 'flag-red']);
    m = updateTopic(m, m.roots[0].id, { text: 'Yeni başlık' });
    expect(m.title).toBe('Yeni başlık');
  });
});

describe('history', () => {
  it('undoes and redoes', () => {
    let h = initHistory(1);
    h = push(h, 2);
    h = push(h, 3);
    h = undo(h);
    expect(h.present).toBe(2);
    h = redo(h);
    expect(h.present).toBe(3);
    h = undo(undo(undo(h)));
    expect(h.present).toBe(1);
  });
});

describe('layout', () => {
  it('puts main topics on both sides of the root without overlaps', () => {
    const m = createMap();
    const l = layoutMap(m, approxMeasure);
    const sides = m.roots[0].children.map((c) => l.byId.get(c.id)!.side);
    expect(sides).toContain(1);
    expect(sides).toContain(-1);
    const boxes = l.nodes;
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
        expect(overlap).toBe(false);
      }
  });

  it('hides collapsed children and grows right in logic layout', () => {
    let m = createMap();
    const a = m.roots[0].children[0].id;
    m = addChild(m, a).map;
    m = { ...toggleCollapse(m, a), layout: 'logic' };
    const l = layoutMap(m, approxMeasure);
    expect(l.byId.get(a)!.hidden).toBe(1);
    expect(l.nodes).toHaveLength(5);
    expect(m.roots[0].children.every((c) => l.byId.get(c.id)!.x > 0)).toBe(true);
  });

  it('places floating trees at their stored position', () => {
    const f = addFloating(createMap(), { x: 900, y: -200 }, 'Serbest');
    const l = layoutMap(f.map, approxMeasure);
    const b = l.byId.get(f.id)!;
    expect([b.x, b.y]).toEqual([900, -200]);
    expect(b.rootId).toBe(f.id);
  });

  it('lays org charts top-down', () => {
    const m = { ...createMap(), layout: 'org' as const };
    const l = layoutMap(m, approxMeasure);
    expect(m.roots[0].children.every((c) => l.byId.get(c.id)!.y > 0)).toBe(true);
  });
});

describe('io', () => {
  it('round-trips JSON and Markdown', () => {
    let m = createMap('Plan');
    m = addChild(m, m.roots[0].children[0].id, 'Detay').map;
    expect(fromJSON(toJSON(m))).toEqual(m);
    const md = toMarkdown(m);
    expect(md).toContain('# Plan');
    expect(md).toContain('  - Detay');
    const back = fromMarkdown(md);
    expect(back.roots[0].text).toBe('Plan');
    expect(back.roots[0].children[0].children[0].text).toBe('Detay');
  });

  it('rejects non-Keizu JSON', () => {
    expect(() => fromJSON('{"a":1}')).toThrow();
  });
});
