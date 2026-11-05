// Tags and task mode.
//
// Tags ("#acil", "#fikir") are free words on a topic; a filter dims or hides
// the topics that don't match. A task is a topic with a checkbox, and
// optionally a due date and a person. A branch's progress is not stored: it
// is counted from the tasks below it, so it is always right and never
// conflicts in sync. Priority is the existing priority marker.

import { findTopic, updateTopic, type MindMap, type Topic } from './model';
import { fold } from './search';

export type TaskState = 'todo' | 'done';

// ---------- tags ----------

/** A tag as stored: no "#", no spaces (they become "-"), at most 40 characters. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').replace(/\s+/g, '-').replace(/[#,]/g, '').slice(0, 40);
}

const sameTag = (a: string, b: string) => fold(a) === fold(b);

/** Tags of a topic, without duplicates (case and accents ignored). */
function cleanTags(list: string[]): string[] | undefined {
  const out: string[] = [];
  for (const raw of list) {
    const t = normalizeTag(raw);
    if (t && !out.some((x) => sameTag(x, t))) out.push(t);
  }
  return out.length ? out : undefined;
}

/** Sets the tags of one topic. */
export function setTags(map: MindMap, id: string, tags: string[]): MindMap {
  return updateTopic(map, id, { tags: cleanTags(tags) });
}

/** Adds (on) or removes (off) one tag on every listed topic. */
export function setTag(map: MindMap, ids: Iterable<string>, tag: string, on: boolean): MindMap {
  const tg = normalizeTag(tag);
  if (!tg) return map;
  let next = map;
  for (const id of ids) {
    const t = findTopic(next, id);
    if (!t) continue;
    const cur = t.tags ?? [];
    const has = cur.some((x) => sameTag(x, tg));
    if (has === on) continue;
    next = updateTopic(next, id, { tags: cleanTags(on ? [...cur, tg] : cur.filter((x) => !sameTag(x, tg))) });
  }
  return next;
}

const TAG_TOKEN = /(?:^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_\-./]*)$/u;

/**
 * Tags typed at the end of a topic's text ("Call the bank #urgent #home")
 * come off the text. A tag needs a letter, so "#1" stays text.
 */
export function extractTags(text: string): { text: string; tags: string[] } {
  let rest = text.replace(/\s+$/, '');
  const tags: string[] = [];
  for (;;) {
    const m = TAG_TOKEN.exec(rest);
    if (!m || !/\p{L}/u.test(m[1])) break;
    tags.unshift(m[1]);
    rest = rest.slice(0, m.index).replace(/\s+$/, '');
  }
  if (!tags.length || !rest.trim()) return { text, tags: [] };
  return { text: rest, tags };
}

/** Every tag in the map with how many topics carry it, most used first. */
export function allTags(map: MindMap): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  const walk = (t: Topic) => {
    for (const tag of t.tags ?? []) {
      const k = fold(tag);
      const c = counts.get(k);
      if (c) c.count++;
      else counts.set(k, { tag, count: 1 });
    }
    t.children.forEach(walk);
    t.summaries?.forEach((s) => walk(s.topic));
  };
  map.roots.forEach(walk);
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Tag chip colours, picked by the tag's name so a tag looks the same everywhere. */
export const TAG_COLORS = ['#1971C2', '#2B8A3E', '#C2255C', '#E8590C', '#7048E8', '#0C8599', '#5C940D', '#AE3EC9'];

export function tagColor(tag: string): string {
  let h = 0;
  for (const ch of fold(tag)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}

// ---------- tasks ----------

export interface TaskPatch {
  task?: TaskState | null;
  due?: string | null;
  assignee?: string | null;
}

/** Changes task fields on every listed topic; null clears a field. Clearing the task clears its date and person. */
export function setTaskFields(map: MindMap, ids: Iterable<string>, patch: TaskPatch): MindMap {
  let next = map;
  for (const id of ids) {
    const t = findTopic(next, id);
    if (!t) continue;
    const p: Partial<Topic> = {};
    if (patch.task !== undefined) p.task = patch.task ?? undefined;
    if (patch.due !== undefined) p.due = patch.due && isDate(patch.due) ? patch.due : undefined;
    if (patch.assignee !== undefined) p.assignee = patch.assignee?.trim().replace(/^@+/, '') || undefined;
    if (patch.task === null) {
      p.due = undefined;
      p.assignee = undefined;
    } else if ((p.due || p.assignee) && !t.task && patch.task === undefined) {
      // A date or a person makes the topic a task.
      p.task = 'todo';
    }
    if (Object.entries(p).every(([k, v]) => t[k as keyof Topic] === v)) continue;
    next = updateTopic(next, id, p);
  }
  return next;
}

/**
 * The checkbox: topics that are not tasks become open tasks; otherwise all
 * become done, or (when all are done already) open again.
 */
export function toggleTasks(map: MindMap, ids: string[]): MindMap {
  const ts = ids.map((id) => findTopic(map, id)).filter((t): t is Topic => !!t);
  if (!ts.length) return map;
  if (ts.some((t) => !t.task)) return setTaskFields(map, ts.filter((t) => !t.task).map((t) => t.id), { task: 'todo' });
  return setTaskFields(map, ids, { task: ts.every((t) => t.task === 'done') ? 'todo' : 'done' });
}

/** Checks or unchecks one task (a click on its box). */
export function checkTask(map: MindMap, id: string): MindMap {
  const t = findTopic(map, id);
  if (!t?.task) return map;
  return setTaskFields(map, [id], { task: t.task === 'done' ? 'todo' : 'done' });
}

/** A real calendar day written YYYY-MM-DD. */
export function isDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Today as YYYY-MM-DD in local time. */
export function today(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export const isOverdue = (t: Pick<Topic, 'task' | 'due'>, day = today()) => t.task === 'todo' && !!t.due && t.due < day;

/** Short date for a topic: "12 Kas" / "Nov 12", with the year only when it isn't this year. */
export function dueLabel(due: string, locale?: string): string {
  const [y, m, d] = due.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const loc = locale ?? (globalThis.document?.documentElement.lang || 'en');
  try {
    return date.toLocaleDateString(loc, y === new Date().getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return due;
  }
}

export interface Progress {
  done: number;
  total: number;
}

const progressCache = new WeakMap<Topic, Progress | null>();

/**
 * Progress of a branch: the tasks below a topic that have no tasks below
 * them, and how many are done. Null when there are no tasks below it.
 * Topics never change in place, so the count is cached per topic object.
 */
export function branchProgress(t: Topic): Progress | null {
  if (progressCache.has(t)) return progressCache.get(t)!;
  let done = 0, total = 0;
  for (const c of t.children) {
    const p = branchProgress(c);
    if (p) {
      done += p.done;
      total += p.total;
    } else if (c.task) {
      total++;
      if (c.task === 'done') done++;
    }
  }
  const out = total ? { done, total } : null;
  progressCache.set(t, out);
  return out;
}

/** Priority 1–5 from the priority marker, if any. */
export function priorityOf(t: Topic): number | undefined {
  const m = t.markers?.find((x) => x.startsWith('priority-'));
  return m ? Number(m.slice(9)) : undefined;
}

export interface TaskItem {
  id: string;
  text: string;
  /** Ancestor texts, root first. */
  path: string[];
  task: TaskState;
  due?: string;
  assignee?: string;
  priority?: number;
  tags?: string[];
}

/** Every task in the map, inner maps included, in document order. */
export function collectTasks(map: MindMap): TaskItem[] {
  const out: TaskItem[] = [];
  const path: string[] = [];
  const walk = (t: Topic) => {
    if (t.task) out.push({ id: t.id, text: t.text, path: [...path], task: t.task, due: t.due, assignee: t.assignee, priority: priorityOf(t), tags: t.tags });
    path.push(t.text);
    t.children.forEach(walk);
    path.pop();
  };
  map.roots.forEach(walk);
  return out;
}

/** Open tasks first, then by due date (none last), priority, and document order. */
export function sortTasks<T extends TaskItem>(list: T[]): T[] {
  return list
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const x = a.t, y = b.t;
      if (x.task !== y.task) return x.task === 'todo' ? -1 : 1;
      if ((x.due ?? '~') !== (y.due ?? '~')) return (x.due ?? '~') < (y.due ?? '~') ? -1 : 1;
      if ((x.priority ?? 9) !== (y.priority ?? 9)) return (x.priority ?? 9) - (y.priority ?? 9);
      return a.i - b.i;
    })
    .map((e) => e.t);
}

// ---------- filter ----------

export type TaskFilter = 'all' | 'open' | 'done' | 'overdue' | 'none';

export interface TopicFilter {
  /** Topics with any of these tags match (empty: tags don't matter). */
  tags: string[];
  task: TaskFilter;
  /** Others are faded, or left off the map (their ancestors stay so the tree holds). */
  mode: 'dim' | 'hide';
}

export const emptyFilter: TopicFilter = { tags: [], task: 'all', mode: 'dim' };
export const filterActive = (f: TopicFilter | null | undefined): f is TopicFilter => !!f && (f.tags.length > 0 || f.task !== 'all');

export function topicMatches(t: Topic, f: TopicFilter, day = today()): boolean {
  if (f.tags.length && !(t.tags ?? []).some((x) => f.tags.some((y) => sameTag(x, y)))) return false;
  switch (f.task) {
    case 'open':
      return t.task === 'todo';
    case 'done':
      return t.task === 'done';
    case 'overdue':
      return isOverdue(t, day);
    case 'none':
      return !t.task;
    default:
      return true;
  }
}

/** Ids of the topics that match. */
export function matchingIds(map: MindMap, f: TopicFilter): Set<string> {
  const day = today();
  const out = new Set<string>();
  const walk = (t: Topic) => {
    if (topicMatches(t, f, day)) out.add(t.id);
    t.children.forEach(walk);
    t.summaries?.forEach((s) => topicMatches(s.topic, f, day) && out.add(s.topic.id));
  };
  map.roots.forEach(walk);
  return out;
}

/**
 * The map with only matching topics and the path to them (for the "hide"
 * mode). The main topic always stays. View only: never saved.
 */
export function filterMap(map: MindMap, f: TopicFilter): MindMap {
  const day = today();
  const keep = (t: Topic): Topic | null => {
    const children = t.children.map(keep).filter((c): c is Topic => !!c);
    if (!children.length && !topicMatches(t, f, day)) return null;
    if (children.length === t.children.length && children.every((c, i) => c === t.children[i])) return t;
    const shown = new Set(children.map((c) => c.id));
    const out: Topic = { ...t, children };
    const b = t.boundaries?.filter((r) => shown.has(r.from) && shown.has(r.to));
    const s = t.summaries?.filter((r) => shown.has(r.from) && shown.has(r.to));
    if (b?.length) out.boundaries = b;
    else delete out.boundaries;
    if (s?.length) out.summaries = s;
    else delete out.summaries;
    return out;
  };
  const roots = map.roots.map((r, i) => keep(r) ?? (i === 0 ? { ...r, children: [], boundaries: undefined, summaries: undefined } : null)).filter((r): r is Topic => !!r);
  return { ...map, roots };
}

// ---------- text form (Markdown, smart paste) ----------

/** "#tag", "@person" and "📅 date" after a topic's text, as in Markdown exports. */
export function metaSuffix(t: Topic): string {
  const parts: string[] = [];
  for (const tag of t.tags ?? []) parts.push(`#${tag}`);
  if (t.due) parts.push(`📅 ${t.due}`);
  if (t.assignee) parts.push(`@${t.assignee.replace(/\s+/g, '_')}`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

/** "[ ] " or "[x] " for a task, "" otherwise. */
export const taskBox = (t: Topic) => (t.task === 'done' ? '[x] ' : t.task === 'todo' ? '[ ] ' : '');

/**
 * Reads a list item's text written by `taskBox` + text + `metaSuffix` (or by
 * hand, or by another app): a "[ ]" / "[x]" box, then trailing tags, a
 * "📅 YYYY-MM-DD" date and an "@person".
 */
export function parseTaskText(raw: string): { text: string; task?: TaskState; tags?: string[]; due?: string; assignee?: string } {
  let text = raw.trim();
  let task: TaskState | undefined;
  const box = /^\[([ xX])\]\s+(.*)$/.exec(text);
  if (box) {
    task = box[1] === ' ' ? 'todo' : 'done';
    text = box[2];
  }
  let due: string | undefined, assignee: string | undefined;
  const tags: string[] = [];
  for (;;) {
    const d = /\s*(?:📅|🗓️?)\s*(\d{4}-\d{2}-\d{2})$/u.exec(text);
    if (d && isDate(d[1]) && d.index > 0) {
      due = d[1];
      text = text.slice(0, d.index);
      continue;
    }
    // A person only on a checkbox line, so "follow @someone" stays text.
    const a = task ? /\s+@([\p{L}\p{N}_.\-]+)$/u.exec(text) : null;
    if (a && /\p{L}/u.test(a[1])) {
      assignee = a[1].replace(/_/g, ' ');
      text = text.slice(0, a.index);
      continue;
    }
    const tg = /\s+#([\p{L}\p{N}_][\p{L}\p{N}_\-./]*)$/u.exec(text);
    if (tg && /\p{L}/u.test(tg[1])) {
      tags.unshift(tg[1]);
      text = text.slice(0, tg.index);
      continue;
    }
    break;
  }
  if (!text.trim()) return { text: raw.trim() };
  const out: ReturnType<typeof parseTaskText> = { text: text.trim() };
  if (task) out.task = task;
  if (tags.length) out.tags = tags;
  if (due) {
    out.due = due;
    out.task ??= 'todo';
  }
  if (assignee) out.assignee = assignee;
  return out;
}

/** Puts parsed task fields on a new topic. */
export function applyParsed(t: Topic, p: ReturnType<typeof parseTaskText>): Topic {
  t.text = p.text;
  if (p.task) t.task = p.task;
  if (p.tags) t.tags = p.tags;
  if (p.due) t.due = p.due;
  if (p.assignee) t.assignee = p.assignee;
  return t;
}
