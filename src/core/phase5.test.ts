import { describe, expect, it } from 'vitest';
import { approxMeasure, edgeShape, layoutMap } from './layout';
import { mapLink, parseMapLink } from './links';
import { LAYOUT_KINDS, createMap, createTopic, setBranchLayout, type MindMap } from './model';
import { expandAll, presentationSteps } from './present';
import { templateMap, type TemplateLabels } from './templates';

const labels: TemplateLabels = {
  central: 'C', main: 'M', concept: 'K', conceptLink: 'has', timeline: 'T', event: 'E', detail: 'D',
  fishbone: 'F', cause: 'N', subcause: 'S', matrix: 'X', column: 'Col', cell: 'Cell',
};

function overlaps(m: MindMap): string[] {
  const l = layoutMap(m, approxMeasure);
  const out: string[] = [];
  for (let i = 0; i < l.nodes.length; i++)
    for (let j = i + 1; j < l.nodes.length; j++) {
      const a = l.nodes[i], b = l.nodes[j];
      // Matrix cells share borders on purpose: allow a pixel.
      if (Math.abs(a.x - b.x) * 2 < a.w + b.w - 2 && Math.abs(a.y - b.y) * 2 < a.h + b.h - 2) out.push(`${a.topic.text}/${b.topic.text}`);
    }
  return out;
}

describe('new diagram types', () => {
  it('every layout lays out its template without overlaps', () => {
    for (const kind of LAYOUT_KINDS) {
      const m = templateMap(kind, labels);
      expect(m.layout).toBe(kind);
      expect(overlaps(m), kind).toEqual([]);
    }
  });

  it('timeline puts events on one axis, left to right', () => {
    const m = templateMap('timeline', labels);
    const l = layoutMap(m, approxMeasure);
    const events = m.roots[0].children.map((c) => l.byId.get(c.id)!);
    expect(new Set(events.map((e) => e.y)).size).toBe(1);
    for (let i = 1; i < events.length; i++) expect(events[i].x).toBeGreaterThan(events[i - 1].x);
    // Details alternate below and above the axis.
    const d0 = l.byId.get(m.roots[0].children[0].children[0].id)!;
    const d1 = l.byId.get(m.roots[0].children[1].children[0].id)!;
    expect(d0.y).toBeGreaterThan(0);
    expect(d1.y).toBeLessThan(0);
  });

  it('fishbone bones sit left of the head, above and below the spine', () => {
    const m = templateMap('fishbone', labels);
    const l = layoutMap(m, approxMeasure);
    const head = l.byId.get(m.roots[0].id)!;
    const bones = m.roots[0].children.map((c) => l.byId.get(c.id)!);
    for (const b of bones) expect(b.x).toBeLessThan(head.x);
    expect(bones[0].y).toBeLessThan(0);
    expect(bones[1].y).toBeGreaterThan(0);
    expect(edgeShape(head, bones[0], 'curve').d).toMatch(/^M.*H.*L/);
  });

  it('matrix aligns cells into rows and columns without connectors', () => {
    const m = templateMap('matrix', labels);
    const l = layoutMap(m, approxMeasure);
    const cols = m.roots[0].children;
    const rowY = (r: number) => cols.map((c) => l.byId.get(c.children[r].id)!.y);
    for (let r = 0; r < 3; r++) expect(new Set(rowY(r)).size).toBe(1);
    const colW = l.byId.get(cols[0].id)!.w;
    expect(l.byId.get(cols[0].children[1].id)!.w).toBe(colW);
    expect(l.byId.get(cols[0].children[0].id)!.noEdge).toBe(true);
    expect(edgeShape(l.byId.get(cols[0].id)!, l.byId.get(cols[0].children[0].id)!, 'curve').d).toBe('');
  });

  it('concept map draws straight connectors with room for words', () => {
    const m = templateMap('concept', labels);
    const l = layoutMap(m, approxMeasure);
    const root = l.byId.get(m.roots[0].id)!;
    const c = l.byId.get(m.roots[0].children[0].id)!;
    expect(c.topic.linkLabel).toBe('has');
    expect(c.y - root.y).toBeGreaterThan(90);
    expect(edgeShape(root, c, 'curve').d).toContain('L');
  });

  it('a single branch can use a new layout', () => {
    const m0 = createMap();
    const branch = m0.roots[0].children[0].id;
    const m = setBranchLayout(
      { ...m0, roots: [{ ...m0.roots[0], children: [{ ...m0.roots[0].children[0], children: [createTopic('a'), createTopic('b')] }, ...m0.roots[0].children.slice(1)] }] },
      branch,
      'timeline',
    );
    const l = layoutMap(m, approxMeasure);
    expect(l.byId.get(branch)!.flow).toBe('timeline');
    expect(overlaps(m)).toEqual([]);
  });
});

describe('map links', () => {
  it('round-trips', () => {
    expect(parseMapLink(mapLink('m_1', 't_2'))).toEqual({ mapId: 'm_1', topicId: 't_2' });
    expect(parseMapLink(mapLink('m_1'))).toEqual({ mapId: 'm_1', topicId: undefined });
    expect(parseMapLink('https://example.com')).toBeUndefined();
  });
});

describe('presentation', () => {
  it('walks every topic depth first, collapsed ones included', () => {
    const m = createMap();
    const first = m.roots[0].children[0];
    const withKids: MindMap = {
      ...m,
      roots: [{ ...m.roots[0], children: [{ ...first, collapsed: true, children: [createTopic('x')] }, ...m.roots[0].children.slice(1)] }],
    };
    const steps = presentationSteps(expandAll(withKids));
    expect(steps[0]).toBe(m.roots[0].id);
    expect(steps[1]).toBe(first.id);
    expect(steps).toHaveLength(6);
  });
});
