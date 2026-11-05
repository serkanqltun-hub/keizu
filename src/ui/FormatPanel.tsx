import { useEffect, useState } from 'react';
import { MARKERS } from '../core/markers';
import type { BranchStyle, LayoutKind, MindMap, Relation, Topic, TopicShape, TopicStyle } from '../core/model';
import { FILL_SWATCHES, THEMES } from '../core/themes';
import { t, type MessageKey } from '../i18n';
import { MarkerGlyph } from './MapSvg';

interface Props {
  map: MindMap;
  topic: Topic | undefined;
  relation: Relation | undefined;
  isRoot: boolean;
  /** Layout the selected topic's branch gets when it has none of its own. */
  inheritedLayout: LayoutKind;
  onRelationLabel(label: string): void;
  onRelationDelete(): void;
  tab: 'style' | 'map';
  onTab(tab: 'style' | 'map'): void;
  onStyle(patch: TopicStyle): void;
  onBranchLayout(layout: LayoutKind | undefined): void;
  onMarker(id: string): void;
  onNote(note: string): void;
  onLinkLabel(label: string): void;
  onHref(href: string): void;
  /** Other maps in the library, for linking a topic to one. */
  maps: { id: string; title: string }[];
  onMap(patch: Partial<Pick<MindMap, 'theme' | 'layout' | 'branchStyle' | 'multicolor' | 'notebook'>>): void;
}

const SHAPES: { id: TopicShape; css: React.CSSProperties }[] = [
  { id: 'rounded', css: { borderRadius: 5, border: '1.5px solid currentColor' } },
  { id: 'pill', css: { borderRadius: 8, border: '1.5px solid currentColor' } },
  { id: 'rect', css: { border: '1.5px solid currentColor' } },
  { id: 'underline', css: { height: 10, borderBottom: '1.5px solid currentColor' } },
  { id: 'none', css: { border: '1.5px dashed currentColor', opacity: 0.4, borderRadius: 5 } },
];

const LAYOUTS: { id: LayoutKind; d: string }[] = [
  { id: 'mindmap', d: 'M25 14c4 0 4-8 8-8M25 14c4 0 4 8 8 8M15 14c-4 0-4-8-8-8M15 14c-4 0-4 8-8 8' },
  { id: 'logic', d: 'M13 14h6M19 5v18M19 5h6M19 14h6M19 23h6' },
  { id: 'org', d: 'M20 9v5M8 14h24M8 14v5M20 14v5M32 14v5' },
  { id: 'concept', d: 'M18 9L9 19M22 9l9 10M13 22h14' },
  { id: 'timeline', d: 'M11 14h27M17 14v-6h5M26 14v6h5M35 14v-6' },
  { id: 'fishbone', d: 'M27 14H3M22 14l-5-9M22 14l-5 9M12 14L7 5M12 14l-5 9' },
  { id: 'matrix', d: 'M14 3h24v22H14zM22 3v22M30 3v22M14 10h24M14 17h24' },
];

const BRANCHES: BranchStyle[] = ['curve', 'elbow', 'straight'];

function LayoutGlyph({ id, d }: { id: LayoutKind; d: string }) {
  return (
    <svg width="40" height="28" viewBox="0 0 40 28" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      {id === 'mindmap' && <rect x="15" y="11" width="10" height="6" rx="2" />}
      {id === 'logic' && <rect x="3" y="11" width="10" height="6" rx="2" />}
      {(id === 'org' || id === 'concept') && <rect x="15" y="3" width="10" height="6" rx="2" />}
      {id === 'timeline' && <rect x="1" y="11" width="10" height="6" rx="2" />}
      {id === 'fishbone' && <rect x="27" y="11" width="11" height="6" rx="2" />}
      {id === 'matrix' && <rect x="3" y="3" width="10" height="7" rx="1" />}
      <path d={d} />
    </svg>
  );
}

export function FormatPanel({ map, topic, relation, isRoot, inheritedLayout, tab, onTab, onStyle, onBranchLayout, onMarker, onNote, onLinkLabel, onHref, maps, onMap, onRelationLabel, onRelationDelete }: Props) {
  return (
    <aside className="panel" aria-label={t('panel.label')}>
      <div role="tablist" className="tabs">
        <button role="tab" aria-selected={tab === 'style'} onClick={() => onTab('style')}>{t('panel.topic')}</button>
        <button role="tab" aria-selected={tab === 'map'} onClick={() => onTab('map')}>{t('panel.map')}</button>
      </div>
      {tab === 'style' ? (
        relation ? (
          <RelationSection key={relation.id} relation={relation} onLabel={onRelationLabel} onDelete={onRelationDelete} />
        ) : topic ? (
          <TopicSection
            key={topic.id}
            topic={topic}
            isRoot={isRoot}
            inheritedLayout={inheritedLayout}
            onStyle={onStyle}
            onBranchLayout={onBranchLayout}
            onMarker={onMarker}
            onNote={onNote}
            onLinkLabel={onLinkLabel}
            onHref={onHref}
            maps={maps.filter((m) => m.id !== map.id)}
          />
        ) : (
          <p className="muted">{t('panel.pickTopic')}</p>
        )
      ) : (
        <MapSection map={map} onMap={onMap} />
      )}
    </aside>
  );
}

function TopicSection({
  topic,
  isRoot,
  inheritedLayout,
  onStyle,
  onBranchLayout,
  onMarker,
  onNote,
  onLinkLabel,
  onHref,
  maps,
}: {
  topic: Topic;
  isRoot: boolean;
  inheritedLayout: LayoutKind;
  onStyle(p: TopicStyle): void;
  onBranchLayout(l: LayoutKind | undefined): void;
  onMarker(id: string): void;
  onNote(n: string): void;
  onLinkLabel(l: string): void;
  onHref(h: string): void;
  maps: { id: string; title: string }[];
}) {
  const s = topic.style ?? {};
  const [note, setNote] = useState(topic.note ?? '');
  useEffect(() => setNote(topic.note ?? ''), [topic.note]);
  const [linkLabel, setLinkLabel] = useState(topic.linkLabel ?? '');
  useEffect(() => setLinkLabel(topic.linkLabel ?? ''), [topic.linkLabel]);
  const internal = topic.href?.startsWith('keizu:') ? topic.href : '';
  const [url, setUrl] = useState(internal ? '' : topic.href ?? '');
  useEffect(() => setUrl(topic.href?.startsWith('keizu:') ? '' : topic.href ?? ''), [topic.href]);
  const linkedMapId = internal ? /^keizu:map\/([^#]+)/.exec(internal)?.[1] : undefined;
  return (
    <>
      <section>
        <h3 className="lbl">{t('panel.shape')}</h3>
        <div className="grid5">
          {SHAPES.map((sh) => (
            <button key={sh.id} className={`opt ${s.shape === sh.id ? 'on' : ''}`} aria-label={t(`shape.${sh.id}`)} title={t(`shape.${sh.id}`)} aria-pressed={s.shape === sh.id} onClick={() => onStyle({ shape: s.shape === sh.id ? undefined : sh.id })}>
              <span style={{ width: 26, height: 15, boxSizing: 'border-box', ...sh.css }} />
            </button>
          ))}
        </div>
        <h3 className="lbl">{t('panel.fill')}</h3>
        <div className="swatches">
          <button className={`sw auto ${!s.fill ? 'on' : ''}`} aria-label={t('panel.autoFill')} title={t('panel.auto')} onClick={() => onStyle({ fill: undefined })}>A</button>
          {FILL_SWATCHES.map((c) => (
            <button key={c} className={`sw ${s.fill === c ? 'on' : ''}`} aria-label={t('panel.fillColor', { color: c })} style={{ background: c }} onClick={() => onStyle({ fill: c })} />
          ))}
        </div>
      </section>

      <section>
        <h3 className="lbl">{t('panel.text')}</h3>
        <div className="row">
          <label className="field grow">
            <span className="sr">{t('panel.fontSize')}</span>
            <select value={s.fontSize ?? ''} onChange={(e) => onStyle({ fontSize: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">{t('panel.autoSize')}</option>
              {[12, 13, 14, 15, 16, 18, 20, 24, 28, 32].map((n) => (
                <option key={n} value={n}>{n} px</option>
              ))}
            </select>
          </label>
          <div className="seg">
            <button aria-label={t('panel.bold')} aria-pressed={!!s.bold} className={s.bold ? 'on' : ''} style={{ fontWeight: 700 }} onClick={() => onStyle({ bold: s.bold ? undefined : true })}>B</button>
            <button aria-label={t('panel.italic')} aria-pressed={!!s.italic} className={s.italic ? 'on' : ''} style={{ fontStyle: 'italic' }} onClick={() => onStyle({ italic: s.italic ? undefined : true })}>I</button>
          </div>
        </div>
      </section>

      {!isRoot && (
        <section>
          <h3 className="lbl">{t('panel.branchLayout')}</h3>
          <div className="grid4">
            <button
              className={`opt tall ${!topic.layout ? 'on' : ''}`}
              aria-pressed={!topic.layout}
              title={t('panel.branchInherit', { layout: t(`layout.${inheritedLayout}`) })}
              onClick={() => onBranchLayout(undefined)}
            >
              <LayoutGlyph id={inheritedLayout} d={LAYOUTS.find((l) => l.id === inheritedLayout)!.d} />
              <span>{t('panel.inherit')}</span>
            </button>
            {LAYOUTS.map((l) => (
              <button key={l.id} className={`opt tall ${topic.layout === l.id ? 'on' : ''}`} aria-pressed={topic.layout === l.id} title={t(`layout.${l.id}`)} onClick={() => onBranchLayout(l.id)}>
                <LayoutGlyph id={l.id} d={l.d} />
                <span>{t(`layoutShort.${l.id}`)}</span>
              </button>
            ))}
          </div>
          <p className="muted small">{t('panel.branchHint')}</p>
        </section>
      )}

      <section>
        <h3 className="lbl">{t('panel.markers')}</h3>
        <div className="markers">
          {MARKERS.map((m) => {
            const on = topic.markers?.includes(m.id);
            const label = t(`marker.${m.id}` as MessageKey);
            return (
              <button key={m.id} className={`marker ${on ? 'on' : ''}`} title={label} aria-label={label} aria-pressed={!!on} onClick={() => onMarker(m.id)}>
                <svg width="18" height="18" aria-hidden="true">
                  <MarkerGlyph id={m.id} x={0} y={0} />
                </svg>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <label className="field">
          <span className="lbl">{t('panel.note')}</span>
          <textarea
            id="note-field"
            rows={5}
            placeholder={isRoot ? t('panel.notePlaceholderRoot') : t('panel.notePlaceholder')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== (topic.note ?? '') && onNote(note)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        {!!topic.note?.trim() && (
          <label className="check">
            <span>{t('note.showInTopic')}</span>
            <input type="checkbox" checked={!!s.showNote} onChange={(e) => onStyle({ showNote: e.target.checked || undefined })} />
          </label>
        )}
      </section>

      <section>
        <h3 className="lbl">{t('panel.link')}</h3>
        {!isRoot && (
          <label className="field">
            <span className="small muted">{t('panel.linkLabel')}</span>
            <input
              value={linkLabel}
              placeholder={t('panel.linkLabelPlaceholder')}
              onChange={(e) => setLinkLabel(e.target.value)}
              onBlur={() => linkLabel.trim() !== (topic.linkLabel ?? '') && onLinkLabel(linkLabel.trim())}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          </label>
        )}
        <label className="field">
          <span className="small muted">{t('panel.linkMap')}</span>
          <select value={linkedMapId ?? ''} onChange={(e) => onHref(e.target.value ? `keizu:map/${e.target.value}` : '')}>
            <option value="">{t('panel.linkNone')}</option>
            {linkedMapId && !maps.some((m) => m.id === linkedMapId) && <option value={linkedMapId}>{t('panel.linkMissing')}</option>}
            {maps.map((m) => (
              <option key={m.id} value={m.id}>{m.title}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="small muted">{t('panel.linkUrl')}</span>
          <input
            type="url"
            value={url}
            placeholder="https://…"
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => {
              const v = url.trim();
              if (v !== (internal ? '' : topic.href ?? '') && (!v || /^https?:\/\//i.test(v) || /^mailto:/i.test(v))) onHref(v);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
        </label>
        {topic.href && <p className="muted small">{t('panel.linkHint')}</p>}
      </section>
    </>
  );
}

function MapSection({ map, onMap }: { map: MindMap; onMap: Props['onMap'] }) {
  return (
    <>
      <section>
        <h3 className="lbl">{t('panel.theme')}</h3>
        <div className="themes">
          {THEMES.map((th) => (
            <button key={th.id} className={`theme ${map.theme === th.id ? 'on' : ''}`} aria-pressed={map.theme === th.id} onClick={() => onMap({ theme: th.id })}>
              <span className="theme-chip" style={{ background: th.canvas }}>
                <span style={{ background: th.centralFill }} />
                {th.palette.slice(0, 3).map((c, i) => (
                  <i key={i} style={{ background: c }} />
                ))}
              </span>
              {t(`theme.${th.id}` as MessageKey)}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3 className="lbl">{t('panel.layout')}</h3>
        <div className="grid4">
          {LAYOUTS.map((l) => (
            <button key={l.id} className={`opt tall ${map.layout === l.id ? 'on' : ''}`} aria-pressed={map.layout === l.id} title={t(`layout.${l.id}`)} onClick={() => onMap({ layout: l.id })}>
              <LayoutGlyph id={l.id} d={l.d} />
              <span>{t(`layoutShort.${l.id}`)}</span>
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3 className="lbl">{t('panel.branches')}</h3>
        <div className="seg wide">
          {BRANCHES.map((b) => (
            <button key={b} className={map.branchStyle === b ? 'on' : ''} aria-pressed={map.branchStyle === b} onClick={() => onMap({ branchStyle: b })}>
              {t(`branch.${b}`)}
            </button>
          ))}
        </div>
        <label className="check">
          {t('panel.multicolor')}
          <input type="checkbox" checked={map.multicolor} onChange={(e) => onMap({ multicolor: e.target.checked })} />
        </label>
        <label className="check" title={t('tb.notebookTip')}>
          {t('cmd.notebook')}
          <input type="checkbox" checked={!!map.notebook} onChange={(e) => onMap({ notebook: e.target.checked })} />
        </label>
      </section>
    </>
  );
}

function RelationSection({ relation, onLabel, onDelete }: { relation: Relation; onLabel(l: string): void; onDelete(): void }) {
  const [label, setLabel] = useState(relation.label ?? '');
  return (
    <section>
      <h3 className="lbl">{t('panel.relation')}</h3>
      <label className="field">
        <span className="muted">{t('panel.label2')}</span>
        <input
          className="text-input"
          value={label}
          placeholder={t('panel.relationPlaceholder')}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => label !== (relation.label ?? '') && onLabel(label.trim())}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </label>
      <button className="btn" onClick={onDelete}>{t('panel.deleteRelation')}</button>
    </section>
  );
}
