import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createMap, findTopic, pasteFloating, type Topic } from '../core/model';
import { ContextMenu, tidy, type CtxItem } from './ContextMenu';
import { getKeymap, commandFor } from './keymap';

const item = (id: string, extra: Partial<Extract<CtxItem, { type: 'item' }>> = {}): CtxItem => ({ type: 'item', id, label: id, run() {}, ...extra });
const sep: CtxItem = { type: 'sep' };

describe('context menu', () => {
  it('drops hidden items and stray separators', () => {
    const out = tidy([sep, item('a'), false, sep, sep, undefined, item('b'), sep, null, '', sep]);
    expect(out.map((i) => (i.type === 'sep' ? '-' : i.id))).toEqual(['a', '-', 'b']);
  });

  it('renders items, shortcuts, submenus and swatches', () => {
    const html = renderToStaticMarkup(
      <ContextMenu
        x={10}
        y={10}
        label="Konu menüsü"
        onClose={() => {}}
        items={[
          item('copy', { label: 'Kopyala', keys: 'Ctrl+C' }),
          item('remove', { label: 'Sil', danger: true }),
          item('paste', { label: 'Yapıştır', disabled: true }),
          sep,
          { type: 'sub', id: 'shape', label: 'Şekil', items: [item('pill', { checked: true })] },
          { type: 'swatches', id: 'color', label: 'Renk', colors: [{ value: undefined, label: 'Otomatik', on: true }, { value: '#FFFFFF', label: 'Beyaz', on: false }], pick() {} },
        ]}
      />,
    );
    expect(html).toContain('role="menu"');
    expect(html).toContain('aria-label="Konu menüsü"');
    expect(html).toContain('Ctrl+C');
    expect(html).toContain('ctx-item  danger');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('role="separator"');
    expect(html).toMatch(/menuitemradio[^>]*aria-checked="true"[^>]*aria-label="Otomatik"/);
  });

  it('opens from the keyboard with Shift+F10 and the menu key', () => {
    expect(commandFor(getKeymap(), 'Shift+F10', false)).toBe('contextMenu');
    expect(commandFor(getKeymap(), 'ContextMenu', false)).toBe('contextMenu');
  });

  it('pastes a copy as a floating topic where the menu was opened', () => {
    const m = createMap();
    const src: Topic = { id: 'x', text: 'Kopya', children: [{ id: 'y', text: 'Alt', children: [] }] };
    const r = pasteFloating(m, { x: 300, y: -40 }, src);
    expect(r.map.roots).toHaveLength(2);
    const pasted = findTopic(r.map, r.id)!;
    expect(pasted.pos).toEqual({ x: 300, y: -40 });
    expect(pasted.id).not.toBe('x');
    expect(pasted.children[0].id).not.toBe('y');
    expect(pasted.children[0].text).toBe('Alt');
  });
});
