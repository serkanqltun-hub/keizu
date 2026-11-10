// A large window in the middle of the screen for reading and writing a
// topic's note. Notes are Markdown: the window shows them formatted, and
// editing shows the Markdown with a formatting bar next to a live preview.
// The draft is saved when the window closes, so one note edit is one undo step.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Topic } from '../core/model';
import { toggleTask } from '../core/richText';
import { t } from '../i18n';
import * as I from './Icons';
import { NoteEditor, RichNote } from './RichNote';

export interface NoteSave {
  note: string;
  showNote: boolean;
}

interface Props {
  topic: Topic;
  readOnly?: boolean;
  /** Open straight in the editor (F4, toolbar); otherwise a note opens formatted. */
  edit?: boolean;
  onSave(save: NoteSave): void;
  onClose(): void;
  /** Render in place instead of on top of the page (tests). */
  inline?: boolean;
}

export function NoteDialog({ topic, readOnly, edit, onSave, onClose, inline }: Props) {
  const [note, setNote] = useState(topic.note ?? '');
  const [showNote, setShowNote] = useState(!!topic.style?.showNote);
  const [editing, setEditing] = useState(!readOnly && (!!edit || !note.trim()));
  const ta = useRef<HTMLTextAreaElement>(null);
  const win = useRef<HTMLDivElement>(null);

  // Save whatever is in the window when it goes away (closed, other topic picked).
  const latest = useRef({ note, showNote, onSave });
  latest.current = { note, showNote, onSave };
  useEffect(
    () => () => {
      if (!readOnly) latest.current.onSave({ note: latest.current.note, showNote: latest.current.showNote });
    },
    [readOnly],
  );

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) {
      // Formatted view: focus the window so Esc and Enter work.
      win.current?.focus();
      return;
    }
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const title = topic.text.split('\n')[0] || t('note.untitled');
  const preview = note.trim() ? (
    <RichNote md={note} onToggle={readOnly ? undefined : (line) => setNote((n) => toggleTask(n, line))} />
  ) : (
    <span className="muted">{t('note.empty')}</span>
  );

  const dialog = (
    <div
      className="dialog-backdrop note-backdrop"
      // Clicking outside the window closes it (and saves).
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      // The window sits in the map's React tree: keep its events off the map.
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        ref={win}
        className={`note-dialog${editing ? ' editing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('note.dialog', { topic: title })}
        tabIndex={-1}
        onKeyDown={(e) => {
          // Keep the editor's shortcuts out of the window.
          e.stopPropagation();
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
            e.preventDefault();
            onClose();
          } else if (!editing && !readOnly && (e.key === 'Enter' || e.key === 'F2') && e.target === win.current) {
            e.preventDefault();
            setEditing(true);
          }
        }}
      >
        <div className="note-dialog-head">
          <I.NoteIcon size={17} />
          <span className="note-dialog-title" title={title}>{title}</span>
          {!readOnly && !!note.trim() && (
            <button
              className={`ib note-pop-mode${editing ? ' on' : ''}`}
              aria-pressed={editing}
              title={editing ? t('note.previewTip') : t('note.editTip')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setEditing(!editing)}
            >
              {editing ? t('note.preview') : t('note.edit')}
            </button>
          )}
          <button className="ib" aria-label={t('note.close')} title={t('note.closeTip')} onClick={onClose}>✕</button>
        </div>
        {editing && !readOnly ? (
          <div className="note-dialog-body split">
            <NoteEditor
              ref={ta}
              ariaLabel={t('panel.note')}
              placeholder={t('panel.notePlaceholder')}
              value={note}
              onChange={setNote}
            />
            <div className="note-dialog-preview" aria-label={t('note.preview')}>
              {preview}
            </div>
          </div>
        ) : (
          <div
            className="note-dialog-body note-dialog-read"
            onClick={(e) => {
              // Clicking the text (not a link or checkbox) starts editing.
              if (readOnly || (e.target as Element).closest('a, input')) return;
              setEditing(true);
            }}
          >
            {preview}
          </div>
        )}
        {!readOnly && (
          <div className="note-pop-foot note-dialog-foot">
            <label className="check">
              <input type="checkbox" checked={showNote} disabled={!note.trim()} onChange={(e) => setShowNote(e.target.checked)} />
              <span>{t('note.showInTopic')}</span>
            </label>
            {note && (
              <button
                className="note-pop-clear"
                onClick={() => {
                  setNote('');
                  setShowNote(false);
                  setEditing(true);
                }}
              >
                {t('note.clear')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
  return inline || typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}
