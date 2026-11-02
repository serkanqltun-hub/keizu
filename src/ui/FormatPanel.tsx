import { useEffect, useState } from 'react';
import { MARKERS } from '../core/markers';
import type { BranchStyle, LayoutKind, MindMap, Relation, Topic, TopicShape, TopicStyle } from '../core/model';
import { FILL_SWATCHES, THEMES } from '../core/themes';
import { MarkerGlyph } from './MapSvg';

interface Props {
  map: MindMap;
  topic: Topic | undefined;
  relation: Relation | undefined;
  isRoot: boolean;
  onRelationLabel(label: string): void;
  onRelationDelete(): void;
  tab: 'style' | 'map';
  onTab(tab: 'style' | 'map'): void;
  onStyle(patch: TopicStyle): void;
  onMarker(id: string): void;
  onNote(note: string): void;
  onMap(patch: Partial<Pick<MindMap, 'theme' | 'layout' | 'branchStyle' | 'multicolor'>>): void;
}

const SHAPES: { id: TopicShape; label: string; css: React.CSSProperties }[] = [
  { id: 'rounded', label: 'Yuvarlak dikdörtgen', css: { borderRadius: 5, border: '1.5px solid currentColor' } },
  { id: 'pill', label: 'Hap', css: { borderRadius: 8, border: '1.5px solid currentColor' } },
  { id: 'rect', label: 'Dikdörtgen', css: { border: '1.5px solid currentColor' } },
  { id: 'underline', label: 'Alt çizgi', css: { height: 10, borderBottom: '1.5px solid currentColor' } },
  { id: 'none', label: 'Şekilsiz', css: { border: '1.5px dashed currentColor', opacity: 0.4, borderRadius: 5 } },
];

const LAYOUTS: { id: LayoutKind; label: string; d: string }[] = [
  { id: 'mindmap', label: 'Zihin haritası', d: 'M25 14c4 0 4-8 8-8M25 14c4 0 4 8 8 8M15 14c-4 0-4-8-8-8M15 14c-4 0-4 8-8 8' },
  { id: 'logic', label: 'Mantık şeması', d: 'M13 14h6M19 5v18M19 5h6M19 14h6M19 23h6' },
  { id: 'org', label: 'Organizasyon şeması', d: 'M20 9v5M8 14h24M8 14v5M20 14v5M32 14v5' },
];

const BRANCHES: { id: BranchStyle; label: string }[] = [
  { id: 'curve', label: 'Eğri' },
  { id: 'elbow', label: 'Dirsek' },
  { id: 'straight', label: 'Düz' },
];

export function FormatPanel({ map, topic, relation, isRoot, tab, onTab, onStyle, onMarker, onNote, onMap, onRelationLabel, onRelationDelete }: Props) {
  return (
    <aside className="panel" aria-label="Biçim">
      <div role="tablist" className="tabs">
        <button role="tab" aria-selected={tab === 'style'} onClick={() => onTab('style')}>Konu</button>
        <button role="tab" aria-selected={tab === 'map'} onClick={() => onTab('map')}>Harita</button>
      </div>
      {tab === 'style' ? (
        relation ? (
          <RelationSection key={relation.id} relation={relation} onLabel={onRelationLabel} onDelete={onRelationDelete} />
        ) : topic ? (
          <TopicSection key={topic.id} topic={topic} isRoot={isRoot} onStyle={onStyle} onMarker={onMarker} onNote={onNote} />
        ) : (
          <p className="muted">Biçimlendirmek için bir konu seç.</p>
        )
      ) : (
        <MapSection map={map} onMap={onMap} />
      )}
    </aside>
  );
}

function TopicSection({ topic, isRoot, onStyle, onMarker, onNote }: { topic: Topic; isRoot: boolean; onStyle(p: TopicStyle): void; onMarker(id: string): void; onNote(n: string): void }) {
  const s = topic.style ?? {};
  const [note, setNote] = useState(topic.note ?? '');
  useEffect(() => setNote(topic.note ?? ''), [topic.note]);
  return (
    <>
      <section>
        <h3 className="lbl">Şekil</h3>
        <div className="grid5">
          {SHAPES.map((sh) => (
            <button key={sh.id} className={`opt ${s.shape === sh.id ? 'on' : ''}`} aria-label={sh.label} title={sh.label} aria-pressed={s.shape === sh.id} onClick={() => onStyle({ shape: s.shape === sh.id ? undefined : sh.id })}>
              <span style={{ width: 26, height: 15, boxSizing: 'border-box', ...sh.css }} />
            </button>
          ))}
        </div>
        <h3 className="lbl">Dolgu</h3>
        <div className="swatches">
          <button className={`sw auto ${!s.fill ? 'on' : ''}`} aria-label="Otomatik dolgu" title="Otomatik" onClick={() => onStyle({ fill: undefined })}>A</button>
          {FILL_SWATCHES.map((c) => (
            <button key={c} className={`sw ${s.fill === c ? 'on' : ''}`} aria-label={`Dolgu ${c}`} style={{ background: c }} onClick={() => onStyle({ fill: c })} />
          ))}
        </div>
      </section>

      <section>
        <h3 className="lbl">Metin</h3>
        <div className="row">
          <label className="field grow">
            <span className="sr">Yazı boyutu</span>
            <select value={s.fontSize ?? ''} onChange={(e) => onStyle({ fontSize: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">Otomatik boyut</option>
              {[12, 13, 14, 15, 16, 18, 20, 24, 28, 32].map((n) => (
                <option key={n} value={n}>{n} px</option>
              ))}
            </select>
          </label>
          <div className="seg">
            <button aria-label="Kalın" aria-pressed={!!s.bold} className={s.bold ? 'on' : ''} style={{ fontWeight: 700 }} onClick={() => onStyle({ bold: s.bold ? undefined : true })}>B</button>
            <button aria-label="İtalik" aria-pressed={!!s.italic} className={s.italic ? 'on' : ''} style={{ fontStyle: 'italic' }} onClick={() => onStyle({ italic: s.italic ? undefined : true })}>I</button>
          </div>
        </div>
      </section>

      <section>
        <h3 className="lbl">İşaretler</h3>
        <div className="markers">
          {MARKERS.map((m) => {
            const on = topic.markers?.includes(m.id);
            return (
              <button key={m.id} className={`marker ${on ? 'on' : ''}`} title={m.label} aria-label={m.label} aria-pressed={!!on} onClick={() => onMarker(m.id)}>
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
          <span className="lbl">Not</span>
          <textarea
            id="note-field"
            rows={5}
            placeholder={isRoot ? 'Haritayla ilgili not…' : 'Bu konuya not ekle…'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== (topic.note ?? '') && onNote(note)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
      </section>
    </>
  );
}

function MapSection({ map, onMap }: { map: MindMap; onMap: Props['onMap'] }) {
  return (
    <>
      <section>
        <h3 className="lbl">Tema</h3>
        <div className="themes">
          {THEMES.map((t) => (
            <button key={t.id} className={`theme ${map.theme === t.id ? 'on' : ''}`} aria-pressed={map.theme === t.id} onClick={() => onMap({ theme: t.id })}>
              <span className="theme-chip" style={{ background: t.canvas }}>
                <span style={{ background: t.centralFill }} />
                {t.palette.slice(0, 3).map((c, i) => (
                  <i key={i} style={{ background: c }} />
                ))}
              </span>
              {t.name}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3 className="lbl">Yerleşim</h3>
        <div className="grid3">
          {LAYOUTS.map((l) => (
            <button key={l.id} className={`opt tall ${map.layout === l.id ? 'on' : ''}`} aria-pressed={map.layout === l.id} title={l.label} onClick={() => onMap({ layout: l.id })}>
              <svg width="40" height="28" viewBox="0 0 40 28" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                {l.id === 'mindmap' && <rect x="15" y="11" width="10" height="6" rx="2" />}
                {l.id === 'logic' && <rect x="3" y="11" width="10" height="6" rx="2" />}
                {l.id === 'org' && <rect x="15" y="3" width="10" height="6" rx="2" />}
                <path d={l.d} />
              </svg>
              <span>{l.label}</span>
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3 className="lbl">Dallar</h3>
        <div className="seg wide">
          {BRANCHES.map((b) => (
            <button key={b.id} className={map.branchStyle === b.id ? 'on' : ''} aria-pressed={map.branchStyle === b.id} onClick={() => onMap({ branchStyle: b.id })}>
              {b.label}
            </button>
          ))}
        </div>
        <label className="check">
          Çok renkli dallar
          <input type="checkbox" checked={map.multicolor} onChange={(e) => onMap({ multicolor: e.target.checked })} />
        </label>
      </section>
    </>
  );
}

function RelationSection({ relation, onLabel, onDelete }: { relation: Relation; onLabel(l: string): void; onDelete(): void }) {
  const [label, setLabel] = useState(relation.label ?? '');
  return (
    <section>
      <h3 className="lbl">İlişki</h3>
      <label className="field">
        <span className="muted">Etiket</span>
        <input
          className="text-input"
          value={label}
          placeholder="örn. besler, bağlı"
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => label !== (relation.label ?? '') && onLabel(label.trim())}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </label>
      <button className="btn" onClick={onDelete}>İlişkiyi sil</button>
    </section>
  );
}
