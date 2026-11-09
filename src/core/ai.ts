// AI assistant: the part that doesn't depend on who answers. It turns the
// map (with the selected branch as its focus) into a prompt, reads the reply (a small JSON object) and
// applies accepted suggestions to the map. The desktop app sends the prompt to
// an AI command-line tool the user has signed in to with their own
// subscription (Claude Code, Gemini CLI); see src/ui/assistant.tsx.

import { pasteTopics } from './bulk';
import { createTopic, findParent, findTopic, updateTopic, type MindMap, type Topic } from './model';
import { isDate, priorityOf } from './tasks';

export type AiAction = 'ideas' | 'expand' | 'summarize' | 'rewrite' | 'translateTr' | 'translateEn' | 'fromNote' | 'nextSteps' | 'ask';

/** Actions that add branches; the rest answer with text. */
export const BRANCH_ACTIONS: AiAction[] = ['ideas', 'expand', 'fromNote'];

/** A suggested topic with its own suggested children. */
export interface AiTopic {
  text: string;
  children: AiTopic[];
  /** Suggested as a task (an open checkbox). */
  task?: boolean;
  /** Task due date, YYYY-MM-DD. */
  due?: string;
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
  links: string[];
  focusRef: string;
}

const MAX_CONTEXT = 16000;
const MAX_TOPICS = 60;
const MAX_TEXT = 240;
const MAX_DEPTH = 4;
const MAX_NOTE = 600;

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();

/** "[ ] ", tags, due date, assignee, priority, inner map size: what a topic carries besides its text. */
function topicMeta(t: Topic): { box: string; suffix: string } {
  const box = t.task === 'done' ? '[x] ' : t.task === 'todo' ? '[ ] ' : '';
  const parts: string[] = [];
  for (const tag of t.tags ?? []) parts.push(`#${tag}`);
  if (t.due) parts.push(`due ${t.due}`);
  if (t.assignee) parts.push(`@${t.assignee}`);
  const prio = priorityOf(t);
  if (prio) parts.push(`priority ${prio}`);
  if (t.innerSize) parts.push(`(has an inner map of ${t.innerSize} topics)`);
  return { box, suffix: parts.length ? ` ${parts.join(' ')}` : '' };
}

/**
 * The whole map as an indented list with refs ([t1], [t2]…), task state,
 * tags and notes, the focus branch marked, plus relations and flow links.
 * When the map is too big, branches outside the focus are cut short first.
 */
function mapContext(map: MindMap, focusId: string): Context {
  const focusPath = new Set<string>([focusId]);
  for (let p = findParent(map, focusId); p; p = findParent(map, p.id)) focusPath.add(p.id);
  const render = (otherDepth: number, noteLen: number) => {
    const refs = new Map<string, string>();
    const byId = new Map<string, string>();
    const lines: string[] = [];
    let n = 0;
    const ref = (id: string) => {
      let r = byId.get(id);
      if (!r) {
        r = `t${++n}`;
        byId.set(id, r);
        refs.set(r, id);
      }
      return r;
    };
    const walk = (t: Topic, depth: number, inFocus: boolean) => {
      const pad = '  '.repeat(depth);
      const { box, suffix } = topicMeta(t);
      const mark = t.id === focusId ? '   <-- FOCUS' : '';
      lines.push(`${pad}- [${ref(t.id)}] ${box}${oneLine(t.text) || '(empty)'}${suffix}${mark}`);
      if (t.note?.trim()) {
        const note = oneLine(t.note);
        lines.push(`${pad}  note: ${note.length > noteLen ? `${note.slice(0, noteLen)}…` : note}`);
      }
      for (const sm of t.summaries ?? []) lines.push(`${pad}  summary of some children: ${oneLine(sm.topic.text)}`);
      const deeper = inFocus || focusPath.has(t.id) || depth < otherDepth;
      if (!deeper && t.children.length) {
        const count = (x: Topic): number => x.children.reduce((k, c) => k + 1 + count(c), 0);
        lines.push(`${pad}  … (${count(t)} more topics not shown)`);
        return;
      }
      for (const c of t.children) walk(c, depth + 1, inFocus || t.id === focusId || c.id === focusId);
    };
    map.roots.forEach((r, i) => {
      if (i === 1) lines.push('Floating topics (not attached to the main topic):');
      walk(r, i === 0 ? 0 : 1, r.id === focusId);
    });
    const links: string[] = [];
    for (const r of map.relations) {
      const a = byId.get(r.from), b = byId.get(r.to);
      if (!a || !b) continue;
      const label = r.label ? ` "${oneLine(r.label)}"` : '';
      links.push(r.kind === 'flow' ? `- flow: [${a}] also leads to [${b}]${label}` : `- relation: [${a}] -> [${b}]${label}`);
    }
    return { outline: lines.join('\n'), refs, links, focusRef: byId.get(focusId) ?? 't1' };
  };
  let ctx = render(Infinity, MAX_NOTE);
  for (const [depth, note] of [[3, 300], [2, 160], [1, 80]] as const) {
    if (ctx.outline.length + ctx.links.join('\n').length <= MAX_CONTEXT) break;
    ctx = render(depth, note);
  }
  if (ctx.outline.length > MAX_CONTEXT) ctx = { ...ctx, outline: `${ctx.outline.slice(0, MAX_CONTEXT)}\n…` };
  return ctx;
}

const TASKS: Record<AiAction, string> = {
  ideas:
    'Brainstorm 5 to 8 new, distinct sub-topics for the FOCUS topic [F]. Do not repeat its existing children or ideas found elsewhere in the map. Keep each topic short (a few words). Answer with {"add":[{"parent":"F","topics":[{"text":"…","children":[]}]}]}.',
  expand:
    'Deepen the FOCUS branch by one level: for each topic in it that has no children yet, suggest 2 to 4 short sub-topics. Answer with {"add":[{"parent":"<ref>","topics":[{"text":"…","children":[]}]}, …]} using the refs from the outline.',
  fromNote:
    'Turn the note of the FOCUS topic [F] into a well-structured tree of short sub-topics for [F], at most 3 levels deep. Answer with {"add":[{"parent":"F","topics":[{"text":"…","children":[…]}]}]}.',
  summarize: 'Summarize the FOCUS branch in one short paragraph (2 to 4 sentences). Answer with {"text":"…"}.',
  rewrite: 'Rewrite the text of the FOCUS topic [F] to be clearer and shorter, keeping its meaning. Answer with {"text":"…"} holding only the new topic text.',
  translateTr: 'Translate the text of the FOCUS topic [F] into Turkish. Answer with {"text":"…"} holding only the translation.',
  translateEn: 'Translate the text of the FOCUS topic [F] into English. Answer with {"text":"…"} holding only the translation.',
  nextSteps:
    'Look at the whole map with the FOCUS branch [F] as the area of interest: open and done tasks, due dates, empty branches and gaps. In "text", say briefly where things stand, what is missing or blocked, and what the next steps are (a short paragraph plus up to 5 short lines starting with "- "). In "add", suggest 3 to 5 concrete next-step tasks, each under the topic it belongs to, with "task":true and, when a date makes sense, "due":"YYYY-MM-DD". Answer with {"text":"…","add":[{"parent":"<ref>","topics":[{"text":"…","task":true,"children":[]}]}]}.',
  ask: 'Answer the user\'s question about this mind map. Use the whole map; the FOCUS branch is what the user has selected. Answer with {"text":"…"}. If the answer is best given as new topics, also include "add": {"text":"…","add":[{"parent":"<ref>","topics":[{"text":"…","children":[]}]}]}; mark a topic that is something to do with "task":true.',
};

/** One finished exchange of the panel's conversation. */
export interface ChatTurn {
  question: string;
  answer: string;
}

export interface PromptOptions {
  /** The user's question (action "ask"). */
  question?: string;
  /** Language for answers: "auto" follows the map's own language. */
  lang?: 'auto' | 'tr' | 'en';
  /** Earlier questions and answers, oldest first (actions "ask" and "nextSteps"). */
  history?: ChatTurn[];
  /** Today, YYYY-MM-DD (for due dates). */
  today?: string;
}

const MAX_HISTORY = 6;

/** The full prompt for an action on a topic, plus the refs used in it. */
export function buildPrompt(map: MindMap, topicId: string, action: AiAction, opts: PromptOptions = {}): { prompt: string; refs: Map<string, string> } {
  const ctx = mapContext(map, topicId);
  const lang =
    action === 'translateTr' || action === 'translateEn'
      ? ''
      : opts.lang === 'tr'
        ? 'Write all text in Turkish.'
        : opts.lang === 'en'
          ? 'Write all text in English.'
          : 'Write all text in the same language as the mind map.';
  const chat = action === 'ask' || action === 'nextSteps' ? (opts.history ?? []).slice(-MAX_HISTORY) : [];
  const parts = [
    'You are the assistant inside Keizu, a mind mapping app. You only produce text; do not use tools, read files or run commands.',
    `Mind map: "${oneLine(map.title)}"`,
    opts.today ? `Today is ${opts.today}.` : '',
    'The whole map (each topic has a ref in brackets; "[ ]" is an open task, "[x]" a done one):',
    ctx.outline,
    ctx.links.length ? `Links between topics:\n${ctx.links.join('\n')}` : '',
    `The FOCUS topic is [${ctx.focusRef}].`,
    chat.length ? `Earlier in this conversation:\n${chat.map((c) => `User: ${oneLine(c.question)}\nAssistant: ${oneLine(c.answer).slice(0, 1500)}`).join('\n')}` : '',
    '',
    `Task: ${TASKS[action].replace(/\[F\]/g, `[${ctx.focusRef}]`).replace(/"parent":"F"/g, `"parent":"${ctx.focusRef}"`)}`,
    action === 'ask' && opts.question ? `User's question: ${opts.question.trim()}` : '',
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
    const obj = item && typeof item === 'object' ? (item as { children?: unknown; task?: unknown; due?: unknown }) : undefined;
    const topic: AiTopic = { text, children: readTopics(obj?.children, depth + 1, budget) };
    if (obj?.task === true) topic.task = true;
    if (topic.task && typeof obj?.due === 'string' && isDate(obj.due)) topic.due = obj.due;
    out.push(topic);
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

const toTopic = (s: AiTopic): Topic => {
  const t = createTopic(s.text, s.children.map(toTopic));
  if (s.task) t.task = 'todo';
  if (s.due) t.due = s.due;
  return t;
};

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
