import { describe, expect, it } from 'vitest';
import { approxMeasure, layoutMap } from './layout';
import { addChild, createMap, updateTopic, updateStyle } from './model';
import { fromMarkdown, toMarkdown } from './io';
import {
  continueList,
  indentLines,
  insertLink,
  layoutNote,
  notePlainText,
  parseInline,
  parseNote,
  toggleLines,
  toggleTask,
  toggleWrap,
} from './richText';

describe('rich-text notes: parsing', () => {
  it('reads bold, italic, strike, code and links', () => {
    expect(parseInline('a **kalın** ve *eğik* ~~yok~~ `kod`')).toEqual([
      { text: 'a ' },
      { text: 'kalın', b: true },
      { text: ' ve ' },
      { text: 'eğik', i: true },
      { text: ' ' },
      { text: 'yok', s: true },
      { text: ' ' },
      { text: 'kod', code: true },
    ]);
    expect(parseInline('[site](https://keizu.app) ve https://x.com/a.')).toEqual([
      { text: 'site', href: 'https://keizu.app' },
      { text: ' ve ' },
      { text: 'https://x.com/a', href: 'https://x.com/a' },
      { text: '.' },
    ]);
    expect(parseInline('***ikisi***')).toEqual([{ text: 'ikisi', b: true, i: true }]);
  });

  it('leaves plain text, snake_case and lone stars alone', () => {
    expect(parseInline('dosya_adi_bu 2 * 3 = 6')).toEqual([{ text: 'dosya_adi_bu 2 * 3 = 6' }]);
    expect(parseInline('\\*yıldız\\*')).toEqual([{ text: '*yıldız*' }]);
  });

  it('drops unsafe link targets', () => {
    expect(parseInline('[x](javascript:alert(1))')[0].href).toBeUndefined();
  });

  it('reads headings, lists, checklists, quotes, rules and code blocks', () => {
    const md = '# Başlık\n- bir\n  - iki\n3. üç\n- [ ] yap\n- [x] bitti\n> alıntı\n---\n```\nkod  satırı\n```\nson';
    const types = parseNote(md).map((b) => b.type);
    expect(types).toEqual(['h', 'li', 'li', 'li', 'li', 'li', 'quote', 'hr', 'code', 'p']);
    const [, a, b, c, d, e] = parseNote(md);
    expect(a).toMatchObject({ depth: 0, marker: '•' });
    expect(b).toMatchObject({ depth: 1 });
    expect(c).toMatchObject({ marker: '3.' });
    expect(d).toMatchObject({ check: false, line: 4 });
    expect(e).toMatchObject({ check: true });
    expect(notePlainText(md)).toContain('☐ yap');
  });

  it('ticks a checklist item by its line', () => {
    expect(toggleTask('a\n- [ ] yap', 1)).toBe('a\n- [x] yap');
    expect(toggleTask('- [X] yap', 0)).toBe('- [ ] yap');
    expect(toggleTask('düz', 0)).toBe('düz');
  });
});

describe('rich-text notes: drawing', () => {
  it('keeps one line per source line for plain notes, wrapping long ones', () => {
    const l = layoutNote('bir\n\niki üç dört beş altı yedi sekiz', 12, 80, approxMeasure);
    expect(l.lines[0].runs[0].text).toBe('bir');
    expect(l.lines[1].runs).toHaveLength(0);
    expect(l.lines.length).toBeGreaterThan(3);
    expect(l.w).toBeLessThanOrEqual(80);
  });

  it('draws marks, bold runs and checkboxes', () => {
    const l = layoutNote('- **a** b\n- [x] c', 12, 200, approxMeasure);
    expect(l.lines[0].mark?.kind).toBe('bullet');
    expect(l.lines[0].runs[0]).toMatchObject({ text: 'a', b: true });
    expect(l.lines[0].runs[0].font).toMatch(/^700 /);
    expect(l.lines[1].mark).toMatchObject({ kind: 'check', checked: true, line: 1 });
    // Text sits after the mark.
    expect(l.lines[1].runs[0].x).toBeGreaterThan(0);
  });

  it('makes headings bigger and cuts long notes with "…"', () => {
    const l = layoutNote('# Büyük\nküçük', 12, 200, approxMeasure);
    expect(l.lines[0].fontSize).toBeGreaterThan(l.lines[1].fontSize);
    const cut = layoutNote(Array.from({ length: 20 }, (_, i) => `- ${i}`).join('\n'), 12, 200, approxMeasure, 5);
    expect(cut.lines).toHaveLength(5);
    expect(cut.cut).toBe(true);
    expect(cut.lines[4].runs.at(-1)!.text).toMatch(/…$/);
  });

  it('shows rich notes inside the topic and in notebook mode', () => {
    const base = createMap('H', 'Ana');
    const r = addChild(base, base.roots[0].id, 'Konu');
    let m = updateTopic(r.map, r.id, { note: '## Plan\n- [ ] bir\n- [x] iki' });
    m = updateStyle(m, r.id, { showNote: true });
    const nb = layoutMap(m, approxMeasure).byId.get(r.id)!.noteBlock!;
    expect(nb.lines).toHaveLength(3);
    expect(nb.lines[1].mark?.kind).toBe('check');
  });

  it('keeps rich notes through Markdown export and import', () => {
    const base = createMap('H', 'Ana');
    const r = addChild(base, base.roots[0].id, 'Konu');
    const note = '# Başlık\n**kalın** ve [bağ](https://a.b)\n\n- [ ] yap\n  - alt\n```\nx = 1\n```';
    const m = updateTopic(r.map, r.id, { note });
    const back = fromMarkdown(toMarkdown(m));
    expect(back.roots[0].children.find((c) => c.text === 'Konu')?.note).toBe(note);
  });
});

describe('rich-text notes: editing', () => {
  const at = (value: string, start: number, end = start) => ({ value, start, end });

  it('wraps and unwraps the selection', () => {
    const on = toggleWrap(at('bir iki', 4, 7), '**');
    expect(on).toEqual({ value: 'bir **iki**', start: 6, end: 9 });
    expect(toggleWrap(on, '**')).toEqual({ value: 'bir iki', start: 4, end: 7 });
    expect(toggleWrap(at('a ', 0, 2), '*').value).toBe('*a* ');
  });

  it('turns lines into lists and back', () => {
    const ul = toggleLines(at('a\nb', 0, 3), 'ul');
    expect(ul.value).toBe('- a\n- b');
    expect(toggleLines(ul, 'ul').value).toBe('a\nb');
    expect(toggleLines(at('- a\n- b', 0, 7), 'ol').value).toBe('1. a\n2. b');
    expect(toggleLines(at('a', 1), 'task')).toEqual({ value: '- [ ] a', start: 7, end: 7 });
    expect(toggleLines(at('a', 0), 'h2').value).toBe('## a');
    // On a new empty line it starts the list.
    expect(toggleLines(at('a\n', 2), 'ul')).toEqual({ value: 'a\n- ', start: 4, end: 4 });
  });

  it('continues lists on Enter and ends them on an empty item', () => {
    expect(continueList(at('- a', 3))).toEqual({ value: '- a\n- ', start: 6, end: 6 });
    expect(continueList(at('2. a', 4))!.value).toBe('2. a\n3. ');
    expect(continueList(at('- [x] a', 7))!.value).toBe('- [x] a\n- [ ] ');
    expect(continueList(at('- a\n- ', 6))).toEqual({ value: '- a\n', start: 4, end: 4 });
    expect(continueList(at('düz', 3))).toBeUndefined();
  });

  it('nests list items with Tab', () => {
    expect(indentLines(at('- a', 3), false)).toEqual({ value: '  - a', start: 5, end: 5 });
    expect(indentLines(at('  - a', 5), true)).toEqual({ value: '- a', start: 3, end: 3 });
    expect(indentLines(at('düz', 1), false)).toBeUndefined();
  });

  it('inserts links around the selection', () => {
    const l = insertLink(at('bak', 0, 3));
    expect(l.value).toBe('[bak](https://)');
    expect(l.value.slice(l.start, l.end)).toBe('https://');
  });
});
