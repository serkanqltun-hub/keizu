// Rich-text notes in HTML: the formatted view (note card, presentation) and
// the editor (a Markdown text field with a formatting bar and shortcuts).

import { forwardRef, type ReactNode } from 'react';
import { continueList, indentLines, insertLink, parseNote, toggleLines, toggleWrap, type Block, type LineKind, type Span, type TextEdit } from '../core/richText';
import { t } from '../i18n';
import { openExternal } from './platform';

function Inline({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) => {
        let node: ReactNode = s.text;
        if (s.code) node = <code>{node}</code>;
        if (s.b) node = <strong>{node}</strong>;
        if (s.i) node = <em>{node}</em>;
        if (s.s) node = <s>{node}</s>;
        if (s.href) {
          const href = s.href;
          node = (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!href.startsWith('keizu:')) void openExternal(href).catch(() => {});
              }}
            >
              {node}
            </a>
          );
        }
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}

function BlockView({ b, onToggle }: { b: Block; onToggle?(line: number): void }) {
  switch (b.type) {
    case 'blank':
      return <div className="rn-blank" />;
    case 'hr':
      return <hr />;
    case 'code':
      return <pre>{b.text}</pre>;
    case 'h': {
      const H = `h${b.level + 2}` as 'h3' | 'h4' | 'h5';
      return (
        <H className={`rn-h${b.level}`}>
          <Inline spans={b.spans} />
        </H>
      );
    }
    case 'quote':
      return (
        <blockquote>
          <Inline spans={b.spans} />
        </blockquote>
      );
    case 'li':
      return (
        <div className={`rn-li${b.check ? ' done' : ''}`} style={{ paddingLeft: `${b.depth * 1.25}em` }}>
          {b.check !== undefined ? (
            <input
              type="checkbox"
              checked={b.check}
              disabled={!onToggle}
              aria-label={b.spans.map((s) => s.text).join('')}
              onChange={() => onToggle?.(b.line)}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="rn-mark">{b.marker}</span>
          )}
          <span className="rn-li-body">
            <Inline spans={b.spans} />
          </span>
        </div>
      );
    default:
      return (
        <p>
          <Inline spans={b.spans} />
        </p>
      );
  }
}

/** A note shown formatted. Checklist items can be ticked when `onToggle` is given. */
export function RichNote({ md, onToggle, className }: { md: string; onToggle?(line: number): void; className?: string }) {
  const blocks = parseNote(md.replace(/\n+$/, ''));
  return (
    <div className={`rich-note${className ? ` ${className}` : ''}`}>
      {blocks.map((b, i) => (
        <BlockView key={i} b={b} onToggle={onToggle} />
      ))}
    </div>
  );
}

// ---------- editing ----------

type Action = { id: string; label: string; icon: ReactNode; run(e: TextEdit): TextEdit | undefined };

const ico = (d: ReactNode) => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

function actions(): Action[] {
  const wrap = (m: string) => (e: TextEdit) => toggleWrap(e, m);
  const lines = (k: LineKind) => (e: TextEdit) => toggleLines(e, k);
  return [
    { id: 'bold', label: t('note.fmt.bold'), icon: <b>B</b>, run: wrap('**') },
    { id: 'italic', label: t('note.fmt.italic'), icon: <i style={{ fontFamily: 'serif' }}>I</i>, run: wrap('*') },
    { id: 'strike', label: t('note.fmt.strike'), icon: <s>S</s>, run: wrap('~~') },
    { id: 'heading', label: t('note.fmt.heading'), icon: <b>H</b>, run: lines('h2') },
    {
      id: 'ul',
      label: t('note.fmt.ul'),
      icon: ico(<><circle cx="3" cy="4" r=".9" fill="currentColor" /><circle cx="3" cy="8" r=".9" fill="currentColor" /><circle cx="3" cy="12" r=".9" fill="currentColor" /><path d="M6.5 4h7M6.5 8h7M6.5 12h7" /></>),
      run: lines('ul'),
    },
    {
      id: 'ol',
      label: t('note.fmt.ol'),
      icon: ico(<><path d="M2.5 2.8l1-.6v3.6M2.2 9.2c.4-.6 1.8-.6 1.8.3 0 .8-1.8 1.4-1.8 2.3H4.1" strokeWidth={1.1} /><path d="M6.5 4h7M6.5 8h7M6.5 12h7" /></>),
      run: lines('ol'),
    },
    {
      id: 'task',
      label: t('note.fmt.task'),
      icon: ico(<><rect x="1.8" y="2.3" width="4" height="4" rx="1" /><path d="M2.6 4.4l.9.9 1.6-1.8M8 4.3h6M8 11.3h6" /><rect x="1.8" y="9.3" width="4" height="4" rx="1" /></>),
      run: lines('task'),
    },
    {
      id: 'link',
      label: t('note.fmt.link'),
      icon: ico(<path d="M7 9.2a2.7 2.7 0 0 0 3.8 0l2.3-2.3a2.7 2.7 0 0 0-3.8-3.8l-.9.9M9 6.8a2.7 2.7 0 0 0-3.8 0L2.9 9.1a2.7 2.7 0 0 0 3.8 3.8l.9-.9" />),
      run: (e) => insertLink(e, t('note.linkText')),
    },
    { id: 'code', label: t('note.fmt.code'), icon: ico(<path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />), run: wrap('`') },
    { id: 'quote', label: t('note.fmt.quote'), icon: ico(<><path d="M3 3v10" strokeWidth={2} /><path d="M6.5 5h7M6.5 8h7M6.5 11h4.5" /></>), run: lines('quote') },
  ];
}

/** Shortcut → toolbar action id. */
export function noteShortcut(e: { key: string; code: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): string | undefined {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (e.altKey && !e.shiftKey && e.code === 'Digit1') return 'heading';
  if (e.altKey) return;
  if (e.shiftKey) {
    if (e.code === 'Digit7') return 'ol';
    if (e.code === 'Digit8') return 'ul';
    if (e.code === 'Digit9') return 'task';
    if (k === 'x') return 'strike';
    return;
  }
  if (k === 'b') return 'bold';
  if (k === 'i') return 'italic';
  if (k === 'k') return 'link';
  if (k === 'e') return 'code';
}

interface EditorProps {
  value: string;
  onChange(v: string): void;
  onBlur?(): void;
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
  /** Extra key handling (runs after the editor's own). */
  onKeyDown?(e: React.KeyboardEvent<HTMLTextAreaElement>): void;
}

/** Sets a text field's value and selection, keeping the browser's own undo history. */
function apply(el: HTMLTextAreaElement, next: TextEdit, onChange: (v: string) => void) {
  el.focus();
  // Replace only the part that changed, so Ctrl+Z in the field undoes it.
  const prev = el.value;
  let a = 0;
  while (a < prev.length && a < next.value.length && prev[a] === next.value[a]) a++;
  let b = 0;
  while (b < prev.length - a && b < next.value.length - a && prev[prev.length - 1 - b] === next.value[next.value.length - 1 - b]) b++;
  el.setSelectionRange(a, prev.length - b);
  const ok = typeof document.execCommand === 'function' && document.execCommand('insertText', false, next.value.slice(a, next.value.length - b));
  if (!ok || el.value !== next.value) el.value = next.value;
  el.setSelectionRange(next.start, next.end);
  onChange(next.value);
}

/** The note text field with its formatting bar. */
export const NoteEditor = forwardRef<HTMLTextAreaElement, EditorProps>(function NoteEditor({ value, onChange, onBlur, placeholder, id, ariaLabel, onKeyDown }, ref) {
  const acts = actions();
  const run = (a: Action, el: HTMLTextAreaElement | null) => {
    if (!el) return;
    const next = a.run({ value: el.value, start: el.selectionStart, end: el.selectionEnd });
    if (next) apply(el, next, onChange);
  };
  return (
    <div className="note-editor">
      <div className="note-fmt" role="toolbar" aria-label={t('note.fmt.toolbar')}>
        {acts.map((a) => (
          <button
            key={a.id}
            type="button"
            className="ib"
            title={a.label}
            aria-label={a.label}
            data-fmt={a.id}
            // Keep the focus (and selection) in the text field.
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              const el = e.currentTarget.closest('.note-editor')?.querySelector('textarea') ?? null;
              run(a, el);
            }}
          >
            {a.icon}
          </button>
        ))}
      </div>
      <textarea
        ref={ref}
        id={id}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        title={t('note.mdHint')}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={(e) => {
          const el = e.currentTarget;
          const sel = { value: el.value, start: el.selectionStart, end: el.selectionEnd };
          const id = noteShortcut(e);
          if (id) {
            e.preventDefault();
            e.stopPropagation();
            run(acts.find((a) => a.id === id)!, el);
            return;
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.nativeEvent.isComposing) {
            const next = continueList(sel);
            if (next) {
              e.preventDefault();
              apply(el, next, onChange);
              return;
            }
          }
          if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const next = indentLines(sel, e.shiftKey);
            if (next) {
              e.preventDefault();
              apply(el, next, onChange);
              return;
            }
          }
          onKeyDown?.(e);
        }}
      />
    </div>
  );
});
