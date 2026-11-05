// Text search for topics, commands and maps. Matching ignores case and
// accents, Turkish-aware: "sik" finds "Şık", "istanbul" finds "İSTANBUL".

import type { MindMap, Topic } from './model';

function foldChar(c: string): string {
  if (c === 'ı' || c === 'I' || c === 'İ') return 'i';
  const f = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return f.length === 1 ? f : c.toLowerCase().charAt(0) || c;
}

/**
 * Lowercase, accent-free copy of `s`, one UTF-16 unit per unit of `s`, so a
 * match found in the folded text has the same offsets in the original.
 */
export function fold(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) out += foldChar(s[i]);
  return out;
}

export interface Match {
  score: number;
  /** Start and end of the matched text in the original string. */
  start: number;
  end: number;
}

const isWordStart = (s: string, i: number) => i === 0 || /[\s\-_/.,:;(]/.test(s[i - 1]);

/** Substring match; earlier, word-initial and whole matches score higher. */
export function matchText(query: string, text: string): Match | undefined {
  const q = fold(query.trim());
  if (!q) return undefined;
  const t = fold(text);
  let at = t.indexOf(q);
  if (at < 0) return undefined;
  // Prefer a hit at the start of a word if there is one.
  for (let i = at; i >= 0 && i < t.length; i = t.indexOf(q, i + 1)) {
    if (isWordStart(t, i)) {
      at = i;
      break;
    }
  }
  let score = 100 - Math.min(at, 50);
  if (isWordStart(t, at)) score += 30;
  if (t.length === q.length) score += 50;
  return { score, start: at, end: at + q.length };
}

/** Looser match for short labels like command names: letters in order. */
export function matchLabel(query: string, label: string): Match | undefined {
  const exact = matchText(query, label);
  if (exact) return { ...exact, score: exact.score + 100 };
  const q = fold(query.replace(/\s+/g, ''));
  const t = fold(label);
  if (!q) return undefined;
  let i = 0, first = -1, gaps = 0, last = -1;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] !== q[i]) continue;
    if (first < 0) first = j;
    if (last >= 0) gaps += j - last - 1;
    last = j;
    i++;
  }
  if (i < q.length) return undefined;
  return { score: Math.max(1, 60 - gaps * 3 - first), start: first, end: last + 1 };
}

export interface TopicHit {
  id: string;
  text: string;
  /** Texts of the ancestors, root first. */
  path: string[];
  /** Where the query was found. */
  field: 'text' | 'note';
  match: Match;
}

/** Topics whose text or note contains the query, best first. */
export function searchMap(map: MindMap, query: string, limit = 50): TopicHit[] {
  if (!query.trim()) return [];
  const hits: TopicHit[] = [];
  const path: string[] = [];
  const walk = (t: Topic) => {
    const m = matchText(query, t.text);
    const n = !m && t.note ? matchText(query, t.note) : undefined;
    if (m) hits.push({ id: t.id, text: t.text, path: [...path], field: 'text', match: m });
    else if (n) hits.push({ id: t.id, text: t.text, path: [...path], field: 'note', match: { ...n, score: n.score - 60 } });
    path.push(t.text);
    t.children.forEach(walk);
    t.summaries?.forEach((s) => walk(s.topic));
    path.pop();
  };
  map.roots.forEach(walk);
  hits.sort((a, b) => b.match.score - a.match.score);
  return hits.slice(0, limit);
}
