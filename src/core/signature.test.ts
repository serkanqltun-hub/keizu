import { describe, expect, it } from 'vitest';
import { approxMeasure, edgePath, layoutMap, LEAD_DOT } from './layout';
import { createMap, createTopic } from './model';
import { defaultThemeId, deepen, getTheme, tint } from './themes';

function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
function contrast(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe('signature theme', () => {
  it('is the default for new maps, with elbow connectors', () => {
    const m = createMap('Harita');
    expect(m.theme).toBe('imza');
    expect(m.branchStyle).toBe('elbow');
    expect(defaultThemeId(true)).toBe('imzaNight');
    expect(getTheme('imzaNight').signature).toBe(true);
  });

  it('boxes every topic and leaves room for the leading dot', () => {
    const m = createMap('Harita', 'Dal');
    m.roots[0].children[0].children.push(createTopic('Alt konu'));
    const sig = layoutMap(m, approxMeasure);
    const plain = layoutMap({ ...m, theme: 'fresh' }, approxMeasure);
    const id = m.roots[0].children[0].children[0].id;
    const a = sig.byId.get(id)!, b = plain.byId.get(id)!;
    expect(a.shape).toBe('rounded');
    expect(b.shape).toBe('underline');
    expect(a.lead).toBe(LEAD_DOT);
    expect(b.lead).toBe(0);
    expect(sig.byId.get(m.roots[0].id)!.lead).toBe(0);
  });

  it('keeps text readable on every branch tint and fill (4.5:1)', () => {
    for (const id of ['imza', 'imzaNight']) {
      const th = getTheme(id);
      for (const c of th.palette) {
        const soft = tint(c, th.dark, th.dark ? 0.2 : 0.12);
        expect(contrast(deepen(c, th.dark), soft)).toBeGreaterThanOrEqual(4.5);
        const onMain = th.dark ? '#14181E' : '#FFFFFF';
        expect(contrast(onMain, c)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('rounded elbows', () => {
  it('rounds both corners and keeps the end points', () => {
    const d = edgePath(false, 'elbow', { x: 0, y: 0 }, { x: 100, y: 60 });
    expect(d.startsWith('M0 0H40Q50 0 50 10V50Q50 60 60 60H100')).toBe(true);
  });
  it('stays a straight line when the ends are level', () => {
    expect(edgePath(false, 'elbow', { x: 0, y: 0 }, { x: 100, y: 0 })).toBe('M0 0H50V0H100');
  });
});
