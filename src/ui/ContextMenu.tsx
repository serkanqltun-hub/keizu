// Right-click menu: a list of commands at the pointer, with submenus and
// colour swatches. Works with the mouse and the keyboard (arrows, Enter,
// Esc, Shift+F10 / the menu key to open it on the selected topic).

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export type CtxItem =
  | {
      type: 'item';
      id: string;
      label: string;
      icon?: ReactNode;
      /** Shortcut shown on the right, already formatted. */
      keys?: string;
      disabled?: boolean;
      danger?: boolean;
      /** Shown as a radio tick (submenus of choices). */
      checked?: boolean;
      run(): void;
    }
  | { type: 'sub'; id: string; label: string; icon?: ReactNode; disabled?: boolean; items: CtxItem[] }
  | { type: 'swatches'; id: string; label: string; colors: { value: string | undefined; label: string; on: boolean }[]; pick(value: string | undefined): void }
  | { type: 'sep' };

type At = { x: number; y: number } | { rect: DOMRect };

const isActive = (i: CtxItem) => i.type !== 'sep' && !(('disabled' in i) && i.disabled);

/** Drops separators at the ends and doubled separators (left by hidden items). */
export function tidy(items: (CtxItem | false | null | undefined | "")[]): CtxItem[] {
  const out: CtxItem[] = [];
  for (const i of items) {
    if (!i) continue;
    if (i.type === 'sep' && (!out.length || out[out.length - 1].type === 'sep')) continue;
    out.push(i);
  }
  while (out.length && out[out.length - 1].type === 'sep') out.pop();
  return out;
}

interface Props {
  x: number;
  y: number;
  items: CtxItem[];
  label: string;
  /** Opened from the keyboard: the first item starts highlighted. */
  keyboard?: boolean;
  onClose(): void;
}

export function ContextMenu({ x, y, items, label, keyboard, onClose }: Props) {
  // Any press outside, a scroll, a resize or leaving the window closes it.
  useLayoutEffect(() => {
    const outside = (e: Event) => {
      if (!(e.target as Element)?.closest?.('.ctx-menu')) onClose();
    };
    const close = () => onClose();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('wheel', outside, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('wheel', outside, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);

  return <MenuList items={items} at={{ x, y }} label={label} keyboard={keyboard} onDone={onClose} />;
}

function MenuList({ items, at, label, onDone, onBack, onEnter, keyboard = false }: { items: CtxItem[]; at: At; label: string; onDone(): void; onBack?(): void; onEnter?(): void; keyboard?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const first = items.findIndex(isActive);
  // Opened from the keyboard: the first item is highlighted at once.
  const [active, setActive] = useState(keyboard ? first : -1);
  const [sub, setSub] = useState<{ index: number; rect: DOMRect; keyboard: boolean } | null>(null);
  const [swatch, setSwatch] = useState(0);
  const rows = useRef<(HTMLElement | null)[]>([]);
  const hoverTimer = useRef<number>();

  // Keep the whole menu on screen: flip left / up when it would overflow.
  useLayoutEffect(() => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight, m = 8;
    let left: number, top: number;
    if ('rect' in at) {
      left = at.rect.right - 2;
      if (left + r.width > vw - m) left = at.rect.left - r.width + 2;
      top = at.rect.top - 5;
    } else {
      left = at.x;
      top = at.y;
      if (left + r.width > vw - m) left = at.x - r.width;
    }
    if (top + r.height > vh - m) top = vh - r.height - m;
    setPos({ left: Math.max(m, left), top: Math.max(m, top) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Focus once placed (a hidden element can't take focus).
  const placed = !!pos;
  useLayoutEffect(() => {
    if (placed) ref.current?.focus({ preventScroll: true });
  }, [placed]);

  useLayoutEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const openSub = (index: number, viaKey: boolean) => {
    const el = rows.current[index];
    if (!el) return;
    setActive(index);
    setSub({ index, rect: el.getBoundingClientRect(), keyboard: viaKey });
  };

  const run = (item: CtxItem, index: number, viaKey = false) => {
    if (!isActive(item)) return;
    if (item.type === 'sub') return openSub(index, viaKey);
    if (item.type === 'swatches') {
      onDone();
      return item.pick(item.colors[swatch]?.value);
    }
    if (item.type === 'item') {
      onDone();
      item.run();
    }
  };

  const step = (dir: 1 | -1) => {
    if (first < 0) return;
    let i = active;
    for (let n = 0; n < items.length; n++) {
      i = (i + dir + items.length) % items.length;
      if (isActive(items[i])) break;
    }
    setActive(i);
    if (items[i].type === 'swatches') setSwatch(Math.max(0, (items[i] as Extract<CtxItem, { type: 'swatches' }>).colors.findIndex((c) => c.on)));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // The editor's shortcuts must not see keys meant for the menu.
    e.stopPropagation();
    if (sub) return;
    const item = items[active];
    const k = e.key;
    if (k === 'ArrowDown' || (k === 'Tab' && !e.shiftKey)) step(1);
    else if (k === 'ArrowUp' || (k === 'Tab' && e.shiftKey)) step(-1);
    else if (k === 'Home') setActive(first);
    else if (k === 'End') setActive(items.length - 1 - [...items].reverse().findIndex(isActive));
    else if (k === 'ArrowRight' && item?.type === 'sub') openSub(active, true);
    else if (k === 'ArrowRight' && item?.type === 'swatches') setSwatch((s) => Math.min(item.colors.length - 1, s + 1));
    else if (k === 'ArrowLeft' && item?.type === 'swatches') setSwatch((s) => Math.max(0, s - 1));
    else if (k === 'ArrowLeft' && onBack) onBack();
    else if (k === 'Escape') onBack ? onBack() : onDone();
    else if ((k === 'Enter' || k === ' ') && item) run(item, active, true);
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typing a letter jumps to the next item that starts with it.
      const ch = k.toLocaleLowerCase();
      for (let n = 1; n <= items.length; n++) {
        const i = (active + n) % items.length;
        const it = items[i];
        if (isActive(it) && it.type !== 'sep' && it.label.toLocaleLowerCase().startsWith(ch)) {
          setActive(i);
          break;
        }
      }
    } else return;
    e.preventDefault();
  };

  const subItem = sub ? items[sub.index] : undefined;

  return (
    <>
      <div
        ref={ref}
        className="ctx-menu"
        role="menu"
        aria-label={label}
        tabIndex={-1}
        style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
        onKeyDown={onKeyDown}
        onPointerEnter={onEnter}
        onContextMenu={(e) => e.preventDefault()}
        onPointerLeave={() => {
          window.clearTimeout(hoverTimer.current);
          if (!sub) setActive(-1);
        }}
      >
        {items.map((item, i) => {
          if (item.type === 'sep') return <div key={`sep${i}`} className="ctx-sep" role="separator" />;
          const on = i === active;
          const hover = () => {
            if (active === i) return;
            setActive(i);
            window.clearTimeout(hoverTimer.current);
            if (item.type === 'sub' && !item.disabled) {
              if (sub?.index !== i) hoverTimer.current = window.setTimeout(() => openSub(i, false), 120);
            } else if (sub) hoverTimer.current = window.setTimeout(() => setSub(null), 200);
          };
          if (item.type === 'swatches') {
            return (
              <div key={item.id} ref={(el) => (rows.current[i] = el)} className={`ctx-swatches ${on ? 'on' : ''}`} role="group" aria-label={item.label} onPointerMove={hover}>
                <span className="ctx-label">{item.label}</span>
                <span className="ctx-sw-row">
                  {item.colors.map((c, ci) => (
                    <button
                      key={c.value ?? 'auto'}
                      role="menuitemradio"
                      aria-checked={c.on}
                      aria-label={c.label}
                      title={c.label}
                      tabIndex={-1}
                      className={`ctx-sw ${c.value ? '' : 'auto'} ${c.on ? 'checked' : ''} ${on && ci === swatch ? 'kb' : ''}`}
                      style={c.value ? { background: c.value } : undefined}
                      onClick={() => {
                        onDone();
                        item.pick(c.value);
                      }}
                    >
                      {c.value ? null : 'A'}
                    </button>
                  ))}
                </span>
              </div>
            );
          }
          const disabled = !!item.disabled;
          const radio = item.type === 'item' && item.checked !== undefined;
          return (
            <button
              key={item.id}
              ref={(el) => (rows.current[i] = el)}
              role={radio ? 'menuitemradio' : 'menuitem'}
              aria-checked={radio ? (item as { checked?: boolean }).checked : undefined}
              aria-haspopup={item.type === 'sub' ? 'menu' : undefined}
              aria-expanded={item.type === 'sub' ? sub?.index === i : undefined}
              aria-disabled={disabled || undefined}
              tabIndex={-1}
              className={`ctx-item ${on ? 'on' : ''} ${item.type === 'item' && item.danger ? 'danger' : ''} ${disabled ? 'disabled' : ''}`}
              onPointerMove={hover}
              onClick={() => run(item, i)}
            >
              <span className="ctx-icon" aria-hidden="true">
                {radio ? ((item as { checked?: boolean }).checked ? <span className="ctx-dot" /> : null) : item.icon}
              </span>
              <span className="ctx-label">{item.label}</span>
              {item.type === 'item' && item.keys && <kbd className="ctx-keys">{item.keys}</kbd>}
              {item.type === 'sub' && (
                <svg className="ctx-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
      {sub && subItem?.type === 'sub' && (
        <MenuList
          key={sub.index}
          items={subItem.items}
          at={{ rect: sub.rect }}
          label={subItem.label}
          keyboard={sub.keyboard}
          onDone={onDone}
          onEnter={() => {
            window.clearTimeout(hoverTimer.current);
            setActive(sub.index);
          }}
          onBack={() => {
            setSub(null);
            ref.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </>
  );
}
