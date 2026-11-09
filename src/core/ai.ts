// AI assistant: the part that doesn't depend on who answers. It turns a
// branch of the map into a prompt, reads the reply (a small JSON object) and
// applies accepted suggestions to the map. The desktop app sends the prompt to
// an AI command-line tool the user has signed in to with their own
// subscription (Claude Code, Gemini CLI); see src/ui/assistant.tsx.

import { pasteTopics } from './bulk';
import { createTopic, findParent, findTopic, updateTopic, type MindMap, type Topic } from './model';

export type AiAction = 'ideas' | 'expand' | 'summarize' | 'rewrite' | 'translateTr' | 'translateEn' | 'fromNote' | 'ask';

/** Actions that add branches; the rest answer with text. */
export const BRANCH_ACTIONS: AiAction[] = ['ideas', 'expand', 'fromNote'];

/** A suggested topic with its own suggested children. */
export interface AiTopic {
  text: string;
  children: AiTopic[];
}

/** Suggested topics to add under one existing topic. */
export interface AiAddition {
  parentId: string;
  topics: AiTopic[];
}

export interface AiReply {
  /** Plain answer (summary, rewritten text, answer to a question). */
  text?: string;
  additions: AiAddition[];
}

/** How the prompt refers to topics: short refs, not the long internal ids. */
interface Context {
  outline: string;
  refs: Map<string, string>;
  path: string[];
}

const MAX_CONTEXT = 6000;
const MAX_TOPICS = 60;
const MAX_TEXT = 240;
const MAX_DEPTH = 4;

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();

/** The branch of `topicId` as an indented list with refs ([t1], [t2]…). */
function branchContext(map: MindMap, topicId: string): Context {
  const refs = new Map<string, string>();
  const lines: string[] = [];
  let size = 0;
  let n = 0;
  const walk = (t: Topic, depth: number) => {
    if (size > MAX_CONTEXT) return;
    const ref = `t${++n}`;
    refs.set(ref, t.id);
    const line = `${'  '.repeat(depth)}- [${ref}] ${oneLine(t.text) || '(boş)'}`;
    lines.push(line);
    size += line.length;
    if (t.note) {
      const note = oneLine(t.note).slice(0, 400);
      lines.push(`${'  '.repeat(depth)}  note: ${note}`);
      size += note.length;
    }
    for (const c of t.children) walk(c, depth + 1);
  };
  const topic = findTopic(map, topicId);
  if (topic) walk(topic, 0);
  if (size > MAX_CONTEXT) lines.push('  …');
  const path: string[] = [];
  for (let p = findParent(map, topicId); p; p = findParent(map, p.id)) path.unshift(oneLine(p.text));
  return { outline: lines.join('\n'), refs, path };
}

const TASKS: Record<AiAction, string> = {
  ideas:
    'Brainstorm 5 to 8 new, distinct sub-topics for [t1]. Do not repeat its existing children. Keep each topic short (a few words). Answer with {"add":[{"parent":"t1","topics":[{"text":"…","children":[]}]}]}.',
  expand:
    'Deepen this branch by one level: for each topic that has no children yet, suggest 2 to 4 short sub-topics. Answer with {"add":[{"parent":"<ref>","topics":[{"text":"…","children":[]}]}, …]} using the refs from the outline.',
  fromNote:
    'Turn the note of [t1] (and any text in it) into a well-structured tree of short sub-topics for [t1], at most 3 levels deep. Answer with {"add":[{"parent":"t1","topics":[{"text":"…","children":[…]}]}]}.',
  summarize: 'Summarize this branch in one short paragraph (2 to 4 sentences). Answer with {"text":"…"}.',
  rewrite: 'Rewrite the text of [t1] to be clearer and shorter, keeping its meaning. Answer with {"text":"…"} holding only the new topic text.',
  translateTr: 'Translate the text of [t1] into Turkish. Answer with {"text":"…"} holding only the translation.',
  translateEn: 'Translate the text of [t1] into English. Answer with {"text":"…"} holding only the translation.',
  ask: 'Answer the user\'s question below about this mind map branch. Answer with {"text":"…"}. If the answer is best given as new topics, also include "add" as described: {"text":"…","add":[{"parent":"<ref>","topics":[…]}]}.',
};

export interface PromptOptions {
  /** The user's question (action "ask"). */
  question?: string;
  /** Language for answers: "auto" follows the map's own language. */
  lang?: 'auto' | 'tr' | 'en';
}

/** The full prompt for an action on a topic, plus the refs used in it. */
export function buildPrompt(map: MindMap, topicId: string, action: AiAction, opts: PromptOptions = {}): { prompt: string; refs: Map<string, string> } {
  const ctx = branchContext(map, topicId);
  const lang =
    action === 'translateTr' || action === 'translateEn'
      ? ''
      : opts.lang === 'tr'
        ? 'Write all text in Turkish.'
        : opts.lang === 'en'
          ? 'Write all text in English.'
          : 'Write all text in the same language as the mind map.';
  const parts = [
    'You are the assistant inside Keizu, a mind mapping app. You only produce text; do not use tools, read files or run commands.',
    `Mind map: "${oneLine(map.title)}"`,
    ctx.path.length ? `Path from the central topic to the branch: ${ctx.path.join(' > ')}` : '',
    'Branch (each topic has a ref in brackets):',
    ctx.outline,
    '',
    `Task: ${TASKS[action]}`,
    action === 'ask' && opts.question ? `User's question: ${oneLine(opts.question)}` : '',
    lang,
    'Reply with only one JSON object and nothing else: no explanation, no Markdown fences.',
  ];
  return { prompt: parts.filter((p) => p !== '').join('\n'), refs: ctx.refs };
}

/** Finds the JSON object in a reply (tolerates fences and chatter around it). */
function extractJson(raw: string): unknown {
  const text = raw.replace(/```(?:json)?/gi, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function readTopics(v: unknown, depth: number, budget: { left: number }): AiTopic[] {
  if (!Array.isArray(v) || depth > MAX_DEPTH) return [];
  const out: AiTopic[] = [];
  for (const item of v) {
    if (budget.left <= 0) break;
    const rawText = typeof item === 'string' ? item : item && typeof item === 'object' ? (item as { text?: unknown }).text : undefined;
    if (typeof rawText !== 'string') continue;
    const text = oneLine(rawText).slice(0, MAX_TEXT);
    if (!text) continue;
    budget.left--;
    const kids = item && typeof item === 'object' ? (item as { children?: unknown }).children : undefined;
    out.push({ text, children: readTopics(kids, depth + 1, budget) });
  }
  return out;
}

export class AiReplyError extends Error {}

/**
 * Reads the assistant's reply. Refs ("t3") are turned back into topic ids;
 * unknown refs fall back to `fallbackId` (the topic the action was run on).
 * A reply that isn't JSON is kept as plain text for text actions.
 */
export function parseReply(raw: string, refs: Map<string, string>, fallbackId: string, action: AiAction): AiReply {
  const data = extractJson(raw) as { text?: unknown; add?: unknown; topics?: unknown } | undefined;
  const wantsBranches = BRANCH_ACTIONS.includes(action);
  if (!data || typeof data !== 'object') {
    const plain = raw.trim();
    if (!wantsBranches && plain) return { text: plain, additions: [] };
    throw new AiReplyError('unreadable');
  }
  const budget = { left: MAX_TOPICS };
  const byParent = new Map<string, AiTopic[]>();
  const push = (parentId: string, topics: AiTopic[]) => {
    if (!topics.length) return;
    byParent.set(parentId, [...(byParent.get(parentId) ?? []), ...topics]);
  };
  if (Array.isArray(data.add)) {
    for (const a of data.add) {
      if (!a || typeof a !== 'object') continue;
      const ref = String((a as { parent?: unknown }).parent ?? '').replace(/[[\]\s]/g, '');
      push(refs.get(ref) ?? fallbackId, readTopics((a as { topics?: unknown }).topics, 1, budget));
    }
  } else if (Array.isArray(data.topics)) {
    push(fallbackId, readTopics(data.topics, 1, budget));
  }
  const additions = [...byParent].map(([parentId, topics]) => ({ parentId, topics }));
  const text = typeof data.text === 'string' && data.text.trim() ? data.text.trim() : undefined;
  if (!text && !additions.length) throw new AiReplyError('empty');
  return { text, additions };
}

/** Counts suggested topics, children included. */
export function countSuggestions(additions: AiAddition[]): number {
  const n = (ts: AiTopic[]): number => ts.reduce((s, t) => s + 1 + n(t.children), 0);
  return additions.reduce((s, a) => s + n(a.topics), 0);
}

/** Key of a top-level suggestion: "<addition index>/<topic index>". */
export const suggestionKey = (a: number, t: number) => `${a}/${t}`;

const toTopic = (s: AiTopic): Topic => createTopic(s.text, s.children.map(toTopic));

/**
 * Adds the suggestions to the map. `skip` holds keys of top-level suggestions
 * left out. Returns every new topic id (children included), first-level ids
 * first, so the caller can select or fade them.
 */
export function applySuggestions(map: MindMap, additions: AiAddition[], skip: ReadonlySet<string> = new Set()): { map: MindMap; ids: string[]; allIds: string[] } {
  let next = map;
  const ids: string[] = [];
  const allIds: string[] = [];
  additions.forEach((a, ai) => {
    if (!findTopic(next, a.parentId)) return;
    const topics = a.topics.filter((_, ti) => !skip.has(suggestionKey(ai, ti))).map(toTopic);
    if (!topics.length) return;
    const r = pasteTopics(next, a.parentId, topics);
    next = r.map;
    ids.push(...r.ids);
  });
  const walk = (t: Topic) => {
    allIds.push(t.id);
    t.children.forEach(walk);
  };
  for (const id of ids) {
    const t = findTopic(next, id);
    if (t) walk(t);
  }
  return { map: next, ids, allIds };
}

/** Puts a text answer into the map: the topic's text or (summary) its note. */
export function applyText(map: MindMap, topicId: string, action: AiAction, text: string): MindMap {
  const topic = findTopic(map, topicId);
  if (!topic) return map;
  if (action === 'rewrite' || action === 'translateTr' || action === 'translateEn') return updateTopic(map, topicId, { text: oneLine(text) });
  const note = topic.note?.trim() ? `${topic.note.trimEnd()}\n\n${text}` : text;
  return updateTopic(map, topicId, { note });
}
