import { describe, expect, it } from 'vitest';
import { approxMeasure, layoutMap } from '../core/layout';
import { addChild, createMap, toggleCollapse } from '../core/model';
import { cubicBezier, easeStandard, isMouseWheel, wheelZoomFactor } from './motion';
import { frameAt, planLayoutMotion } from './useLayoutMotion';

describe('wheel', () => {
  it('tells a mouse wheel from a touchpad', () => {
    expect(isMouseWheel({ deltaMode: 1, deltaX: 0, deltaY: 3 })).toBe(true); // Firefox: lines
    expect(isMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: 100, wheelDeltaY: -120 })).toBe(true); // Chrome notch
    expect(isMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: 4.5, wheelDeltaY: -13 })).toBe(false); // touchpad
    expect(isMouseWheel({ deltaMode: 0, deltaX: 2, deltaY: 30 })).toBe(false); // two-axis scroll
    expect(isMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: 100 })).toBe(true);
  });
  it('zooms in on wheel up and out on wheel down, about 20% a notch', () => {
    const up = wheelZoomFactor({ deltaMode: 0, deltaY: -100, ctrlKey: false });
    const down = wheelZoomFactor({ deltaMode: 0, deltaY: 100, ctrlKey: false });
    expect(up).toBeGreaterThan(1.15);
    expect(up).toBeLessThan(1.25);
    expect(up * down).toBeCloseTo(1);
    expect(wheelZoomFactor({ deltaMode: 1, deltaY: 3, ctrlKey: false })).toBeLessThan(1);
  });
});

describe('easing', () => {
  it('starts at 0, ends at 1 and moves fast early', () => {
    expect(easeStandard(0)).toBe(0);
    expect(easeStandard(1)).toBe(1);
    expect(easeStandard(0.3)).toBeGreaterThan(0.6);
    expect(cubicBezier(0, 0, 1, 1)(0.5)).toBeCloseTo(0.5, 3);
  });
});

describe('layout motion', () => {
  it('grows a new topic out of its parent and fades it in', () => {
    const m = createMap('Harita', 'Dal');
    const a = layoutMap(m, approxMeasure);
    const branch = m.roots[0].children[0].id;
    const r = addChild(m, branch, 'Yeni');
    const b = layoutMap(r.map, approxMeasure);
    const plan = planLayoutMotion(a, b)!;
    expect(plan).not.toBeNull();
    const start = frameAt(b, plan, 0);
    const born = start.layout.byId.get(r.id)!;
    expect(born.x).toBe(a.byId.get(branch)!.x);
    expect(start.fade!.get(r.id)).toBe(0);
    const end = frameAt(b, plan, 1);
    expect(end.layout.byId.get(r.id)!.x).toBe(b.byId.get(r.id)!.x);
    expect(end.fade!.get(r.id)).toBe(1);
  });
  it('slides collapsed topics into their parent and fades them out', () => {
    let m = createMap('Harita', 'Dal');
    const branch = m.roots[0].children[0].id;
    const r = addChild(m, branch, 'Alt');
    m = r.map;
    const a = layoutMap(m, approxMeasure);
    const b = layoutMap(toggleCollapse(m, branch), approxMeasure);
    const plan = planLayoutMotion(a, b)!;
    const end = frameAt(b, plan, 1);
    expect(end.layout.byId.get(r.id)!.x).toBe(b.byId.get(branch)!.x);
    expect(end.fade!.get(r.id)).toBe(0);
  });
  it('does nothing when nothing moved', () => {
    const m = createMap('Harita');
    const a = layoutMap(m, approxMeasure);
    expect(planLayoutMotion(a, layoutMap(m, approxMeasure))).toBeNull();
  });
});
