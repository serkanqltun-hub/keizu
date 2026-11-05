// Smart paste: text from the clipboard becomes topics. A bulleted or
// numbered list, Markdown headings or an indented outline (from a chat, a
// document or a note app) turns into a tree; a web address becomes a link.
// The reverse, topicsToText, is what Keizu puts on the clipboard on copy, so
// topics pasted into another app read as a Markdown list.

import { createTopic, type Topic } from './model';

const URL_RE = /^(https?:\/\/|www\.)[^\s<>"]+$/i;

/** A whole line that is a web address. */
export function isUrl(text: string): boolean {
  return URL_RE.test(text.trim());
}

function normalizeUrl(u: string): string {
  return /^www\./i.test(u) ? `https://${u}` : u;
}

/** Display text without Markdown emphasis, plus the first link it held. */
export function cleanInline(raw: string): { text: string; href?: string } {
  let href: string | undefined;
  let text = raw.replace(/!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, label: string, url: string) => {
    href ??= url;
    return label || url;
  });
  text = text
    .replace(/<(https?:\/\/[^>\s]+)>/g, (_m, url: string) => {
      href ??= url;
      return url;
    })
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/(^|[^*\w])\*(?=\S)([^*]+?)(?<=\S)\*(?!\*)/g, '$1$2')
    .replace(/(^|[^_\w])_(?=\S)([^_]+?)(?<=\S)_(?!\w)/g, '$1$2')
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!href && isUrl(text)) href = normalizeUrl(text);
  return { text, href };
}

interface Line {
  /** Nesting rank: headings rank below any list indent, so lists sit under them. */
  rank: number;
  text: string;
  done?: boolean;
  quote?: boolean;
}

function widthOf(ws: string): number {
  let w = 0;
  for (const ch of ws) w += ch === '\t' ? 4 : 1;
  return w;
}

function readLine(raw: string): Line | null {
  const line = raw.replace(/ /g, ' ').replace(/\s+$/, '');
  if (!line.trim()) return null;
  // Horizontal rules, code fences and table separators carry no topic.
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line) || /^\s*(```|~~~)/.test(line) || /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line)) return null;
  const indent = widthOf(/^\s*/.exec(line)![0]);
  const body = line.trim();
  const q = /^>\s?(.*)$/.exec(body);
  if (q) return { rank: indent, text: q[1], quote: true };
  const h = /^(#{1,6})\s+(.*?)\s*#*$/.exec(body);
  if (h) return { rank: h[1].length - 10, text: h[2] };
  // Bullets, numbers ("1." "1)" "a)" "iv."), and task boxes.
  const b = /^(?:[-*+•◦▪▫‣·–—]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)]|[ivxIVX]{1,4}[.)])\s+(.*)$/.exec(body);
  let text = b ? b[1] : body;
  let done: boolean | undefined;
  const task = /^\[([ xX])\]\s+(.*)$/.exec(text);
  if (task) {
    done = task[1] !== ' ';
    text = task[2];
  }
  // A table row: its cells side by side.
  if (!b && /^\|.*\|$/.test(body)) text = body.slice(1, -1).split('|').map((c) => c.trim()).filter(Boolean).join(' · ');
  return { rank: indent, text, done };
}

/**
 * Turns pasted text into topics. Each list item, heading or non-empty line is
 * a topic; deeper indentation (or a lower heading) nests it under the line
 * above. "> " quote lines become the note of the topic above them.
 */
export function parsePastedText(input: string): Topic[] {
  const tops: Topic[] = [];
  const stack: { rank: number; topic: Topic }[] = [];
  let last: Topic | undefined;
  for (const raw of input.replace(/\r\n?/g, '\n').split('\n')) {
    const line = readLine(raw);
    if (!line) continue;
    if (line.quote) {
      if (last) last.note = last.note === undefined ? line.text : `${last.note}\n${line.text}`;
      else {
        // Quote with nothing above it: a topic of its own.
        const t = createTopic(cleanInline(line.text).text || line.text);
        tops.push(t);
        last = t;
      }
      continue;
    }
    const { text, href } = cleanInline(line.text);
    if (!text) continue;
    const topic = createTopic(text);
    if (href) topic.href = normalizeUrl(href);
    if (line.done !== undefined) topic.markers = [line.done ? 'task-100' : 'task-0'];
    while (stack.length && stack[stack.length - 1].rank >= line.rank) stack.pop();
    if (stack.length) stack[stack.length - 1].topic.children.push(topic);
    else tops.push(topic);
    stack.push({ rank: line.rank, topic });
    last = topic;
  }
  return tops;
}

/** Topics as a Markdown list, notes as "> " lines under their topic. */
export function topicsToText(topics: Topic[]): string {
  const out: string[] = [];
  const walk = (t: Topic, depth: number) => {
    const pad = '  '.repeat(depth);
    const text = t.text.replace(/\s*\n\s*/g, ' ');
    out.push(`${pad}- ${t.href && !t.href.startsWith('keizu:') && t.href !== text ? `[${text}](${t.href})` : text}`);
    if (t.note) for (const l of t.note.split('\n')) out.push(`${pad}  > ${l}`);
    t.children.forEach((c) => walk(c, depth + 1));
  };
  // A single topic with no children copies as plain text.
  if (topics.length === 1 && !topics[0].children.length && !topics[0].note) return topics[0].text;
  topics.forEach((t) => walk(t, 0));
  return out.join('\n');
}
