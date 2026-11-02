// The outline (ana hat) view: the same map as an indented list. Only the
// rows on screen are rendered, so it stays smooth with 10,000 topics.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { outlineRows } from '../core/outline';
import { countTopics, type MindMap } from '../core/model';
import { t } from '../i18n';
import * as I from './Icons';

const ROW_H = 30;
const INDENT = 22;
const OVERSCAN = 10;

interface Props {
  map: MindMap;
  selectedId: string | null;
  editingId: string | null;
  editSeed: string | null;
  /** Branch colours by topic id, so rows match the map. */
  colorOf(id: string): string;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onCommitEdit(id: string, text: string): void;
  onCancelEdit(): void;
  onToggleCollapse(id: string): void;
}

export function OutlineView(props: Props) {
  const { map, selectedId, editingId } = props;
  const rows = useMemo(() => outlineRows(map), [map]);
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Keep the selected row on screen.
  const selectedIndex = useMemo(() => rows.findIndex((r) => r.topic.id === selectedId), [rows, selectedId]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || selectedIndex < 0) return;
    const top = selectedIndex * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top - ROW_H;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H * 2 - el.clientHeight;
  }, [selectedIndex]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN);

  return (
    <div className="outline" ref={scroller} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} role="tree" aria-label={t('outline.label', { title: map.title })}>
      <div className="outline-inner" style={{ height: rows.length * ROW_H }}>
        {rows.slice(first, last).map((r, i) => {
          const tp = r.topic;
          const index = first + i;
          const hasKids = tp.children.length > 0;
          // The central topic can't be collapsed (same as on the map).
          const canToggle = hasKids && !(r.root === 0 && r.depth === 0);
          const selected = tp.id === selectedId;
          const firstLine = tp.text.split('\n')[0] || ' ';
          const multi = tp.text.includes('\n');
          return (
            <div
              key={tp.id}
              className={`o-row ${selected ? 'on' : ''} ${r.depth === 0 ? 'o-root' : ''}`}
              style={{ top: index * ROW_H, paddingLeft: 12 + r.depth * INDENT }}
              role="treeitem"
              aria-level={r.depth + 1}
              aria-selected={selected}
              aria-expanded={hasKids ? !tp.collapsed : undefined}
              onPointerDown={(e) => {
                if (e.button !== 0 || (e.target as Element).closest('.o-toggle, textarea')) return;
                props.onSelect(tp.id);
              }}
              onDoubleClick={(e) => !(e.target as Element).closest('.o-toggle') && props.onStartEdit(tp.id)}
            >
              {canToggle ? (
                <button
                  className="o-toggle"
                  tabIndex={-1}
                  aria-label={tp.collapsed ? t('outline.expand') : t('outline.collapse')}
                  onClick={() => props.onToggleCollapse(tp.id)}
                >
                  <span className={`o-chev ${tp.collapsed ? '' : 'open'}`}><I.Chevron size={14} /></span>
                </button>
              ) : (
                <span className="o-toggle" aria-hidden="true" />
              )}
              <span className="o-dot" style={{ background: props.colorOf(tp.id) }} aria-hidden="true" />
              <span className="o-text">
                {firstLine}
                {multi && <span className="o-more"> …</span>}
              </span>
              {tp.note && <span className="o-badge" title={t('outline.hasNote')}><I.NoteIcon size={13} /></span>}
              {tp.collapsed && hasKids && <span className="o-badge count">{countTopics(tp) - 1}</span>}
              {tp.id === editingId && (
                <OutlineEdit
                  key={tp.id}
                  initial={props.editSeed ?? tp.text}
                  replace={props.editSeed !== null}
                  left={12 + r.depth * INDENT + 34}
                  onCommit={(text) => props.onCommitEdit(tp.id, text)}
                  onCancel={props.onCancelEdit}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OutlineEdit({ initial, replace, left, onCommit, onCancel }: { initial: string; replace: boolean; left: number; onCommit(text: string): void; onCancel(): void }) {
  const [value, setValue] = useState(initial);
  const ta = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    const el = ta.current!;
    el.focus();
    el.setSelectionRange(replace ? el.value.length : 0, el.value.length);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(value);
    else onCancel();
  };
  return (
    <textarea
      ref={ta}
      className="o-edit"
      aria-label={t('edit.topicText')}
      value={value}
      rows={Math.max(1, value.split('\n').length)}
      spellCheck={false}
      style={{ left }}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
    />
  );
}
