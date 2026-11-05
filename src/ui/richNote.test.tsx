import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { approxMeasure, layoutMap } from '../core/layout';
import { addChild, createMap, setMapProps, updateStyle, updateTopic } from '../core/model';
import { getTheme } from '../core/themes';
import { MapSvg } from './MapSvg';
import { RichNote } from './RichNote';

const NOTE = '## Plan\n**kalın** [site](https://a.b)\n- [x] bitti\n- [ ] kaldı';

function sample() {
  const base = createMap('H', 'Ana');
  const r = addChild(base, base.roots[0].id, 'Konu');
  return { map: updateTopic(r.map, r.id, { note: NOTE }), id: r.id };
}

describe('rich notes on screen and in exports', () => {
  it('draws a shown note formatted in the map SVG (used by SVG/PNG/PDF export)', () => {
    const { map, id } = sample();
    const shown = updateStyle(map, id, { showNote: true });
    const html = renderToStaticMarkup(<MapSvg map={shown} layout={layoutMap(shown, approxMeasure)} theme={getTheme(shown.theme)} />);
    expect(html).toContain('data-note-check="2"');
    expect(html).toContain('data-note-href="https://a.b"');
    expect(html).toMatch(/font:700 [^"]*">kalın</);
    expect(html).not.toContain('**');
  });

  it('draws notes formatted in notebook mode too', () => {
    const { map } = sample();
    const nb = setMapProps(map, { notebook: true });
    const html = renderToStaticMarkup(<MapSvg map={nb} layout={layoutMap(nb, approxMeasure)} theme={getTheme(nb.theme)} />);
    expect(html).toContain('data-note-check="3"');
  });

  it('renders the note card / presentation view as HTML', () => {
    const html = renderToStaticMarkup(<RichNote md={NOTE} />);
    expect(html).toContain('<h4');
    expect(html).toContain('<strong>kalın</strong>');
    expect(html).toContain('href="https://a.b"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
  });
});
