// Presentation order: the main topic, then every branch depth first, then
// the floating topics the same way. Each step shows one topic with its
// children.

import type { MindMap, Topic } from './model';

export function presentationSteps(map: MindMap): string[] {
  const out: string[] = [];
  const walk = (t: Topic) => {
    out.push(t.id);
    t.children.forEach(walk);
  };
  map.roots.forEach(walk);
  return out;
}

/** The map with every branch expanded, so a presentation can reach all of it. */
export function expandAll(map: MindMap): MindMap {
  const open = (t: Topic): Topic => ({ ...t, collapsed: undefined, children: t.children.map(open) });
  return { ...map, roots: map.roots.map(open) };
}
