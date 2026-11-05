// Starter content for each diagram type, so a new timeline looks like a
// timeline rather than a mind map with a different setting.

import { createMap, createTopic, newId, type LayoutKind, type MindMap, type Topic } from './model';

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
  flowStart: string;
  flowPath: string;
  flowStep: string;
  flowMeet: string;
  flowEnd: string;
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
    case 'flow': {
      // Three paths out of the start that meet again before the end.
      const end = createTopic(l.flowEnd);
      const meet = createTopic(l.flowMeet, [end]);
      const p1 = createTopic(`${l.flowPath} 1`, [createTopic(`${l.flowStep} 1.1`, [meet])]);
      const s21 = createTopic(`${l.flowStep} 2.1`);
      const s22 = createTopic(`${l.flowStep} 2.2`);
      s21.children = [s22];
      const p2 = createTopic(`${l.flowPath} 2`, [s21]);
      const p3 = createTopic(`${l.flowPath} 3`);
      const map = withRoot(l.flowStart, [p1, p2, p3]);
      map.relations = [
        { id: newId('r'), from: s22.id, to: meet.id, kind: 'flow' },
        { id: newId('r'), from: p3.id, to: meet.id, kind: 'flow' },
      ];
      map.branchStyle = 'elbow';
      return map;
    }
    default:
      return { ...base, layout };
  }
}
