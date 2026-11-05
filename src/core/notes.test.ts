import { describe, expect, it } from 'vitest';
import { decodeKeizu, encodeKeizu } from './archive';
import { fromMarkdown, fromOPML, toMarkdown, toOPML } from './io';
import { approxMeasure, layoutMap, wrapText } from './layout';
import { addChild, createMap, findTopic, updateStyle, updateTopic } from './model';

function withNote(note: string, show: boolean) {
  const base = createMap('Notlar', 'Ana');
  const r = addChild(base, base.roots[0].id, 'Konu');
  let m = updateTopic(r.map, r.id, { note });
  if (show) m = updateStyle(m, r.id, { showNote: true });
  return { map: m, id: r.id };
}

describe('topic notes', () => {
  it('wraps long text at spaces and cuts words that do not fit', () => {
    const lines = wrapText('bir iki üç dört beş altı yedi', '400 12px x', 60, approxMeasure);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(approxMeasure(l, '400 12px x')).toBeLessThanOrEqual(60);
    expect(lines.join(' ')).toBe('bir iki üç dört beş altı yedi');
    expect(wrapText('a\n\nb', '400 12px x', 100, approxMeasure)).toEqual(['a', '', 'b']);
    const long = wrapText('x'.repeat(80), '400 12px x', 60, approxMeasure);
    expect(long.length).toBeGreaterThan(1);
    expect(long.join('')).toBe('x'.repeat(80));
  });

  it('a shown note makes the topic taller; a hidden one only adds the icon', () => {
    const note = 'Toplantıda konuşulacak.\nİkinci satır biraz daha uzun bir cümle olsun ki sarılsın.';
    const hidden = withNote(note, false);
    const shown = withNote(note, true);
    const a = layoutMap(hidden.map, approxMeasure).byId.get(hidden.id)!;
    const b = layoutMap(shown.map, approxMeasure).byId.get(shown.id)!;
    expect(a.noteBlock).toBeUndefined();
    expect(b.noteBlock!.lines.length).toBeGreaterThanOrEqual(2);
    expect(b.h).toBe(a.h + b.noteBlock!.h);
    expect(b.w).toBeGreaterThanOrEqual(a.w);
  });

  it('cuts very long shown notes', () => {
    const { map, id } = withNote(Array.from({ length: 40 }, (_, i) => `satır ${i}`).join('\n'), true);
    const nb = layoutMap(map, approxMeasure).byId.get(id)!.noteBlock!;
    expect(nb.lines.length).toBe(12);
    expect(nb.lines[11].runs.at(-1)!.text.endsWith('…')).toBe(true);
  });

  it('keeps the note and the show setting in .keizu files', () => {
    const { map, id } = withNote('gizli değil', true);
    const back = decodeKeizu(encodeKeizu(map));
    const tp = findTopic(back, id)!;
    expect(tp.note).toBe('gizli değil');
    expect(tp.style?.showNote).toBe(true);
  });

  it('round-trips notes through Markdown, central topic included', () => {
    let { map } = withNote('ilk satır\n\nüçüncü satır', false);
    map = updateTopic(map, map.roots[0].id, { note: 'harita notu' });
    const back = fromMarkdown(toMarkdown(map));
    expect(back.roots[0].note).toBe('harita notu');
    const konu = back.roots[0].children.find((c) => c.text === 'Konu');
    expect(konu?.note).toBe('ilk satır\n\nüçüncü satır');
    expect(back.roots[0].children.filter((c) => c.note).length).toBe(1);
  });

  it('round-trips notes through OPML', () => {
    const { map } = withNote('opml notu', false);
    const back = fromOPML(toOPML(map));
    expect(back.roots[0].children.find((c) => c.text === 'Konu')?.note).toBe('opml notu');
  });
});
