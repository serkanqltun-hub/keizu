import { useEffect, useMemo, useState } from 'react';
import { layoutMap } from '../core/layout';
import type { MindMap } from '../core/model';
import { getTheme } from '../core/themes';
import type { VersionInfo, VersionStore } from '../sync/types';
import { locale, t, type MessageKey } from '../i18n';
import * as I from './Icons';
import { MapSvg } from './MapSvg';
import { canvasMeasure } from './measure';

interface Props {
  store: VersionStore;
  map: MindMap;
  fontsReady: number;
  onClose(): void;
  onRestore(map: MindMap): void;
}

const reasonLabel = (r: VersionInfo['reason']) => t(`versions.reason.${r}` as MessageKey);

function stamp(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  return today ? t('versions.today', { time }) : `${d.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })} ${time}`;
}

export function VersionPanel({ store, map, fontsReady, onClose, onRestore }: Props) {
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [picked, setPicked] = useState<{ info: VersionInfo; map: MindMap } | null>(null);

  useEffect(() => {
    store.listVersions(map.id).then(setVersions).catch(() => setVersions([]));
  }, [store, map.id]);

  const pick = async (info: VersionInfo) => {
    const m = await store.getVersion(info.id);
    if (m) setPicked({ info, map: m });
  };

  return (
    <aside className="panel versions" aria-label={t('versions.title')}>
      <div className="sc-head">
        <strong>{t('versions.title')}</strong>
        <button className="ib" aria-label={t('common.close')} onClick={onClose}>×</button>
      </div>
      <p className="muted small">{t('versions.intro')}</p>
      {picked && (
        <div className="version-preview">
          <Preview map={picked.map} fontsReady={fontsReady} />
          <div className="row">
            <button className="btn primary" onClick={() => onRestore(picked.map)}>{t('versions.restore')}</button>
            <button className="btn" onClick={() => setPicked(null)}>{t('common.cancel')}</button>
          </div>
        </div>
      )}
      {versions === null ? null : versions.length === 0 ? (
        <p className="muted small">{t('versions.empty')}</p>
      ) : (
        <ul className="version-list">
          {versions.map((v) => (
            <li key={v.id}>
              <button className={picked?.info.id === v.id ? 'on' : ''} onClick={() => pick(v)}>
                <I.History size={16} />
                <span className="v-main">
                  <span>{stamp(v.savedAt)}</span>
                  <span className="muted">{reasonLabel(v.reason)} · {t('common.topics', { n: v.topics })}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function Preview({ map, fontsReady }: { map: MindMap; fontsReady: number }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => layoutMap(map, canvasMeasure), [map, fontsReady]);
  const theme = getTheme(map.theme);
  const { minX, minY, maxX, maxY } = layout.bounds;
  const pad = 24;
  return (
    <svg
      className="preview-svg"
      viewBox={`${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`}
      style={{ background: theme.canvas }}
      role="img"
      aria-label={t('versions.preview', { title: map.title })}
    >
      <MapSvg map={map} layout={layout} theme={theme} />
    </svg>
  );
}
