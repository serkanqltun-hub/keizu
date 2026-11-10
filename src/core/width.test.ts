import { describe, expect, it } from 'vitest';
import { mergeMaps } from '../sync/merge';
import { decodeKeizu, encodeKeizu } from './archive';
import { approxMeasure, layoutMap } from './layout';
import { LAYOUT_KINDS, TOPIC_MAX_W, TOPIC_MIN_W, addChild, createMap, findTopic, setTopicWidth, updateStyle, updateTopic } from './model';

const LONG = 'Bu konu epey uzun bir cümle, elle genişlik verilince birkaç satıra sarılmalı ve kutu o genişlikte kalmalı';

function sample() {
  const base = createMap('Genişlik', 'Ana');
  const a = addChild(base, base.roots[0].id, LONG);
  const b = addChild(a.map, a.id, 'Alt');
  return { map: b.map, id: a.id, child: b.id };
}

describe('topic width set by hand', () => {
  it('stores a rounded, clamped width and removes it again', () => {
    const { map, id } = sample();
    expect(findTopic(setTopicWidth(map, id, 240.6), id)!.width).toBe(241);
    expect(findTopic(setTopicWidth(map, id, 5), id)!.width).toBe(TOPIC_MIN_W);
    expect(findTopic(setTopicWidth(map, id, 99999), id)!.width).toBe(TOPIC_MAX_W);
    const set = setTopicWidth(map, id, 200);
    expect(setTopicWidth(set, id, 200)).toBe(set);
    const cleared = setTopicWidth(set, id, undefined);
    expect('width' in findTopic(cleared, id)!).toBe(false);
    expect(setTopicWidth(map, 'yok', 200)).toBe(map);
  });

  it('the box takes the width and the text wraps inside it', () => {
    const { map, id } = sample();
    const auto = layoutMap(map, approxMeasure).byId.get(id)!;
    expect(auto.lines).toHaveLength(1);
    const narrow = layoutMap(setTopicWidth(map, id, 180), approxMeasure).byId.get(id)!;
    expect(narrow.w).toBe(180);
    expect(narrow.lines.length).toBeGreaterThan(1);
    expect(narrow.lines.join(' ')).toBe(LONG);
    for (const l of narrow.lines) expect(approxMeasure(l, narrow.font)).toBeLessThanOrEqual(180 - narrow.padX * 2);
    expect(narrow.h).toBeGreaterThan(auto.h);
    const wider = layoutMap(setTopicWidth(map, id, 320), approxMeasure).byId.get(id)!;
    expect(wider.lines.length).toBeLessThan(narrow.lines.length);
    expect(wider.h).toBeLessThan(narrow.h);
  });

  it('a wider topic makes a shown note shorter instead of growing down', () => {
    const { map, id } = sample();
    const note = Array.from({ length: 6 }, () => 'Notun içinde uzun bir paragraf var, kutu genişleyince daha az satır tutmalı.').join(' ');
    const shown = updateStyle(updateTopic(map, id, { note, text: 'Kısa' }), id, { showNote: true });
    const auto = layoutMap(shown, approxMeasure).byId.get(id)!;
    const wide = layoutMap(setTopicWidth(shown, id, 700), approxMeasure).byId.get(id)!;
    expect(wide.w).toBe(700);
    expect(wide.noteBlock!.lines.length).toBeLessThan(auto.noteBlock!.lines.length);
    expect(wide.noteBlock!.w).toBeLessThanOrEqual(700 - wide.padX * 2);
    expect(wide.h).toBeLessThan(auto.h);
    // Notebook cards follow the hand-set width too.
    const book = layoutMap({ ...setTopicWidth(shown, id, 600), notebook: true }, approxMeasure).byId.get(id)!;
    expect(book.w).toBe(600);
  });

  it('every layout respects the width and keeps children clear of it', () => {
    const { map, id, child } = sample();
    for (const kind of LAYOUT_KINDS) {
      const m = { ...setTopicWidth(map, id, 260), layout: kind };
      const l = layoutMap(m, approxMeasure);
      const box = l.byId.get(id)!;
      expect(box.w, kind).toBe(260);
      const kid = l.byId.get(child);
      if (!kid) continue;
      // The child never sits on top of the widened topic.
      const overlapX = Math.abs(kid.x - box.x) < (kid.w + box.w) / 2;
      const overlapY = Math.abs(kid.y - box.y) < (kid.h + box.h) / 2;
      expect(overlapX && overlapY, kind).toBe(false);
    }
  });

  it('never gets narrower than its icons and chips need', () => {
    const { map, id } = sample();
    let m = updateTopic(map, id, { markers: ['priority-1', 'flag-red', 'star-yellow'], note: 'n', href: 'https://example.com', task: 'todo', due: '2026-12-01', assignee: 'Serkan', tags: ['uzun-etiket', 'ikinci'] });
    m = setTopicWidth(m, id, TOPIC_MIN_W);
    const box = layoutMap(m, approxMeasure).byId.get(id)!;
    expect(box.w).toBeGreaterThan(TOPIC_MIN_W);
    expect(box.w).toBeGreaterThanOrEqual(box.meta!.w + box.padX * 2);
  });

  it('is kept in .keizu files and merges like other topic fields', () => {
    const { map, id } = sample();
    const set = setTopicWidth(map, id, 222);
    expect(findTopic(decodeKeizu(encodeKeizu(set)), id)!.width).toBe(222);
    // One device widened the topic, the other renamed it: both survive.
    const renamed = updateTopic(map, id, { text: 'Yeni ad' });
    const merged = mergeMaps(map, set, renamed)!;
    expect(findTopic(merged, id)).toMatchObject({ width: 222, text: 'Yeni ad' });
    // Reset on one side only: the reset wins.
    const reset = mergeMaps(set, setTopicWidth(set, id, undefined), set)!;
    expect(findTopic(reset, id)!.width).toBeUndefined();
  });
});
