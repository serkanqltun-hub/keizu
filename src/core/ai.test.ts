import { describe, expect, it } from 'vitest';
import { AiReplyError, applySuggestions, applyText, buildPrompt, countSuggestions, parseReply, suggestionKey } from './ai';
import { createMap, createTopic, findTopic, type MindMap } from './model';

function sample(): MindMap {
  const m = createMap('Oyun fikri');
  const a = createTopic('Karakterler', [createTopic('Kahraman'), createTopic('Kötü')]);
  const b = createTopic('Mekanikler');
  b.note = 'Zıplama, tırmanma, yüzme';
  m.roots[0].children = [a, b];
  return m;
}

describe('buildPrompt', () => {
  it('lists the branch with refs and the path above it', () => {
    const m = sample();
    const branch = m.roots[0].children[0];
    const { prompt, refs } = buildPrompt(m, branch.id, 'ideas');
    expect(prompt).toContain('- [t1] Karakterler');
    expect(prompt).toContain('  - [t2] Kahraman');
    expect(prompt).toContain('central topic to the branch: Oyun fikri');
    expect(refs.get('t1')).toBe(branch.id);
    expect(refs.get('t3')).toBe(branch.children[1].id);
  });

  it('includes notes, the question and the answer language', () => {
    const m = sample();
    const mech = m.roots[0].children[1];
    expect(buildPrompt(m, mech.id, 'fromNote').prompt).toContain('note: Zıplama, tırmanma, yüzme');
    const ask = buildPrompt(m, mech.id, 'ask', { question: 'Ne eksik?', lang: 'tr' }).prompt;
    expect(ask).toContain('Ne eksik?');
    expect(ask).toContain('Turkish');
  });

  it('cuts very large branches', () => {
    const m = createMap('Büyük', 'Kök');
    m.roots[0].children = Array.from({ length: 2000 }, (_, i) => createTopic(`Konu numarası ${i}`));
    expect(buildPrompt(m, m.roots[0].id, 'summarize').prompt.length).toBeLessThan(9000);
  });
});

describe('parseReply', () => {
  const m = sample();
  const branch = m.roots[0].children[0];
  const { refs } = buildPrompt(m, branch.id, 'expand');

  it('reads additions with refs, fences and chatter around the JSON', () => {
    const raw = 'Here you go:\n```json\n{"add":[{"parent":"t2","topics":[{"text":"Geçmişi","children":[{"text":"Köy"}]}]},{"parent":"[t3]","topics":["Motivasyon"]}]}\n```';
    const r = parseReply(raw, refs, branch.id, 'expand');
    expect(r.additions).toHaveLength(2);
    expect(r.additions[0].parentId).toBe(branch.children[0].id);
    expect(r.additions[0].topics[0]).toEqual({ text: 'Geçmişi', children: [{ text: 'Köy', children: [] }] });
    expect(r.additions[1].parentId).toBe(branch.children[1].id);
    expect(countSuggestions(r.additions)).toBe(3);
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
    expect(countSuggestions(r.additions)).toBe(60);
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
