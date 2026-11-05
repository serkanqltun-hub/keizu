import { describe, expect, it } from 'vitest';
import { applyStyle, copyableStyle, documentOrder, floatTopics, moveTopics, pasteTopics, removeTopics, setCollapsed, setMarker, topLevel, updateStyles } from './bulk';
import { addChild, createMap, findParent, findTopic, updateStyle, type MindMap } from './model';
import { cleanInline, isUrl, parsePastedText, topicsToText } from './smartPaste';

function sample(): { map: MindMap; a: string; b: string; c: string; a1: string } {
  let map = createMap('Kök', 'Ana');
  const root = map.roots[0].id;
  map = { ...map, roots: [{ ...map.roots[0], children: [] }] };
  const a = addChild(map, root, 'A');
  const b = addChild(a.map, root, 'B');
  const c = addChild(b.map, root, 'C');
  const a1 = addChild(c.map, a.id, 'A1');
  return { map: a1.map, a: a.id, b: b.id, c: c.id, a1: a1.id };
}

describe('multi-select operations', () => {
  it('keeps only the outermost selected topics, in document order', () => {
    const s = sample();
    expect(topLevel(s.map, [s.c, s.a1, s.a])).toEqual([s.a, s.c]);
    expect(documentOrder(s.map)).toEqual([s.map.roots[0].id, s.a, s.a1, s.b, s.c]);
  });

  it('styles, marks and collapses many topics in one change', () => {
    const s = sample();
    let m = updateStyles(s.map, [s.a, s.b], { fill: '#FF0000', bold: true });
    expect(findTopic(m, s.a)!.style).toEqual({ fill: '#FF0000', bold: true });
    expect(findTopic(m, s.b)!.style).toEqual({ fill: '#FF0000', bold: true });
    expect(findTopic(m, s.c)!.style).toBeUndefined();
    m = setMarker(m, [s.a, s.b], 'priority-1', true);
    m = setMarker(m, [s.a], 'priority-2', true);
    expect(findTopic(m, s.a)!.markers).toEqual(['priority-2']);
    expect(findTopic(m, s.b)!.markers).toEqual(['priority-1']);
    m = setMarker(m, [s.a, s.b], 'priority-1', false);
    expect(findTopic(m, s.b)!.markers).toBeUndefined();
    m = setCollapsed(m, [s.a, s.b, m.roots[0].id], true);
    expect(findTopic(m, s.a)!.collapsed).toBe(true);
    expect(findTopic(m, s.b)!.collapsed).toBeUndefined(); // no children
    expect(m.roots[0].collapsed).toBeFalsy(); // the main topic never collapses
  });

  it('deletes many topics but never the main one, and selects a surviving parent', () => {
    const s = sample();
    const r = removeTopics(s.map, [s.a1, s.b, s.map.roots[0].id]);
    expect(findTopic(r.map, s.a1)).toBeUndefined();
    expect(findTopic(r.map, s.b)).toBeUndefined();
    expect(findTopic(r.map, s.a)).toBeDefined();
    expect(r.map.roots[0].id).toBe(s.map.roots[0].id);
    expect(r.nextId).toBe(s.a);
  });

  it('moves many topics under one parent, keeping their order', () => {
    const s = sample();
    const m = moveTopics(s.map, [s.c, s.b], s.a);
    expect(findTopic(m, s.a)!.children.map((c) => c.text)).toEqual(['A1', 'B', 'C']);
    // A topic can't go inside itself.
    const same = moveTopics(s.map, [s.a], s.a1);
    expect(findParent(same, s.a)!.id).toBe(s.map.roots[0].id);
  });

  it('floats many topics by the same offset', () => {
    const s = sample();
    const pos: Record<string, { x: number; y: number }> = { [s.b]: { x: 100, y: 10 }, [s.c]: { x: 100, y: 50 } };
    const m = floatTopics(s.map, [s.b, s.c], (id) => pos[id], { x: 200, y: 0 });
    expect(m.roots.map((r) => r.text)).toEqual(['Kök', 'B', 'C']);
    expect(m.roots[1].pos).toEqual({ x: 300, y: 10 });
    expect(m.roots[2].pos).toEqual({ x: 300, y: 50 });
  });

  it('pastes several topics with fresh ids', () => {
    const s = sample();
    const a = findTopic(s.map, s.a)!;
    const c = findTopic(s.map, s.c)!;
    const r = pasteTopics(s.map, s.b, [a, c]);
    const b = findTopic(r.map, s.b)!;
    expect(b.children.map((x) => x.text)).toEqual(['A', 'C']);
    expect(b.children[0].children[0].text).toBe('A1');
    expect(r.ids).not.toContain(s.a);
    expect(r.ids).toHaveLength(2);
  });
});

describe('format painter', () => {
  it('copies the look but keeps each topic its own shown note', () => {
    const s = sample();
    let m = updateStyle(s.map, s.a, { fill: '#123456', shape: 'pill', italic: true, showNote: true });
    m = updateStyle(m, s.b, { bold: true, fontSize: 20, showNote: true });
    const style = copyableStyle(findTopic(m, s.a)!);
    expect(style).toEqual({ fill: '#123456', shape: 'pill', italic: true });
    m = applyStyle(m, [s.b, s.c], style);
    expect(findTopic(m, s.b)!.style).toEqual({ fill: '#123456', shape: 'pill', italic: true, showNote: true });
    expect(findTopic(m, s.c)!.style).toEqual({ fill: '#123456', shape: 'pill', italic: true });
    // Painting a plain look clears the style.
    m = applyStyle(m, [s.c], {});
    expect(findTopic(m, s.c)!.style).toBeUndefined();
  });
});

describe('smart paste', () => {
  it('turns a nested bulleted list into a tree', () => {
    const tops = parsePastedText('- Pazarlama\n  - Sosyal medya\n  - E-posta\n    * Bülten\n- Satış\n\t- Bayiler');
    expect(tops.map((t) => t.text)).toEqual(['Pazarlama', 'Satış']);
    expect(tops[0].children.map((t) => t.text)).toEqual(['Sosyal medya', 'E-posta']);
    expect(tops[0].children[1].children[0].text).toBe('Bülten');
    expect(tops[1].children[0].text).toBe('Bayiler');
  });

  it('nests lists under Markdown headings and keeps quotes as notes', () => {
    const md = '# Plan\n\n## Hafta 1\n1. **Araştırma** yap\n2. Taslak\n> ilk taslak cuma\n## Hafta 2\n- [x] Gözden geçir\n- [ ] Yayınla';
    const [plan] = parsePastedText(md);
    expect(plan.text).toBe('Plan');
    expect(plan.children.map((t) => t.text)).toEqual(['Hafta 1', 'Hafta 2']);
    expect(plan.children[0].children.map((t) => t.text)).toEqual(['Araştırma yap', 'Taslak']);
    expect(plan.children[0].children[1].note).toBe('ilk taslak cuma');
    expect(plan.children[1].children.map((t) => t.markers)).toEqual([['task-100'], ['task-0']]);
  });

  it('reads plain lines and indented outlines', () => {
    expect(parsePastedText('bir\niki\n\nüç').map((t) => t.text)).toEqual(['bir', 'iki', 'üç']);
    const tops = parsePastedText('Oyun\n    Başlangıç\n    Orta\n        Boss\nSon');
    expect(tops.map((t) => t.text)).toEqual(['Oyun', 'Son']);
    expect(tops[0].children[1].children[0].text).toBe('Boss');
  });

  it('turns web addresses and Markdown links into topic links', () => {
    expect(isUrl('https://keizu.app/a?b=1')).toBe(true);
    expect(isUrl('bir https://x.com')).toBe(false);
    const [url] = parsePastedText('https://example.com/docs');
    expect(url.text).toBe('https://example.com/docs');
    expect(url.href).toBe('https://example.com/docs');
    const [www] = parsePastedText('www.example.com');
    expect(www.href).toBe('https://www.example.com');
    expect(cleanInline('Bkz. [belge](https://d.com/x) ve `kod`')).toEqual({ text: 'Bkz. belge ve kod', href: 'https://d.com/x' });
  });

  it('skips rules, fences and table separators and joins table cells', () => {
    const tops = parsePastedText('---\n| Ad | Rol |\n|---|---|\n| Ali | Tasarım |\n```\n');
    expect(tops.map((t) => t.text)).toEqual(['Ad · Rol', 'Ali · Tasarım']);
  });

  it('copies topics as a Markdown list that pastes back the same', () => {
    const s = sample();
    const a = findTopic(s.map, s.a)!;
    const text = topicsToText([{ ...a, note: 'not' }, findTopic(s.map, s.b)!]);
    expect(text).toBe('- A\n  > not\n  - A1\n- B');
    const back = parsePastedText(text);
    expect(back.map((t) => t.text)).toEqual(['A', 'B']);
    expect(back[0].note).toBe('not');
    expect(back[0].children[0].text).toBe('A1');
    expect(topicsToText([findTopic(s.map, s.b)!])).toBe('B');
  });
});
