import { describe, expect, it } from 'vitest';
import { applyOps, diff, docFromMap, materialize, stamp } from './crdt';
import { mergeCanvas, setViewCanvas, setViewKind, viewCanvas, viewKind } from './canvas';
import { hasInner, viewOf, writeBack } from './inner';
import { addChild, createMap, findTopic, pruneResources, type CanvasData, type CanvasElement, type MindMap } from './model';
import { mergeMaps } from '../sync/merge';
import { decodeKeizu, encodeKeizu } from './archive';

const el = (id: string, version = 1, extra: Partial<CanvasElement> = {}): CanvasElement => ({ id, type: 'rectangle', version, index: `a${id}`, x: 0, y: 0, ...extra });
const drawing = (...elements: CanvasElement[]): CanvasData => ({ elements });

function withInner(): { map: MindMap; host: string } {
  const m = createMap('Oyun', 'Konu');
  const host = m.roots[0].children[0].id;
  return { map: m, host };
}

describe('canvas mode', () => {
  it('switches the outer map between map, canvas and both', () => {
    const m = createMap('Oyun');
    expect(viewKind(m, false)).toBe('map');
    const c = setViewKind(m, false, 'canvas');
    expect(viewKind(c, false)).toBe('canvas');
    expect(viewKind(setViewKind(c, false, 'both'), false)).toBe('both');
    const back = setViewKind(c, false, 'map');
    expect(back.canvasMode).toBeUndefined();
  });

  it('keeps an inner drawing on the topic and writes it back from the view', () => {
    const { map, host } = withInner();
    // A topic with only a canvas inside can be entered.
    const doc: MindMap = { ...map, roots: [{ ...map.roots[0], children: map.roots[0].children.map((t) => (t.id === host ? { ...t, innerKind: 'canvas' } : t)) }] };
    expect(hasInner(findTopic(doc, host))).toBe(true);
    const view = viewOf(doc, [host]);
    expect(viewKind(view, true)).toBe('canvas');
    const drawn = setViewCanvas(view, true, drawing(el('1')));
    const next = writeBack(doc, [host], drawn);
    expect(findTopic(next, host)?.canvas?.elements.map((e) => e.id)).toEqual(['1']);
    // The outer map has no drawing of its own.
    expect(viewCanvas(viewOf(next, []), false)).toBeUndefined();
    // Switching the inner view back to the map keeps the topic enterable.
    const mapped = writeBack(next, [host], setViewKind(viewOf(next, [host]), true, 'map'));
    expect(findTopic(mapped, host)?.innerKind).toBe('map');
    expect(hasInner(findTopic(mapped, host))).toBe(true);
  });

  it('removes an empty drawing', () => {
    const m = setViewCanvas(createMap('x'), false, drawing(el('1')));
    expect(m.canvas?.elements).toHaveLength(1);
    expect(setViewCanvas(m, false, drawing()).canvas).toBeUndefined();
  });

  it('keeps pictures a drawing uses when pruning resources', () => {
    const m: MindMap = { ...createMap('x'), canvas: drawing(el('1', 1, { type: 'image', fileId: 'f1' })), resources: { f1: 'data:image/png;base64,AA', old: 'data:image/png;base64,BB' } };
    expect(Object.keys(pruneResources(m).resources ?? {})).toEqual(['f1']);
  });
});

describe('drawings in .keizu files', () => {
  it('keeps the drawing, its mode and its pictures', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const m: MindMap = { ...setViewKind(createMap('x'), false, 'both'), canvas: { elements: [el('1', 1, { type: 'image', fileId: 'f1' })], topics: { a: { x: 1, y: 2 } } }, resources: { f1: png } };
    const back = decodeKeizu(encodeKeizu(m));
    expect(back.canvasMode).toBe('both');
    expect(back.canvas).toEqual(m.canvas);
    expect(back.resources?.f1).toBe(png);
  });
});

describe('merging drawings', () => {
  it('merges element by element', () => {
    const base = drawing(el('a'), el('b'));
    const local = drawing(el('a', 2, { x: 10 }), el('b'), el('c'));
    const remote = drawing(el('a'), el('b', 3, { x: 5 }), el('d'));
    const m = mergeCanvas(base, local, remote)!;
    expect(m.elements.map((e) => [e.id, e.version])).toEqual([
      ['a', 2],
      ['b', 3],
      ['c', 1],
      ['d', 1],
    ]);
  });

  it('keeps deletions unless the other side edited the element', () => {
    const base = drawing(el('a'), el('b'));
    const local = drawing(el('b', 2));
    const remote = drawing(el('a'));
    // a: deleted here, untouched there. b: edited here, deleted there.
    expect(mergeCanvas(base, local, remote)!.elements.map((e) => e.id)).toEqual(['b']);
    const edited = drawing(el('a', 4));
    expect(mergeCanvas(base, drawing(el('b')), edited)!.elements.map((e) => e.id)).toEqual(['a']);
  });

  it('two devices drawing on the same map merge without a conflict', () => {
    const base = setViewCanvas(createMap('x'), false, drawing(el('a')));
    const local = setViewCanvas(base, false, drawing(el('a'), el('l')));
    const remote = setViewCanvas(base, false, drawing(el('a'), el('r')));
    const merged = mergeMaps(base, local, remote);
    expect(merged?.canvas?.elements.map((e) => e.id).sort()).toEqual(['a', 'l', 'r']);
  });

  it('merges inner drawings and keeps inner-map fields', () => {
    const { map, host } = withInner();
    const base: MindMap = { ...map, roots: [{ ...map.roots[0], children: map.roots[0].children.map((t) => (t.id === host ? { ...t, innerKind: 'both', canvas: drawing(el('a')) } : t)) }] };
    const edit = (m: MindMap, c: CanvasData) => writeBack(m, [host], setViewCanvas(viewOf(m, [host]), true, c));
    const merged = mergeMaps(base, edit(base, drawing(el('a'), el('l'))), edit(base, drawing(el('a', 2))))!;
    const t = findTopic(merged, host)!;
    expect(t.innerKind).toBe('both');
    expect(t.canvas?.elements.map((e) => [e.id, e.version])).toEqual([
      ['a', 2],
      ['l', 1],
    ]);
  });
});

describe('drawings in live collaboration', () => {
  it('round-trips through the CRDT, outer and inner', () => {
    const { map, host } = withInner();
    let m = setViewCanvas(setViewKind(map, false, 'both'), false, { elements: [el('a'), el('b')], topics: { [host]: { x: 1, y: 2 } } });
    const inner = addChild(m, host, 'İç');
    m = writeBack(inner.map, [], viewOf(inner.map, []));
    m = { ...m, roots: [{ ...m.roots[0], children: m.roots[0].children.map((t) => (t.id === host ? { ...t, innerKind: 'canvas', canvas: drawing(el('x')) } : t)) }] };
    const back = materialize(docFromMap(m)) as unknown as MindMap;
    expect(back.canvasMode).toBe('both');
    expect(back.canvas).toEqual(m.canvas);
    expect(findTopic(back, host)?.canvas).toEqual(drawing(el('x')));
  });

  it('stores one register per element, so concurrent drawing does not collide', () => {
    const m = setViewCanvas(createMap('x'), false, drawing(el('a')));
    const one = docFromMap(m, 'p1');
    const two = docFromMap(m, 'p2');
    const opsOne = stamp(one, diff(one, setViewCanvas(m, false, drawing(el('a'), el('b')))), 'p1');
    const opsTwo = stamp(two, diff(two, setViewCanvas(m, false, drawing(el('a', 2), el('c')))), 'p2');
    // Each side's change touches only its own elements.
    expect(opsOne.map((o) => o.f)).toEqual(['cv:b']);
    expect(opsTwo.map((o) => o.f).sort()).toEqual(['cv:a', 'cv:c']);
    applyOps(one, opsOne);
    applyOps(two, opsTwo);
    applyOps(one, opsTwo);
    applyOps(two, opsOne);
    const a = materialize(one), b = materialize(two);
    expect(a).toEqual(b);
    expect(a.canvas?.elements.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('removing the drawing clears it everywhere', () => {
    const m = setViewCanvas(createMap('x'), false, drawing(el('a')));
    const doc = docFromMap(m);
    applyOps(doc, stamp(doc, diff(doc, setViewCanvas(m, false, undefined)), 'p'));
    const out = materialize(doc);
    expect('canvas' in out && out.canvas).toBeFalsy();
  });
});
