// The outline (ana hat) view: the map's trees as one indented list.

import type { MindMap, Topic } from './model';

export interface OutlineRow {
  topic: Topic;
  depth: number;
  /** Index of the root this row belongs to (0 = main tree). */
  root: number;
  parentId?: string;
}

/** Rows in reading order; children of collapsed topics are left out. */
export function outlineRows(map: MindMap): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const walk = (t: Topic, depth: number, root: number, parentId?: string) => {
    rows.push({ topic: t, depth, root, parentId });
    if (t.collapsed) return;
    for (const c of t.children) walk(c, depth + 1, root, t.id);
  };
  map.roots.forEach((r, i) => walk(r, 0, i));
  return rows;
}
