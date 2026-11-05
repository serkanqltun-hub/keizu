// Tags and task mode in the interface: the "Görev ve etiketler" part of the
// topic panel, the "Görevler" tab (every task, here or in all maps), and the
// filter bar on the canvas.

import { useEffect, useMemo, useRef, useState } from 'react';
import { PRIORITY_COLORS } from '../core/markers';
import type { MindMap, Topic } from '../core/model';
import { fold } from '../core/search';
import {
  collectTasks,
  dueLabel,
  isOverdue,
  normalizeTag,
  sortTasks,
  tagColor,
  today,
  type TaskFilter,
  type TaskItem,
  type TaskPatch,
  type TopicFilter,
} from '../core/tasks';
import type { MapStore } from '../sync/types';
import { locale, t } from '../i18n';
import * as I from './Icons';

const stop = (e: React.KeyboardEvent) => e.stopPropagation();

/** Task fields and tags of the selected topic(s). */
export function TaskTagSection({
  topic,
  count,
  tags,
  onTask,
  onTag,
  onPriority,
}: {
  topic: Topic;
  /** Topics selected; above 1 the changes go to all of them. */
  count: number;
  /** Tags used anywhere in the map, for suggestions. */
  tags: string[];
  onTask(p: TaskPatch): void;
  onTag(tag: string, on: boolean): void;
  onPriority(n: number | undefined): void;
}) {
  const [draft, setDraft] = useState('');
  const [who, setWho] = useState(topic.assignee ?? '');
  useEffect(() => setWho(topic.assignee ?? ''), [topic.assignee]);
  const priority = Number(topic.markers?.find((m) => m.startsWith('priority-'))?.slice(9)) || undefined;
  const own = topic.tags ?? [];
  const suggestions = tags.filter((x) => !own.some((o) => fold(o) === fold(x)));
  const addDraft = () => {
    const tag = normalizeTag(draft);
    if (tag) onTag(tag, true);
    setDraft('');
  };
  const state = topic.task ?? 'none';
  return (
    <>
      <section className="task-sec">
        <h3 className="lbl">{t('task.section')}</h3>
        <div className="seg-tabs" role="group" aria-label={t('task.section')}>
          {(['none', 'todo', 'done'] as const).map((s) => (
            <button key={s} className={state === s ? 'on' : ''} aria-pressed={state === s} onClick={() => onTask({ task: s === 'none' ? null : s })}>
              {t(`task.state.${s}`)}
            </button>
          ))}
        </div>
        <div className="task-fields">
          <label className="field">
            <span className="small muted">{t('task.due')}</span>
            <span className="due-input">
              <input type="date" value={topic.due ?? ''} onChange={(e) => onTask({ due: e.target.value || null })} onKeyDown={stop} />
              {topic.due && (
                <button className="chip-x" aria-label={t('task.clearDue')} title={t('task.clearDue')} onClick={() => onTask({ due: null })}>×</button>
              )}
            </span>
          </label>
          <label className="field">
            <span className="small muted">{t('task.assignee')}</span>
            <input
              value={who}
              placeholder={t('task.assigneePlaceholder')}
              onChange={(e) => setWho(e.target.value)}
              onBlur={() => who.trim() !== (topic.assignee ?? '') && onTask({ assignee: who.trim() || null })}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          </label>
        </div>
        <div className="field">
          <span className="small muted">{t('task.priority')}</span>
          <div className="prio-row" role="group" aria-label={t('task.priority')}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={`prio ${priority === n ? 'on' : ''}`}
                style={{ '--p': PRIORITY_COLORS[n - 1] } as React.CSSProperties}
                aria-pressed={priority === n}
                title={t('task.priorityN', { n })}
                onClick={() => onPriority(priority === n ? undefined : n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        {count > 1 && <p className="muted small">{t('task.multiHint', { n: count })}</p>}
      </section>
      <section>
        <h3 className="lbl">{t('tag.section')}</h3>
        {own.length > 0 && (
          <div className="tag-list">
            {own.map((tag) => (
              <span key={tag} className="tag-chip" style={{ '--tag': tagColor(tag) } as React.CSSProperties}>
                #{tag}
                <button aria-label={t('tag.remove', { tag })} title={t('tag.remove', { tag })} onClick={() => onTag(tag, false)}>×</button>
              </span>
            ))}
          </div>
        )}
        <input
          id="tag-input"
          className="tag-input"
          value={draft}
          list="kz-tag-list"
          placeholder={t('tag.placeholder')}
          onChange={(e) => {
            // Typing a comma or a space-separated "#tag" adds it.
            const v = e.target.value;
            if (/[,]$/.test(v)) {
              const tag = normalizeTag(v.slice(0, -1));
              if (tag) onTag(tag, true);
              setDraft('');
            } else setDraft(v);
          }}
          onBlur={addDraft}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              addDraft();
            }
          }}
        />
        <datalist id="kz-tag-list">
          {suggestions.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
        {suggestions.length > 0 && (
          <div className="tag-list suggest" aria-label={t('tag.suggest')}>
            {suggestions.slice(0, 8).map((tag) => (
              <button key={tag} className="tag-chip ghost" style={{ '--tag': tagColor(tag) } as React.CSSProperties} onClick={() => onTag(tag, true)}>
                + #{tag}
              </button>
            ))}
          </div>
        )}
        {!own.length && <p className="muted small">{t('tag.hint')}</p>}
      </section>
    </>
  );
}

interface ListedTask extends TaskItem {
  mapId: string;
  mapTitle: string;
}

/** The "Görevler" tab: every task of this map, or of every map in the library. */
export function TasksPane({
  doc,
  store,
  onGo,
  onOpenMap,
  onCheck,
  readOnly,
}: {
  /** The whole open file (inner maps included). */
  doc: MindMap;
  store?: MapStore;
  onGo(id: string): void;
  onOpenMap(mapId: string, topicId: string): void;
  onCheck(id: string): void;
  readOnly?: boolean;
}) {
  const [scope, setScope] = useState<'map' | 'all'>('map');
  const [showDone, setShowDone] = useState(false);
  const [others, setOthers] = useState<ListedTask[] | null>(null);
  const loadId = useRef(0);
  useEffect(() => {
    if (scope !== 'all' || !store) return;
    const id = ++loadId.current;
    (async () => {
      const list = await store.list().catch(() => []);
      const out: ListedTask[] = [];
      for (const s of list) {
        if (s.id === doc.id) continue;
        const m = await store.get(s.id).catch(() => undefined);
        if (m) out.push(...collectTasks(m).map((x) => ({ ...x, mapId: m.id, mapTitle: m.title })));
      }
      if (id === loadId.current) setOthers(out);
    })();
  }, [scope, store, doc.id]);

  const items = useMemo(() => {
    const here = collectTasks(doc).map((x) => ({ ...x, mapId: doc.id, mapTitle: doc.title }));
    const all = scope === 'all' ? [...here, ...(others ?? [])] : here;
    return sortTasks(all);
  }, [doc, scope, others]);
  const open = items.filter((x) => x.task === 'todo');
  const shown = showDone ? items : open;
  const day = today();
  const loc = locale();
  return (
    <div className="tasks-pane">
      <div className="seg-tabs" role="group" aria-label={t('tasks.scope')}>
        <button className={scope === 'map' ? 'on' : ''} aria-pressed={scope === 'map'} onClick={() => setScope('map')}>{t('tasks.thisMap')}</button>
        <button className={scope === 'all' ? 'on' : ''} aria-pressed={scope === 'all'} onClick={() => setScope('all')} disabled={!store}>{t('tasks.allMaps')}</button>
      </div>
      <div className="tasks-head">
        <span className="small muted">{t('tasks.count', { open: open.length, all: items.length })}</span>
        <label className="check small">
          <span>{t('tasks.showDone')}</span>
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
        </label>
      </div>
      {scope === 'all' && !others && <p className="muted small">{t('tasks.loading')}</p>}
      {!shown.length ? (
        <p className="muted small">{items.length ? t('tasks.allDone') : t('tasks.empty')}</p>
      ) : (
        <ul className="task-list">
          {shown.map((x) => {
            const here = x.mapId === doc.id;
            const late = isOverdue(x, day);
            return (
              <li key={`${x.mapId}:${x.id}`} className={x.task === 'done' ? 'done' : ''}>
                <button
                  className={`tl-check ${x.task === 'done' ? 'on' : ''}`}
                  role="checkbox"
                  aria-checked={x.task === 'done'}
                  aria-label={x.text}
                  disabled={!here || readOnly}
                  title={here ? undefined : t('tasks.openToCheck')}
                  onClick={() => onCheck(x.id)}
                >
                  {x.task === 'done' && <I.Check size={12} />}
                </button>
                <button className="tl-body" onClick={() => (here ? onGo(x.id) : onOpenMap(x.mapId, x.id))}>
                  <span className="tl-text">
                    {x.priority && <span className="tl-prio" style={{ background: PRIORITY_COLORS[x.priority - 1] }}>{x.priority}</span>}
                    {x.text.split('\n')[0] || '…'}
                  </span>
                  <span className="tl-meta">
                    {scope === 'all' && <span className="tl-map">{x.mapTitle}</span>}
                    {x.path.length > 0 && <span className="tl-path">{x.path.slice(-2).join(' › ')}</span>}
                    {x.due && <span className={`tl-due ${late ? 'late' : ''}`}>{dueLabel(x.due, loc)}</span>}
                    {x.assignee && <span>@{x.assignee}</span>}
                    {x.tags?.map((tag) => <span key={tag} style={{ color: tagColor(tag) }}>#{tag}</span>)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const TASK_FILTERS: TaskFilter[] = ['all', 'open', 'done', 'overdue', 'none'];

/** The filter bar on the canvas: pick tags and a task state; others fade or hide. */
export function FilterBar({
  tags,
  filter,
  matches,
  onChange,
  onClose,
  below,
}: {
  /** Something else holds the top right corner: sit under it. */
  below?: boolean;
  tags: { tag: string; count: number }[];
  filter: TopicFilter;
  /** How many topics match, when a filter is set. */
  matches?: number;
  onChange(f: TopicFilter): void;
  onClose(): void;
}) {
  const on = (tag: string) => filter.tags.some((x) => fold(x) === fold(tag));
  return (
    <div className="filter-bar" style={below ? { top: 62 } : undefined} role="region" aria-label={t('filter.label')} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <span className="fb-title"><I.FilterIcon size={15} />{t('filter.label')}</span>
      <div className="fb-tags">
        {tags.length ? (
          tags.map(({ tag, count }) => (
            <button
              key={tag}
              className={`tag-chip ${on(tag) ? 'on' : 'ghost'}`}
              style={{ '--tag': tagColor(tag) } as React.CSSProperties}
              aria-pressed={on(tag)}
              onClick={() => onChange({ ...filter, tags: on(tag) ? filter.tags.filter((x) => fold(x) !== fold(tag)) : [...filter.tags, tag] })}
            >
              #{tag} <span className="n">{count}</span>
            </button>
          ))
        ) : (
          <span className="muted small">{t('filter.noTags')}</span>
        )}
      </div>
      <select aria-label={t('filter.task')} value={filter.task} onChange={(e) => onChange({ ...filter, task: e.target.value as TaskFilter })} onKeyDown={stop}>
        {TASK_FILTERS.map((f) => (
          <option key={f} value={f}>{t(`filter.task.${f}`)}</option>
        ))}
      </select>
      <div className="seg-tabs fb-mode" role="group" aria-label={t('filter.mode')}>
        <button className={filter.mode === 'dim' ? 'on' : ''} aria-pressed={filter.mode === 'dim'} onClick={() => onChange({ ...filter, mode: 'dim' })}>{t('filter.dim')}</button>
        <button className={filter.mode === 'hide' ? 'on' : ''} aria-pressed={filter.mode === 'hide'} onClick={() => onChange({ ...filter, mode: 'hide' })}>{t('filter.hide')}</button>
      </div>
      {matches !== undefined && <span className="fb-count small">{t('filter.matches', { n: matches })}</span>}
      <button className="ib" aria-label={t('filter.close')} title={`${t('filter.close')} (Esc)`} onClick={onClose}>×</button>
    </div>
  );
}
