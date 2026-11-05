// Import / export of formats that don't need a browser.

import { createTopic, isMindMap, newId, normalizeMap, type MindMap, type Topic } from './model';
import { child, childrenNamed, escapeXml, parseXml, type XmlNode } from './xml';

export function toJSON(map: MindMap): string {
  return JSON.stringify(map, null, 2);
}

export function fromJSON(text: string): MindMap {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Dosya okunamadı: geçerli bir Keizu haritası değil.');
  }
  if (!isMindMap(data)) throw new Error('Bu dosya bir Keizu haritası değil.');
  return normalizeMap(data);
}

/** Central topic as a heading, everything else as a nested list. Notes are "> " quotes under their topic. */
export function toMarkdown(map: MindMap): string {
  const out: string[] = [`# ${map.roots[0].text.replace(/\n/g, ' ')}`, ''];
  const rootNote = (t: Topic) => {
    if (t.note) out.push(...t.note.split('\n').map((l) => `> ${l}`), '');
  };
  rootNote(map.roots[0]);
  const walk = (t: Topic, depth: number) => {
    const pad = '  '.repeat(depth);
    out.push(`${pad}- ${t.text.replace(/\n/g, ' ')}`);
    if (t.note) for (const line of t.note.split('\n')) out.push(`${pad}  > ${line}`);
    t.children.forEach((c) => walk(c, depth + 1));
  };
  map.roots[0].children.forEach((c) => walk(c, 0));
  // Floating topics follow as their own sections.
  for (const r of map.roots.slice(1)) {
    out.push('', `## ${r.text.replace(/\n/g, ' ')}`, '');
    rootNote(r);
    r.children.forEach((c) => walk(c, 0));
  }
  return out.join('\n') + '\n';
}

/** OPML outline: the main topic and any floating topics as top-level outlines. Notes go in `_note`. */
export function toOPML(map: MindMap): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    `    <title>${escapeXml(map.title)}</title>`,
    `    <dateModified>${new Date(map.updatedAt).toUTCString()}</dateModified>`,
    '  </head>',
    '  <body>',
  ];
  const walk = (t: Topic, depth: number) => {
    const pad = '  '.repeat(depth);
    const note = t.note ? ` _note="${escapeXml(t.note)}"` : '';
    const open = `${pad}<outline text="${escapeXml(t.text)}"${note}`;
    if (!t.children.length) return void out.push(`${open}/>`);
    out.push(`${open}>`);
    t.children.forEach((c) => walk(c, depth + 1));
    out.push(`${pad}</outline>`);
  };
  map.roots.forEach((r) => walk(r, 2));
  out.push('  </body>', '</opml>');
  return out.join('\n') + '\n';
}

/** Reads an OPML outline. One top-level outline becomes the main topic; several hang under the title. */
export function fromOPML(text: string, fallbackTitle = 'İçe aktarılan'): MindMap {
  let doc: XmlNode;
  try {
    doc = parseXml(text);
  } catch {
    throw new Error('OPML dosyası okunamadı.');
  }
  if (doc.name !== 'opml') throw new Error('Bu dosya bir OPML belgesi değil.');
  const body = child(doc, 'body');
  const title = child(child(doc, 'head') ?? doc, 'title')?.text.trim() || fallbackTitle;
  const convert = (o: XmlNode): Topic => {
    const t = createTopic((o.attrs.text ?? o.attrs.title ?? '').trim() || 'Konu', childrenNamed(o, 'outline').map(convert));
    const note = o.attrs._note?.trim();
    if (note) t.note = note;
    return t;
  };
  const tops = body ? childrenNamed(body, 'outline').map(convert) : [];
  const main = tops.length === 1 ? tops[0] : createTopic(title, tops);
  return emptyMap(main);
}

export function emptyMap(main: Topic, roots: Topic[] = [main]): MindMap {
  return {
    format: 'keizu/1',
    id: newId('m'),
    title: main.text,
    version: 0,
    updatedAt: new Date().toISOString(),
    theme: 'fresh',
    layout: 'mindmap',
    branchStyle: 'curve',
    multicolor: true,
    roots,
    relations: [],
  };
}

function trimNotes(t: Topic) {
  if (t.note !== undefined) {
    const n = t.note.replace(/^\n+|\n+$/g, '');
    if (n.trim()) t.note = n;
    else delete t.note;
  }
  t.children.forEach(trimNotes);
}

/** Parses a heading plus nested "-" / "*" / "1." list back into a map. */
export function fromMarkdown(text: string, fallbackTitle = 'İçe aktarılan'): MindMap {
  const lines = text.split(/\r?\n/);
  const main = createTopic(fallbackTitle);
  const roots: Topic[] = [main];
  let mainNamed = false;
  let stack: { indent: number; topic: Topic }[] = [{ indent: -1, topic: main }];
  // "> " lines are the note of the topic just above them.
  let noteFor: Topic | undefined;
  for (const raw of lines) {
    const q = /^\s*>\s?(.*)$/.exec(raw);
    if (q) {
      const target = noteFor ?? stack[stack.length - 1].topic;
      target.note = target.note === undefined ? q[1] : `${target.note}\n${q[1]}`;
      noteFor = target;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (h) {
      const title = h[2].trim();
      if (!mainNamed && main.children.length === 0) {
        main.text = title;
        mainNamed = true;
        noteFor = main;
        continue;
      }
      // Later headings become free-floating topics.
      const floating = createTopic(title);
      roots.push(floating);
      stack = [{ indent: -1, topic: floating }];
      noteFor = floating;
      continue;
    }
    const m = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    if (!m) {
      // Any other text ends the note.
      if (raw.trim() && noteFor) noteFor = undefined;
      continue;
    }
    const indent = m[1].replace(/\t/g, '  ').length;
    const topic = createTopic(m[2].trim());
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    stack[stack.length - 1].topic.children.push(topic);
    stack.push({ indent, topic });
    noteFor = topic;
  }
  for (const r of roots) trimNotes(r);
  return emptyMap(main, roots);
}
