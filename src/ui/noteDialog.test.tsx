import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { addChild, createMap, updateStyle, updateTopic } from '../core/model';
import { NoteDialog } from './NoteDialog';

function topicWith(note?: string, show = false) {
  const base = createMap('H', 'Ana');
  const r = addChild(base, base.roots[0].id, 'Proje planı\nikinci satır');
  let map = note === undefined ? r.map : updateTopic(r.map, r.id, { note });
  if (show) map = updateStyle(map, r.id, { showNote: true });
  const find = (ts: typeof map.roots): any => ts.map((t) => (t.id === r.id ? t : find(t.children ?? []))).find(Boolean);
  return find(map.roots);
}

const draw = (props: Partial<Parameters<typeof NoteDialog>[0]> & { topic: any }) =>
  renderToStaticMarkup(<NoteDialog inline onSave={() => {}} onClose={() => {}} {...props} />);

describe('note window', () => {
  it('opens as a centred modal window over the page, titled with the topic', () => {
    const html = draw({ topic: topicWith('**kalın** metin') });
    expect(html).toContain('class="dialog-backdrop note-backdrop"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('class="note-dialog-title" title="Proje planı"');
    expect(html).not.toContain('style="left');
  });

  it('shows a note formatted, with show-in-topic and delete options', () => {
    const html = draw({ topic: topicWith('**kalın** metin', true) });
    expect(html).toContain('note-dialog-read');
    expect(html).toContain('<strong>kalın</strong>');
    expect(html).not.toContain('<textarea');
    expect(html).toMatch(/type="checkbox" checked=""/);
    expect(html).toContain('note-pop-clear');
    expect(html).toContain('note-pop-mode');
  });

  it('edits with the Markdown editor next to a live preview', () => {
    const html = draw({ topic: topicWith('**kalın** metin'), edit: true });
    expect(html).toContain('note-dialog-body split');
    expect(html).toContain('<textarea');
    expect(html).toContain('note-fmt');
    expect(html).toContain('note-dialog-preview');
    expect(html).toContain('<strong>kalın</strong>');
  });

  it('starts in the editor when the topic has no note yet', () => {
    const html = draw({ topic: topicWith() });
    expect(html).toContain('<textarea');
    expect(html).not.toContain('note-pop-clear');
  });

  it('is read-only without editor or options when the map cannot be changed', () => {
    const html = draw({ topic: topicWith('metin'), readOnly: true, edit: true });
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('note-pop-clear');
    expect(html).not.toContain('note-pop-mode');
    expect(html).toContain('metin');
  });
});
