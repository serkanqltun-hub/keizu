import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { initHistory, push, redo, replace, undo, type History } from '../core/history';
import { layoutMap, type MapLayout } from '../core/layout';
import { outlineRows } from '../core/outline';
import {
  addChild,
  findParent,
  indentTopic,
  moveAmongSiblings,
  outdentTopic,
  revealTopic,
  setBranchLayout,
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
import type { NoteSave } from './NotePopover';
import { canvasMeasure } from './measure';
import { OutlineView } from './OutlineView';
import { CommandPalette, type PaletteCommand } from './CommandPalette';
import { KeysDialog, cmdLabel, fmt } from './KeysDialog';
import { COMMANDS, commandFor, comboFromEvent, useKeymap, type CommandId } from './keymap';
import { LANGS, getLang, setLang, t } from '../i18n';
import { parseMapLink } from '../core/links';
import { Presentation } from './Presentation';
import { openExternal } from './platform';
import { ShareDialog } from './ShareDialog';
import { useLive, type SharedRef } from './useLive';
import { sync } from '../sync/controller';

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

type ViewMode = 'map' | 'outline';
const VIEW_KEY = 'keizu:view';

function savedView(): ViewMode {
  try {
    return globalThis.localStorage?.getItem(VIEW_KEY) === 'outline' ? 'outline' : 'map';
  } catch {
    return 'map';
  }
}

interface Props {
  initial: MindMap;
  store: LibraryStore;
  fontsReady: number;
  /** Topic to select (and reveal) when the map opens, e.g. from a search. */
  focusId?: string;
  onBack(): void;
  /** Opens another map of the library (a topic link to it). */
  onOpenMap(id: string, topicId?: string): void;
  /** Set for a map another account shared with you: it lives on the server only. */
  shared?: SharedRef;
}

function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    /* private mode: not remembered */
  }
}

export function Editor({ initial, store, fontsReady, focusId, onBack, onOpenMap, shared }: Props) {
  const [hist, setHist] = useState<History<MindMap>>(() => initHistory(focusId ? revealTopic(initial, focusId) : initial));
  const map = hist.present;
  const startId = focusId && findTopic(initial, focusId) ? focusId : initial.roots[0].id;
  const [selectedId, setSelectedId] = useState<string | null>(startId);
  const [view, setView] = useState<ViewMode>(savedView);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const keymap = useKeymap();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSeed, setEditSeed] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [outlineOpen, setOutlineOpenState] = useState(() => readPref('kz.outlinePanel', window.innerWidth >= 1280));
  const setOutlineOpen = (v: boolean) => {
    setOutlineOpenState(v);
    writePref('kz.outlinePanel', v);
  };
  const [panelTab, setPanelTab] = useState<'style' | 'map'>('style');
  const [zoom, setZoom] = useState(1);
  const [saved, setSaved] = useState<'saved' | 'saving'>('saved');
  const [exportOpen, setExportOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [presenting, setPresenting] = useState(false);
  // Topic whose note card is open on the canvas.
  const [noteId, setNoteId] = useState<string | null>(null);
  // Other maps, for linking a topic to one.
  const [libraryMaps, setLibraryMaps] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    store.list().then((l) => setLibraryMaps(l.map((m) => ({ id: m.id, title: m.title })))).catch(() => {});
  }, [store]);
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

  // Live collaboration (Keizu Server): maps that arrive from the session
  // replace the editor's map without becoming an undo step.
  const fromLive = useRef<MindMap | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const live = useLive({
    mapId: initial.id,
    shared,
    store,
    current: () => latest.current,
    showRemote: (m) => {
      fromLive.current = m;
      setHist((h) => replace(h, m));
    },
    toast: (msg) => setToast(msg),
  });
  const session = live.session;
  const readOnly = live.role === 'view';
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  const commit = useCallback((next: MindMap, select?: string | null) => {
    if (readOnlyRef.current) {
      setToast(t('live.readOnly'));
      return;
    }
    setHist((h) => push(h, next));
    if (select !== undefined) setSelectedId(select);
  }, []);

  // The note card belongs to the selected topic on the map.
  useEffect(() => {
    if (noteId && (selectedId !== noteId || view !== 'map')) setNoteId(null);
  }, [selectedId, view, noteId]);

  // Saves a note card. Works on the newest map, since the card saves as it
  // closes, possibly in the same moment as another change.
  const saveNote = useCallback((id: string, save: NoteSave) => {
    if (readOnlyRef.current) return;
    setHist((h) => {
      const tp = findTopic(h.present, id);
      if (!tp) return h;
      const note = save.note.trim() ? save.note : undefined;
      const showNote = note && save.showNote ? true : undefined;
      if (note === tp.note && showNote === tp.style?.showNote) return h;
      const style = { ...tp.style, showNote };
      if (!showNote) delete style.showNote;
      return push(h, updateTopic(h.present, id, { note, style: Object.keys(style).length ? style : undefined }));
    });
  }, []);

  // Every local change goes to the live session as it happens.
  useEffect(() => {
    if (!session || map === fromLive.current) return;
    session.localChange(map);
  }, [map, session]);

  useEffect(() => {
    session?.select(selectedId);
  }, [session, selectedId]);

  // Load the file link, and keep a version-history snapshot of the map as it
  // was opened and as it is left.
  useEffect(() => {
    let alive = true;
    store.getLink(initial.id).then(async (l) => {
      if (!alive || !l) return;
      setLink(l);
      if (!(await linkWritable(l))) setFileState('needs-permission');
    });
    if (shared) return; // someone else's map: nothing is kept on this device
    store.addVersion(initial, 'open').catch(() => {});
    return () => {
      alive = false;
      store.addVersion(latest.current, 'close').catch(() => {});
    };
  }, [store, initial, shared]);

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
    if (map === initial || shared) return;
    setSaved('saving');
    const timer = setTimeout(() => {
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
        .catch(() => setToast(t('toast.storageFull')));
      const f = fileRef.current;
      if (f.fileState !== 'needs-permission') writeFile(next, f.link, false);
    }, 400);
    return () => clearTimeout(timer);
  }, [map, initial, store, writeFile, shared]);

  /** "Save to computer": writes the linked file, or asks where to keep one. */
  const saveToFile = async (saveAs = false) => {
    try {
      if (link && !saveAs) {
        await writeFile(map, link, true);
        setToast(t('toast.savedTo', { name: link.name }));
        return;
      }
      const target = await chooseSaveTarget(`${safeFileName(map.title)}.keizu`);
      if (target) {
        // If the link can't be stored it still works for this session.
        await store.setLink(map.id, target).catch(() => {});
        setLink(target);
        await writeFile(map, target, true);
        setToast(t('toast.linked', { name: target.name }));
      } else if (!canLinkFiles()) {
        // Browsers without file handles: a one-off download.
        if (await exportKeizu(map)) setToast(t('toast.downloaded'));
      }
    } catch (err) {
      setToast((err as Error).message || t('toast.saveFailed'));
    }
  };

  const unlinkFile = async () => {
    await store.setLink(map.id, undefined);
    setLink(undefined);
    setFileState('ok');
    setToast(t('toast.unlinked'));
  };

  const pickImage = async (file: File) => {
    if (!selectedId) return;
    try {
      const img = await loadImageFile(file);
      commit(setTopicImage(map, selectedId, img.dataUrl, img.width, img.height));
    } catch (err) {
      setToast((err as Error).message || t('toast.imageFailed'));
    }
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  // If the selected topic disappears (undo, collapse), fall back to the root.
  useEffect(() => {
    if (selectedId && !layout.byId.has(selectedId)) setSelectedId(mainId);
  }, [layout, selectedId, mainId]);

  const startEdit = (id: string, seed: string | null = null) => {
    if (readOnly) return;
    setSelectedId(id);
    setEditSeed(seed);
    setEditingId(id);
  };

  const rows = useMemo(() => (view === 'outline' ? outlineRows(map) : []), [map, view]);

  /** Selects a topic anywhere in the map, opening collapsed branches on the way. */
  const goTo = (id: string) => {
    const shown = revealTopic(map, id);
    if (shown !== map) commit(shown);
    selectTopic(id);
    setSelectedRelId(null);
    if (view === 'map') setTimeout(() => canvas.current?.centerOn(id), 0);
  };

  const switchView = (next: ViewMode) => {
    setView(next);
    setEditingId(null);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* not remembered */
    }
  };

  const navigate = (dir: Dir) => {
    const id = selectedId ?? mainId;
    if (view === 'map') {
      const next = nearest(layout, id, dir);
      if (next) selectTopic(next);
      return;
    }
    const i = rows.findIndex((r) => r.topic.id === id);
    const row = rows[i];
    if (!row) return selectTopic(mainId);
    if (dir === 'up' && i > 0) selectTopic(rows[i - 1].topic.id);
    if (dir === 'down' && i < rows.length - 1) selectTopic(rows[i + 1].topic.id);
    const tp = row.topic;
    if (dir === 'left') {
      if (tp.children.length && !tp.collapsed && tp.id !== mainId) commit(toggleCollapse(map, tp.id));
      else if (row.parentId) selectTopic(row.parentId);
    }
    if (dir === 'right') {
      if (tp.collapsed) commit(toggleCollapse(map, tp.id));
      else if (tp.children.length) selectTopic(tp.children[0].id);
    }
  };

  const actions = {
    addChild() {
      if (!selectedId) return;
      const r = addChild(map, selectedId, selectedId === mainId ? t('topic.main') : t('topic.sub'));
      commit(r.map, r.id);
      startEdit(r.id);
    },
    addSibling(before = false) {
      if (!selectedId) return;
      const r = addSibling(map, selectedId, selectedId === mainId ? t('topic.main') : t('topic.default'), before);
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
    // In a live session undo and redo touch only this person's own edits.
    undo: () => {
      if (!session) return setHist((h) => undo(h));
      const m = session.undo();
      if (m) setHist((h) => replace(h, (fromLive.current = { ...latest.current, ...m } as MindMap)));
    },
    redo: () => {
      if (!session) return setHist((h) => redo(h));
      const m = session.redo();
      if (m) setHist((h) => replace(h, (fromLive.current = { ...latest.current, ...m } as MindMap)));
    },
    collapse() {
      if (selectedId) commit(toggleCollapse(map, selectedId));
    },
    copy(cut = false) {
      if (!selected) return;
      clipboard.current = selected;
      if (cut && selectedId !== mainId) actions.remove();
      setToast(cut ? t('toast.cut') : t('toast.copied'));
    },
    paste() {
      if (!selectedId || !clipboard.current) return;
      const r = pasteTopic(map, selectedId, clipboard.current);
      commit(r.map, r.id);
    },
    relation() {
      if (!selectedId) return;
      if (view !== 'map') switchView('map');
      setRelationFrom(selectedId);
      setToast(t('toast.pickRelation'));
    },
    floating(pos = { x: 0, y: (layout.bounds.maxY ?? 0) + 120 }) {
      const r = addFloating(map, pos, t('topic.floating'));
      commit(r.map, r.id);
      startEdit(r.id);
    },
    note() {
      if (!selectedId) return;
      // On the map the note opens in a card next to the topic.
      if (view === 'map') return void setNoteId(selectedId);
      setPanelOpen(true);
      setHistoryOpen(false);
      setPanelTab('style');
      setTimeout(() => document.getElementById('note-field')?.focus(), 0);
    },
    async openLink(id = selectedId) {
      const tp = id ? findTopic(map, id) : undefined;
      if (!tp?.href) return;
      const ml = parseMapLink(tp.href);
      if (!ml) return void openExternal(tp.href).catch(() => setToast(t('toast.linkFailed')));
      if (ml.mapId === map.id) return goTo(ml.topicId ?? mainId);
      if (!(await store.get(ml.mapId))) return setToast(t('toast.linkMissing'));
      onOpenMap(ml.mapId, ml.topicId);
    },
    move(id: string | null, fn: (m: MindMap, id: string) => MindMap) {
      if (!id) return;
      const next = fn(map, id);
      if (next !== map) commit(next, id);
    },
  };

  /** Everything the keyboard and the command palette can run. */
  const commands: Record<CommandId, { run(): void; enabled?: boolean }> = {
    palette: { run: () => setPaletteOpen((v) => !v) },
    shortcuts: { run: () => setKeysOpen((v) => !v) },
    language: { run: () => setLang(getLang() === 'tr' ? 'en' : 'tr') },
    back: { run: onBack },
    addChild: { run: actions.addChild, enabled: !!selectedId },
    addSibling: { run: () => actions.addSibling(), enabled: !!selectedId },
    addSiblingBefore: { run: () => actions.addSibling(true), enabled: !!selectedId },
    edit: { run: () => selectedId && startEdit(selectedId), enabled: !!selectedId },
    remove: { run: actions.remove, enabled: !!selectedRelId || (!!selectedId && selectedId !== mainId) },
    undo: { run: actions.undo, enabled: session ? session.canUndo() : hist.past.length > 0 },
    redo: { run: actions.redo, enabled: session ? session.canRedo() : hist.future.length > 0 },
    copy: { run: () => actions.copy(), enabled: !!selected },
    cut: { run: () => actions.copy(true), enabled: !!selected && selectedId !== mainId },
    paste: { run: actions.paste, enabled: !!selectedId && !!clipboard.current },
    collapse: { run: actions.collapse, enabled: !!selected?.children.length && selectedId !== mainId },
    moveUp: { run: () => actions.move(selectedId, (m, id) => moveAmongSiblings(m, id, -1)), enabled: !!selectedId },
    moveDown: { run: () => actions.move(selectedId, (m, id) => moveAmongSiblings(m, id, 1)), enabled: !!selectedId },
    indent: { run: () => actions.move(selectedId, indentTopic), enabled: !!selectedId },
    outdent: { run: () => actions.move(selectedId, outdentTopic), enabled: !!selectedId },
    navLeft: { run: () => navigate('left') },
    navRight: { run: () => navigate('right') },
    navUp: { run: () => navigate('up') },
    navDown: { run: () => navigate('down') },
    relation: { run: actions.relation, enabled: !!selectedId },
    floating: { run: () => actions.floating() },
    note: { run: actions.note, enabled: !!selectedId },
    save: { run: () => saveToFile() },
    saveAs: { run: () => saveToFile(true), enabled: canLinkFiles() },
    toggleOutline: { run: () => switchView(view === 'map' ? 'outline' : 'map') },
    zoomIn: { run: () => canvas.current?.zoomBy(1.2), enabled: view === 'map' },
    zoomOut: { run: () => canvas.current?.zoomBy(1 / 1.2), enabled: view === 'map' },
    fit: { run: () => canvas.current?.fit(), enabled: view === 'map' },
    centerSelected: { run: () => selectedId && canvas.current?.centerOn(selectedId), enabled: view === 'map' && !!selectedId },
    history: { run: () => setHistoryOpen((v) => !v) },
    panel: { run: () => setPanelOpen((v) => !v) },
    present: { run: () => setPresenting(true) },
    openLink: { run: () => actions.openLink(), enabled: !!selected?.href },
    share: { run: () => setShareOpen(true), enabled: !shared && sync.canShare() },
  };

  // Keyboard shortcuts (inactive while typing in a field or a dialog is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingId || keysOpen || presenting || shareOpen) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const combo = comboFromEvent(e);
      if (!combo) return;
      if (paletteOpen && combo !== 'Mod+K') return;
      const id = commandFor(keymap, combo, view === 'outline');
      if (id) {
        e.preventDefault();
        // Arrow keys and editing keys act on the selected relation, if any.
        if (selectedRelId && ['navLeft', 'navRight', 'navUp', 'navDown', 'edit'].includes(id)) return;
        const c = commands[id];
        if (c.enabled !== false) c.run();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (relationFrom) setRelationFrom(null);
        else selectTopic(null), setSelectedRelId(null);
        return;
      }
      // Typing a character starts editing with that character.
      if (e.key.length === 1 && !e.altKey && !e.ctrlKey && !e.metaKey && selectedId && !selectedRelId) {
        e.preventDefault();
        startEdit(selectedId, e.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const paletteCommands: PaletteCommand[] = COMMANDS.filter((c) => c.id !== 'palette' && (!c.outlineOnly || view === 'outline')).map((c) => ({
    id: c.id,
    label: c.id === 'language' ? `${cmdLabel(c.id)}: ${LANGS.find((l) => l.id !== getLang())!.name}` : cmdLabel(c.id),
    keys: keymap[c.id].map(fmt),
    disabled: commands[c.id].enabled === false,
    run: commands[c.id].run,
  }));

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
      setToast((err as Error).message || t('toast.exportFailed'));
    }
  };

  /** "Undo (Ctrl+Z)": a tooltip with the command's first shortcut. */
  const tip = (id: CommandId, label = cmdLabel(id)) => (keymap[id][0] ? `${label} (${fmt(keymap[id][0])})` : label);

  const commitEdit = (id: string, text: string) => {
    setEditingId(null);
    setEditSeed(null);
    const tp = findTopic(map, id);
    const clean = text.replace(/\s+$/g, '');
    if (tp && clean && clean !== tp.text) commit(updateTopic(map, id, { text: clean }));
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditSeed(null);
  };

  const layoutName = (k: MindMap['layout']) => t(`layout.${k}`);
  // What the selected branch would use without its own layout setting.
  const parentBox = selectedId ? layout.byId.get(layout.byId.get(selectedId)?.parentId ?? '') : undefined;
  const inheritedLayout = parentBox?.layout ?? map.layout;
  const colorOf = (id: string) => {
    const b = layout.byId.get(id);
    if (b) return b.color;
    // Hidden in a collapsed branch on the map: use the nearest shown ancestor.
    for (let p = findParent(map, id); p; p = findParent(map, p.id)) {
      const pb = layout.byId.get(p.id);
      if (pb) return pb.color;
    }
    return theme.mono;
  };
  const shareAvail = !shared && sync.canShare();

  return (
    <div className={`editor ${theme.dark ? 'dark-map' : ''}`}>
      <div className="ed-body">
      <nav className="rail" aria-label={t('rail.label')}>
        <button className="rail-logo" aria-label={t('editor.back')} title={t('editor.back')} onClick={onBack}>
          <I.Logo size={34} />
        </button>
        <button className="rb" aria-label={t('rail.library')} title={t('rail.library')} onClick={onBack}><I.Folder size={20} /></button>
        <button
          className={`rb ${view === 'outline' || outlineOpen ? 'on' : ''}`}
          aria-label={view === 'outline' ? t('view.map') : t('rail.outline')}
          aria-pressed={view === 'outline' || outlineOpen}
          title={view === 'outline' ? tip('toggleOutline', t('view.map')) : t('rail.outline')}
          onClick={() => (view === 'outline' ? switchView('map') : setOutlineOpen(!outlineOpen))}
        >
          {view === 'outline' ? <I.MapIcon size={20} /> : <I.OutlineIcon size={20} />}
        </button>
        <button className={`rb ${paletteOpen ? 'on' : ''}`} aria-label={cmdLabel('palette')} title={tip('palette')} onClick={() => setPaletteOpen(true)}><I.Search size={20} /></button>
        {!shared && <button className={`rb ${historyOpen ? 'on' : ''}`} aria-label={cmdLabel('history')} aria-pressed={historyOpen} title={tip('history')} onClick={() => setHistoryOpen((v) => !v)}><I.History size={20} /></button>}
        <span className="rail-gap" />
        <button className="rb" aria-label={cmdLabel('shortcuts')} title={tip('shortcuts')} onClick={() => setKeysOpen(true)}><I.Keyboard size={20} /></button>
      </nav>
      {outlineOpen && view === 'map' && (
        <aside className="outline-panel" aria-label={t('view.outline')}>
          <div className="op-head">
            <span>{t('view.outline')}</span>
            <button className="ib" aria-label={t('rail.outlineFull')} title={tip('toggleOutline', t('rail.outlineFull'))} onClick={() => switchView('outline')}><I.Export size={15} /></button>
          </div>
          <div className="op-body">
            <OutlineView
              map={map}
              selectedId={selectedId}
              editingId={null}
              editSeed={null}
              colorOf={colorOf}
              onSelect={(id) => {
                selectTopic(id);
                canvas.current?.centerOn(id);
              }}
              onStartEdit={(id) => {
                selectTopic(id);
                startEdit(id);
              }}
              onCommitEdit={commitEdit}
              onCancelEdit={cancelEdit}
              onToggleCollapse={(id) => commit(toggleCollapse(map, id))}
            />
          </div>
          <button className="op-foot" onClick={() => setPaletteOpen(true)}>
            <span>{cmdLabel('palette')}</span>
            {keymap.palette[0] && <kbd>{fmt(keymap.palette[0])}</kbd>}
          </button>
        </aside>
      )}
      <div className="ed-main">
      <header className="topbar">
        <div className="tb-left">
          <div className="doc-title">
            <span className="name">{map.title}</span>
            {shared ? (
              <span className="status saving">{t(readOnly ? 'live.sharedView' : 'live.sharedEdit', { owner: shared.owner })}</span>
            ) : (
              link && fileState === 'needs-permission' ? (
              <button className="status warn" onClick={() => saveToFile()} title={t('file.permissionTip')}>
                {t('file.permission', { name: link.name })}
              </button>
            ) : link && fileState === 'error' ? (
              <button className="status warn" onClick={() => saveToFile()} title={t('common.retry')}>
                {t('file.writeFailed', { name: link.name })}
              </button>
            ) : (
              <span className={`status ${saved}`} title={link ? (link.kind === 'path' ? link.path : link.name) : undefined}>
                {saved === 'saved' ? <><I.Check size={13} /> {link ? t('file.savedTo', { name: link.name }) : t('file.savedHere')}</> : t('file.saving')}
              </span>
            )
            )}
          </div>
          <div className="tb-group">
            <button className="ib" aria-label={cmdLabel('undo')} title={tip('undo')} disabled={!commands.undo.enabled} onClick={actions.undo}><I.Undo /></button>
            <button className="ib" aria-label={cmdLabel('redo')} title={tip('redo')} disabled={!commands.redo.enabled} onClick={actions.redo}><I.Redo /></button>
          </div>
        </div>

        {readOnly ? (
          <div className="tb-center readonly-note">{t('live.readOnlyBar')}</div>
        ) : (
        <nav className="tb-center" aria-label={t('editor.insert')}>
          <button className="tb" title={tip('addSibling')} disabled={!selectedId} onClick={() => actions.addSibling()}><I.TopicIcon />{t('tb.topic')}</button>
          <button className="tb" title={tip('addChild')} disabled={!selectedId} onClick={actions.addChild}><I.SubtopicIcon />{t('tb.subtopic')}</button>
          <button className={`tb ${relationFrom ? 'on' : ''}`} title={t('tb.relationTip')} disabled={!selectedId} onClick={actions.relation}><I.RelationIcon />{t('tb.relation')}</button>
          <button className="tb" title={t('tb.floatingTip')} onClick={() => actions.floating()}><I.FloatingIcon />{t('tb.floating')}</button>
          <button className="tb" title={t('tb.markerTip')} disabled={!selectedId} onClick={() => { setPanelOpen(true); setHistoryOpen(false); setPanelTab('style'); }}><I.MarkerIcon />{t('tb.marker')}</button>
          <button className="tb" title={t('tb.noteTip')} disabled={!selectedId} onClick={actions.note}><I.NoteIcon />{t('tb.note')}</button>
          {selected?.image ? (
            <button className="tb" title={t('tb.removeImageTip')} onClick={() => selectedId && commit(removeTopicImage(map, selectedId))}><I.ImageIcon />{t('tb.removeImage')}</button>
          ) : (
            <button className="tb" title={t('tb.imageTip')} disabled={!selectedId} onClick={() => imageInput.current?.click()}><I.ImageIcon />{t('tb.image')}</button>
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
          <button className="tb" title={tip('collapse')} disabled={!selected?.children.length || selectedId === mainId} onClick={actions.collapse}><I.Collapse />{t('tb.collapse')}</button>
          <button className="tb" title={tip('remove')} disabled={!selectedRelId && (!selectedId || selectedId === mainId)} onClick={actions.remove}><I.Trash />{t('tb.delete')}</button>
          <span className="tb-sep" />
          <div className="seg-tabs layout-switch" role="group" aria-label={t('layout.switch')}>
            {(['mindmap', 'logic', 'org'] as const).map((k) => (
              <button key={k} className={map.layout === k ? 'on' : ''} aria-pressed={map.layout === k} title={layoutName(k)} onClick={() => map.layout !== k && commit(setMapProps(map, { layout: k }))}>
                {t(`layout.short.${k}`)}
              </button>
            ))}
          </div>
        </nav>
        )}

        <div className="tb-right">
          {live.peers.length > 0 && (
            <div className="peers" aria-label={t('live.peers', { n: live.peers.length })}>
              {live.peers.slice(0, 5).map((p) => (
                <span
                  key={p.id}
                  className="avatar"
                  style={{ background: p.color }}
                  title={`${p.name}${p.role === 'view' ? ` (${t('share.role.view')})` : ''}`}
                  onClick={() => p.sel && goTo(p.sel)}
                >
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
              ))}
              {live.peers.length > 5 && <span className="avatar more">+{live.peers.length - 5}</span>}
            </div>
          )}
          {!shared && (
          <button
            className={`btn ${link || shareAvail ? '' : 'primary'}`}
            title={link ? `${t('file.saveToTip', { name: link.name })} (${fmt(keymap.save[0] ?? 'Mod+S')})` : tip('save', t('file.saveTip'))}
            onClick={() => saveToFile()}
          >
            <I.Save size={16} /> {isDesktop ? t('file.save') : t('file.saveToComputer')}
          </button>
          )}
          <div className="menu-wrap">
            <button className="btn" aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen((v) => !v)}>
              <I.Export size={16} /> {t('export.menu')}
            </button>
            {exportOpen && (
              <div className="menu" role="menu" onMouseLeave={() => setExportOpen(false)}>
                {canLinkFiles() && (
                  <button role="menuitem" onClick={() => { setExportOpen(false); saveToFile(true); }}>{t('export.saveAs')}</button>
                )}
                {link && (
                  <button role="menuitem" onClick={() => { setExportOpen(false); unlinkFile(); }}>{t('export.unlink')}</button>
                )}
                {(canLinkFiles() || link) && <hr />}
                <button role="menuitem" onClick={() => runExport('png')}>{t('export.png')}</button>
                <button role="menuitem" onClick={() => runExport('svg')}>{t('export.svg')}</button>
                <button role="menuitem" onClick={() => runExport('pdf')}>PDF</button>
                <button role="menuitem" onClick={() => runExport('md')}>Markdown</button>
                <button role="menuitem" onClick={() => runExport('opml')}>{t('export.opml')}</button>
                <button role="menuitem" onClick={() => runExport('keizu')}>{t('export.keizu')}</button>
                <button role="menuitem" onClick={() => runExport('json')}>{t('export.json')}</button>
              </div>
            )}
          </div>
          <button className="ib" aria-label={cmdLabel('present')} title={tip('present')} onClick={() => setPresenting(true)}><I.Present /></button>
          {shareAvail && (
            <button className="btn primary" title={tip('share', t('share.title'))} onClick={() => setShareOpen(true)}>
              <I.Share size={16} /> {t('share.button')}
            </button>
          )}
          <button className={`ib ${panelOpen ? 'on' : ''}`} aria-label={cmdLabel('panel')} aria-pressed={panelOpen} title={tip('panel')} onClick={() => setPanelOpen((v) => !v)}><I.Panel /></button>
        </div>
      </header>

      <div className="workspace">
        <main className="canvas-area">
          {view === 'map' ? (
            <MapCanvas
              ref={canvas}
              map={map}
              layout={layout}
              theme={theme}
              selectedId={selectedId}
              editingId={editingId}
              editSeed={editSeed}
              focusId={startId}
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
              onCommitEdit={commitEdit}
              onCancelEdit={cancelEdit}
              onMove={(id, parent) => commit(moveTopic(map, id, parent))}
              onToggleCollapse={(id) => commit(toggleCollapse(map, id))}
              onZoomChange={setZoom}
              onOpenLink={(id) => actions.openLink(id)}
              noteId={noteId}
              onOpenNote={setNoteId}
              onCloseNote={() => setNoteId(null)}
              onSaveNote={saveNote}
              readOnly={readOnly}
              peers={live.peers.map((p) => ({ id: p.id, name: p.name, color: p.color, selectedId: p.sel }))}
            />
          ) : (
            <OutlineView
              map={map}
              selectedId={selectedId}
              editingId={editingId}
              editSeed={editSeed}
              colorOf={colorOf}
              onSelect={selectTopic}
              onStartEdit={(id) => startEdit(id)}
              onCommitEdit={commitEdit}
              onCancelEdit={cancelEdit}
              onToggleCollapse={(id) => commit(toggleCollapse(map, id))}
            />
          )}
          {view === 'map' && (
            <div className="zoom">
              <button className="ib" aria-label={cmdLabel('zoomOut')} title={tip('zoomOut')} onClick={() => canvas.current?.zoomBy(1 / 1.2)}><I.Minus size={16} /></button>
              <span>{Math.round(zoom * 100)}%</span>
              <button className="ib" aria-label={cmdLabel('zoomIn')} title={tip('zoomIn')} onClick={() => canvas.current?.zoomBy(1.2)}><I.Plus size={16} /></button>
              <span className="sep" />
              <button className="ib" aria-label={cmdLabel('fit')} title={tip('fit')} onClick={() => canvas.current?.fit()}><I.Target size={16} /></button>
            </div>
          )}
          {toast && <div className="toast" role="status">{toast}</div>}
        </main>
      </div>
      <footer className="statusbar">
        <span className={`sb-live ${live.state}`} title={live.state !== 'off' ? t(`live.state.${live.state}`) : undefined}>
          <span className="dot" />
          {live.state !== 'off' ? t(`live.state.${live.state}`) : t('status.local')}
        </span>
        <span>{t('status.topics', { n: countAll(map) })}</span>
        <span>{t('status.relations', { n: map.relations.length })}</span>
        {live.peers.length > 0 && <span>{t('live.peers', { n: live.peers.length })}</span>}
        <span>{layoutName(map.layout)}</span>
        <button className="sb-lang" title={t('status.lang')} onClick={() => commands.language.run()}>{getLang().toUpperCase()}</button>
      </footer>
      </div>

        {historyOpen && (
          <VersionPanel
            store={store}
            map={map}
            fontsReady={fontsReady}
            onClose={() => setHistoryOpen(false)}
            onRestore={async (old) => {
              await store.addVersion(map, 'restore').catch(() => {});
              commit({ ...old, id: map.id, version: map.version, updatedAt: new Date().toISOString() }, old.roots[0].id);
              setToast(t('toast.restored', { key: fmt(keymap.undo[0] ?? 'Mod+Z') }));
            }}
          />
        )}

        {panelOpen && !historyOpen && !readOnly && (
          <FormatPanel
            map={map}
            topic={selected}
            relation={selectedRel}
            onRelationLabel={(label) => selectedRelId && commit(updateRelation(map, selectedRelId, { label: label || undefined }))}
            onRelationDelete={() => actions.remove()}
            isRoot={selectedId === mainId}
            inheritedLayout={inheritedLayout}
            tab={panelTab}
            onTab={setPanelTab}
            onStyle={(p) => selectedId && commit(updateStyle(map, selectedId, p))}
            onBranchLayout={(k) => selectedId && commit(setBranchLayout(map, selectedId, k))}
            onMarker={(m) => selectedId && commit(toggleMarker(map, selectedId, m))}
            onNote={(n) => selectedId && commit(updateTopic(map, selectedId, { note: n || undefined }))}
            onLinkLabel={(l) => selectedId && commit(updateTopic(map, selectedId, { linkLabel: l || undefined }))}
            onHref={(h) => selectedId && commit(updateTopic(map, selectedId, { href: h || undefined }))}
            maps={libraryMaps}
            onMap={(p) => commit(setMapProps(map, p))}
          />
        )}
      </div>

      {paletteOpen && (
        <CommandPalette map={map} commands={paletteCommands} onPickTopic={goTo} onClose={() => setPaletteOpen(false)} />
      )}
      {keysOpen && <KeysDialog onClose={() => setKeysOpen(false)} />}
      {shareOpen && <ShareDialog map={map} onClose={() => setShareOpen(false)} onShared={live.enable} />}
      {presenting && (
        <Presentation
          map={map}
          startId={selectedId}
          onClose={(last) => {
            setPresenting(false);
            if (findTopic(map, last)) goTo(last);
          }}
        />
      )}
    </div>
  );
}
