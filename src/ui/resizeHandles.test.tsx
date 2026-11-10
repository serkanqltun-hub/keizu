import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { approxMeasure, layoutMap } from '../core/layout';
import { addChild, createMap, setTopicWidth } from '../core/model';
import { getTheme } from '../core/themes';
import { MapSvg } from './MapSvg';

describe('width grips', () => {
  const base = createMap('Tutamak', 'Ana');
  const r = addChild(base, base.roots[0].id, 'Konu');
  const draw = (map = r.map, opts: { resizable?: boolean; theme?: string; selectedIds?: Set<string> } = {}) =>
    renderToStaticMarkup(
      <svg>
        <MapSvg map={map} layout={layoutMap(map, approxMeasure)} theme={getTheme(opts.theme ?? map.theme)} selectedId={r.id} selectedIds={opts.selectedIds} resizable={opts.resizable} />
      </svg>,
    );

  it('shows a grip on each side of the selected topic only when resizing is allowed', () => {
    const html = draw(r.map, { resizable: true });
    expect(html.match(/data-resize="/g)).toHaveLength(2);
    expect(html).toContain('ew-resize');
    expect(draw(r.map, { resizable: false })).not.toContain('data-resize=');
  });

  it('works in classic and signature themes, filled once a width is set', () => {
    for (const theme of ['imza', 'imzaNight', 'fresh', 'night']) {
      expect(draw(r.map, { resizable: true, theme }).match(/data-resize="/g), theme).toHaveLength(2);
    }
    const fixed = setTopicWidth(r.map, r.id, 240);
    expect(draw(fixed, { resizable: true })).not.toBe(draw(r.map, { resizable: true }));
  });
});
