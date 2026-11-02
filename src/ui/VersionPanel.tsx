import { useEffect, useMemo, useState } from 'react';
import { layoutMap } from '../core/layout';
import type { MindMap } from '../core/model';
import { getTheme } from '../core/themes';
import type { VersionInfo, VersionStore } from '../sync/types';
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

const REASON: Record<VersionInfo['reason'], string> = {
  open: 'Açılırken',
  close: 'Kapatılırken',
  auto: 'Otomatik',
  restore: 'Geri yüklemeden önce',
};

function stamp(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return today ? `Bugün ${time}` : `${d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })} ${time}`;
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
    <aside className="panel versions" aria-label="Sürüm geçmişi">
      <div className="sc-head">
        <strong>Sürüm geçmişi</strong>
        <button className="ib" aria-label="Kapat" onClick={onClose}>×</button>
      </div>
      <p className="muted small">
        Keizu bu cihazda haritanın eski hallerini kendiliğinden saklar: açarken, kapatırken ve düzenlerken en çok beş dakikada bir.
        Eski sürümler zamanla seyreltilir.
      </p>
      {picked && (
        <div className="version-preview">
          <Preview map={picked.map} fontsReady={fontsReady} />
          <div className="row">
            <button className="btn primary" onClick={() => onRestore(picked.map)}>Bu sürümü geri yükle</button>
            <button className="btn" onClick={() => setPicked(null)}>Vazgeç</button>
          </div>
        </div>
      )}
      {versions === null ? null : versions.length === 0 ? (
        <p className="muted small">Henüz kayıtlı sürüm yok. Düzenledikçe burada birikir.</p>
      ) : (
        <ul className="version-list">
          {versions.map((v) => (
            <li key={v.id}>
              <button className={picked?.info.id === v.id ? 'on' : ''} onClick={() => pick(v)}>
                <I.History size={16} />
                <span className="v-main">
                  <span>{stamp(v.savedAt)}</span>
                  <span className="muted">{REASON[v.reason]} · {v.topics} konu</span>
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
      aria-label={`${map.title} önizlemesi`}
    >
      <MapSvg map={map} layout={layout} theme={theme} />
    </svg>
  );
}
