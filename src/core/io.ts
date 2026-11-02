// Import / export of formats that don't need a browser.

import { createTopic, isMindMap, newId, normalizeMap, type MindMap, type Topic } from './model';

export function toJSON(map: MindMap): string {
  return JSON.stringify(map, null, 2);
}

export function fromJSON(text: string): MindMap {
  const data = JSON.parse(text);
  if (!isMindMap(data)) throw new Error('Bu dosya bir Keizu haritası değil.');
  return normalizeMap(data);
}

/** Central topic as a heading, everything else as a nested list. */
export function toMarkdown(map: MindMap): string {
  const out: string[] = [`# ${map.roots[0].text.replace(/\n/g, ' ')}`, ''];
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
    r.children.forEach((c) => walk(c, 0));
  }
  return out.join('\n') + '\n';
}

/** Parses a heading plus nested "-" / "*" / "1." list back into a map. */
export function fromMarkdown(text: string, fallbackTitle = 'İçe aktarılan'): MindMap {
  const lines = text.split(/\r?\n/);
  const main = createTopic(fallbackTitle);
  const roots: Topic[] = [main];
  let mainNamed = false;
  let stack: { indent: number; topic: Topic }[] = [{ indent: -1, topic: main }];
  for (const raw of lines) {
    const h = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (h) {
      const title = h[2].trim();
      if (!mainNamed && main.children.length === 0) {
        main.text = title;
        mainNamed = true;
        continue;
      }
      // Later headings become free-floating topics.
      const floating = createTopic(title);
      roots.push(floating);
      stack = [{ indent: -1, topic: floating }];
      continue;
    }
    const m = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    if (!m) continue;
    const indent = m[1].replace(/\t/g, '  ').length;
    const topic = createTopic(m[2].trim());
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    stack[stack.length - 1].topic.children.push(topic);
    stack.push({ indent, topic });
  }
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
