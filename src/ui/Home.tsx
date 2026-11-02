import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { LayoutKind, MindMap } from '../core/model';
import { templateMap } from '../core/templates';
import { matchText, searchMap, type TopicHit } from '../core/search';
import { LANGS, getLang, locale, setLang, t, type Lang } from '../i18n';
import type { MapStore, MapSummary } from '../sync/types';
import { sync } from '../sync/controller';
import { Highlight } from './CommandPalette';
import { fmtWhen, statusText } from './SyncSettings';
import * as I from './Icons';
import { comboFromEvent, formatCombo } from './keymap';
import { fromFileList, isDesktop, pickFiles, type PickedFile } from './platform';

interface Props {
  store: MapStore;
  onOpen(map: MindMap, focusId?: string): void;
  onSettings(): void;
  /** Imports files; resolves with an error message, if any. */
  onOpenFiles(files: PickedFile[]): Promise<string | null>;
  notice: string | null;
  onNoticeShown(): void;
}

const TEMPLATES: { layout: LayoutKind; svg: JSX.Element }[] = [
  {
    layout: 'mindmap',
    svg: (
      <svg width="96" height="56" viewBox="0 0 96 56" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <rect x="36" y="22" width="24" height="12" rx="4" fill="#1F2A37" />
        <path d="M60 28c8 0 8-14 16-14M60 28c8 0 8 14 16 14" stroke="#E8590C" />
        <path d="M36 28c-8 0-8-14-16-14M36 28c-8 0-8 14-16 14" stroke="#2B8A3E" />
      </svg>
    ),
  },
  {
    layout: 'logic',
    svg: (
      <svg width="96" height="56" viewBox="0 0 96 56" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <rect x="10" y="22" width="24" height="12" rx="4" fill="#1F2A37" />
        <path d="M34 28h12M46 10v36M46 10h14M46 28h14M46 46h14" stroke="#1971C2" />
        <path d="M62 10h22M62 28h22M62 46h22" stroke="#C4C9D0" />
      </svg>
    ),
  },
  {
    layout: 'org',
    svg: (
      <svg width="96" height="56" viewBox="0 0 96 56" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <rect x="36" y="6" width="24" height="12" rx="4" fill="#1F2A37" />
        <path d="M48 18v8M18 26h60M18 26v8M48 26v8M78 26v8" stroke="#9C36B5" />
        <rect x="8" y="36" width="20" height="10" rx="3" stroke="#9C36B5" />
        <rect x="38" y="36" width="20" height="10" rx="3" stroke="#9C36B5" />
        <rect x="68" y="36" width="20" height="10" rx="3" stroke="#9C36B5" />
      </svg>
    ),
  },
  {
    layout: 'concept',
    svg: (
      <svg width="96" height="56" viewBox="0 0 96 56" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <rect x="36" y="4" width="24" height="12" rx="4" fill="#1F2A37" />
        <path d="M44 16L20 40M52 16l24 24M28 40h40" stroke="#0C8599" />
        <rect x="8" y="38" width="22" height="12" rx="4" stroke="#0C8599" />
        <rect x="66" y="38" width="22" height="12" rx="4" stroke="#0C8599" />
        <path d="M26 26h8M62 26h8" stroke="#C4C9D0" />
      </svg>
    ),
  },
  {
    layout: 'timeline',
    svg: (
      <svg width="96" height="56" viewBox="0 0 96 56" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <rect x="4" y="22" width="18" height="12" rx="4" fill="#1F2A37" />
        <path d="M22 28h70" stroke="#E8590C" />
        <rect x="28" y="23" width="14" height="10" rx="3" fill="#FFF4E6" stroke="#E8590C" />
        <rect x="52" y="23" width="14" height="10" rx="3" fill="#FFF4E6" stroke="#E8590C" />
        <rect x="76" y="23" width="14" height="10" rx="3" fill="#FFF4E6" stroke="#E8590C" />
        <path d="M31 33v8h10M55 23v-8h10M79 33v8h10" stroke="#C4C9D0" />
      </svg>
    ),
  },
  {
    layout: 'fishbone',
    svg: (
      <svg width="96" height="56" viewBox="0 0 96 56" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <rect x="70" y="22" width="22" height="12" rx="4" fill="#1F2A37" />
        <path d="M70 28H8M58 28L48 10M58 28L48 46M34 28L24 10M34 28L24 46" stroke="#C92A2A" />
        <path d="M44 16h8M44 40h8M20 16h8M20 40h8" stroke="#C4C9D0" />
      </svg>
    ),
  },
  {
    layout: 'matrix',
    svg: (
      <svg width="96" height="56" viewBox="0 0 96 56" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <rect x="8" y="6" width="20" height="12" rx="2" fill="#1F2A37" />
        <path d="M28 6h60v44H28zM48 6v44M68 6v44M28 18h60M28 34h60" stroke="#5F3DC4" />
      </svg>
    ),
  },
];

function when(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return t('time.justNow');
  if (diff < 3600) return t('time.minutesAgo', { n: Math.floor(diff / 60) });
  if (diff < 86400) return t('time.today', { time: d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) });
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

interface MapHits {
  summary: MapSummary;
  hits: TopicHit[];
  total: number;
}

/**
 * Searches inside every map in the library (topic texts and notes). Maps
 * are read from the device once and cached until they change.
 */
function useLibrarySearch(store: MapStore, maps: MapSummary[] | null, query: string): MapHits[] | null {
  const cache = useRef(new Map<string, { updatedAt: string; map: MindMap }>());
  const [results, setResults] = useState<MapHits[] | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (!maps || q.length < 2) {
      setResults(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      const out: MapHits[] = [];
      for (const summary of maps) {
        let entry = cache.current.get(summary.id);
        if (!entry || entry.updatedAt !== summary.updatedAt) {
          const map = await store.get(summary.id).catch(() => undefined);
          if (!alive) return;
          if (!map) continue;
          entry = { updatedAt: summary.updatedAt, map };
          cache.current.set(summary.id, entry);
        }
        const hits = searchMap(entry.map, q, 200);
        if (hits.length) out.push({ summary, hits: hits.slice(0, 5), total: hits.length });
      }
      out.sort((a, b) => b.hits[0].match.score - a.hits[0].match.score);
      if (alive) setResults(out);
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [store, maps, query]);
  return results;
}

function SyncPill({ onClick }: { onClick(): void }) {
  const status = useSyncExternalStore((f) => sync.subscribe(f), sync.getStatus);
  const on = status.state !== 'off';
  return (
    <button className="sync-pill" onClick={onClick}>
      <I.Cloud size={16} />
      <span>
        <strong>{t('home.sync')}</strong>
        <span className="muted">
          {on ? `${statusText(status)}${status.lastSyncAt && status.state === 'idle' ? ` · ${fmtWhen(status.lastSyncAt)}` : ''}` : t('home.syncOff')}
        </span>
      </span>
      {on && <span className={`dot ${status.state === 'idle' || status.state === 'syncing' ? 'ok' : 'warn'}`} />}
    </button>
  );
}

export function Home({ store, onOpen, onSettings, onOpenFiles, notice, onNoticeShown }: Props) {
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const searchBox = useRef<HTMLInputElement>(null);
  const found = useLibrarySearch(store, maps, query);

  // Ctrl+K / ⌘K jumps to the search box here, like the palette in a map.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (comboFromEvent(e) !== 'Mod+K') return;
      e.preventDefault();
      searchBox.current?.focus();
      searchBox.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!notice) return;
    setError(notice);
    onNoticeShown();
  }, [notice, onNoticeShown]);

  const refresh = () => store.list().then(setMaps);
  useEffect(() => {
    refresh();
    return sync.onMapsChanged(() => refresh());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async (layout: LayoutKind) => {
    const map = templateMap(layout, {
      central: t('topic.central'),
      main: t('topic.main'),
      concept: t('tpl.concept'),
      conceptLink: t('tpl.conceptLink'),
      timeline: t('tpl.timeline'),
      event: t('tpl.event'),
      detail: t('tpl.detail'),
      fishbone: t('tpl.fishbone'),
      cause: t('tpl.cause'),
      subcause: t('tpl.subcause'),
      matrix: t('tpl.matrix'),
      column: t('tpl.column'),
      cell: t('tpl.cell'),
    });
    await store.save(map);
    onOpen(map);
  };

  const open = async (id: string) => {
    const map = await store.get(id);
    if (map) onOpen(map);
  };

  const remove = async (s: MapSummary) => {
    if (!window.confirm(t('home.confirmDelete', { title: s.title }))) return;
    await store.remove(s.id);
    refresh();
  };

  const importFiles = async (files: PickedFile[]) => {
    setError(null);
    try {
      const err = await onOpenFiles(files);
      if (err) setError(err);
    } catch (e) {
      setError((e as Error).message || t('home.openFailed'));
    }
    refresh();
  };

  const openDialog = async () => {
    try {
      await importFiles(await pickFiles());
    } catch (e) {
      setError((e as Error).message || t('home.openFailed'));
    }
  };

  const shown = (maps ?? []).filter((m) => !query.trim() || matchText(query, m.title));
  const openAt = async (id: string, topicId: string) => {
    const map = await store.get(id);
    if (map) onOpen(map, topicId);
  };

  return (
    <div
      className={`home ${dragging ? 'dropping' : ''}`}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        setDragging(false);
        importFiles(await fromFileList(e.dataTransfer.files));
      }}
    >
      <aside className="home-side">
        <div className="brand">
          <div className="logo-mark"><I.Logo size={32} /></div>
          <I.Wordmark size={28} />
        </div>
        <button className="btn primary block" onClick={() => create('mindmap')}>
          <I.Plus size={16} /> {t('home.newMap')}
        </button>
        <button className="btn block" onClick={openDialog} title={t('home.openFileTip')}>
          <I.Import size={16} /> {t('home.openFile')}
        </button>
        <p className="side-hint">{t('home.openHint')}</p>
        <div className="local-card">
          <strong>{t('home.onDevice')}</strong>
          <span>{isDesktop ? t('home.onDeviceDesktop') : t('home.onDeviceWeb')}</span>
          <span className="muted">{t('home.versionsNote')}</span>
        </div>
        <SyncPill onClick={onSettings} />
        <label className="lang-pick">
          <span>{t('home.language')}</span>
          <select value={getLang()} onChange={(e) => setLang(e.target.value as Lang)}>
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
      </aside>

      <main className="home-main">
        <label className="search">
          <I.Search />
          <span className="sr">{t('home.search')}</span>
          <input ref={searchBox} type="search" placeholder={t('home.searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} />
          <kbd className="search-kbd">{formatCombo('Mod+K')}</kbd>
        </label>

        {error && <div className="error" role="alert">{error}</div>}

        {found && (
          <section className="found">
            <h2>{t('home.inTopics')}</h2>
            {found.length === 0 ? (
              <p className="muted">{t('home.noTopicHits')}</p>
            ) : (
              found.map((f) => (
                <div key={f.summary.id} className="found-map">
                  <div className="found-title">
                    <strong>{f.summary.title}</strong>
                    <span className="muted">{t('home.hitCount', { n: f.total })}</span>
                  </div>
                  <ul>
                    {f.hits.map((h) => (
                      <li key={h.id}>
                        <button onClick={() => openAt(f.summary.id, h.id)}>
                          <span className="found-text">
                            {h.field === 'text' ? <Highlight text={h.text.split('\n')[0]} match={h.match} /> : h.text.split('\n')[0]}
                            {h.field === 'note' && <span className="pi-tag">{t('palette.inNote')}</span>}
                          </span>
                          {h.path.length > 0 && <span className="pi-path">{h.path.slice(-2).map((p) => p.split('\n')[0]).join(' › ')}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>
        )}

        {!query.trim() && (
          <section>
            <h2>{t('home.start')}</h2>
            <div className="tpl-grid">
              {TEMPLATES.map((tp) => (
                <button key={tp.layout} className="tpl" onClick={() => create(tp.layout)}>
                  <span className="tpl-art">{tp.svg}</span>
                  {t(`layout.${tp.layout}`)}
                </button>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2>{query.trim() ? t('home.titleMatches') : t('home.myMaps')}</h2>
          {maps === null ? null : shown.length === 0 ? (
            <p className="muted">{maps.length ? t('home.noTitleMatch') : t('home.empty')}</p>
          ) : (
            <div className="card-grid">
              {shown.map((m) => (
                <div key={m.id} className="card">
                  <button className="card-open" onClick={() => open(m.id)}>
                    <span className="card-art" aria-hidden="true">
                      <svg width="140" height="72" viewBox="0 0 140 72" fill="none" strokeWidth="2" strokeLinecap="round">
                        <rect x="52" y="28" width="36" height="16" rx="5" fill="#1F2A37" />
                        <path d="M88 36c10 0 10-18 20-18h20M88 36c10 0 10 18 20 18h20" stroke="#1971C2" />
                        <path d="M52 36c-10 0-10-18-20-18H12M52 36c-10 0-10 18-20 18H12" stroke="#2B8A3E" />
                      </svg>
                    </span>
                    <span className="card-title">{m.title}</span>
                    <span className="card-meta">
                      {when(m.updatedAt)}
                      {m.fileName && <span className="card-file" title={t('home.fileTip')}> · {m.fileName}</span>}
                    </span>
                  </button>
                  <button className="ib card-del" aria-label={t('home.deleteMap', { title: m.title })} title={t('tb.delete')} onClick={() => remove(m)}>
                    <I.Trash size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
      {dragging && <div className="drop-hint" aria-hidden="true">{t('home.dropHint')}</div>}
    </div>
  );
}
