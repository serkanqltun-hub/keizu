import { useEffect, useRef, useState } from 'react';
import { fromJSON, fromMarkdown } from '../core/io';
import { createMap, type LayoutKind, type MindMap } from '../core/model';
import type { MapStore, MapSummary } from '../sync/types';
import * as I from './Icons';

interface Props {
  store: MapStore;
  onOpen(map: MindMap): void;
}

const TEMPLATES: { layout: LayoutKind; name: string; svg: JSX.Element }[] = [
  {
    layout: 'mindmap',
    name: 'Zihin haritası',
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
    name: 'Mantık şeması',
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
    name: 'Organizasyon şeması',
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
];

function when(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'az önce';
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  if (diff < 86400) return `bugün ${d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function Home({ store, onOpen }: Props) {
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => store.list().then(setMaps);
  useEffect(() => {
    refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async (layout: LayoutKind) => {
    const map = { ...createMap('Merkez konu'), layout };
    await store.save(map);
    onOpen(map);
  };

  const open = async (id: string) => {
    const map = await store.get(id);
    if (map) onOpen(map);
  };

  const remove = async (s: MapSummary) => {
    if (!window.confirm(`"${s.title}" silinsin mi? Bu işlem geri alınamaz.`)) return;
    await store.remove(s.id);
    refresh();
  };

  const importFile = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const map = /\.(md|markdown|txt)$/i.test(file.name) ? fromMarkdown(text, file.name.replace(/\.[^.]+$/, '')) : fromJSON(text);
      await store.save(map);
      onOpen(map);
    } catch (e) {
      setError((e as Error).message || 'Dosya açılamadı.');
    }
  };

  const shown = (maps ?? []).filter((m) => m.title.toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr')));

  return (
    <div className="home">
      <aside className="home-side">
        <div className="brand">
          <div className="logo-mark big"><I.Logo size={20} /></div>
          <span>Keizu</span>
        </div>
        <button className="btn primary block" onClick={() => create('mindmap')}>
          <I.Plus size={16} /> Yeni harita
        </button>
        <button className="btn block" onClick={() => fileInput.current?.click()}>
          <I.Import size={16} /> Dosya aç
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".keizu,.json,.md,.markdown,.txt"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importFile(f);
            e.target.value = '';
          }}
        />
        <div className="local-card">
          <strong>Bu cihazda</strong>
          <span>Haritaların yalnız bu cihazda saklanır, hesap veya sunucu gerekmez.</span>
          <span className="muted">Senkron ve ortak çalışma için kendi sunucunu bağlama seçeneği yakında.</span>
        </div>
      </aside>

      <main className="home-main">
        <label className="search">
          <I.Search />
          <span className="sr">Haritalarda ara</span>
          <input type="search" placeholder="Haritalarda ara" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>

        {error && <div className="error" role="alert">{error}</div>}

        <section>
          <h2>Yeni başla</h2>
          <div className="tpl-grid">
            {TEMPLATES.map((t) => (
              <button key={t.layout} className="tpl" onClick={() => create(t.layout)}>
                <span className="tpl-art">{t.svg}</span>
                {t.name}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>Haritalarım</h2>
          {maps === null ? null : shown.length === 0 ? (
            <p className="muted">{maps.length ? 'Aramayla eşleşen harita yok.' : 'Henüz harita yok. Yukarıdan bir tane oluştur ya da bir dosya aç.'}</p>
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
                    <span className="card-meta">{when(m.updatedAt)}</span>
                  </button>
                  <button className="ib card-del" aria-label={`${m.title} haritasını sil`} title="Sil" onClick={() => remove(m)}>
                    <I.Trash size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
