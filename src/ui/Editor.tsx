import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { initHistory, push, redo, replace, undo, type History } from '../core/history';
import { layoutMap, type FocusOptions, type MapLayout } from '../core/layout';
import { outlineRows } from '../core/outline';
import {
  addChild,
  addBoundary,
  addSummary,
  findBoundary,
  findParent,
  isDescendant,
  isSummaryTopic,
  removeBoundary,
  removeSummary,
  resizeBoundary,
  resizeSummary,
  summaryOwner,
  updateBoundary,
  indentTopic,
  moveAmongSiblings,
  outdentTopic,
  revealTopic,
  setBranchLayout,
  addSibling,
  addFloating,
  addFlowLink,
  addRelation,
  countAll,
  floatTopic,
  removeRelation,
  updateRelation,
  findTopic,
  pasteFloating,
  LAYOUT_KINDS,
  type TopicShape,
  moveTopic,
  removeTopic,
  removeTopicImage,
  setMapProps,
  setTopicImage,
  setTopicWidth,
  toggleCollapse,
  toggleMarker,
  updateStyle,
  updateTopic,
  type MindMap,
  type Topic,
  type TopicStyle,
} from '../core/model';
import { applyStyle, copyableStyle, documentOrder, floatTopics, moveTopics, pasteTopics, removeTopics, setCollapsed, setLayouts, setMarker, topLevel, updateStyles } from '../core/bulk';
import { parsePastedText, topicsToText } from '../core/smartPaste';
import { allTags, checkTask, emptyFilter, extractTags, filterActive, filterMap, matchingIds, setTag, setTaskFields, toggleTasks, type TaskPatch, type TopicFilter } from '../core/tasks';
import { FilterBar, TaskTagSection, TasksPane } from './TaskPanel';
import { FILL_SWATCHES, getTheme } from '../core/themes';
import {
  addInner,
  branchToInner,
  hasInner,
  innerPathTo,
  innerToBranch,
  insertMapAsTopic,
  validPath,
  viewOf,
  writeBack,
  type InnerPath,
} from '../core/inner';
import { importFile } from '../core/importFile';
import { pickFiles } from './platform';
import { nodeColors } from './MapSvg';
import { VIEW_KINDS, addCanvas, setViewCanvas, setViewKind, viewCanvas, viewKind, type ViewKind } from '../core/canvas';
import type { CanvasBoardHandle, BoardTopic } from './CanvasBoard';
import { preInvert } from './preInvert';
import { ghostOf, playEnter, playExit } from './innerMotion';
import { SNAPSHOT_EVERY_MS } from '../core/versions';
import type { FileLink, LibraryStore } from '../sync/types';
import { exportKeizu, exportMarkdown, exportOpml, exportPdf, exportPlainJson, exportPng, exportSvg, safeFileName } from './exporters';
import { loadImageFile } from './images';
import { canLinkFiles, chooseSaveTarget, encodeForFile, isDesktop, linkWritable, writeLink } from './platform';
import { VersionPanel } from './VersionPanel';
import { FormatPanel } from './FormatPanel';
import * as I from './Icons';
import { MapCanvas, type CanvasHandle, type CanvasTarget, type View as CanvasView } from './MapCanvas';
import { ContextMenu, tidy, type CtxItem } from './ContextMenu';
import type { NoteSave } from './NotePopover';
import { toggleTask as toggleNoteLine } from '../core/richText';
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
import { AssistantPanel, actionLabel, useAiAvailable, useAiPrefs, useAssistant } from './assistant';
import type { AiAction } from '../core/ai';

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

// The drawing canvas (Excalidraw) is big: load it only when a view uses it.
const CanvasBoard = lazy(() => import('./CanvasBoard'));
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

/**
 * What Copy and Cut put aside, shared by every open map so topics can move
 * between maps with their styles and notes. `text` is the same topics as a
 * Markdown list, also put on the system clipboard: when the clipboard still
 * holds that text, a paste uses these topics instead of re-reading the text.
 */
let topicClipboard: { topics: Topic[]; text: string } | null = null;
/** The look the format painter or "Copy style" took. */
let copiedStyle: TopicStyle | null = null;

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
  // The whole file. The editor shows and edits `map`: the outer map, or the
  // inner map of the topic you entered (see core/inner.ts).
  const doc = hist.present;
  const [rawPath, setRawPath] = useState<InnerPath>(() => (focusId ? innerPathTo(initial, focusId) ?? [] : []));
  const pathKey = rawPath.join('/');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const path = useMemo(() => validPath(doc, rawPath), [doc, pathKey]);
  const pathRef = useRef(path);
  pathRef.current = path;
  const map = useMemo(() => viewOf(doc, path), [doc, path]);
  const mapRef = useRef(map);
  mapRef.current = map;
  const startId = focusId && findTopic(initial, focusId) ? focusId : initial.roots[0].id;
  // The selected topic (the one the keyboard and the panel act on) and, with
  // multi-select, the other selected topics. Selecting one topic clears the rest.
  const [selectedId, setPrimary] = useState<string | null>(startId);
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const setSelectedId = useCallback((id: string | null) => {
    setPrimary(id);
    setExtraIds([]);
  }, []);
  const selectedIds = useMemo(() => {
    const all = new Set(extraIds);
    if (selectedId) all.add(selectedId);
    return [...all];
  }, [extraIds, selectedId]);
  const multi = selectedIds.length > 1;
  const selectedSet = useMemo(() => (multi ? new Set(selectedIds) : undefined), [multi, selectedIds]);
  // Format painter: the copied look, and whether it stays on after a click.
  const [painter, setPainter] = useState<{ style: TopicStyle; sticky: boolean } | null>(null);
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
  const [panelTab, setPanelTab] = useState<'style' | 'map' | 'tasks'>('style');
  // Tag / task filter: a view setting of this editor, never saved in the map.
  const [filter, setFilter] = useState<TopicFilter | null>(null);
  const [zoom, setZoom] = useState(1);
  const [saved, setSaved] = useState<'saved' | 'saving'>('saved');
  const [exportOpen, setExportOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [presenting, setPresenting] = useState(false);
  // The open right-click menu: what it is for and where.
  const [ctx, setCtx] = useState<{ x: number; y: number; target: CanvasTarget; kb?: boolean } | null>(null);
  // Topic whose note card is open on the canvas.
  const [noteId, setNoteIdRaw] = useState<string | null>(null);
  // Whether the card opens in the editor (F4) or shows the note formatted (icon click).
  const [noteEdit, setNoteEdit] = useState(false);
  const setNoteId = useCallback((id: string | null, edit = false) => {
    setNoteEdit(edit);
    setNoteIdRaw(id);
  }, []);
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
  latest.current = doc;
  const lastSnapshot = useRef(Date.now());
  // Read by the autosave timer without restarting it.
  const fileRef = useRef({ link, fileState });
  fileRef.current = { link, fileState };
  const pasteFallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvas = useRef<CanvasHandle>(null);

  const mainId = map.roots[0].id;
  const [relationFrom, setRelationFrom] = useState<string | null>(null);
  /** What picking a target makes: a relation arrow, or a flow chart link (paths merge). */
  const [linkKind, setLinkKind] = useState<'relation' | 'flow'>('relation');
  const [selectedRelId, setSelectedRelId] = useState<string | null>(null);
  const selectedRel = map.relations.find((r) => r.id === selectedRelId);
  const [selectedBoundaryId, setSelectedBoundaryId] = useState<string | null>(null);
  const selectedBoundary = selectedBoundaryId ? findBoundary(map, selectedBoundaryId) : undefined;
  // Focus mode: only this branch is on the map.
  const [focus, setFocus] = useState<FocusOptions | null>(null);
  const theme = getTheme(map.theme);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filtering = filterActive(filter);
  // AI assistant: its suggestions show faded on the map until added or discarded.
  const [aiOpen, setAiOpen] = useState(false);
  const aiPrefs = useAiPrefs();
  const aiAvailable = useAiAvailable();
  const commitRef = useRef<(next: MindMap, select?: string | null) => void>(() => {});
  const assistant = useAssistant(
    useCallback(() => mapRef.current, []),
    useCallback((next: MindMap, select?: string | null) => commitRef.current(next, select), []),
    useCallback((msg: string) => setToast(msg), []),
  );
  // "Hide" filtering lays out only matching topics (and the way to them).
  // A topic's width while its side grip is being dragged (not saved until released).
  const [sizing, setSizing] = useState<{ id: string; w: number } | null>(null);
  const sizedMap = useMemo(() => (sizing ? setTopicWidth(map, sizing.id, sizing.w) : map), [map, sizing]);
  const filteredMap = useMemo(() => (filtering && filter.mode === 'hide' ? filterMap(sizedMap, filter) : sizedMap), [sizedMap, filter, filtering]);
  const ghost = useMemo(() => (view === 'map' ? assistant.preview(filteredMap) : null), [assistant.preview, filteredMap, view]);
  const shownMap = ghost?.map ?? filteredMap;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => layoutMap(shownMap, canvasMeasure, focus ?? undefined), [shownMap, fontsReady, focus]);
  // The whole map's layout: the same one outside focus mode.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fullLayout = useMemo(() => (focus ? layoutMap(shownMap, canvasMeasure) : layout), [shownMap, fontsReady, focus, layout]);
  const matched = useMemo(() => (filtering ? matchingIds(map, filter) : undefined), [map, filter, filtering]);
  /** Topics the "dim" filter fades. */
  const filterDim = useMemo(() => {
    if (!matched || filter?.mode !== 'dim') return undefined;
    const out = new Set<string>();
    for (const b of layout.nodes) if (!matched.has(b.id)) out.add(b.id);
    return out;
  }, [matched, filter, layout]);
  /** Faded topics: filtered out ("dim") or suggested by the assistant. */
  const dimIds = useMemo(() => (ghost ? new Set([...(filterDim ?? []), ...ghost.ids]) : filterDim), [ghost, filterDim]);
  const mapTags = useMemo(() => allTags(map), [map]);
  const taskCount = useMemo(() => {
    let all = 0, done = 0;
    const walk = (tp: Topic) => {
      if (tp.task) {
        all++;
        if (tp.task === 'done') done++;
      }
      tp.children.forEach(walk);
    };
    doc.roots.forEach(walk);
    return { all, done };
  }, [doc]);
  const selected = selectedId ? findTopic(map, selectedId) : undefined;
  /** The selected topic is a step of a flow chart. */
  const inFlow = !!selectedId && layout.byId.get(selectedId)?.layout === 'flow';
  const focused = focus && layout.focusId ? findTopic(map, focus.id) : undefined;
  /** The topic the map is drawn around: the focused one, or the main topic. */
  const viewRootId = focused?.id ?? mainId;

  // Canvas mode: this view shown as a free drawing, alone or with its topics on it.
  const inner = path.length > 0;
  const kind: ViewKind = viewKind(map, inner);
  const drawing = view === 'map' && kind !== 'map';
  const board = useRef<CanvasBoardHandle>(null);
  const boardPath = path;
  const boardCanvas = viewCanvas(map, inner);
  const boardTopics = useMemo<BoardTopic[]>(
    () =>
      kind === 'both'
        ? layout.nodes.map((b) => {
            const c = nodeColors(b, theme);
            return { id: b.id, text: b.topic.text, parentId: b.parentId, x: b.x, y: b.y, w: b.w, h: b.h, stroke: b.color, fill: c.fill === 'transparent' ? 'transparent' : c.fill, textColor: c.text, depth: b.depth };
          })
        : [],
    [kind, layout, theme],
  );
  const setKind = (k: ViewKind) => {
    if (k === kind || readOnly) return;
    commit(setViewKind(map, inner, k));
    if (view !== 'map') setView('map');
  };

  const selectTopic = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) {
      setSelectedRelId(null);
      setSelectedBoundaryId(null);
    }
  }, [setSelectedId]);

  /** Makes a selected topic the one the keyboard and panel act on, keeping the rest. */
  const focusInSelection = (id: string) => {
    setExtraIds(selectedIds);
    setPrimary(id);
  };

  /** Ctrl/⌘+click toggles a topic in the selection; Shift+click adds it. */
  const extendSelection = (id: string, toggle: boolean) => {
    setSelectedRelId(null);
    setSelectedBoundaryId(null);
    if (selectedIds.includes(id)) {
      if (!toggle) return focusInSelection(id);
      const rest = selectedIds.filter((x) => x !== id);
      setExtraIds(rest);
      setPrimary(rest[rest.length - 1] ?? null);
      return;
    }
    setExtraIds(selectedIds);
    setPrimary(id);
  };

  /** Selects a set of topics at once (box select, select all, paste). */
  const selectMany = (ids: string[], additive = false) => {
    const all = additive ? [...new Set([...selectedIds, ...ids])] : ids;
    setSelectedRelId(null);
    setSelectedBoundaryId(null);
    setExtraIds(all);
    setPrimary(additive && selectedId && all.includes(selectedId) ? selectedId : all[0] ?? null);
  };

  // A focused topic that is gone (deleted, undone) ends focus mode.
  useEffect(() => {
    if (focus && !findTopic(map, focus.id)) setFocus(null);
  }, [map, focus]);
  // Only the canvas shows focus mode.
  useEffect(() => {
    if (view !== 'map') setFocus(null);
  }, [view]);

  /** Shows only the branch of `id`, drawn where it stands now so the move is smooth. */
  const enterFocus = (id: string) => {
    if (id === mainId || isSummaryTopic(map, id) || !findTopic(map, id)) return setFocus(null);
    // Going up to an ancestor: its place on the full map.
    const shown = layout.byId.get(id);
    const box = shown ?? fullLayout.byId.get(id);
    const color = box && box.depth > 0 ? box.color : focus?.color;
    setFocus({ id, anchor: box ? { x: box.x, y: box.y } : undefined, color });
    if (!selectedId || !(selectedId === id || isDescendant(map, id, selectedId))) selectTopic(id);
  };
  const exitFocus = () => setFocus(null);
  /** Leaves focus mode if `id` is outside the focused branch. */
  const keepInFocus = (id: string) => {
    if (focus && id !== focus.id && !isDescendant(map, focus.id, id)) setFocus(null);
  };
  /** Ancestors of the focused topic, then the topic: the focus bar. */
  const focusPath = useMemo(() => {
    if (!focused) return [];
    const path: { id: string; text: string }[] = [];
    for (let p: { id: string; text: string } | undefined = focused; p; p = findParent(map, p.id)) path.unshift({ id: p.id, text: p.text });
    return path;
  }, [map, focused]);

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
    setHist((h) => push(h, writeBack(h.present, pathRef.current, next)));
    if (select !== undefined) setSelectedId(select);
  }, []);
  commitRef.current = commit;
  /** Runs an assistant action on a topic and shows the panel for its answer. */
  const aiRun = (action: AiAction, id: string) => {
    setAiOpen(true);
    setHistoryOpen(false);
    assistant.run(action, id);
  };
  // Suggestions arrived: bring the branch into view so they can be seen.
  const aiState = assistant.state;
  useEffect(() => {
    if (aiState.status !== 'done' || !aiState.reply.additions.length) return;
    // Suggestions under several topics: show the whole map; else centre the one topic.
    if (aiState.reply.additions.length > 1) canvas.current?.fit();
    else canvas.current?.centerOn(aiState.reply.additions[0].parentId);
  }, [aiState]);
  const closeAssistant = () => {
    setAiOpen(false);
    if (assistant.state.status === 'running') assistant.cancel();
    else if (assistant.state.status === 'done') assistant.discard();
  };
  /**
   * Edits the view at `at` as it is now. The drawing canvas saves after a
   * pause, possibly after you have left that view, so it can't use `map`.
   */
  const editView = useCallback((at: InnerPath, fn: (view: MindMap) => MindMap) => {
    if (readOnlyRef.current) return;
    setHist((h) => {
      const at2 = validPath(h.present, at);
      if (at2.length !== at.length) return h;
      const before = viewOf(h.present, at);
      const next = fn(before);
      return next === before ? h : push(h, writeBack(h.present, at, next));
    });
  }, []);
  /** Records a change made to the whole file (not to the view). */
  const commitDoc = useCallback((next: MindMap, select?: string | null) => {
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
    if (!session || doc === fromLive.current) return;
    session.localChange(doc);
  }, [doc, session]);

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
    if (doc === initial || shared) return;
    setSaved('saving');
    const timer = setTimeout(() => {
      const next = { ...doc, version: doc.version + 1 };
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
  }, [doc, initial, store, writeFile, shared]);

  /** "Save to computer": writes the linked file, or asks where to keep one. */
  const saveToFile = async (saveAs = false) => {
    try {
      if (link && !saveAs) {
        await writeFile(doc, link, true);
        setToast(t('toast.savedTo', { name: link.name }));
        return;
      }
      const target = await chooseSaveTarget(`${safeFileName(doc.title)}.keizu`);
      if (target) {
        // If the link can't be stored it still works for this session.
        await store.setLink(map.id, target).catch(() => {});
        setLink(target);
        await writeFile(doc, target, true);
        setToast(t('toast.linked', { name: target.name }));
      } else if (!canLinkFiles()) {
        // Browsers without file handles: a one-off download.
        if (await exportKeizu(doc)) setToast(t('toast.downloaded'));
      }
    } catch (err) {
      setToast((err as Error).message || t('toast.saveFailed'));
    }
  };

  const unlinkFile = async () => {
    await store.setLink(doc.id, undefined);
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
  // Other selected topics that disappear just leave the selection.
  useEffect(() => {
    if (selectedId && !layout.byId.has(selectedId)) setSelectedId(viewRootId);
    else if (extraIds.some((id) => !layout.byId.has(id))) setExtraIds(extraIds.filter((id) => layout.byId.has(id)));
  }, [layout, selectedId, extraIds, viewRootId, setSelectedId]);
  useEffect(() => {
    if (selectedBoundaryId && !selectedBoundary) setSelectedBoundaryId(null);
  }, [selectedBoundaryId, selectedBoundary]);

  const startEdit = (id: string, seed: string | null = null) => {
    if (readOnly) return;
    setSelectedId(id);
    setEditSeed(seed);
    setEditingId(id);
  };

  const rows = useMemo(() => (view === 'outline' ? outlineRows(map) : []), [map, view]);

  /** Selects a topic anywhere in the map, opening collapsed branches on the way. */
  const goTo = (id: string) => {
    // It may sit in an inner map: go there first.
    const p = innerPathTo(doc, id);
    if (p && p.join('/') !== path.join('/')) {
      setRawPath(p);
      pathRef.current = p;
      setEditingId(null);
      setNoteId(null);
    }
    const target = p ?? path;
    if (p && p.join('/') === path.join('/')) keepInFocus(id);
    const v = viewOf(doc, target);
    const shown = revealTopic(v, id);
    if (shown !== v) commitDoc(writeBack(doc, target, shown));
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
    if (!row) return selectTopic(viewRootId);
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

  // ---------- inner maps ----------
  const savedViews = useRef<CanvasView[]>([]);
  const pendingMotion = useRef<(() => void) | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [insertOpen, setInsertOpen] = useState(false);
  const [crumbAnim, setCrumbAnim] = useState(false);
  useLayoutEffect(() => {
    const run = pendingMotion.current;
    pendingMotion.current = null;
    run?.();
  }, [pathKey]);
  // A path that stopped being valid (undo, a collaborator's change) is trimmed.
  useEffect(() => {
    if (path.length !== rawPath.length) setRawPath(path);
  }, [path, rawPath]);

  // Branch colour of each entered topic, for its dot in the breadcrumb.
  const crumbColors = useRef(new Map<string, string>());
  const boxColor = (id: string) => crumbColors.current.get(id);
  const boxLook = (id: string) => {
    const b = layoutRef.current.byId.get(id);
    if (!b) return { fill: theme.centralFill, radius: 12 };
    const { fill } = nodeColors(b, theme);
    return { fill: fill === 'transparent' ? theme.canvas : fill, radius: b.depth === 0 ? 12 : b.depth === 1 ? 9 : 7 };
  };

  const goToPath = (next: InnerPath) => {
    setFocus(null);
    setEditingId(null);
    setNoteId(null);
    setRelationFrom(null);
    setRawPath(next);
    pathRef.current = next;
  };

  const enterInner = (id: string | null = selectedId) => {
    if (!id) return;
    const tp = findTopic(doc, id);
    if (!hasInner(tp)) return setToast(t('inner.none'));
    const next = [...path, id];
    const eb = layout.byId.get(id);
    if (eb) crumbColors.current.set(id, eb.color);
    const c = canvas.current, el = c?.element();
    const from = c?.screenRect(id);
    if (view === 'map' && c && el && from) {
      savedViews.current[path.length] = c.getView();
      const look = boxLook(id);
      const ghost = ghostOf(el);
      pendingMotion.current = () => {
        const to = canvas.current?.screenRect(id);
        if (!to) return ghost.remove();
        playEnter({ live: el, ghost, from, to, ...look, canvasColor: theme.canvas });
      };
    }
    setCrumbAnim(true);
    goToPath(next);
    selectTopic(id);
  };

  /** Leaves `levels` inner maps at once (the breadcrumb can skip several). */
  const exitInner = (levels = 1) => {
    if (!path.length) return;
    const depth = Math.max(0, path.length - levels);
    const leaving = path[depth];
    const inner = path[path.length - 1];
    const c = canvas.current, el = c?.element();
    const from = c?.screenRect(inner);
    if (view === 'map' && c && el && from) {
      const ghost = ghostOf(el);
      const saved = savedViews.current[depth];
      pendingMotion.current = () => {
        const cv = canvas.current;
        if (saved) cv?.setView(saved);
        const to = cv?.screenRect(leaving);
        if (!to) return ghost.remove();
        playExit({ live: el, ghost, from, to, ...boxLook(leaving), canvasColor: theme.canvas });
      };
    }
    savedViews.current.length = depth;
    setCrumbAnim(false);
    goToPath(path.slice(0, depth));
    selectTopic(leaving);
  };

  const insertMap = (other: MindMap) => {
    setInsertOpen(false);
    const parent = selectedId ?? mainId;
    const r = insertMapAsTopic(map, other, parent);
    commit(r.map, r.id);
    setToast(t('inner.inserted', { title: other.title }));
  };
  const insertFromFile = async () => {
    try {
      const files = await pickFiles();
      const f = files[0];
      if (!f) return;
      const maps = importFile(f.name, f.bytes);
      if (maps[0]) insertMap(maps[0]);
    } catch {
      setToast(t('inner.insertFailed'));
    }
  };
  const insertFromLibrary = async (id: string) => {
    const m = await store.get(id).catch(() => undefined);
    if (m) insertMap(m);
    else setToast(t('toast.linkMissing'));
  };

  const selectedHasInner = !!selected?.innerSize;
  const canMakeInner = !!selected && selectedId !== mainId && selected.children.length > 0;

  const actions = {
    addChild() {
      if (!selectedId) return;
      const r = addChild(map, selectedId, selectedId === mainId ? t('topic.main') : t('topic.sub'));
      commit(r.map, r.id);
      startEdit(r.id);
    },
    addSibling(before = false) {
      if (!selectedId) return;
      // In focus mode the focused topic acts as the centre: it grows children.
      if (selectedId === viewRootId && focused) return actions.addChild();
      if (isSummaryTopic(map, selectedId)) return;
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
      if (selectedBoundaryId) {
        const owner = selectedBoundary?.boundary.from;
        commit(removeBoundary(map, selectedBoundaryId), owner ?? null);
        setSelectedBoundaryId(null);
        return;
      }
      if (multi) {
        // In focus mode the focused topic stays, like the main topic.
        const ids = selectedIds.filter((id) => id !== viewRootId);
        const n = topLevel(map, ids.filter((id) => id !== mainId)).length;
        const r = removeTopics(map, ids);
        if (r.map === map) return;
        commit(r.map, r.nextId);
        setToast(t('toast.deletedN', { n }));
        return;
      }
      if (!selectedId || selectedId === viewRootId) return;
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
      if (!selectedId) return;
      if (!multi) return commit(toggleCollapse(map, selectedId));
      // Several topics follow the first one that can fold.
      const first = selectedIds.map((id) => findTopic(map, id)).find((tp) => tp && tp.children.length && tp.id !== mainId);
      if (first) commit(setCollapsed(map, selectedIds, !first.collapsed));
    },
    copy(cut = false) {
      if (!selected) return;
      const ids = multi ? topLevel(map, selectedIds) : [selected.id];
      // From the file, so copied topics keep their inner maps.
      const topics = ids.map((id) => findTopic(doc, id)!).filter(Boolean);
      const text = topicsToText(topics);
      topicClipboard = { topics, text };
      // Other apps get the topics as a Markdown list.
      navigator.clipboard?.writeText(text).catch(() => {});
      if (cut) {
        const r = removeTopics(map, ids.filter((id) => id !== viewRootId));
        if (r.map !== map) commit(r.map, r.nextId);
      }
      const n = topics.length;
      setToast(n > 1 ? t(cut ? 'toast.cutN' : 'toast.copiedN', { n }) : cut ? t('toast.cut') : t('toast.copied'));
    },
    /** Pastes topics under the selected topic and selects what came in. */
    pasteTopics(topics: Topic[]) {
      const parent = selectedId ?? mainId;
      if (!topics.length) return;
      const r = pasteTopics(map, parent, topics);
      if (!r.ids.length) return;
      commit(r.map);
      selectMany(r.ids);
      if (r.ids.length > 1) setToast(t('toast.pastedN', { n: r.ids.length }));
      if (view === 'map') setTimeout(() => canvas.current?.centerOn(r.ids[0]), 0);
    },
    /** Smart paste: Keizu topics, a picture, or text that becomes a tree. */
    async pasteData(data: { text?: string; image?: Blob }) {
      if (readOnlyRef.current) return setToast(t('live.readOnly'));
      const text = data.text?.replace(/\s+$/, '') ?? '';
      if (data.image) {
        try {
          const img = await loadImageFile(data.image);
          const parent = selectedId ?? mainId;
          const added = addChild(latest.current, parent, t('topic.image'));
          commit(setTopicImage(added.map, added.id, img.dataUrl, img.width, img.height), added.id);
        } catch (err) {
          setToast((err as Error).message || t('toast.imageFailed'));
        }
        return;
      }
      const clip = topicClipboard;
      if (clip && (!text || text === clip.text.replace(/\s+$/, ''))) return actions.pasteTopics(clip.topics);
      if (text.trim()) actions.pasteTopics(parsePastedText(text));
    },
    /** Paste without a paste event (palette, toolbar): read the clipboard ourselves. */
    async paste() {
      let text: string | undefined;
      try {
        text = await navigator.clipboard?.readText();
      } catch {
        /* not allowed: use what Keizu copied */
      }
      await actions.pasteData({ text });
    },
    selectAll() {
      const ids = documentOrder(map).filter((id) => layout.byId.has(id));
      selectMany(ids);
      setPrimary(selectedId && ids.includes(selectedId) ? selectedId : mainId);
    },
    /** Starts the format painter with the selected topic's look. */
    painter(sticky = false) {
      if (painter && !sticky) return setPainter(null);
      if (!selected) return;
      const style = copyableStyle(selected);
      copiedStyle = style;
      if (view !== 'map') switchView('map');
      setPainter({ style, sticky });
      setToast(t(sticky ? 'toast.painterSticky' : 'toast.painter'));
    },
    paint(id: string) {
      if (!painter) return;
      const next = applyStyle(map, [id], painter.style);
      if (next !== map) commit(next);
      selectTopic(id);
      if (!painter.sticky) {
        setPainter(null);
        setToast(null);
      }
    },
    copyStyle() {
      if (!selected) return;
      copiedStyle = copyableStyle(selected);
      setToast(t('toast.styleCopied'));
    },
    pasteStyle() {
      if (!copiedStyle) return setToast(t('toast.noStyle'));
      const next = applyStyle(map, selectedIds, copiedStyle);
      if (next !== map) commit(next);
    },
    relation() {
      if (!selectedId) return;
      if (view !== 'map') switchView('map');
      setRelationFrom(selectedId);
      setLinkKind('relation');
      setToast(t('toast.pickRelation'));
    },
    merge() {
      if (!selectedId) return;
      if (view !== 'map') switchView('map');
      setRelationFrom(selectedId);
      setLinkKind('flow');
      setToast(t('toast.pickMerge'));
    },
    /** Flow charts: the path ending at `from` continues to `to`. */
    link(from: string, to: string) {
      const r = addFlowLink(map, from, to);
      if (r.id) commit(r.map);
      else setToast(t('toast.mergeExists'));
    },
    floating(pos?: { x: number; y: number }) {
      if (path.length) return setToast(t('inner.noFloating'));
      // Floating topics live outside any branch: leave focus mode to show them.
      if (focused) setFocus(null);
      pos ??= { x: 0, y: fullLayout.bounds.maxY + 120 };
      const r = addFloating(map, pos, t('topic.floating'));
      commit(r.map, r.id);
      startEdit(r.id);
    },
    note() {
      if (!selectedId) return;
      // On the map the note opens in a card next to the topic.
      if (view === 'map') return void setNoteId(selectedId, true);
      setPanelOpen(true);
      setHistoryOpen(false);
      setPanelTab('style');
      setTimeout(() => document.getElementById('note-field')?.focus(), 0);
    },
    async openLink(id = selectedId) {
      const tp = id ? findTopic(map, id) : undefined;
      if (tp?.href) await actions.openHref(tp.href);
    },
    /** Opens a web address, or a Keizu map / topic link. */
    async openHref(href: string) {
      const ml = parseMapLink(href);
      if (!ml) return void openExternal(href).catch(() => setToast(t('toast.linkFailed')));
      if (ml.mapId === map.id) return goTo(ml.topicId ?? mainId);
      if (!(await store.get(ml.mapId))) return setToast(t('toast.linkMissing'));
      onOpenMap(ml.mapId, ml.topicId);
    },
    focus() {
      if (view !== 'map') switchView('map');
      if (selectedId && selectedId !== viewRootId && selectedId !== mainId) enterFocus(selectedId);
      else exitFocus();
    },
    boundary() {
      if (!selectedId) return;
      const r = addBoundary(map, [selectedId]);
      if (!r.id) return setToast(t('toast.noRun'));
      commit(r.map, null);
      setSelectedBoundaryId(r.id);
      setSelectedRelId(null);
      setPanelOpen(true);
      setHistoryOpen(false);
      setPanelTab('style');
    },
    summary() {
      if (!selectedId) return;
      const r = addSummary(map, [selectedId], t('topic.summary'));
      if (!r.id) return setToast(t('toast.noRun'));
      commit(r.map, r.id);
      startEdit(r.id);
    },
    move(id: string | null, fn: (m: MindMap, id: string) => MindMap) {
      if (!id) return;
      const next = fn(map, id);
      if (next !== map) commit(next, id);
    },
  };

  // Boundaries and summaries group branches: any topic that has a parent.
  const canGroup = !!selectedId && !!findParent(map, selectedId);

  // ---------- right-click menu ----------

  const keyOf = (id: CommandId) => (keymap[id][0] ? fmt(keymap[id][0]) : undefined);
  const closeMenu = useCallback(() => setCtx(null), []);

  const openMenu = (target: CanvasTarget, x: number, y: number) => {
    setRelationFrom(null);
    // Right-clicking one of several selected topics keeps them all selected,
    // so the menu acts on the whole selection.
    if (target.kind === 'topic') {
      if (multi && selectedIds.includes(target.id)) focusInSelection(target.id);
      else selectTopic(target.id);
    }
    if (target.kind === 'relation') {
      setSelectedRelId(target.id);
      setSelectedId(null);
    }
    setCtx({ x, y, target });
  };

  /** Shift+F10 or the menu key: the menu for the selection, next to it. */
  const openMenuFromKeyboard = () => {
    const rect = selectedId && view === 'map' ? canvas.current?.topicRect(selectedId) : undefined;
    const area = document.querySelector('.canvas-area')?.getBoundingClientRect();
    const sel = selectedId ? document.querySelector('.o-row.on')?.getBoundingClientRect() : undefined;
    if (selectedRelId) {
      const r = area ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
      return setCtx({ x: r.left + r.width / 2, y: r.top + r.height / 2, target: { kind: 'relation', id: selectedRelId }, kb: true });
    }
    if (selectedId) {
      const r = rect ?? sel;
      const x = r ? r.left + Math.min(r.width, 40) : (area?.left ?? 0) + 40;
      const y = r ? r.bottom + 4 : (area?.top ?? 0) + 40;
      return setCtx({ x, y, target: { kind: 'topic', id: selectedId }, kb: true });
    }
    if (view === 'map' && area) setCtx({ x: area.left + area.width / 2, y: area.top + area.height / 2, target: { kind: 'canvas', pos: { x: 0, y: (layout.bounds.maxY ?? 0) + 120 } }, kb: true });
  };

  // ---- task mode and tags (act on every selected topic) ----
  const taskTargets = () => (multi ? selectedIds : selectedId ? [selectedId] : []);
  const toggleTask = () => {
    const ids = taskTargets();
    if (ids.length) commit(toggleTasks(map, ids));
  };
  const patchTask = (p: TaskPatch) => commit(setTaskFields(map, taskTargets(), p));
  const tagTopics = (tag: string, on: boolean) => commit(setTag(map, taskTargets(), tag, on));
  const setPriority = (n: number | undefined) => {
    const ids = taskTargets();
    if (n) return commit(setMarker(map, ids, `priority-${n}`, true));
    let next = map;
    for (const id of ids) {
      const m = findTopic(next, id)?.markers?.find((x) => x.startsWith('priority-'));
      if (m) next = setMarker(next, [id], m, false);
    }
    commit(next);
  };
  const openTagInput = () => {
    setPanelOpen(true);
    setHistoryOpen(false);
    setPanelTab('style');
    setTimeout(() => document.getElementById('tag-input')?.focus(), 0);
  };
  const openTasks = () => {
    setPanelOpen(true);
    setHistoryOpen(false);
    setPanelTab('tasks');
  };
  const toggleFilter = () => setFilter((f) => (f ? null : { ...emptyFilter }));
  /** A tag chip on the map: filter by it (again: stop filtering by it). */
  const filterByTag = (tag: string) =>
    setFilter((f) => {
      const cur = f ?? { ...emptyFilter };
      const has = cur.tags.some((x) => x.toLowerCase() === tag.toLowerCase());
      return { ...cur, tags: has ? cur.tags.filter((x) => x.toLowerCase() !== tag.toLowerCase()) : [...cur.tags, tag] };
    });

  const topicMenu = (id: string): CtxItem[] => {
    const tp = findTopic(map, id);
    if (!tp) return [];
    const isMain = id === mainId;
    const hasKids = tp.children.length > 0;
    const style = tp.style ?? {};
    const item = (cid: CommandId, run: () => void, extra: Partial<Extract<CtxItem, { type: 'item' }>> = {}): CtxItem => ({
      type: 'item',
      id: cid,
      label: cmdLabel(cid),
      keys: keyOf(cid),
      run,
      ...extra,
    });
    const sep: CtxItem = { type: 'sep' };
    // With several topics selected, look changes go to all of them.
    const targets = multi && selectedIds.includes(id) ? selectedIds : [id];
    const restyle = (patch: TopicStyle) => commit(updateStyles(map, targets, patch));
    const relayout = (k: Topic['layout']) => commit(setLayouts(map, targets.filter((x) => x !== mainId || targets.length === 1), k));
    const box = layout.byId.get(id);
    const ownLayout = tp.layout;
    const inherited = (box ? layout.byId.get(box.parentId ?? '')?.layout : undefined) ?? map.layout;
    if (readOnly) {
      return tidy([
        item('copy', () => actions.copy(), { icon: <I.Copy size={16} /> }),
        tp.href && item('openLink', () => actions.openLink(id), { icon: <I.LinkIcon size={16} /> }),
        tp.note && view === 'map' && { type: 'item', id: 'note', label: cmdLabel('note'), icon: <I.NoteIcon size={16} />, run: () => setNoteId(id) },
        sep,
        view === 'map' && { type: 'item', id: 'focus', label: t('ctx.focus'), keys: keyOf('centerSelected'), icon: <I.Target size={16} />, run: () => canvas.current?.centerOn(id) },
        !!tp.innerSize && item('enterInner', () => enterInner(id), { icon: <I.InnerIcon size={16} /> }),
      ]);
    }
    // Inner map: go in, or make one.
    const innerItems: (CtxItem | false)[] = multi
      ? []
      : tp.innerSize
        ? [
            item('enterInner', () => enterInner(id), { icon: <I.InnerIcon size={16} />, keys: t('ctx.dblClick') }),
            !isMain && item('innerToBranch', commands.innerToBranch.run, { icon: <I.InnerIcon size={16} /> }),
          ]
        : isMain
          ? []
          : [
              hasKids ? item('branchToInner', commands.branchToInner.run, { icon: <I.InnerIcon size={16} /> }) : item('addInner', commands.addInner.run, { icon: <I.InnerIcon size={16} /> }),
              item('addCanvas', commands.addCanvas.run, { icon: <I.BrushIcon size={16} /> }),
            ];
    return tidy([
      ...innerItems,
      innerItems.length > 0 && sep,
      item('addChild', actions.addChild, { icon: <I.SubtopicIcon size={16} /> }),
      item('addSibling', () => actions.addSibling(), { icon: <I.TopicIcon size={16} /> }),
      sep,
      item('edit', () => startEdit(id), { icon: <I.Pencil size={16} /> }),
      item('note', actions.note, { label: tp.note ? t('ctx.editNote') : cmdLabel('note'), icon: <I.NoteIcon size={16} /> }),
      tp.image
        ? { type: 'item', id: 'image', label: t('tb.removeImage'), icon: <I.ImageIcon size={16} />, run: () => commit(removeTopicImage(map, id)) }
        : { type: 'item', id: 'image', label: t('ctx.addImage'), icon: <I.ImageIcon size={16} />, run: () => imageInput.current?.click() },
      tp.href && item('openLink', () => actions.openLink(id), { icon: <I.LinkIcon size={16} /> }),
      sep,
      {
        type: 'swatches',
        id: 'color',
        label: t('ctx.color'),
        colors: [
          { value: undefined, label: t('ctx.autoColor'), on: !style.fill },
          ...FILL_SWATCHES.map((c) => ({ value: c, label: t('panel.fillColor', { color: c }), on: style.fill === c })),
        ],
        pick: (fill) => restyle({ fill }),
      },
      {
        type: 'sub',
        id: 'shape',
        label: t('ctx.shape'),
        icon: <I.ShapeIcon size={16} />,
        items: [
          { type: 'item', id: 'auto', label: t('panel.auto'), checked: !style.shape, run: () => restyle({ shape: undefined }) },
          ...(['rounded', 'pill', 'rect', 'underline', 'none'] as TopicShape[]).map<CtxItem>((sh) => ({
            type: 'item',
            id: sh,
            label: t(`shape.${sh}`),
            checked: style.shape === sh,
            run: () => restyle({ shape: sh }),
          })),
        ],
      },
      targets.some((x) => findTopic(map, x)?.width) && {
        type: 'item',
        id: 'autoWidth',
        label: t('ctx.autoWidth'),
        icon: <I.ShapeIcon size={16} />,
        run: () => commit(targets.reduce((m, x) => setTopicWidth(m, x, undefined), map)),
      },
      {
        type: 'sub',
        id: 'layout',
        label: t('ctx.branchLayout'),
        icon: <I.MapIcon size={16} />,
        items: [
          { type: 'item', id: 'inherit', label: t('panel.branchInherit', { layout: layoutName(inherited) }), checked: !ownLayout, run: () => relayout(undefined) },
          { type: 'sep' },
          ...LAYOUT_KINDS.map<CtxItem>((k) => ({ type: 'item', id: k, label: layoutName(k), checked: ownLayout === k, run: () => relayout(k) })),
        ],
      },
      {
        type: 'item',
        id: 'markers',
        label: t('ctx.markers'),
        icon: <I.MarkerIcon size={16} />,
        run: () => {
          setPanelOpen(true);
          setHistoryOpen(false);
          setPanelTab('style');
        },
      },
      item('task', toggleTask, { label: !tp.task ? t('task.make') : tp.task === 'todo' ? t('task.check') : t('task.uncheck'), icon: <I.TaskIcon size={16} /> }),
      !!tp.task && { type: 'item', id: 'taskRemove', label: t('task.remove'), icon: <I.TaskIcon size={16} />, run: () => patchTask({ task: null }) },
      {
        type: 'sub',
        id: 'tags',
        label: t('tag.section'),
        icon: <I.TagIcon size={16} />,
        items: [
          ...mapTags.slice(0, 12).map<CtxItem>(({ tag }) => {
            const on = !!tp.tags?.some((x) => x.toLowerCase() === tag.toLowerCase());
            return { type: 'item', id: `tag-${tag}`, label: `#${tag}`, checked: on, run: () => tagTopics(tag, !on) };
          }),
          ...(mapTags.length ? [{ type: 'sep' } as CtxItem] : []),
          { type: 'item', id: 'newTag', label: t('tag.new'), run: openTagInput },
        ],
      },
      item('formatPainter', () => actions.painter(), { label: t('tb.painter'), icon: <I.BrushIcon size={16} /> }),
      copiedStyle && item('pasteStyle', actions.pasteStyle, { icon: <I.BrushIcon size={16} /> }),
      sep,
      (hasKids || multi) && !isMain && commands.collapse.enabled !== false && item('collapse', actions.collapse, { label: tp.collapsed ? t('ctx.expand') : t('ctx.collapse'), icon: <I.Collapse size={16} /> }),
      item('relation', actions.relation, { icon: <I.RelationIcon size={16} /> }),
      layout.byId.get(id)?.layout === 'flow' && item('merge', actions.merge, { icon: <I.MergeIcon size={16} /> }),
      canGroup && item('boundary', actions.boundary, { icon: <I.BoundaryIcon size={16} /> }),
      canGroup && item('summary', actions.summary, { icon: <I.SummaryIcon size={16} /> }),
      view === 'map' && commands.focus.enabled !== false && { type: 'item', id: 'focusMode', label: focused?.id === id ? t('focus.exit') : cmdLabel('focus'), keys: keyOf('focus'), icon: <I.FocusIcon size={16} />, run: actions.focus },
      view === 'map' && { type: 'item', id: 'focus', label: t('ctx.focus'), keys: keyOf('centerSelected'), icon: <I.Target size={16} />, run: () => canvas.current?.centerOn(id) },
      sep,
      aiAvailable && !multi && {
        type: 'sub',
        id: 'assistant',
        label: t('ctx.assistant'),
        icon: <I.Sparkle size={16} />,
        items: [
          ...(['nextSteps', 'ideas', 'expand', 'summarize', 'rewrite', 'fromNote', 'translateTr', 'translateEn'] as AiAction[])
            .filter((a) => a !== 'fromNote' || !!tp.note?.trim())
            .map((a): CtxItem => ({ type: 'item', id: `ai-${a}`, label: actionLabel(a), run: () => aiRun(a, id) })),
          { type: 'sep' },
          { type: 'item', id: 'ai-open', label: cmdLabel('assistant'), keys: keyOf('assistant'), run: () => setAiOpen(true) },
        ],
      },
      sep,
      (!isMain || multi) && item('cut', () => actions.copy(true), { icon: <I.Cut size={16} /> }),
      item('copy', () => actions.copy(), { icon: <I.Copy size={16} /> }),
      item('paste', () => void actions.paste(), { icon: <I.Paste size={16} /> }),
      sep,
      (!isMain || multi) && item('remove', actions.remove, { label: multi && targets.length > 1 ? `${cmdLabel('remove')} (${targets.length})` : cmdLabel('remove'), danger: true, icon: <I.Trash size={16} /> }),
    ]);
  };

  const canvasMenu = (pos: { x: number; y: number }): CtxItem[] => {
    const sep: CtxItem = { type: 'sep' };
    const viewItems: CtxItem[] = [
      { type: 'item', id: 'fit', label: cmdLabel('fit'), keys: keyOf('fit'), icon: <I.Target size={16} />, run: () => canvas.current?.fit() },
      { type: 'item', id: 'zoom100', label: t('ctx.resetZoom'), icon: <I.Search size={16} />, run: () => canvas.current?.resetZoom() },
      { type: 'item', id: 'root', label: t('ctx.centerRoot'), icon: <I.RootIcon size={16} />, run: () => goTo(mainId) },
    ];
    const more: CtxItem[] = [
      { type: 'item', id: 'outline', label: t('ctx.outline'), keys: keyOf('toggleOutline'), icon: <I.OutlineIcon size={16} />, run: () => switchView('outline') },
      { type: 'item', id: 'present', label: cmdLabel('present'), keys: keyOf('present'), icon: <I.Present size={16} />, run: () => setPresenting(true) },
    ];
    const out: CtxItem | false = path.length > 0 && { type: 'item', id: 'exitInner', label: cmdLabel('exitInner'), keys: 'Esc', icon: <I.ExitInnerIcon size={16} />, run: () => exitInner() };
    if (readOnly) return tidy([out, out && sep, ...viewItems, sep, ...more]);
    return tidy([
      out,
      out && sep,
      !path.length && { type: 'item', id: 'floating', label: t('ctx.floatingHere'), icon: <I.FloatingIcon size={16} />, run: () => actions.floating(pos) },
      { type: 'item', id: 'insertMap', label: cmdLabel('insertMap'), icon: <I.InnerIcon size={16} />, run: () => setInsertOpen(true) },
      topicClipboard && {
        type: 'item',
        id: 'paste',
        label: t('ctx.pasteHere'),
        keys: keyOf('paste'),
        icon: <I.Paste size={16} />,
        run: () => {
          // Several copied topics land one below the other.
          let next = map;
          const ids: string[] = [];
          topicClipboard!.topics.forEach((tp, i) => {
            const r = pasteFloating(next, { x: pos.x, y: pos.y + i * 60 }, tp);
            next = r.map;
            ids.push(r.id);
          });
          commit(next);
          selectMany(ids);
        },
      },
      sep,
      { type: 'item', id: 'undo', label: cmdLabel('undo'), keys: keyOf('undo'), disabled: !commands.undo.enabled, icon: <I.Undo size={16} />, run: actions.undo },
      { type: 'item', id: 'redo', label: cmdLabel('redo'), keys: keyOf('redo'), disabled: !commands.redo.enabled, icon: <I.Redo size={16} />, run: actions.redo },
      sep,
      ...viewItems,
      {
        type: 'sub',
        id: 'mapLayout',
        label: t('ctx.mapLayout'),
        icon: <I.MapIcon size={16} />,
        items: LAYOUT_KINDS.map<CtxItem>((k) => ({ type: 'item', id: k, label: layoutName(k), checked: map.layout === k, run: () => map.layout !== k && commit(setMapProps(map, { layout: k })) })),
      },
      sep,
      ...more,
      { type: 'item', id: 'panel', label: cmdLabel('panel'), icon: <I.Panel size={16} />, run: () => { setPanelOpen(true); setHistoryOpen(false); setPanelTab('map'); } },
    ]);
  };

  const relationMenu = (id: string): CtxItem[] => {
    const rel = map.relations.find((r) => r.id === id);
    if (!rel) return [];
    return tidy([
      !readOnly && {
        type: 'item',
        id: 'label',
        label: t('ctx.relLabel'),
        icon: <I.Pencil size={16} />,
        run: () => {
          setPanelOpen(true);
          setHistoryOpen(false);
          setPanelTab('style');
          setTimeout(() => document.getElementById('relation-label')?.focus(), 0);
        },
      },
      { type: 'item', id: 'from', label: t('ctx.relFrom'), icon: <I.Back size={16} />, run: () => goTo(rel.from) },
      { type: 'item', id: 'to', label: t('ctx.relTo'), icon: <I.Chevron size={16} />, run: () => goTo(rel.to) },
      { type: 'sep' },
      !readOnly && { type: 'item', id: 'remove', label: t('ctx.relDelete'), keys: keyOf('remove'), danger: true, icon: <I.Trash size={16} />, run: () => { commit(removeRelation(map, id)); setSelectedRelId(null); } },
    ]);
  };

  /** Everything the keyboard and the command palette can run. */
  const commands: Record<CommandId, { run(): void; enabled?: boolean }> = {
    palette: { run: () => setPaletteOpen((v) => !v) },
    contextMenu: { run: () => openMenuFromKeyboard() },
    shortcuts: { run: () => setKeysOpen((v) => !v) },
    language: { run: () => setLang(getLang() === 'tr' ? 'en' : 'tr') },
    back: { run: onBack },
    addChild: { run: actions.addChild, enabled: !!selectedId },
    addSibling: { run: () => actions.addSibling(), enabled: !!selectedId },
    addSiblingBefore: { run: () => actions.addSibling(true), enabled: !!selectedId },
    edit: { run: () => selectedId && startEdit(selectedId), enabled: !!selectedId },
    remove: { run: actions.remove, enabled: !!selectedRelId || !!selectedBoundaryId || selectedIds.some((id) => id !== mainId && id !== viewRootId) },
    undo: { run: actions.undo, enabled: session ? session.canUndo() : hist.past.length > 0 },
    redo: { run: actions.redo, enabled: session ? session.canRedo() : hist.future.length > 0 },
    copy: { run: () => actions.copy(), enabled: !!selected },
    cut: { run: () => actions.copy(true), enabled: selectedIds.some((id) => id !== mainId && id !== viewRootId) },
    paste: { run: () => void actions.paste(), enabled: !readOnly },
    collapse: { run: actions.collapse, enabled: (multi ? selectedIds : selectedId ? [selectedId] : []).some((id) => id !== mainId && id !== viewRootId && !!findTopic(map, id)?.children.length) },
    selectAll: { run: actions.selectAll },
    formatPainter: { run: () => actions.painter(), enabled: !!selected && !readOnly },
    copyStyle: { run: actions.copyStyle, enabled: !!selected },
    pasteStyle: { run: actions.pasteStyle, enabled: !!selectedId && !readOnly },
    moveUp: { run: () => actions.move(selectedId, (m, id) => moveAmongSiblings(m, id, -1)), enabled: !!selectedId },
    moveDown: { run: () => actions.move(selectedId, (m, id) => moveAmongSiblings(m, id, 1)), enabled: !!selectedId },
    indent: { run: () => actions.move(selectedId, indentTopic), enabled: !!selectedId },
    outdent: { run: () => actions.move(selectedId, outdentTopic), enabled: !!selectedId },
    navLeft: { run: () => navigate('left') },
    navRight: { run: () => navigate('right') },
    navUp: { run: () => navigate('up') },
    navDown: { run: () => navigate('down') },
    relation: { run: actions.relation, enabled: !!selectedId },
    merge: { run: actions.merge, enabled: inFlow },
    floating: { run: () => actions.floating() },
    note: { run: actions.note, enabled: !!selectedId },
    save: { run: () => saveToFile() },
    saveAs: { run: () => saveToFile(true), enabled: canLinkFiles() },
    toggleOutline: { run: () => switchView(view === 'map' ? 'outline' : 'map') },
    notebook: { run: () => commit(setMapProps(map, { notebook: !map.notebook })), enabled: !readOnly },
    zoomIn: { run: () => canvas.current?.zoomBy(1.2), enabled: view === 'map' },
    zoomOut: { run: () => canvas.current?.zoomBy(1 / 1.2), enabled: view === 'map' },
    fit: { run: () => canvas.current?.fit(), enabled: view === 'map' },
    centerSelected: { run: () => selectedId && canvas.current?.centerOn(selectedId), enabled: view === 'map' && !!selectedId },
    history: { run: () => setHistoryOpen((v) => !v) },
    panel: { run: () => setPanelOpen((v) => !v) },
    present: { run: () => setPresenting(true) },
    openLink: { run: () => actions.openLink(), enabled: !!selected?.href },
    share: { run: () => setShareOpen(true), enabled: !shared && sync.canShare() },
    focus: { run: actions.focus, enabled: !!focused || (!!selectedId && selectedId !== mainId && !!selected && !isSummaryTopic(map, selectedId)) },
    boundary: { run: actions.boundary, enabled: !!selectedId && canGroup },
    summary: { run: actions.summary, enabled: !!selectedId && canGroup },
    enterInner: { run: () => enterInner(), enabled: selectedHasInner },
    exitInner: { run: () => exitInner(), enabled: path.length > 0 },
    branchToInner: {
      run: () => {
        if (!selectedId) return;
        commit(branchToInner(map, selectedId), selectedId);
        setToast(t('inner.converted'));
      },
      enabled: canMakeInner && !readOnly,
    },
    innerToBranch: {
      run: () => {
        if (!selectedId) return;
        commitDoc(innerToBranch(doc, selectedId), selectedId);
        setToast(t('inner.expanded'));
      },
      enabled: selectedHasInner && selectedId !== mainId && !readOnly,
    },
    addInner: {
      run: () => {
        if (!selectedId) return;
        const r = addInner(doc, selectedId, t('topic.default'));
        if (r.id) commitDoc(r.map, selectedId);
      },
      enabled: !!selected && !selectedHasInner && selectedId !== mainId && !readOnly,
    },
    insertMap: { run: () => setInsertOpen(true), enabled: !readOnly },
    task: { run: toggleTask, enabled: !!selectedId && !readOnly },
    tag: { run: openTagInput, enabled: !!selectedId && !readOnly },
    filter: { run: toggleFilter },
    tasks: { run: openTasks },
    assistant: { run: () => (aiOpen ? closeAssistant() : (setAiOpen(true), setHistoryOpen(false))), enabled: aiPrefs.enabled },
    aiIdeas: { run: () => selectedId && aiRun('ideas', selectedId), enabled: aiAvailable && !!selectedId && !readOnly },
    aiExpand: { run: () => selectedId && aiRun('expand', selectedId), enabled: aiAvailable && !!selectedId && !readOnly },
    aiSummarize: { run: () => selectedId && aiRun('summarize', selectedId), enabled: aiAvailable && !!selectedId && !readOnly },
    aiNextSteps: { run: () => aiRun('nextSteps', selectedId ?? mainId), enabled: aiAvailable && !readOnly },
    viewCanvas: { run: () => setKind(kind === 'map' ? 'canvas' : 'map'), enabled: !readOnly },
    viewBoth: { run: () => setKind(kind === 'both' ? 'map' : 'both'), enabled: !readOnly },
    addCanvas: {
      run: () => {
        if (!selectedId) return;
        const tp = findTopic(doc, selectedId);
        if (!tp || hasInner(tp)) return;
        commitDoc(updateTopic(doc, selectedId, addCanvas(tp)), selectedId);
        crumbColors.current.set(selectedId, colorOf(selectedId));
        setCrumbAnim(true);
        goToPath([...path, selectedId]);
      },
      enabled: !!selected && !selectedHasInner && selectedId !== mainId && !readOnly,
    },
  };

  // Keyboard shortcuts (inactive while typing in a field or a dialog is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingId || keysOpen || presenting || shareOpen || ctx || insertOpen) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (drawing) return; // see the canvas-mode handler below
      const combo = comboFromEvent(e);
      if (!combo) return;
      if (paletteOpen && combo !== 'Mod+K') return;
      const id = commandFor(keymap, combo, view === 'outline');
      if (id === 'paste' && combo === 'Mod+V') {
        // Let the browser fire its paste event, which carries the clipboard
        // (text, pictures) without asking for permission. If none comes,
        // read the clipboard directly.
        if (pasteFallback.current) clearTimeout(pasteFallback.current);
        pasteFallback.current = setTimeout(() => {
          pasteFallback.current = null;
          void actions.paste();
        }, 120);
        return;
      }
      if (id) {
        e.preventDefault();
        // Arrow keys and editing keys act on the selected relation, if any.
        if ((selectedRelId || selectedBoundaryId) && ['navLeft', 'navRight', 'navUp', 'navDown', 'edit'].includes(id)) return;
        const c = commands[id];
        if (c.enabled !== false) c.run();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (painter) {
          setPainter(null);
          setToast(null);
        } else if (relationFrom) setRelationFrom(null);
        else if (filter) setFilter(null);
        else if (focused) exitFocus();
        else if (path.length) exitInner();
        else selectTopic(null), setSelectedRelId(null), setSelectedBoundaryId(null);
        return;
      }
      // Typing a character starts editing with that character.
      if (e.key.length === 1 && !e.altKey && !e.ctrlKey && !e.metaKey && selectedId && !selectedRelId && !selectedBoundaryId) {
        e.preventDefault();
        startEdit(selectedId, e.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Keys in canvas mode. The drawing canvas has its own keys and stops
  // them from bubbling, so this listens first (capture). Keizu keeps only a
  // few that aren't about topics, and Esc leaves an inner view once the
  // canvas is idle (nothing selected, no tool, no text being typed).
  useEffect(() => {
    if (!drawing) return;
    const onKey = (e: KeyboardEvent) => {
      if (keysOpen || presenting || shareOpen || ctx || insertOpen || paletteOpen) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || (tag === 'TEXTAREA' && !(e.target as HTMLElement).closest('.excalidraw'))) return;
      if (e.key === 'Escape') {
        if (path.length && tag !== 'TEXTAREA' && (board.current?.idle() ?? true)) {
          e.preventDefault();
          e.stopPropagation();
          exitInner();
        }
        return;
      }
      if (tag === 'TEXTAREA') return;
      const c = comboFromEvent(e);
      const id = c ? commandFor(keymap, c, false) : undefined;
      const allowed: CommandId[] = ['palette', 'save', 'saveAs', 'exitInner', 'present', 'viewCanvas', 'viewBoth', 'history', 'toggleOutline'];
      if (!id || !allowed.includes(id)) return;
      e.preventDefault();
      e.stopPropagation();
      if (commands[id].enabled !== false) commands[id].run();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // Smart paste: whatever is on the clipboard becomes topics.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (editingId || keysOpen || presenting || shareOpen || paletteOpen || drawing) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if (pasteFallback.current) {
        clearTimeout(pasteFallback.current);
        pasteFallback.current = null;
      }
      const dt = e.clipboardData;
      if (!dt) return;
      e.preventDefault();
      const text = dt.getData('text/plain');
      // Office apps put a picture of the copied text next to the text: text wins.
      const image = text.trim()
        ? undefined
        : [...dt.files].find((f) => f.type.startsWith('image/')) ?? [...dt.items].find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile() ?? undefined;
      void actions.pasteData({ text, image });
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
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
      // A drawing exports the drawing (with its topics in "both" mode).
      if (drawing && board.current && (kind === 'png' || kind === 'svg' || kind === 'pdf')) await board.current.exportAs(kind, inner ? map.roots[0].text || map.title : map.title);
      else if (kind === 'png') await exportPng(map, fullLayout, theme);
      else if (kind === 'svg') await exportSvg(map, fullLayout, theme);
      else if (kind === 'pdf') await exportPdf(map, fullLayout, theme);
      // Files hold everything, inner maps included; pictures show what you see.
      if (kind === 'md') await exportMarkdown(doc);
      if (kind === 'opml') await exportOpml(doc);
      if (kind === 'keizu') await exportKeizu(doc);
      if (kind === 'json') await exportPlainJson(doc);
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
    // "#tag" words typed at the end become the topic's tags.
    const ex = extractTags(clean);
    if (tp && ex.tags.length) {
      commit(ex.tags.reduce((m, tag) => setTag(m, [id], tag, true), updateTopic(map, id, { text: ex.text })));
      return;
    }
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
    const b = fullLayout.byId.get(id);
    if (b) return b.color;
    // Hidden in a collapsed branch on the map: use the nearest shown ancestor.
    for (let p = findParent(map, id); p; p = findParent(map, p.id)) {
      const pb = fullLayout.byId.get(p.id);
      if (pb) return pb.color;
    }
    return theme.mono;
  };
  const shareAvail = !shared && sync.canShare();
  // Map / canvas / both: top-right of the canvas area, in both modes.
  const kindSwitch = readOnly ? null : (
    <div className="seg-tabs kind-switch" role="group" aria-label={t('canvas.switch')}>
            {VIEW_KINDS.map((k) => (
              <button key={k} data-kind={k} className={kind === k ? 'on' : ''} aria-pressed={kind === k} title={t(`canvas.kindTip.${k}`)} onClick={() => setKind(k)}>
                {k === 'map' ? <I.SubtopicIcon size={15} /> : k === 'canvas' ? <I.BrushIcon size={15} /> : <I.InnerIcon size={15} />}
                {t(`canvas.kind.${k}`)}
              </button>
            ))}
          </div>
  );

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
                keepInFocus(id);
                selectTopic(id);
                setTimeout(() => canvas.current?.centerOn(id), 0);
              }}
              selectedIds={selectedSet}
              onSelectExtend={extendSelection}
              onStartEdit={(id) => {
                selectTopic(id);
                startEdit(id);
              }}
              onCommitEdit={commitEdit}
              onCancelEdit={cancelEdit}
              onToggleCollapse={(id) => commit(toggleCollapse(map, id))}
              onContextMenu={(id, x, y) => openMenu({ kind: 'topic', id }, x, y)}
              onCheckTask={readOnly ? undefined : (id) => commit(checkTask(map, id))}
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
          {!drawing && <>
          <button className="tb" title={tip('addSibling')} disabled={!selectedId} onClick={() => actions.addSibling()}><I.TopicIcon />{t('tb.topic')}</button>
          <button className="tb" title={tip('addChild')} disabled={!selectedId} onClick={actions.addChild}><I.SubtopicIcon />{t('tb.subtopic')}</button>
          <button className={`tb ${relationFrom && linkKind === 'relation' ? 'on' : ''}`} title={t('tb.relationTip')} disabled={!selectedId} onClick={actions.relation}><I.RelationIcon />{t('tb.relation')}</button>
          {inFlow && (
            <button className={`tb ${relationFrom && linkKind === 'flow' ? 'on' : ''}`} title={tip('merge', t('tb.mergeTip'))} onClick={actions.merge}><I.MergeIcon />{t('tb.merge')}</button>
          )}
          <button className="tb" title={tip('boundary', t('tb.boundaryTip'))} disabled={!commands.boundary.enabled} onClick={actions.boundary}><I.BoundaryIcon />{t('tb.boundary')}</button>
          <button className="tb" title={tip('summary', t('tb.summaryTip'))} disabled={!commands.summary.enabled} onClick={actions.summary}><I.SummaryIcon />{t('tb.summary')}</button>
          <button className="tb" title={t('tb.floatingTip')} onClick={() => actions.floating()}><I.FloatingIcon />{t('tb.floating')}</button>
          <button className="tb" title={t('tb.markerTip')} disabled={!selectedId} onClick={() => { setPanelOpen(true); setHistoryOpen(false); setPanelTab('style'); }}><I.MarkerIcon />{t('tb.marker')}</button>
          <button
            className={`tb ${painter ? 'on' : ''}`}
            title={tip('formatPainter', t('tb.painterTip'))}
            aria-pressed={!!painter}
            disabled={!selected && !painter}
            onClick={(e) => (e.detail > 1 ? undefined : actions.painter())}
            onDoubleClick={() => actions.painter(true)}
          >
            <I.BrushIcon />{t('tb.painter')}
          </button>
          <button className="tb" title={t('tb.noteTip')} disabled={!selectedId} onClick={actions.note}><I.NoteIcon />{t('tb.note')}</button>
          <button className={`tb ${selected?.task ? 'on' : ''}`} aria-pressed={!!selected?.task} title={tip('task', t('tb.taskTip'))} disabled={!selectedId} onClick={toggleTask}><I.TaskIcon />{t('tb.task')}</button>
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
          <button className="tb" title={tip('collapse')} disabled={!commands.collapse.enabled} onClick={actions.collapse}><I.Collapse />{t('tb.collapse')}</button>
          <button className={`tb ${focused ? 'on' : ''}`} aria-pressed={!!focused} title={focused ? `${t('focus.exit')} (Esc)` : tip('focus', t('tb.focusTip'))} disabled={!commands.focus.enabled} onClick={actions.focus}><I.FocusIcon />{t('tb.focus')}</button>
          <button className="tb" title={tip('remove')} disabled={!commands.remove.enabled} onClick={actions.remove}><I.Trash />{t('tb.delete')}</button>
          <span className="tb-sep" />
          <div className="seg-tabs layout-switch" role="group" aria-label={t('layout.switch')}>
            {(['mindmap', 'logic', 'org'] as const).map((k) => (
              <button key={k} className={map.layout === k ? 'on' : ''} aria-pressed={map.layout === k} title={layoutName(k)} onClick={() => map.layout !== k && commit(setMapProps(map, { layout: k }))}>
                {t(`layout.short.${k}`)}
              </button>
            ))}
          </div>
          <button
            className={`tb ${map.notebook ? 'on' : ''}`}
            aria-pressed={!!map.notebook}
            title={tip('notebook', t('tb.notebookTip'))}
            onClick={commands.notebook.run}
          >
            <I.NotebookIcon />{t('tb.notebook')}
          </button>
          <button className={`tb ${filter ? 'on' : ''}`} aria-pressed={!!filter} title={tip('filter', t('tb.filterTip'))} onClick={toggleFilter}><I.FilterIcon />{t('tb.filter')}</button>
          {aiAvailable && (
            <button className={`tb ${aiOpen ? 'on' : ''}`} aria-pressed={aiOpen} title={tip('assistant')} onClick={commands.assistant.run}>
              <I.Sparkle />{t('tb.assistant')}
            </button>
          )}
          </>}
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
          {!drawing && <button className={`ib ${panelOpen ? 'on' : ''}`} aria-label={cmdLabel('panel')} aria-pressed={panelOpen} title={tip('panel')} onClick={() => setPanelOpen((v) => !v)}><I.Panel /></button>}
        </div>
      </header>

      <div className="workspace">
        <main className={`canvas-area ${drawing ? 'drawing' : ''}`}>
          {drawing ? (
            <Suspense fallback={<div className="canvas-loading">{t('canvas.loading')}</div>}>
              <CanvasBoard
                key={`${pathKey}|${kind}`}
                ref={board}
                canvas={boardCanvas}
                mode={kind as 'canvas' | 'both'}
                topics={boardTopics}
                resources={map.resources}
                dark={theme.dark}
                lang={getLang()}
                readOnly={readOnly}
                background={theme.dark ? preInvert(theme.canvas) : theme.canvas}
                onChange={(c, files) =>
                  editView(boardPath, (v) => {
                    const next = setViewCanvas(v, boardPath.length > 0, c);
                    return Object.keys(files).length ? { ...next, resources: { ...next.resources, ...files } } : next;
                  })
                }
                onTopicText={(id, text) => editView(boardPath, (v) => updateTopic(v, id, { text }))}
                topRight={kindSwitch}
              />
            </Suspense>
          ) : view === 'map' ? (
            <MapCanvas
              ref={canvas}
              map={map}
              layout={layout}
              theme={theme}
              selectedId={selectedId}
              editingId={editingId}
              editSeed={editSeed}
              focusId={startId}
              onSelect={(id) => !(id && ghost?.ids.has(id)) && selectTopic(id)}
              selectedIds={selectedSet}
              onSelectExtend={extendSelection}
              onSelectBox={(ids, additive) => selectMany(ids, additive)}
              onMoveMany={(ids, parent) => commit(moveTopics(map, ids, parent))}
              onFloatMany={(ids, delta) => commit(floatTopics(map, ids, (id) => layout.byId.get(id), delta))}
              painting={!!painter}
              onPaint={actions.paint}
              selectedRelId={selectedRelId}
              selectedBoundaryId={selectedBoundaryId}
              scopeId={focused?.id ?? null}
              relationFrom={relationFrom}
              onSelectRelation={(id) => {
                setSelectedRelId(id);
                setSelectedBoundaryId(null);
                setSelectedId(null);
                setPanelOpen(true);
                setPanelTab('style');
              }}
              onSelectBoundary={(id) => {
                setSelectedBoundaryId(id);
                setSelectedRelId(null);
                setSelectedId(null);
                setPanelOpen(true);
                setPanelTab('style');
              }}
              onPickRelationTarget={(id) => {
                if (relationFrom && id !== relationFrom && linkKind === 'flow') {
                  setRelationFrom(null);
                  setToast(null);
                  return actions.link(relationFrom, id);
                }
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
              onFloat={(id, pos) => !focused && commit(floatTopic(map, id, pos), id)}
              onCreateFloating={(pos) => !focused && actions.floating(pos)}
              onStartEdit={(id) => !ghost?.ids.has(id) && startEdit(id)}
              onCommitEdit={commitEdit}
              onCancelEdit={cancelEdit}
              onMove={(id, parent, merge) => (merge ? actions.link(id, parent) : commit(moveTopic(map, id, parent)))}
              onEnterInner={(id) => enterInner(id)}
              viewKey={pathKey}
              onToggleCollapse={(id) => commit(toggleCollapse(map, id))}
              onZoomChange={setZoom}
              onOpenLink={(id) => actions.openLink(id)}
              onContextMenu={openMenu}
              onCheckTask={(id) => commit(checkTask(map, id))}
              onTagClick={filterByTag}
              filterDim={dimIds}
              noteId={noteId}
              noteEdit={noteEdit}
              onOpenNote={(id) => setNoteId(id)}
              onCloseNote={() => setNoteId(null)}
              onSaveNote={saveNote}
              onToggleNoteTask={(id, line) => {
                const tp = findTopic(map, id);
                if (tp?.note) commit(updateTopic(map, id, { note: toggleNoteLine(tp.note, line) }));
              }}
              onOpenNoteLink={(href) => void actions.openHref(href)}
              onResizePreview={(id, w) => setSizing(w === null ? null : { id, w })}
              onResize={(id, w) => {
                const next = setTopicWidth(map, id, w);
                if (next !== map) commit(next, id);
              }}
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
              selectedIds={selectedSet}
              onSelectExtend={extendSelection}
              onSelectRange={(ids) => {
                selectMany(ids);
                setPrimary(ids.includes(selectedId ?? '') ? selectedId : ids[0]);
              }}
              onStartEdit={(id) => startEdit(id)}
              onCommitEdit={commitEdit}
              onCancelEdit={cancelEdit}
              onToggleCollapse={(id) => commit(toggleCollapse(map, id))}
              onContextMenu={(id, x, y) => openMenu({ kind: 'topic', id }, x, y)}
              onCheckTask={readOnly ? undefined : (id) => commit(checkTask(map, id))}
            />
          )}
          {path.length > 0 && (
            <nav className="crumbs" aria-label={t('inner.crumbs')}>
              <button className="up" aria-label={t('inner.up')} title={tip('exitInner', t('inner.up'))} onClick={() => exitInner()}>
                <I.Undo size={15} />
              </button>
              {[doc.roots[0].id, ...path].map((id, i, all) => {
                const tp = findTopic(doc, id);
                const last = i === all.length - 1;
                const color = i > 0 ? boxColor(id) : undefined;
                return (
                  <span key={id} style={{ display: 'contents' }}>
                    {i > 0 && <span className="sep">›</span>}
                    <button
                      className={last && crumbAnim ? 'new' : undefined}
                      aria-current={last ? 'location' : undefined}
                      onClick={() => !last && exitInner(all.length - 1 - i)}
                    >
                      {color && <span className="dot" style={{ background: color }} />}
                      <span className="tx">{i === 0 ? doc.title : tp?.text}</span>
                    </button>
                  </span>
                );
              })}
            </nav>
          )}
          {view === 'map' && !drawing && focused && (
            <nav className="focus-bar" aria-label={t('focus.label')} style={path.length ? { top: 60 } : undefined}>
              <I.FocusIcon size={15} />
              <ol>
                {focusPath.map((p, i) => (
                  <li key={p.id}>
                    {i < focusPath.length - 1 ? (
                      <button onClick={() => (i === 0 && p.id === mainId ? exitFocus() : enterFocus(p.id))}>{p.text.split('\n')[0] || '…'}</button>
                    ) : (
                      <span aria-current="location">{p.text.split('\n')[0] || '…'}</span>
                    )}
                  </li>
                ))}
              </ol>
              <button className="focus-exit" title={t('focus.hint')} onClick={exitFocus}>
                {t('focus.exit')}
                <kbd>Esc</kbd>
              </button>
            </nav>
          )}
          {filter && view === 'map' && !drawing && (
            <FilterBar
              below={!!kindSwitch}
              tags={mapTags}
              filter={filter}
              matches={matched?.size}
              onChange={setFilter}
              onClose={() => setFilter(null)}
            />
          )}
          {view === 'map' && !drawing && kindSwitch && <div className="kind-float">{kindSwitch}</div>}
          {view === 'map' && !drawing && (
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
        {taskCount.all > 0 && (
          <button className="sb-tasks" title={cmdLabel('tasks')} onClick={openTasks}>{t('status.tasks', taskCount)}</button>
        )}
        {filtering && <span className="sb-sel">{t('status.filter')}</span>}
        {multi && <span className="sb-sel">{t('status.selected', { n: selectedIds.length })}</span>}
        {live.peers.length > 0 && <span>{t('live.peers', { n: live.peers.length })}</span>}
        <span>{drawing ? t(`canvas.kind.${kind}`) : layoutName(map.layout)}</span>
        {path.length > 0 && <span>{t('inner.where', { n: path.length })}</span>}
        {focused && <span>{t('status.focus', { name: focused.text.split('\n')[0] })}</span>}
        <button className="sb-lang" title={t('status.lang')} onClick={() => commands.language.run()}>{getLang().toUpperCase()}</button>
      </footer>
      </div>

        {historyOpen && (
          <VersionPanel
            store={store}
            map={doc}
            fontsReady={fontsReady}
            onClose={() => setHistoryOpen(false)}
            onRestore={async (old) => {
              await store.addVersion(doc, 'restore').catch(() => {});
              goToPath([]);
              commitDoc({ ...old, id: doc.id, version: doc.version, updatedAt: new Date().toISOString() }, old.roots[0].id);
              setToast(t('toast.restored', { key: fmt(keymap.undo[0] ?? 'Mod+Z') }));
            }}
          />
        )}

        {aiOpen && !historyOpen && !readOnly && (
          <AssistantPanel map={map} topicId={selectedId ?? mainId} assistant={assistant} onClose={closeAssistant} />
        )}

        {panelOpen && !historyOpen && !aiOpen && !readOnly && !drawing && (
          <FormatPanel
            map={map}
            topic={selected}
            relation={selectedRel}
            boundary={selectedBoundary}
            onBoundary={(p) => selectedBoundaryId && commit(updateBoundary(map, selectedBoundaryId, p))}
            onBoundaryResize={(end, delta) => selectedBoundaryId && commit(resizeBoundary(map, selectedBoundaryId, end, delta))}
            summary={selectedId ? summaryOwner(map, selectedId) : undefined}
            onSummaryResize={(end, delta) => selectedId && commit(resizeSummary(map, selectedId, end, delta))}
            onSummaryDelete={() => selectedId && commit(removeSummary(map, selectedId), summaryOwner(map, selectedId)?.summary.to ?? null)}
            onRelationLabel={(label) => selectedRelId && commit(updateRelation(map, selectedRelId, { label: label || undefined }))}
            onRelationDelete={() => actions.remove()}
            isRoot={selectedId === mainId}
            count={selectedIds.length}
            inheritedLayout={inheritedLayout}
            tab={panelTab}
            onTab={setPanelTab}
            onStyle={(p) => selectedId && commit(multi ? updateStyles(map, selectedIds, p) : updateStyle(map, selectedId, p))}
            onBranchLayout={(k) => selectedId && commit(multi ? setLayouts(map, selectedIds.filter((id) => id !== mainId), k) : setBranchLayout(map, selectedId, k))}
            onMarker={(m) => selectedId && commit(multi ? setMarker(map, selectedIds, m, !selected?.markers?.includes(m)) : toggleMarker(map, selectedId, m))}
            onNote={(n) => selectedId && commit(updateTopic(map, selectedId, { note: n || undefined }))}
            onLinkLabel={(l) => selectedId && commit(updateTopic(map, selectedId, { linkLabel: l || undefined }))}
            onHref={(h) => selectedId && commit(updateTopic(map, selectedId, { href: h || undefined }))}
            maps={libraryMaps}
            onMap={(p) => commit(setMapProps(map, p))}
            topicTop={
              selected ? (
                <TaskTagSection
                  key={`tt-${selected.id}`}
                  topic={selected}
                  count={selectedIds.length}
                  tags={mapTags.map((x) => x.tag)}
                  onTask={patchTask}
                  onTag={tagTopics}
                  onPriority={setPriority}
                />
              ) : undefined
            }
            tasksPane={
              <TasksPane
                doc={doc}
                store={shared ? undefined : store}
                readOnly={readOnly}
                onGo={goTo}
                onOpenMap={(mapId, topicId) => onOpenMap(mapId, topicId)}
                onCheck={(id) => {
                  if (readOnlyRef.current) return;
                  setHist((h) => push(h, checkTask(h.present, id)));
                }}
              />
            }
            topicExtra={
              selected && selectedId !== mainId ? (
                <section>
                  <h3 className="lbl">{t('inner.section')}</h3>
                  <p className="muted" style={{ marginBottom: 8 }}>{t('inner.sectionHint')}</p>
                  <div className="inner-actions">
                    {selectedHasInner ? (
                      <>
                        <button className="btn primary" onClick={() => enterInner()}>{t('inner.enter')}</button>
                        <button className="btn" onClick={commands.innerToBranch.run}>{t('inner.toBranch')}</button>
                      </>
                    ) : (
                      <>
                        {canMakeInner ? (
                          <button className="btn" onClick={commands.branchToInner.run}>{t('inner.toInner')}</button>
                        ) : (
                          <button className="btn" onClick={commands.addInner.run}>{t('inner.add')}</button>
                        )}
                        <button className="btn" onClick={commands.addCanvas.run}>{t('canvas.add')}</button>
                      </>
                    )}
                  </div>
                </section>
              ) : undefined
            }
          />
        )}
      </div>

      {paletteOpen && (
        <CommandPalette map={doc} commands={paletteCommands} onPickTopic={goTo} onClose={() => setPaletteOpen(false)} />
      )}
      {insertOpen && (
        <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setInsertOpen(false)}>
          <div className="dialog" role="dialog" aria-label={t('inner.insertTitle')} onKeyDown={(e) => e.key === 'Escape' && setInsertOpen(false)}>
            <div className="sc-head">
              <strong>{t('inner.insertTitle')}</strong>
              <button className="ib" aria-label={t('common.close')} onClick={() => setInsertOpen(false)}>×</button>
            </div>
            <p className="muted">{t('inner.insertHint')}</p>
            <div className="map-pick">
              {libraryMaps.filter((m) => m.id !== doc.id).map((m) => (
                <button key={m.id} onClick={() => insertFromLibrary(m.id)}>{m.title}</button>
              ))}
              {!libraryMaps.some((m) => m.id !== doc.id) && <p className="muted">{t('inner.insertEmpty')}</p>}
            </div>
            <button className="btn" onClick={insertFromFile}>{t('inner.insertFromFile')}</button>
          </div>
        </div>
      )}
      {ctx && (
        <ContextMenu
          key={`${ctx.x},${ctx.y}`}
          x={ctx.x}
          y={ctx.y}
          keyboard={ctx.kb}
          label={t(ctx.target.kind === 'topic' ? 'ctx.topicMenu' : ctx.target.kind === 'relation' ? 'ctx.relationMenu' : 'ctx.canvasMenu')}
          items={ctx.target.kind === 'topic' ? topicMenu(ctx.target.id) : ctx.target.kind === 'relation' ? relationMenu(ctx.target.id) : canvasMenu(ctx.target.pos)}
          onClose={closeMenu}
        />
      )}
      {keysOpen && <KeysDialog onClose={() => setKeysOpen(false)} />}
      {shareOpen && <ShareDialog map={doc} onClose={() => setShareOpen(false)} onShared={live.enable} />}
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
