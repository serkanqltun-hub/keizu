import { describe, expect, it } from 'vitest';
import { AiReplyError, REPLY_SCHEMA, applySuggestions, applyText, buildPrompt, countSuggestions, parseReply, suggestionKey } from './ai';
import { addFlowLink, addRelation, createMap, createTopic, findTopic, updateTopic, type MindMap } from './model';

function sample(): MindMap {
  const m = createMap('Oyun fikri');
  const a = createTopic('Karakterler', [createTopic('Kahraman'), createTopic('Kötü')]);
  const b = createTopic('Mekanikler');
  b.note = 'Zıplama, tırmanma, yüzme';
  m.roots[0].children = [a, b];
  return m;
}

describe('buildPrompt', () => {
  it('sends the whole map with refs and marks the focus', () => {
    const m = sample();
    const branch = m.roots[0].children[0];
    const { prompt, refs } = buildPrompt(m, branch.id, 'ideas');
    expect(prompt).toContain('- [t1] Oyun fikri');
    expect(prompt).toContain('  - [t2] Karakterler   <-- FOCUS');
    expect(prompt).toContain('    - [t3] Kahraman');
    expect(prompt).toContain('  - [t5] Mekanikler');
    expect(prompt).toContain('The FOCUS topic is [t2].');
    expect(prompt).toContain('"parent":"t2"');
    expect(refs.get('t2')).toBe(branch.id);
    expect(refs.get('t4')).toBe(branch.children[1].id);
  });

  it('includes tasks, tags, notes, links, the date, the question and the language', () => {
    let m = sample();
    const [chars, mech] = m.roots[0].children;
    m = updateTopic(m, chars.children[0].id, { task: 'done', tags: ['ana'], due: '2026-12-01', assignee: 'Ece' });
    m = addRelation(m, chars.children[0].id, mech.id, 'kullanır').map;
    m = addFlowLink(m, chars.children[1].id, mech.id).map;
    const p = buildPrompt(m, mech.id, 'ask', { question: 'Sıradaki adım ne?', lang: 'tr', today: '2026-11-09' }).prompt;
    expect(p).toContain('[x] Kahraman #ana due 2026-12-01 @Ece');
    expect(p).toContain('note: Zıplama, tırmanma, yüzme');
    expect(p).toContain('relation: [t3] -> [t5] "kullanır"');
    expect(p).toContain('flow: [t4] also leads to [t5]');
    expect(p).toContain('Today is 2026-11-09.');
    expect(p).toContain('Sıradaki adım ne?');
    expect(p).toContain('Turkish');
  });

  it('adds the earlier conversation to questions only', () => {
    const m = sample();
    const history = [{ question: 'Ne eksik?', answer: 'Ses tasarımı eksik.' }];
    expect(buildPrompt(m, m.roots[0].id, 'ask', { question: 'Peki onu aç', history }).prompt).toContain('User: Ne eksik?\nAssistant: Ses tasarımı eksik.');
    expect(buildPrompt(m, m.roots[0].id, 'ideas', { history }).prompt).not.toContain('Ses tasarımı');
  });

  it('cuts branches outside the focus first on very large maps', () => {
    const m = createMap('Büyük');
    const big = createTopic('Büyük dal', Array.from({ length: 300 }, (_, i) => createTopic(`Konu ${i}`, [createTopic(`Alt konu ${i} a`), createTopic(`Alt konu ${i} b`)])));
    const focus = createTopic('Odak', [createTopic('Odak çocuğu', [createTopic('Derin')])]);
    m.roots[0].children = [big, createTopic('Ara', [focus])];
    const { prompt } = buildPrompt(m, focus.id, 'summarize');
    expect(prompt.length).toBeLessThan(20000);
    expect(prompt).toContain('Derin');
    expect(prompt).toContain('more topics not shown');
  });
});

describe('parseReply', () => {
  const m = sample();
  const branch = m.roots[0].children[0];
  const { refs } = buildPrompt(m, branch.id, 'expand');

  it('reads additions with refs, fences and chatter around the JSON', () => {
    const raw = 'Here you go:\n```json\n{"add":[{"parent":"t3","topics":[{"text":"Geçmişi","children":[{"text":"Köy"}]}]},{"parent":"[t4]","topics":["Motivasyon"]}]}\n```';
    const r = parseReply(raw, refs, branch.id, 'expand');
    expect(r.additions).toHaveLength(2);
    expect(r.additions[0].parentId).toBe(branch.children[0].id);
    expect(r.additions[0].topics[0]).toEqual({ text: 'Geçmişi', children: [{ text: 'Köy', children: [] }] });
    expect(r.additions[1].parentId).toBe(branch.children[1].id);
    expect(countSuggestions(r.additions)).toBe(3);
  });

  it('reads suggested tasks with valid due dates', () => {
    const r = parseReply('{"text":"Durum","add":[{"parent":"t2","topics":[{"text":"Test et","task":true,"due":"2026-11-20"},{"text":"Yaz","task":true,"due":"yarın"}]}]}', refs, branch.id, 'nextSteps');
    expect(r.text).toBe('Durum');
    expect(r.additions[0].topics[0]).toMatchObject({ task: true, due: '2026-11-20' });
    expect(r.additions[0].topics[1].due).toBeUndefined();
    const added = applySuggestions(m, r.additions);
    expect(findTopic(added.map, added.ids[0])).toMatchObject({ task: 'todo', due: '2026-11-20' });
  });

  it('falls back to the action topic for unknown refs and bare topic lists', () => {
    expect(parseReply('{"add":[{"parent":"t99","topics":[{"text":"X"}]}]}', refs, branch.id, 'ideas').additions[0].parentId).toBe(branch.id);
    expect(parseReply('{"topics":[{"text":"Y"}]}', refs, branch.id, 'ideas').additions[0].parentId).toBe(branch.id);
  });

  it('keeps plain text answers for text actions, rejects them for branch actions', () => {
    expect(parseReply('Kısa bir özet.', refs, branch.id, 'summarize').text).toBe('Kısa bir özet.');
    expect(parseReply('{"text":"Özet"}', refs, branch.id, 'summarize').text).toBe('Özet');
    expect(() => parseReply('no json here', refs, branch.id, 'ideas')).toThrow(AiReplyError);
    expect(() => parseReply('{"add":[]}', refs, branch.id, 'ideas')).toThrow(AiReplyError);
  });

  it('drops empty and junk items and limits size', () => {
    const many = { add: [{ parent: 't1', topics: [...Array.from({ length: 200 }, (_, i) => ({ text: `T${i}` })), { text: '  ' }, 42, null] }] };
    const r = parseReply(JSON.stringify(many), refs, branch.id, 'ideas');
    expect(countSuggestions(r.additions)).toBe(120);
  });

  it('reads the nested "add" object some answers use', () => {
    // Real Claude reply to "turn this story into a map" before the prompt fix.
    const raw = '{"text":"Hikâyeyi dallara böldüm.","add":{"text":"Hikâye haritası","add":[{"parent":"t1","topics":[{"text":"Karakterler","children":[{"text":"Meryem\'in sırrını yaz","task":true,"children":[]}]}]}]}}';
    const r = parseReply(raw, refs, branch.id, 'ask');
    expect(r.text).toBe('Hikâyeyi dallara böldüm.');
    expect(r.additions[0].parentId).toBe(m.roots[0].id);
    expect(r.additions[0].topics[0].children[0]).toMatchObject({ text: "Meryem'in sırrını yaz", task: true });
    expect(parseReply('{"add":{"parent":"t2","topics":["A"]}}', refs, branch.id, 'ideas').additions[0].parentId).toBe(branch.id);
  });

  it('does not show broken JSON as an answer', () => {
    expect(() => parseReply('{"text":"Yarım kal', refs, branch.id, 'ask')).toThrow(AiReplyError);
  });
});

describe('reply format', () => {
  it('asks for a list under "add" and tells the model it only suggests', () => {
    const m = sample();
    const { prompt } = buildPrompt(m, m.roots[0].id, 'ask', { question: 'Bunu haritaya dönüştür' });
    expect(prompt).toContain('"add" must be a list');
    expect(prompt).toContain('never say that you added');
    expect(prompt).not.toMatch(/"add": \{/);
    const schema = JSON.parse(REPLY_SCHEMA);
    expect(schema.properties.add.type).toBe('array');
  });

  it('turns the last exchange into branches', () => {
    const m = sample();
    const history = [{ question: 'Hikâyem: dört yolcu…', answer: 'Güzel bir öncül.' }];
    const { prompt } = buildPrompt(m, m.roots[0].id, 'toBranches', { history });
    expect(prompt).toContain('User: Hikâyem: dört yolcu…');
    expect(prompt).toContain('"parent":"t1"');
  });
});

describe('applying', () => {
  it('adds kept suggestions with children and fresh ids', () => {
    const m = sample();
    const branch = m.roots[0].children[0];
    const additions = [{ parentId: branch.id, topics: [{ text: 'A', children: [{ text: 'A1', children: [] }] }, { text: 'B', children: [] }] }];
    const r = applySuggestions(m, additions, new Set([suggestionKey(0, 1)]));
    const kids = findTopic(r.map, branch.id)!.children.map((c) => c.text);
    expect(kids).toEqual(['Kahraman', 'Kötü', 'A']);
    expect(r.ids).toHaveLength(1);
    expect(r.allIds).toHaveLength(2);
    expect(findTopic(r.map, r.ids[0])!.children[0].text).toBe('A1');
    // The original map is untouched.
    expect(findTopic(m, branch.id)!.children).toHaveLength(2);
  });

  it('skips additions whose parent is gone', () => {
    const m = sample();
    const r = applySuggestions(m, [{ parentId: 'missing', topics: [{ text: 'X', children: [] }] }]);
    expect(r.ids).toEqual([]);
    expect(r.map).toBe(m);
  });

  it('puts text answers in the topic or its note', () => {
    const m = sample();
    const mech = m.roots[0].children[1];
    expect(findTopic(applyText(m, mech.id, 'rewrite', 'Oyun\nmekanikleri'), mech.id)!.text).toBe('Oyun mekanikleri');
    expect(findTopic(applyText(m, mech.id, 'summarize', 'Özet.'), mech.id)!.note).toBe('Zıplama, tırmanma, yüzme\n\nÖzet.');
  });
});
