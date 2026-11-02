import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { initHistory, push, redo, undo, type History } from '../core/history';
import { layoutMap, type MapLayout } from '../core/layout';
import {
  addChild,
  addSibling,
  addFloating,
  addRelation,
  countAll,
  floatTopic,
  removeRelation,
  updateRelation,
  findTopic,
  moveTopic,
  pasteTopic,
  removeTopic,
  removeTopicImage,
  setMapProps,
  setTopicImage,
  toggleCollapse,
  toggleMarker,
  updateStyle,
  updateTopic,
  type MindMap,
  type Topic,
} from '../core/model';
import { getTheme } from '../core/themes';
import { SNAPSHOT_EVERY_MS } from '../core/versions';
import type { FileLink, LibraryStore } from '../sync/types';
import { exportKeizu, exportMarkdown, exportOpml, exportPdf, exportPlainJson, exportPng, exportSvg, safeFileName } from './exporters';
import { loadImageFile } from './images';
import { canLinkFiles, chooseSaveTarget, encodeForFile, isDesktop, linkWritable, writeLink } from './platform';
import { VersionPanel } from './VersionPanel';
import { FormatPanel } from './FormatPanel';
import * as I from './Icons';
import { MapCanvas, type CanvasHandle } from './MapCanvas';
import { canvasMeasure } from './measure';

type Dir = 'left' | 'right' | 'up' | 'down';

/** Picks the nearest visible topic in a direction, favouring straight lines. */
function nearest(layout: MapLayout, fromId: string, dir: Dir): string | undefined {
  const a = layout.byId.get(fromId);
  if (!a) return;
  let best: { id: string; score: number } | undefined;
  for (const b of layout.nodes) {
    if (b.id === a.id) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 1) continue;
    const score = along + across * 2.5;
    if (!best || score < best.score) best = { id: b.id, score };
  }
  return best?.id;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

interface Props {
  initial: MindMap;
  store: LibraryStore;
  fontsReady: number;
  onBack(): void;
}

export function Editor({ initial, store, fontsReady, onBack }: Props) {
  const [hist, setHist] = useState<History<MindMap>>(() => initHistory(initial));
  const map = hist.present;
  const [selectedId, setSelectedId] = useState<string | null>(initial.roots[0].id);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSeed, setEditSeed] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<'style' | 'map'>('style');
  const [zoom, setZoom] = useState(1);
  const [saved, setSaved] = useState<'saved' | 'saving'>('saved');
  const [exportOpen, setExportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // The file on disk this map is mirrored to, and whether the last write worked.
  const [link, setLink] = useState<FileLink | undefined>();
  const [fileState, setFileState] = useState<'ok' | 'needs-permission' | 'error'>('ok');
  const imageInput = useRef<HTMLInputElement>(null);
  const latest = useRef(initial);
  latest.current = map;
  const lastSnapshot = useRef(Date.now());
  // Read by the autosave timer without restarting it.
  const fileRef = useRef({ link, fileState });
  fileRef.current = { link, fileState };
  const clipboard = useRef<Topic | null>(null);
  const canvas = useRef<CanvasHandle>(null);

  const mainId = map.roots[0].id;
  const [relationFrom, setRelationFrom] = useState<string | null>(null);
  const [selectedRelId, setSelectedRelId] = useState<string | null>(null);
  const selectedRel = map.relations.find((r) => r.id === selectedRelId);
  const theme = getTheme(map.theme);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => layoutMap(map, canvasMeasure), [map, fontsReady]);
  const selected = selectedId ? findTopic(map, selectedId) : undefined;

  const selectTopic = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setSelectedRelId(null);
  }, []);

  const commit = useCallback((next: MindMap, select?: string | null) => {
    setHist((h) => push(h, next));
    if (select !== undefined) setSelectedId(select);
  }, []);

  // Load the file link, and keep a version-history snapshot of the map as it
  // was opened and as it is left.
  useEffect(() => {
    let alive = true;
    store.getLink(initial.id).then(async (l) => {
      if (!alive || !l) return;
      setLink(l);
      if (!(await linkWritable(l))) setFileState('needs-permission');
    });
    store.addVersion(initial, 'open').catch(() => {});
    return () => {
      alive = false;
      store.addVersion(latest.current, 'close').catch(() => {});
    };
  }, [store, initial]);

  /** Writes the map to its linked file, if any. */
  const writeFile = useCallback(
    async (m: MindMap, target: FileLink | undefined, interactive: boolean) => {
      if (!target) return;
      try {
        const ok = await writeLink(target, encodeForFile(m, target.name), interactive);
        setFileState(ok ? 'ok' : 'needs-permission');
      } catch {
        setFileState('error');
      }
    },
    [],
  );

  // Autosave shortly after each change. Maps always live on this device
  // first (and in their linked file, if any); a server syncs from here later.
  useEffect(() => {
    if (map === initial) return;
    setSaved('saving');
    const t = setTimeout(() => {
      const next = { ...map, version: map.version + 1 };
      store
        .save(next)
        .then(() => {
          setSaved('saved');
          if (Date.now() - lastSnapshot.current > SNAPSHOT_EVERY_MS) {
            lastSnapshot.current = Date.now();
            store.addVersion(next, 'auto').catch(() => {});
          }
        })
        .catch(() => setToast('Kaydedilemedi: tarayıcı deposu dolu olabilir.'));
      const f = fileRef.current;
      if (f.fileState !== 'needs-permission') writeFile(next, f.link, false);
    }, 400);
    return () => clearTimeout(t);
  }, [map, initial, store, writeFile]);

  /** "Save to computer": writes the linked file, or asks where to keep one. */
  const saveToFile = async (saveAs = false) => {
    try {
      if (link && !saveAs) {
        await writeFile(map, link, true);
        setToast(`${link.name} dosyasına kaydedildi`);
        return;
      }
      const target = await chooseSaveTarget(`${safeFileName(map.title)}.keizu`);
      if (target) {
        // If the link can't be stored it still works for this session.
        await store.setLink(map.id, target).catch(() => {});
        setLink(target);
        await writeFile(map, target, true);
        setToast(`${target.name} dosyasına kaydedildi. Değişiklikler bu dosyaya otomatik yazılacak.`);
      } else if (!canLinkFiles()) {
        // Browsers without file handles: a one-off download.
        if (await exportKeizu(map)) setToast('Dosya indirildi');
      }
    } catch (err) {
      setToast((err as Error).message || 'Kaydedilemedi');
    }
  };

  const unlinkFile = async () => {
    await store.setLink(map.id, undefined);
    setLink(undefined);
    setFileState('ok');
    setToast('Dosya bağlantısı kaldırıldı; harita bu cihazda kalmaya devam ediyor');
  };

  const pickImage = async (file: File) => {
    if (!selectedId) return;
    try {
      const img = await loadImageFile(file);
      commit(setTopicImage(map, selectedId, img.dataUrl, img.width, img.height));
    } catch (err) {
      setToast((err as Error).message || 'Görsel eklenemedi');
    }
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // If the selected topic disappears (undo, collapse), fall back to the root.
  useEffect(() => {
    if (selectedId && !layout.byId.has(selectedId)) setSelectedId(mainId);
  }, [layout, selectedId, mainId]);

  const startEdit = (id: string, seed: string | null = null) => {
    setSelectedId(id);
    setEditSeed(seed);
    setEditingId(id);
  };

  const actions = {
    addChild() {
      if (!selectedId) return;
      const r = addChild(map, selectedId, selectedId === mainId ? 'Ana konu' : 'Alt konu');
      commit(r.map, r.id);
      startEdit(r.id);
    },
    addSibling(before = false) {
      if (!selectedId) return;
      const r = addSibling(map, selectedId, selectedId === mainId ? 'Ana konu' : 'Konu', before);
      commit(r.map, r.id);
      startEdit(r.id);
    },
    remove() {
      if (selectedRelId) {
        commit(removeRelation(map, selectedRelId));
        setSelectedRelId(null);
        return;
      }
      if (!selectedId || selectedId === mainId) return;
      const r = removeTopic(map, selectedId);
      commit(r.map, r.nextId);
    },
    undo: () => setHist((h) => undo(h)),
    redo: () => setHist((h) => redo(h)),
    collapse() {
      if (selectedId) commit(toggleCollapse(map, selectedId));
    },
    copy(cut = false) {
      if (!selected) return;
      clipboard.current = selected;
      if (cut && selectedId !== mainId) actions.remove();
      setToast(cut ? 'Konu kesildi' : 'Konu kopyalandı');
    },
    paste() {
      if (!selectedId || !clipboard.current) return;
      const r = pasteTopic(map, selectedId, clipboard.current);
      commit(r.map, r.id);
    },
    relation() {
      if (!selectedId) return;
      setRelationFrom(selectedId);
      setToast('İlişkinin gideceği konuya tıkla (iptal: Esc)');
    },
    floating(pos = { x: 0, y: (layout.bounds.maxY ?? 0) + 120 }) {
      const r = addFloating(map, pos);
      commit(r.map, r.id);
      startEdit(r.id);
    },
    note() {
      setPanelOpen(true);
      setPanelTab('style');
      setTimeout(() => document.getElementById('note-field')?.focus(), 0);
    },
  };

  // Keyboard shortcuts (inactive while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingId) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const k = e.key;
      const handled = () => e.preventDefault();

      if (mod) {
        const lower = k.toLowerCase();
        if (lower === 'z' && !e.shiftKey) return handled(), actions.undo();
        if ((lower === 'z' && e.shiftKey) || lower === 'y') return handled(), actions.redo();
        if (lower === 'c') return handled(), actions.copy();
        if (lower === 'x') return handled(), actions.copy(true);
        if (lower === 'v') return handled(), actions.paste();
        if (lower === 's') return handled(), saveToFile(e.shiftKey);
        if (k === '/') return handled(), actions.collapse();
        if (k === '=' || k === '+') return handled(), canvas.current?.zoomBy(1.2);
        if (k === '-') return handled(), canvas.current?.zoomBy(1 / 1.2);
        if (k === '0') return handled(), canvas.current?.fit();
        return;
      }
      if (k === 'Tab' || k === 'Insert') return handled(), actions.addChild();
      if (k === 'Enter') return handled(), actions.addSibling(e.shiftKey);
      if (k === 'Delete' || k === 'Backspace') return handled(), actions.remove();
      if (selectedRelId) return;
      if (k === 'F2' || k === ' ') return handled(), selectedId && startEdit(selectedId);
      if (k === 'Escape') {
        handled();
        if (relationFrom) setRelationFrom(null);
        else selectTopic(null), setSelectedRelId(null);
        return;
      }
      if (k === '?') return handled(), setHelpOpen((v) => !v);
      if (k.startsWith('Arrow')) {
        handled();
        const id = selectedId ?? mainId;
        const next = nearest(layout, id, k.slice(5).toLowerCase() as Dir);
        if (next) selectTopic(next);
        return;
      }
      // Typing a character starts editing with that character.
      if (k.length === 1 && !e.altKey && selectedId) {
        handled();
        startEdit(selectedId, k);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const runExport = async (kind: 'png' | 'svg' | 'pdf' | 'md' | 'opml' | 'keizu' | 'json') => {
    setExportOpen(false);
    try {
      if (kind === 'png') await exportPng(map, layout, theme);
      if (kind === 'svg') await exportSvg(map, layout, theme);
      if (kind === 'pdf') await exportPdf(map, layout, theme);
      if (kind === 'md') await exportMarkdown(map);
      if (kind === 'opml') await exportOpml(map);
      if (kind === 'keizu') await exportKeizu(map);
      if (kind === 'json') await exportPlainJson(map);
    } catch (err) {
      setToast((err as Error).message || 'Dışa aktarma başarısız oldu');
    }
  };

  const modKey = isMac ? '⌘' : 'Ctrl';

  return (
    <div className={`editor ${theme.dark ? 'dark-map' : ''}`}>
      <header className="topbar">
        <div className="tb-left">
          <button className="ib" aria-label="Haritalara dön" title="Haritalara dön" onClick={onBack}>
            <I.Menu size={20} />
          </button>
          <div className="logo-mark"><I.Logo /></div>
          <div className="doc-title">
            <span className="name">{map.title}</span>
            {link && fileState === 'needs-permission' ? (
              <button className="status warn" onClick={() => saveToFile()} title="Tarayıcı, dosyaya yazmak için yeniden izin istiyor">
                {link.name} dosyasına yazmak için izin ver
              </button>
            ) : link && fileState === 'error' ? (
              <button className="status warn" onClick={() => saveToFile()} title="Yeniden dene">
                {link.name} dosyasına yazılamadı, yeniden dene
              </button>
            ) : (
              <span className={`status ${saved}`} title={link ? (link.kind === 'path' ? link.path : link.name) : undefined}>
                {saved === 'saved' ? <><I.Check size={13} /> {link ? `Kaydedildi · ${link.name}` : 'Bu cihaza kaydedildi'}</> : 'Kaydediliyor…'}
              </span>
            )}
          </div>
          <div className="tb-group">
            <button className="ib" aria-label="Geri al" title={`Geri al (${modKey}+Z)`} disabled={!hist.past.length} onClick={actions.undo}><I.Undo /></button>
            <button className="ib" aria-label="Yinele" title={`Yinele (${modKey}+Shift+Z)`} disabled={!hist.future.length} onClick={actions.redo}><I.Redo /></button>
          </div>
        </div>

        <nav className="tb-center" aria-label="Ekle">
          <button className="tb" title="Kardeş konu (Enter)" disabled={!selectedId} onClick={() => actions.addSibling()}><I.TopicIcon />Konu</button>
          <button className="tb" title="Alt konu (Tab)" disabled={!selectedId} onClick={actions.addChild}><I.SubtopicIcon />Alt konu</button>
          <button className={`tb ${relationFrom ? 'on' : ''}`} title="İlişki oku: başka bir konuya bağla" disabled={!selectedId} onClick={actions.relation}><I.RelationIcon />İlişki</button>
          <button className="tb" title="Serbest konu (boş alana çift tıkla)" onClick={() => actions.floating()}><I.FloatingIcon />Serbest konu</button>
          <button className="tb" title="İşaret ekle" disabled={!selectedId} onClick={() => { setPanelOpen(true); setPanelTab('style'); }}><I.MarkerIcon />İşaret</button>
          <button className="tb" title="Not ekle" disabled={!selectedId} onClick={actions.note}><I.NoteIcon />Not</button>
          {selected?.image ? (
            <button className="tb" title="Konudaki görseli kaldır" onClick={() => selectedId && commit(removeTopicImage(map, selectedId))}><I.ImageIcon />Görseli kaldır</button>
          ) : (
            <button className="tb" title="Konuya görsel ekle" disabled={!selectedId} onClick={() => imageInput.current?.click()}><I.ImageIcon />Görsel</button>
          )}
          <input
            ref={imageInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pickImage(f);
              e.target.value = '';
            }}
          />
          <button className="tb" title={`Daralt / genişlet (${modKey}+/)`} disabled={!selected?.children.length || selectedId === mainId} onClick={actions.collapse}><I.Collapse />Daralt</button>
          <button className="tb" title="Sil (Delete)" disabled={!selectedRelId && (!selectedId || selectedId === mainId)} onClick={actions.remove}><I.Trash />Sil</button>
        </nav>

        <div className="tb-right">
          <button
            className={`btn ${link ? '' : 'primary'}`}
            title={link ? `${link.name} dosyasına kaydet (${modKey}+S)` : `Haritayı dosya olarak kaydet (${modKey}+S)`}
            onClick={() => saveToFile()}
          >
            <I.Save size={16} /> {isDesktop ? 'Kaydet' : 'Bilgisayara kaydet'}
          </button>
          <div className="menu-wrap">
            <button className="btn" aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen((v) => !v)}>
              <I.Export size={16} /> Dışa aktar
            </button>
            {exportOpen && (
              <div className="menu" role="menu" onMouseLeave={() => setExportOpen(false)}>
                {canLinkFiles() && (
                  <button role="menuitem" onClick={() => { setExportOpen(false); saveToFile(true); }}>Farklı kaydet…</button>
                )}
                {link && (
                  <button role="menuitem" onClick={() => { setExportOpen(false); unlinkFile(); }}>Dosya bağlantısını kaldır</button>
                )}
                {(canLinkFiles() || link) && <hr />}
                <button role="menuitem" onClick={() => runExport('png')}>PNG görsel</button>
                <button role="menuitem" onClick={() => runExport('svg')}>SVG vektör</button>
                <button role="menuitem" onClick={() => runExport('pdf')}>PDF</button>
                <button role="menuitem" onClick={() => runExport('md')}>Markdown</button>
                <button role="menuitem" onClick={() => runExport('opml')}>OPML (ana hat)</button>
                <button role="menuitem" onClick={() => runExport('keizu')}>Keizu dosyası (.keizu)</button>
                <button role="menuitem" onClick={() => runExport('json')}>Düz JSON (git dostu)</button>
              </div>
            )}
          </div>
          <button className={`ib ${historyOpen ? 'on' : ''}`} aria-label="Sürüm geçmişi" aria-pressed={historyOpen} title="Sürüm geçmişi" onClick={() => setHistoryOpen((v) => !v)}><I.History /></button>
          <button className="ib" aria-label="Klavye kısayolları" title="Klavye kısayolları (?)" onClick={() => setHelpOpen((v) => !v)}><I.Keyboard /></button>
          <button className={`ib ${panelOpen ? 'on' : ''}`} aria-label="Biçim paneli" aria-pressed={panelOpen} title="Biçim paneli" onClick={() => setPanelOpen((v) => !v)}><I.Panel /></button>
        </div>
      </header>

      <div className="workspace">
        <main className="canvas-area">
          <MapCanvas
            ref={canvas}
            map={map}
            layout={layout}
            theme={theme}
            selectedId={selectedId}
            editingId={editingId}
            editSeed={editSeed}
            onSelect={selectTopic}
            selectedRelId={selectedRelId}
            relationFrom={relationFrom}
            onSelectRelation={(id) => {
              setSelectedRelId(id);
              setSelectedId(null);
              setPanelOpen(true);
              setPanelTab('style');
            }}
            onPickRelationTarget={(id) => {
              if (relationFrom && id !== relationFrom) {
                const r = addRelation(map, relationFrom, id);
                if (r.id) {
                  commit(r.map);
                  setSelectedRelId(r.id);
                  setSelectedId(null);
                }
              }
              setRelationFrom(null);
              setToast(null);
            }}
            onFloat={(id, pos) => commit(floatTopic(map, id, pos), id)}
            onCreateFloating={(pos) => actions.floating(pos)}
            onStartEdit={(id) => startEdit(id)}
            onCommitEdit={(id, text) => {
              setEditingId(null);
              setEditSeed(null);
              const t = findTopic(map, id);
              const clean = text.replace(/\s+$/g, '');
              if (t && clean && clean !== t.text) commit(updateTopic(map, id, { text: clean }));
            }}
            onCancelEdit={() => {
              setEditingId(null);
              setEditSeed(null);
            }}
            onMove={(id, parent) => commit(moveTopic(map, id, parent))}
            onToggleCollapse={(id) => commit(toggleCollapse(map, id))}
            onZoomChange={setZoom}
          />
          <div className="chip stats">{countAll(map)} konu · {map.layout === 'mindmap' ? 'Zihin haritası' : map.layout === 'logic' ? 'Mantık şeması' : 'Organizasyon şeması'}</div>
          <div className="zoom">
            <button className="ib" aria-label="Uzaklaştır" onClick={() => canvas.current?.zoomBy(1 / 1.2)}><I.Minus size={16} /></button>
            <span>{Math.round(zoom * 100)}%</span>
            <button className="ib" aria-label="Yakınlaştır" onClick={() => canvas.current?.zoomBy(1.2)}><I.Plus size={16} /></button>
            <span className="sep" />
            <button className="ib" aria-label="Haritayı sığdır" title={`Sığdır (${modKey}+0)`} onClick={() => canvas.current?.fit()}><I.Target size={16} /></button>
          </div>
          {helpOpen && <Shortcuts modKey={modKey} onClose={() => setHelpOpen(false)} />}
          {toast && <div className="toast" role="status">{toast}</div>}
        </main>

        {historyOpen && (
          <VersionPanel
            store={store}
            map={map}
            fontsReady={fontsReady}
            onClose={() => setHistoryOpen(false)}
            onRestore={async (old) => {
              await store.addVersion(map, 'restore').catch(() => {});
              commit({ ...old, id: map.id, version: map.version, updatedAt: new Date().toISOString() }, old.roots[0].id);
              setToast(`Sürüm geri yüklendi (geri almak için ${modKey}+Z)`);
            }}
          />
        )}

        {panelOpen && !historyOpen && (
          <FormatPanel
            map={map}
            topic={selected}
            relation={selectedRel}
            onRelationLabel={(label) => selectedRelId && commit(updateRelation(map, selectedRelId, { label: label || undefined }))}
            onRelationDelete={() => actions.remove()}
            isRoot={selectedId === mainId}
            tab={panelTab}
            onTab={setPanelTab}
            onStyle={(p) => selectedId && commit(updateStyle(map, selectedId, p))}
            onMarker={(m) => selectedId && commit(toggleMarker(map, selectedId, m))}
            onNote={(n) => selectedId && commit(updateTopic(map, selectedId, { note: n || undefined }))}
            onMap={(p) => commit(setMapProps(map, p))}
          />
        )}
      </div>
    </div>
  );
}

function Shortcuts({ modKey, onClose }: { modKey: string; onClose(): void }) {
  const rows: [string, string][] = [
    ['Tab', 'Alt konu ekle'],
    ['Enter', 'Kardeş konu ekle (Shift ile öncesine)'],
    ['F2, Boşluk veya yazmaya başla', 'Metni düzenle'],
    ['Shift+Enter (düzenlerken)', 'Yeni satır'],
    ['Delete', 'Konuyu sil'],
    ['Ok tuşları', 'Konular arasında gezin'],
    [`${modKey}+/`, 'Daralt / genişlet'],
    [`${modKey}+S, ${modKey}+Shift+S`, 'Dosyaya kaydet, farklı kaydet'],
    [`${modKey}+Z, ${modKey}+Shift+Z`, 'Geri al, yinele'],
    [`${modKey}+C / X / V`, 'Konuyu kopyala, kes, yapıştır'],
    [`${modKey}+tekerlek, ${modKey}+0`, 'Yakınlaştır, sığdır'],
    ['Sürükle', 'Konuyu başka bir konunun altına taşı'],
    ['Boş alana sürükle veya çift tıkla', 'Serbest konu (ayrı ağaç)'],
  ];
  return (
    <div className="shortcuts" role="dialog" aria-label="Klavye kısayolları">
      <div className="sc-head">
        <strong>Klavye kısayolları</strong>
        <button className="ib" aria-label="Kapat" onClick={onClose}>×</button>
      </div>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt><kbd>{k}</kbd></dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
