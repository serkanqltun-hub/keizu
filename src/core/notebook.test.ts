import { describe, expect, it } from 'vitest';
import { decodeKeizu, encodeKeizu } from './archive';
import { docFromMap, materialize } from './crdt';
import { approxMeasure, layoutMap } from './layout';
import { addChild, createMap, setMapProps, updateTopic } from './model';

function sample() {
  const base = createMap('Defter', 'Ana');
  const a = addChild(base, base.roots[0].id, 'Uzun notlu');
  const b = addChild(a.map, base.roots[0].id, 'Notsuz');
  const long = Array.from({ length: 40 }, (_, i) => `satır ${i} biraz metin`).join('\n');
  const map = updateTopic(b.map, a.id, { note: long });
  return { map, noted: a.id, plain: b.id };
}

describe('notebook mode', () => {
  it('shows every note in full, without the 12-line cut', () => {
    const { map, noted, plain } = sample();
    const off = layoutMap(map, approxMeasure);
    expect(off.byId.get(noted)!.noteBlock).toBeUndefined();
    const on = layoutMap(setMapProps(map, { notebook: true }), approxMeasure);
    const card = on.byId.get(noted)!;
    expect(card.noteBlock!.lines).toHaveLength(40);
    expect(card.noteBlock!.lines.at(-1)).not.toMatch(/…$/);
    expect(card.shape).toBe('rounded');
    // Topics without a note are left as they were.
    expect(on.byId.get(plain)!.h).toBe(off.byId.get(plain)!.h);
    // Neighbours make room for the taller card.
    const p = on.byId.get(plain)!;
    expect(Math.abs(p.y - card.y)).toBeGreaterThanOrEqual((p.h + card.h) / 2);
  });

  it('turning it off removes the field', () => {
    const { map } = sample();
    expect('notebook' in setMapProps(setMapProps(map, { notebook: true }), { notebook: false })).toBe(false);
  });

  it('is saved in .keizu files', async () => {
    const map = setMapProps(sample().map, { notebook: true });
    const back = await decodeKeizu(await encodeKeizu(map));
    expect(back.notebook).toBe(true);
  });

  it('travels through the collaboration document', () => {
    const map = setMapProps(sample().map, { notebook: true });
    expect(materialize(docFromMap(map, 'a')).notebook).toBe(true);
    expect(materialize(docFromMap(sample().map, 'a')).notebook).toBeUndefined();
  });
});
