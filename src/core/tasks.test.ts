import { describe, expect, it } from 'vitest';
import { applyOps, diff, docFromMap, materialize, stamp } from './crdt';
import { fromMarkdown, fromOPML, toMarkdown, toOPML } from './io';
import { layoutMap } from './layout';
import { addChild, createMap, findTopic, updateTopic, type MindMap } from './model';
import { parsePastedText, topicsToText } from './smartPaste';
import {
  allTags,
  branchProgress,
  checkTask,
  collectTasks,
  extractTags,
  filterMap,
  matchingIds,
  parseTaskText,
  setTag,
  setTaskFields,
  sortTasks,
  toggleTasks,
} from './tasks';
import { mergeMaps } from '../sync/merge';

const measure = (s: string) => s.length * 7;

/** Main topic with A (a1, a2) and B. */
function sample() {
  let m = createMap('Plan');
  m = { ...m, roots: [{ ...m.roots[0], children: [] }] };
  const main = m.roots[0].id;
  const a = addChild(m, main, 'A');
  const a1 = addChild(a.map, a.id, 'a1');
  const a2 = addChild(a1.map, a.id, 'a2');
  const b = addChild(a2.map, main, 'B');
  return { m: b.map, main, a: a.id, a1: a1.id, a2: a2.id, b: b.id };
}

describe('tags', () => {
  it('takes #tags off the end of typed text, but not "#1" or a lone tag', () => {
    expect(extractTags('Bankayı ara #acil #ev')).toEqual({ text: 'Bankayı ara', tags: ['acil', 'ev'] });
    expect(extractTags('Madde #1')).toEqual({ text: 'Madde #1', tags: [] });
    expect(extractTags('#sadece')).toEqual({ text: '#sadece', tags: [] });
    expect(extractTags('C# dili')).toEqual({ text: 'C# dili', tags: [] });
  });

  it('adds and removes tags on several topics without duplicates', () => {
    const s = sample();
    let m = setTag(s.m, [s.a, s.b], '#Acil', true);
    m = setTag(m, [s.a], 'acil', true);
    expect(findTopic(m, s.a)!.tags).toEqual(['Acil']);
    m = setTag(m, [s.a], 'fikir', true);
    expect(allTags(m)).toEqual([
      { tag: 'Acil', count: 2 },
      { tag: 'fikir', count: 1 },
    ]);
    m = setTag(m, [s.a, s.b], 'ACİL', false);
    expect(findTopic(m, s.a)!.tags).toEqual(['fikir']);
    expect(findTopic(m, s.b)!.tags).toBeUndefined();
  });
});

describe('tasks', () => {
  it('toggles: plain topics become open tasks, then done, then open again', () => {
    const s = sample();
    let m = toggleTasks(s.m, [s.a1, s.a2]);
    expect([findTopic(m, s.a1)!.task, findTopic(m, s.a2)!.task]).toEqual(['todo', 'todo']);
    m = checkTask(m, s.a1);
    // Mixed: all become done.
    m = toggleTasks(m, [s.a1, s.a2]);
    expect([findTopic(m, s.a1)!.task, findTopic(m, s.a2)!.task]).toEqual(['done', 'done']);
    m = toggleTasks(m, [s.a1, s.a2]);
    expect(findTopic(m, s.a1)!.task).toBe('todo');
  });

  it('a date or person makes a task; removing the task clears them', () => {
    const s = sample();
    let m = setTaskFields(s.m, [s.b], { due: '2026-11-20', assignee: '@Ayşe ' });
    expect(findTopic(m, s.b)).toMatchObject({ task: 'todo', due: '2026-11-20', assignee: 'Ayşe' });
    m = setTaskFields(m, [s.b], { due: 'yarın' });
    expect(findTopic(m, s.b)!.due).toBeUndefined();
    m = setTaskFields(m, [s.b], { task: null });
    expect(findTopic(m, s.b)!.assignee).toBeUndefined();
    expect(findTopic(m, s.b)!.task).toBeUndefined();
  });

  it('counts branch progress from the tasks below, up to the main topic', () => {
    const s = sample();
    let m = toggleTasks(s.m, [s.a1, s.a2, s.b, s.a]);
    m = checkTask(m, s.a1);
    const main = m.roots[0];
    // A is a task too, but its progress comes from a1 and a2.
    expect(branchProgress(findTopic(m, s.a)!)).toEqual({ done: 1, total: 2 });
    expect(branchProgress(main)).toEqual({ done: 1, total: 3 });
    expect(branchProgress(findTopic(m, s.b)!)).toBeNull();
    // Shown on the map as a chip under the text.
    const box = layoutMap(m, measure).byId.get(s.a)!;
    expect(box.meta?.chips.map((c) => c.label)).toEqual(['1/2']);
  });

  it('lists tasks open first, by date and priority', () => {
    const s = sample();
    let m = setTaskFields(s.m, [s.a1], { due: '2026-12-01' });
    m = setTaskFields(m, [s.a2], { due: '2026-11-10' });
    m = setTaskFields(m, [s.b], { task: 'done' });
    m = updateTopic(m, s.a, { task: 'todo', markers: ['priority-1'] });
    expect(sortTasks(collectTasks(m)).map((x) => x.text)).toEqual(['a2', 'a1', 'A', 'B']);
  });
});

describe('filter', () => {
  it('dims or hides topics that do not match, keeping the way to matches', () => {
    const s = sample();
    let m = setTag(s.m, [s.a2], 'acil', true);
    m = toggleTasks(m, [s.b]);
    const f = { tags: ['acil'], task: 'all' as const, mode: 'hide' as const };
    expect([...matchingIds(m, f)]).toEqual([s.a2]);
    const shown = filterMap(m, f);
    expect(shown.roots[0].children.map((c) => c.text)).toEqual(['A']);
    expect(shown.roots[0].children[0].children.map((c) => c.text)).toEqual(['a2']);
    // Nothing matches: the main topic stays.
    const none = filterMap(m, { tags: ['yok'], task: 'all', mode: 'hide' });
    expect(none.roots.length).toBe(1);
    expect(none.roots[0].children).toEqual([]);
    expect([...matchingIds(m, { tags: [], task: 'open', mode: 'dim' })]).toEqual([s.b]);
  });
});

describe('tags and tasks in files and on the clipboard', () => {
  function rich(): { m: MindMap; s: ReturnType<typeof sample> } {
    const s = sample();
    let m = setTaskFields(s.m, [s.a1], { due: '2026-11-20', assignee: 'Ayşe Yılmaz' });
    m = setTaskFields(m, [s.a2], { task: 'done' });
    m = setTag(m, [s.a1, s.b], 'acil', true);
    m = setTag(m, [s.a1], 'iş', true);
    return { m, s };
  }

  it('Markdown keeps boxes, tags, dates and people', () => {
    const { m } = rich();
    const md = toMarkdown(m);
    expect(md).toContain('  - [ ] a1 #acil #iş 📅 2026-11-20 @Ayşe_Yılmaz');
    expect(md).toContain('  - [x] a2');
    expect(md).toContain('- B #acil');
    const back = fromMarkdown(md);
    const a = back.roots[0].children[0];
    expect(a.children[0]).toMatchObject({ text: 'a1', task: 'todo', tags: ['acil', 'iş'], due: '2026-11-20', assignee: 'Ayşe Yılmaz' });
    expect(a.children[1]).toMatchObject({ text: 'a2', task: 'done' });
    expect(back.roots[0].children[1]).toMatchObject({ text: 'B', tags: ['acil'] });
    expect(back.roots[0].children[1].task).toBeUndefined();
  });

  it('OPML keeps them as attributes', () => {
    const { m } = rich();
    const back = fromOPML(toOPML(m));
    expect(back.roots[0].children[0].children[0]).toMatchObject({ task: 'todo', tags: ['acil', 'iş'], due: '2026-11-20', assignee: 'Ayşe Yılmaz' });
  });

  it('copy and smart paste keep them; "@" alone is just text', () => {
    const { m, s } = rich();
    const text = topicsToText([findTopic(m, s.a)!]);
    const [a] = parsePastedText(text);
    expect(a.children[0]).toMatchObject({ text: 'a1', task: 'todo', due: '2026-11-20', assignee: 'Ayşe Yılmaz' });
    expect(parsePastedText('- follow @keizu')[0]).toMatchObject({ text: 'follow @keizu' });
    expect(parsePastedText('- [x] bitti')[0]).toMatchObject({ text: 'bitti', task: 'done' });
    expect(parseTaskText('Toplantı 📅 2026-02-30')).toEqual({ text: 'Toplantı 📅 2026-02-30' });
  });

  it('survive a three-way sync merge, edited on both sides', () => {
    const { m: base, s } = rich();
    const local = setTag(base, [s.b], 'fikir', true);
    const remote = checkTask(setTaskFields(base, [s.a1], { assignee: 'Can' }), s.a1);
    const merged = mergeMaps(base, local, remote)!;
    expect(findTopic(merged, s.b)!.tags).toEqual(['acil', 'fikir']);
    expect(findTopic(merged, s.a1)).toMatchObject({ task: 'done', assignee: 'Can', due: '2026-11-20' });
  });

  it('keep inner-map topics inside when merging', () => {
    const s = sample();
    const base = updateTopic(s.m, s.a1, { inside: true });
    const merged = mergeMaps(base, updateTopic(base, s.b, { task: 'todo' }), updateTopic(base, s.a, { tags: ['x'] }))!;
    expect(findTopic(merged, s.a1)!.inside).toBe(true);
  });

  it('travel through live collaboration', () => {
    const { m, s } = rich();
    const doc = docFromMap(m, 'a');
    const next = setTag(checkTask(m, s.a1), [s.a2], 'yeni', true);
    applyOps(doc, stamp(doc, diff(doc, next), 'b'));
    const out = materialize(doc) as unknown as MindMap;
    expect(findTopic(out, s.a1)).toMatchObject({ task: 'done', tags: ['acil', 'iş'], due: '2026-11-20' });
    expect(findTopic(out, s.a2)!.tags).toEqual(['yeni']);
    // Clearing a field clears it for everyone.
    const cleared = setTaskFields(out, [s.a1], { task: null });
    applyOps(doc, stamp(doc, diff(doc, cleared), 'b'));
    const after = findTopic(materialize(doc) as unknown as MindMap, s.a1)!;
    expect(after.task).toBeUndefined();
    expect(after.due).toBeUndefined();
  });
});
