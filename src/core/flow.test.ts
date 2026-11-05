import { describe, expect, it } from 'vitest';
import { docFromMap, materialize } from './crdt';
import { layeredLayout } from './flow';
import { approxMeasure, flowEdgeShape, layoutMap } from './layout';
import { addChild, addFlowLink, createMap, findParent, findTopic, removeTopic, setMapProps, type MindMap } from './model';
import { templateMap, type TemplateLabels } from './templates';

const labels: TemplateLabels = {
  central: 'C', main: 'M', concept: 'K', conceptLink: 'has', timeline: 'T', event: 'E', detail: 'D',
  fishbone: 'F', cause: 'N', subcause: 'S', matrix: 'X', column: 'Col', cell: 'Cell',
  flowStart: 'Start', flowPath: 'Path', flowStep: 'Step', flowMeet: 'Meet', flowEnd: 'End',
};

const byText = (m: MindMap, text: string) => {
  const l = layoutMap(m, approxMeasure);
  return l.nodes.find((b) => b.topic.text === text)!;
};

/** Start → A, B; A → A1; then A1 and B both lead to End (merge). */
function diamond(): { map: MindMap; ids: Record<string, string> } {
  let map = setMapProps({ ...createMap('Start'), roots: [{ ...createMap('Start').roots[0], children: [] }] }, { layout: 'flow' });
  const root = map.roots[0].id;
  const ids: Record<string, string> = { root };
  for (const [name, parent] of [['A', 'root'], ['B', 'root'], ['A1', 'A'], ['End', 'A1']] as const) {
    const r = addChild(map, ids[parent], name);
    map = r.map;
    ids[name] = r.id;
  }
  map = addFlowLink(map, ids.B, ids.End).map;
  return { map, ids };
}

describe('flow chart layout', () => {
  it('puts a step where paths meet after every path that leads to it', () => {
    const m = templateMap('flow', labels);
    const meet = byText(m, 'Meet');
    for (const t of ['Step 1.1', 'Step 2.2', 'Path 3']) expect(byText(m, t).x).toBeLessThan(meet.x);
    expect(byText(m, 'End').x).toBeGreaterThan(meet.x);
    expect(byText(m, 'Start').x).toBeLessThan(byText(m, 'Path 1').x);
  });

  it('draws one arrow per tree connector and flow link', () => {
    const m = templateMap('flow', labels);
    const l = layoutMap(m, approxMeasure);
    expect(l.flowEdges.length).toBe(l.nodes.length - 1 + m.relations.length);
    for (const fe of l.flowEdges) {
      const s = flowEdgeShape(fe, l.byId)!;
      expect(s.d).toMatch(/^M/);
      // The arrow ends at the left side of its target.
      const to = l.byId.get(fe.to)!;
      expect(s.head).toContain(`M${to.x - to.w / 2} ${to.y}`);
    }
  });

  it('keeps steps in a column apart', () => {
    const { map } = diamond();
    const l = layoutMap(map, approxMeasure);
    for (const a of l.nodes)
      for (const b of l.nodes)
        if (a !== b && a.x === b.x) expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual((a.h + b.h) / 2);
  });

  it('turns a loop back to an earlier step into a plain curve', () => {
    const r = layeredLayout(
      [{ id: 'a', w: 40, h: 20 }, { id: 'b', w: 40, h: 20 }, { id: 'c', w: 40, h: 20 }],
      [{ key: 't:b', from: 'a', to: 'b' }, { key: 't:c', from: 'b', to: 'c' }, { key: 'loop', from: 'c', to: 'a' }],
    );
    expect(r.back.has('loop')).toBe(true);
    expect(r.pos.get('a')!.x).toBeLessThan(r.pos.get('b')!.x);
    expect(r.pos.get('b')!.x).toBeLessThan(r.pos.get('c')!.x);
  });

  it('routes long edges around the steps in between', () => {
    const r = layeredLayout(
      [{ id: 's', w: 40, h: 20 }, { id: 'x', w: 40, h: 20 }, { id: 'y', w: 40, h: 20 }, { id: 'e', w: 40, h: 20 }],
      [{ key: 't:x', from: 's', to: 'x' }, { key: 't:y', from: 'x', to: 'y' }, { key: 't:e', from: 'y', to: 'e' }, { key: 'skip', from: 's', to: 'e' }],
    );
    const route = r.routes.get('skip')!;
    expect(route.gaps.length).toBe(3);
    expect(route.lanes.length).toBe(2);
    // The lane through x's and y's columns clears those steps.
    expect(Math.abs(route.lanes[0] - r.pos.get('x')!.y)).toBeGreaterThanOrEqual(10);
  });

  it('a branch can be a flow chart inside another layout', () => {
    const { map, ids } = diamond();
    const m = { ...map, layout: 'logic' as const, roots: [{ ...map.roots[0], children: map.roots[0].children.map((c) => (c.id === ids.A ? { ...c, layout: 'flow' as const } : c)) }] };
    const l = layoutMap(m, approxMeasure);
    expect(l.byId.get(ids.A1)!.flow).toBe('flow');
    expect(l.byId.get(ids.B)!.flow).not.toBe('flow');
    // B's link into the flow chart is outside it, so it stays a plain relation.
    expect(l.flowEdges.every((fe) => !fe.relId)).toBe(true);
  });
});

describe('flow links', () => {
  it('adds a link once, and not to the step that already follows', () => {
    const { map, ids } = diamond();
    expect(addFlowLink(map, ids.B, ids.End).id).toBe('');
    expect(addFlowLink(map, ids.A1, ids.End).id).toBe('');
    const r = addFlowLink(map, ids.A, ids.End);
    expect(r.id).not.toBe('');
    expect(r.map.relations.at(-1)).toMatchObject({ from: ids.A, to: ids.End, kind: 'flow' });
  });

  it('removing a path keeps a step another path still reaches', () => {
    const { map, ids } = diamond();
    const next = removeTopic(map, ids.A).map;
    expect(findTopic(next, ids.A1)).toBeUndefined();
    expect(findTopic(next, ids.End)).toBeDefined();
    expect(findParent(next, ids.End)?.id).toBe(ids.B);
    expect(next.relations).toEqual([]);
  });

  it('removing the step itself removes it and its links', () => {
    const { map, ids } = diamond();
    const next = removeTopic(map, ids.End).map;
    expect(findTopic(next, ids.End)).toBeUndefined();
    expect(next.relations).toEqual([]);
  });

  it('survives live collaboration', () => {
    const { map } = diamond();
    const back = materialize(docFromMap(map));
    expect(back.relations[0].kind).toBe('flow');
  });
});
