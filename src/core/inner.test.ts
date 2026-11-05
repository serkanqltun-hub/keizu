import { describe, expect, it } from 'vitest';
import { diff, docFromMap, materialize } from './crdt';
import {
  addInner,
  branchToInner,
  hasInner,
  innerPathTo,
  innerToBranch,
  insertMapAsTopic,
  validPath,
  viewOf,
  writeBack,
} from './inner';
import { addChild, addRelation, createMap, findTopic, moveTopic, removeTopic, setMapProps, updateTopic, type MindMap } from './model';

/** Oyun → A (inner: Keşif → Harita tara), B (inner: Savunma), C. */
function game() {
  let m = createMap('Oyun', 'Konu');
  m = { ...m, roots: [{ ...m.roots[0], children: [] }] };
  const root = m.roots[0].id;
  const a = addChild(m, root, 'A operasyonu');
  const b = addChild(a.map, root, 'B operasyonu');
  const c = addChild(b.map, root, 'C operasyonu');
  m = c.map;
  const k = addChild(m, a.id, 'Keşif');
  const h = addChild(k.map, k.id, 'Harita tara');
  const s = addChild(h.map, b.id, 'Savunma');
  m = branchToInner(branchToInner(s.map, a.id), b.id);
  return { map: m, root, a: a.id, b: b.id, c: c.id, k: k.id, h: h.id, s: s.id };
}

describe('inner maps', () => {
  it('turns a branch into an inner map and back', () => {
    const g = game();
    expect(hasInner(findTopic(g.map, g.a))).toBe(true);
    const outer = viewOf(g.map, []);
    expect(findTopic(outer, g.k)).toBeUndefined();
    expect(findTopic(outer, g.a)!.innerSize).toBe(2);
    const back = innerToBranch(g.map, g.a);
    expect(hasInner(findTopic(back, g.a))).toBe(false);
    expect(findTopic(viewOf(back, []), g.k)).toBeDefined();
  });

  it('shows a topic as the main topic of its inner map', () => {
    const g = game();
    const v = viewOf(g.map, [g.a]);
    expect(v.roots).toHaveLength(1);
    expect(v.roots[0].id).toBe(g.a);
    expect(v.roots[0].children.map((c) => c.text)).toEqual(['Keşif']);
    expect(findTopic(v, g.b)).toBeUndefined();
  });

  it('writes edits made inside an inner map back into the file', () => {
    const g = game();
    const v = viewOf(g.map, [g.a]);
    const r = addChild(v, g.a, 'Toplama');
    const doc = writeBack(g.map, [g.a], updateTopic(r.map, g.a, { text: 'A op.' }));
    expect(findTopic(doc, r.id)!.inside).toBe(true);
    expect(findTopic(doc, g.a)!.text).toBe('A op.');
    // The map keeps its own title.
    expect(doc.title).toBe(g.map.title);
    // The outer map still hides it, and B's inner map is untouched.
    expect(findTopic(viewOf(doc, []), r.id)).toBeUndefined();
    expect(findTopic(doc, g.s)!.inside).toBe(true);
    expect(viewOf(doc, [g.a]).roots[0].children).toHaveLength(2);
  });

  it('keeps hidden inner maps when the outer map changes', () => {
    const g = game();
    const outer = viewOf(g.map, []);
    // Move A under C on the outer map: its inner map comes along.
    const doc = writeBack(g.map, [], moveTopic(outer, g.a, g.c));
    expect(findTopic(doc, g.k)).toBeDefined();
    expect(innerPathTo(doc, g.h)).toEqual([g.a]);
    // Deleting A deletes its inner map too.
    const gone = writeBack(doc, [], removeTopic(viewOf(doc, []), g.a).map);
    expect(findTopic(gone, g.k)).toBeUndefined();
  });

  it('a topic moved deeper inside an inner map stops being an inner topic of the host only', () => {
    const g = game();
    const v = viewOf(g.map, [g.a]);
    const r = addChild(v, g.a, 'Toplama');
    const doc = writeBack(g.map, [g.a], moveTopic(r.map, r.id, g.k));
    const t = findTopic(doc, r.id)!;
    expect(t.inside).toBeUndefined();
    expect(findTopic(viewOf(doc, [g.a]), r.id)).toBeDefined();
  });

  it('nests: an inner map can hold topics with inner maps', () => {
    const g = game();
    const doc = writeBack(g.map, [g.a], branchToInner(viewOf(g.map, [g.a]), g.k));
    expect(innerPathTo(doc, g.h)).toEqual([g.a, g.k]);
    expect(viewOf(doc, [g.a, g.k]).roots[0].children.map((c) => c.text)).toEqual(['Harita tara']);
    expect(validPath(doc, [g.a, g.k])).toEqual([g.a, g.k]);
    expect(validPath(innerToBranch(doc, g.k), [g.a, g.k])).toEqual([g.a]);
  });

  it('keeps the inner layout separate from the outer one', () => {
    const g = game();
    const v = viewOf(g.map, [g.a]);
    const doc = writeBack(g.map, [g.a], setMapProps(v, { layout: 'logic' }));
    expect(doc.layout).toBe(g.map.layout);
    expect(findTopic(doc, g.a)!.innerLayout).toBe('logic');
    expect(viewOf(doc, [g.a]).layout).toBe('logic');
  });

  it('relations inside an inner map live in the file and show only inside', () => {
    const g = game();
    const v = viewOf(g.map, [g.a]);
    const r = addChild(v, g.a, 'Toplama');
    const rel = addRelation(r.map, g.h, r.id, 'sonra');
    const doc = writeBack(g.map, [g.a], rel.map);
    expect(doc.relations).toHaveLength(1);
    expect(viewOf(doc, []).relations).toHaveLength(0);
    expect(viewOf(doc, [g.a]).relations).toHaveLength(1);
    // Removing it inside removes it from the file.
    const v2 = viewOf(doc, [g.a]);
    expect(writeBack(doc, [g.a], { ...v2, relations: [] }).relations).toHaveLength(0);
  });

  it('keeps boundaries and summaries with the children they cover', () => {
    const g = game();
    // A has an outer child too; a boundary on each side.
    const r = addChild(g.map, g.a, 'Dışarıda');
    const a = findTopic(r.map, g.a)!;
    const withRanges: MindMap = updateTopic(r.map, g.a, {
      boundaries: [
        { id: 'b-in', from: g.k, to: g.k },
        { id: 'b-out', from: r.id, to: r.id },
      ],
    });
    expect(a.children).toHaveLength(2);
    const outer = viewOf(withRanges, []);
    expect(findTopic(outer, g.a)!.boundaries!.map((b) => b.id)).toEqual(['b-out']);
    const inner = viewOf(withRanges, [g.a]);
    expect(inner.roots[0].boundaries!.map((b) => b.id)).toEqual(['b-in']);
    // Editing either side keeps both.
    const back = writeBack(withRanges, [g.a], updateTopic(inner, g.k, { text: 'Keşif!' }));
    expect(findTopic(back, g.a)!.boundaries!.map((b) => b.id).sort()).toEqual(['b-in', 'b-out']);
    const back2 = writeBack(withRanges, [], updateTopic(outer, g.c, { text: 'C!' }));
    expect(findTopic(back2, g.a)!.boundaries!.map((b) => b.id).sort()).toEqual(['b-in', 'b-out']);
  });

  it('never stores the view-only size', () => {
    const g = game();
    const doc = writeBack(g.map, [], updateTopic(viewOf(g.map, []), g.c, { text: 'C!' }));
    expect(JSON.stringify(doc)).not.toContain('innerSize');
  });

  it('adds an empty inner map', () => {
    const g = game();
    const r = addInner(g.map, g.c, 'Yeni konu');
    expect(hasInner(findTopic(r.map, g.c))).toBe(true);
    expect(findTopic(r.map, r.id)!.inside).toBe(true);
  });

  it('adds another map as a topic with an inner map', () => {
    const g = game();
    let other: MindMap = createMap('Ekonomi', 'Kaynak');
    other = addRelation(other, other.roots[0].children[0].id, other.roots[0].children[1].id).map;
    const r = insertMapAsTopic(g.map, other, g.root);
    const t = findTopic(r.map, r.id)!;
    expect(t.text).toBe('Ekonomi');
    expect(t.children.every((c) => c.inside)).toBe(true);
    expect(t.children).toHaveLength(4);
    expect(r.map.relations).toHaveLength(1);
    expect(viewOf(r.map, [r.id]).relations).toHaveLength(1);
    // Ids are new.
    expect(findTopic(r.map, other.roots[0].id)).toBeUndefined();
  });

  it('survives live collaboration (CRDT round trip)', () => {
    const g = game();
    const back = materialize(docFromMap(g.map)) as unknown as MindMap;
    expect(innerPathTo(back, g.h)).toEqual([g.a]);
    expect(diff(docFromMap(g.map), g.map)).toEqual([]);
  });
});
