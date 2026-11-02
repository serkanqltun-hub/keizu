// Starter content for each diagram type, so a new timeline looks like a
// timeline rather than a mind map with a different setting.

import { createMap, createTopic, type LayoutKind, type MindMap, type Topic } from './model';

export interface TemplateLabels {
  central: string;
  main: string;
  concept: string;
  conceptLink: string;
  timeline: string;
  event: string;
  detail: string;
  fishbone: string;
  cause: string;
  subcause: string;
  matrix: string;
  column: string;
  cell: string;
}

const many = (n: number, make: (i: number) => Topic): Topic[] => Array.from({ length: n }, (_, i) => make(i + 1));

export function templateMap(layout: LayoutKind, l: TemplateLabels): MindMap {
  const base = createMap(l.central, l.main);
  const withRoot = (text: string, children: Topic[]): MindMap => ({ ...base, title: text, layout, roots: [createTopic(text, children)] });
  switch (layout) {
    case 'concept':
      return withRoot(
        l.concept,
        many(3, (i) => ({ ...createTopic(`${l.main} ${i}`, [createTopic(`${l.main} ${i}.1`)]), linkLabel: l.conceptLink })),
      );
    case 'timeline':
      return withRoot(l.timeline, many(4, (i) => createTopic(`${l.event} ${i}`, [createTopic(l.detail)])));
    case 'fishbone':
      return withRoot(l.fishbone, many(4, (i) => createTopic(`${l.cause} ${i}`, many(2, () => createTopic(l.subcause)))));
    case 'matrix':
      return withRoot(l.matrix, many(3, (i) => createTopic(`${l.column} ${i}`, many(3, () => createTopic(l.cell)))));
    default:
      return { ...base, layout };
  }
}
