// Large-map performance: 10,000+ topics must lay out, cull and render
// quickly. The budgets are generous so slow CI machines still pass; the
// timings are printed so regressions are easy to spot.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { approxMeasure, layoutMap } from '../core/layout';
import { addChild, countAll, createMap, type MindMap, type Topic } from '../core/model';
import { outlineRows } from '../core/outline';
import { searchMap } from '../core/search';
import { getTheme } from '../core/themes';
import { snappedViewport, visibleIn } from '../core/viewport';
import { MapSvg } from './MapSvg';

/** 10 main topics × 10 × 10 × 10 = 11,110 topics plus the centre. */
function bigMap(): MindMap {
  let n = 0;
  const make = (depth: number): Topic[] =>
    depth === 0 ? [] : Array.from({ length: 10 }, () => ({ id: `t${n++}`, text: `Konu ${n} örnek metin`, children: make(depth - 1) }));
  const m = createMap('Büyük harita');
  return { ...m, roots: [{ ...m.roots[0], children: make(4) }] };
}

function time<T>(label: string, fn: () => T): { value: T; ms: number } {
  const t0 = performance.now();
  const value = fn();
  const ms = performance.now() - t0;
  console.log(`  ${label}: ${ms.toFixed(1)} ms`);
  return { value, ms };
}

describe('10,000-topic map', () => {
  const map = bigMap();

  it('has more than 10,000 topics', () => {
    expect(countAll(map)).toBeGreaterThan(10000);
  });

  it('lays out fast', () => {
    layoutMap(map, approxMeasure); // warm-up
    const { value: l, ms } = time('layout', () => layoutMap(map, approxMeasure));
    expect(l.nodes.length).toBe(countAll(map));
    expect(ms).toBeLessThan(1000);
  });

  it('re-lays out quickly after a single edit', () => {
    const l0 = layoutMap(map, approxMeasure);
    const edited = addChild(map, 't5', 'Yeni').map;
    const { ms } = time('edit + layout', () => layoutMap(edited, approxMeasure));
    expect(ms).toBeLessThan(1000);
    expect(l0.nodes.length).toBeLessThan(countAll(edited));
  });

  it('draws only what is on screen', () => {
    const l = layoutMap(map, approxMeasure);
    const theme = getTheme(map.theme);
    // A 1440×900 window at 100% zoom, centred on the central topic.
    const vp = snappedViewport({ x: 720, y: 450, k: 1 }, 1440, 900);
    const { value: vis } = time('cull', () => visibleIn(l, vp));
    expect(vis.nodes.length).toBeLessThan(600);
    const { value: html, ms } = time('render visible', () => renderToStaticMarkup(<MapSvg map={map} layout={l} theme={theme} viewport={vp} />));
    expect((html.match(/data-topic-id/g) ?? []).length).toBe(vis.nodes.length);
    expect(ms).toBeLessThan(500);
  });

  it('draws the whole map as a few paths when zoomed far out', () => {
    const l = layoutMap(map, approxMeasure);
    const theme = getTheme(map.theme);
    const { value: html, ms } = time('render simplified', () => renderToStaticMarkup(<MapSvg map={map} layout={l} theme={theme} simple />));
    expect((html.match(/<path/g) ?? []).length).toBeLessThan(40);
    expect(ms).toBeLessThan(1000);
  });

  it('searches and builds the outline fast', () => {
    const { value: hits, ms } = time('search', () => searchMap(map, 'konu 9999'));
    expect(hits.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(300);
    const { value: rows, ms: ms2 } = time('outline rows', () => outlineRows(map));
    expect(rows).toHaveLength(countAll(map));
    expect(ms2).toBeLessThan(200);
  });
});
