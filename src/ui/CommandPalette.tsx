// Ctrl+K / ⌘K: run any command or jump to any topic by typing.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MindMap } from '../core/model';
import { matchLabel, searchMap, type Match } from '../core/search';
import { t } from '../i18n';
import * as I from './Icons';

export interface PaletteCommand {
  id: string;
  label: string;
  keys: string[];
  disabled?: boolean;
  run(): void;
}

type Item =
  | { kind: 'command'; key: string; cmd: PaletteCommand; match?: Match }
  | { kind: 'topic'; key: string; id: string; text: string; path: string[]; inNote: boolean; match: Match };

interface Props {
  map: MindMap;
  commands: PaletteCommand[];
  onPickTopic(id: string): void;
  onClose(): void;
}

export function Highlight({ text, match }: { text: string; match?: Match }) {
  if (!match || match.end > text.length) return <>{text}</>;
  return (
    <>
      {text.slice(0, match.start)}
      <mark>{text.slice(match.start, match.end)}</mark>
      {text.slice(match.end)}
    </>
  );
}

export function CommandPalette({ map, commands, onPickTopic, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  const items = useMemo<Item[]>(() => {
    const q = query.trim();
    const enabled = commands.filter((c) => !c.disabled);
    if (!q) return enabled.map((cmd) => ({ kind: 'command', key: `c:${cmd.id}`, cmd }));
    const cmds = enabled
      .map((cmd) => ({ cmd, match: matchLabel(q, cmd.label) }))
      .filter((x): x is { cmd: PaletteCommand; match: Match } => !!x.match)
      .sort((a, b) => b.match.score - a.match.score)
      .slice(0, 6)
      .map<Item>((x) => ({ kind: 'command', key: `c:${x.cmd.id}`, cmd: x.cmd, match: x.match }));
    const topics = searchMap(map, q, 40).map<Item>((h) => ({
      kind: 'topic',
      key: `t:${h.id}`,
      id: h.id,
      text: h.text.split('\n')[0],
      path: h.path,
      inNote: h.field === 'note',
      match: h.match,
    }));
    return [...cmds, ...topics];
  }, [query, commands, map]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    if (item.kind === 'command') item.cmd.run();
    else onPickTopic(item.id);
  };

  const firstTopic = items.findIndex((i) => i.kind === 'topic');

  return (
    <div className="palette-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label={t('palette.title')}>
        <label className="palette-input">
          <I.Search />
          <input
            ref={input}
            value={query}
            placeholder={t('palette.placeholder')}
            aria-label={t('palette.placeholder')}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `pal-${active}` : undefined}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(items.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                pick(items[active]);
              } else if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
                e.preventDefault();
                onClose();
              }
            }}
          />
        </label>
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {items.length === 0 && <p className="muted palette-empty">{t('palette.empty')}</p>}
          {items.map((item, i) => (
            <div key={item.key}>
              {i === firstTopic && <div className="palette-section">{t('palette.topics')}</div>}
              {i === 0 && item.kind === 'command' && <div className="palette-section">{t('palette.commands')}</div>}
              <div
                id={`pal-${i}`}
                role="option"
                aria-selected={i === active}
                className={`palette-item ${i === active ? 'on' : ''}`}
                onPointerMove={() => setActive(i)}
                onClick={() => pick(item)}
              >
                {item.kind === 'command' ? (
                  <>
                    <span className="pi-main"><Highlight text={item.cmd.label} match={item.match} /></span>
                    <span className="pi-keys">
                      {item.cmd.keys.slice(0, 1).map((k) => <kbd key={k}>{k}</kbd>)}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="pi-main">
                      {item.inNote ? item.text : <Highlight text={item.text} match={item.match} />}
                      {item.inNote && <span className="pi-tag">{t('palette.inNote')}</span>}
                    </span>
                    {item.path.length > 0 && <span className="pi-path">{item.path.slice(-2).map((p) => p.split('\n')[0]).join(' › ')}</span>}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="palette-foot muted">{t('palette.hint')}</div>
      </div>
    </div>
  );
}
