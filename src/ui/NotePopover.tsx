// A card next to a topic on the canvas for reading and writing its note.
// The draft is saved when the card closes, so one note edit is one undo step.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NodeBox } from '../core/layout';
import { t } from '../i18n';
import * as I from './Icons';

export interface NoteSave {
  note: string;
  showNote: boolean;
}

interface Props {
  box: NodeBox;
  /** Canvas pan and zoom, to place the card next to the topic. */
  view: { x: number; y: number; k: number };
  /** Canvas size in pixels, to keep the card on screen. */
  size: { w: number; h: number };
  readOnly?: boolean;
  onSave(save: NoteSave): void;
  onClose(): void;
}

const CARD_W = 300;
const GAP = 10;

export function NotePopover({ box, view, size, readOnly, onSave, onClose }: Props) {
  const topic = box.topic;
  const [note, setNote] = useState(topic.note ?? '');
  const [showNote, setShowNote] = useState(!!topic.style?.showNote);
  const ta = useRef<HTMLTextAreaElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(220);

  // Save whatever is in the card when it goes away (closed, other topic picked).
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
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Grow the text field with its content, up to a limit.
  useLayoutEffect(() => {
    const el = ta.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(320, Math.max(96, el.scrollHeight + 2))}px`;
    }
    if (card.current) setCardH(card.current.offsetHeight);
  }, [note]);

  // Below the topic if it fits, otherwise above; always inside the canvas.
  const left = Math.max(8, Math.min(size.w - CARD_W - 8, view.x + (box.x - box.w / 2) * view.k));
  const below = view.y + (box.y + box.h / 2) * view.k + GAP;
  const above = view.y + (box.y - box.h / 2) * view.k - GAP - cardH;
  const top = below + cardH > size.h - 8 && above > 8 ? above : Math.max(8, Math.min(below, size.h - cardH - 8));

  const title = topic.text.split('\n')[0] || t('note.untitled');

  return (
    <div
      ref={card}
      className="note-pop"
      role="dialog"
      aria-label={t('note.dialog', { topic: title })}
      style={{ left, top, width: CARD_W }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Keep the editor's shortcuts out of the card.
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="note-pop-head">
        <I.NoteIcon size={15} />
        <span className="note-pop-title" title={title}>{title}</span>
        <button className="ib" aria-label={t('note.close')} title={t('note.closeTip')} onClick={onClose}>✕</button>
      </div>
      {readOnly ? (
        <div className="note-pop-read">{note || <span className="muted">{t('note.empty')}</span>}</div>
      ) : (
        <>
          <textarea
            ref={ta}
            aria-label={t('panel.note')}
            placeholder={t('panel.notePlaceholder')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="note-pop-foot">
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
                  ta.current?.focus();
                }}
              >
                {t('note.clear')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
