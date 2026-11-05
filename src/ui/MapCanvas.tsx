// The interactive canvas: pan, zoom, select, drag topics onto new parents,
// and edit topic text in place.

import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MapLayout, NodeBox } from '../core/layout';
import { findTopic, isRoot, type MindMap, type Point, type Topic } from '../core/model';
import type { Theme } from '../core/themes';
import { snappedViewport } from '../core/viewport';
import { t } from '../i18n';
import { MapSvg, SELECT_COLOR, TopicView, nodeColors } from './MapSvg';
import { canvasMeasure } from './measure';
import { NotePopover, type NoteSave } from './NotePopover';
import { getMotionPrefs, isMouseWheel, reducedMotion, wheelZoomFactor } from './motion';
import { useLayoutMotion } from './useLayoutMotion';

export interface CanvasHandle {
  zoomBy(factor: number): void;
  fit(): void;
  centerRoot(): void;
  /** Pans (and zooms in if far out) so a topic sits in the middle. */
  centerOn(id: string): void;
  /** The camera, for putting it back where it was (inner maps). */
  getView(): View;
  setView(v: View): void;
  /** Where a topic is drawn, in pixels from the canvas's top left corner. */
  screenRect(id: string): { x: number; y: number; w: number; h: number } | undefined;
  /** The canvas element, for the enter/exit animation. */
  element(): HTMLDivElement | null;
  /** Back to 100 %, around the middle of the canvas. */
  resetZoom(): void;
  /** Where a topic is on screen (client coordinates), if it is drawn. */
  topicRect(id: string): DOMRect | undefined;
}

/** What was right-clicked on the canvas. */
export type CanvasTarget = { kind: 'topic'; id: string } | { kind: 'relation'; id: string } | { kind: 'canvas'; pos: Point };

/** Re-renders only when the map, selection or snapped viewport changes, not on every pan step. */
const MemoMapSvg = memo(MapSvg);

/** Big maps zoomed out this far are drawn as plain shapes. */
const SIMPLE_MIN_TOPICS = 1500;
const SIMPLE_BELOW_K = 0.35;

interface Props {
  map: MindMap;
  layout: MapLayout;
  theme: Theme;
  selectedId: string | null;
  /** Topic to bring into view when the map opens instead of fitting it all. */
  focusId?: string;
  editingId: string | null;
  editSeed: string | null;
  selectedRelId: string | null;
  selectedBoundaryId?: string | null;
  /**
   * Focus mode: the topic whose branch alone is shown (null for the whole
   * map). Entering zooms to the branch; leaving returns to the earlier view.
   */
  scopeId?: string | null;
  /** When set, the next topic click picks the target of a new relation. */
  relationFrom: string | null;
  onSelect(id: string | null): void;
  onSelectRelation(id: string): void;
  onSelectBoundary?(id: string): void;
  onPickRelationTarget(id: string): void;
  onFloat(id: string, pos: Point): void;
  onCreateFloating(pos: Point): void;
  onStartEdit(id: string): void;
  onCommitEdit(id: string, text: string): void;
  onCancelEdit(): void;
  /** `merge`: flow charts, the dragged step's path continues to the target. */
  onMove(id: string, parentId: string, merge?: boolean): void;
  onToggleCollapse(id: string): void;
  onZoomChange(k: number): void;
  /** Right click (or a long press) on a topic, a relation or empty canvas. */
  onContextMenu?(target: CanvasTarget, clientX: number, clientY: number): void;
  /** The link icon on a topic was clicked. */
  onOpenLink?(id: string): void;
  /** Topic whose note card is open on the canvas. */
  noteId?: string | null;
  onOpenNote?(id: string): void;
  onCloseNote?(): void;
  onSaveNote?(id: string, save: NoteSave): void;
  /** Open the note card in the editor rather than formatted. */
  noteEdit?: boolean;
  /** Tick or untick a checklist item in a note shown inside its topic. */
  onToggleNoteTask?(id: string, line: number): void;
  /** A link clicked in a note shown inside its topic. */
  onOpenNoteLink?(href: string): void;
  /** A topic's inner map was asked for (double-click, or its corner badge). */
  onEnterInner?(id: string): void;
  /**
   * Which (inner) map is shown. When it changes the canvas fits the new map
   * at once; the editor may then put back a saved camera.
   */
  viewKey?: string;
  /** View only: no dragging, no new topics. */
  readOnly?: boolean;
  /** Every selected topic, when more than one is (multi-select). */
  selectedIds?: ReadonlySet<string>;
  /** Ctrl/⌘+click (toggle) or Shift+click (add) on a topic. */
  onSelectExtend?(id: string, toggle: boolean): void;
  /** Shift/Ctrl+drag on empty space drew a box around these topics. */
  onSelectBox?(ids: string[], additive: boolean): void;
  /** Several selected topics were dropped on a topic. */
  onMoveMany?(ids: string[], parentId: string): void;
  /** Several selected topics were dropped on empty space, moved by `delta`. */
  onFloatMany?(ids: string[], delta: Point): void;
  /** Format painter: the next topic click gives it the copied look. */
  painting?: boolean;
  onPaint?(id: string): void;
  /** Other people in a live session and the topic each has selected. */
  peers?: { id: string; name: string; color: string; selectedId?: string | null }[];
}

export interface View {
  x: number;
  y: number;
  k: number;
}

// A small paint brush, for the format painter.
const BRUSH_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#fff" stroke="#1f2328" stroke-width="1.6" stroke-linejoin="round"><rect x="4" y="3" width="14" height="6" rx="1.5"/><path d="M18 6h2v5h-8v3" fill="none"/><rect x="10.5" y="14" width="3" height="7" rx="1"/></svg>',
)}") 12 22, copy`;

const MIN_K = 0.05;
const MAX_K = 3;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));
/** The canvas's size, unaffected by CSS transforms (the inner-map animation scales it). */
const sizeOf = (el: HTMLElement | null) => (el ? { width: el.clientWidth, height: el.clientHeight } : undefined);

function subtreeIds(t: Topic, out = new Set<string>()) {
  out.add(t.id);
  t.children.forEach((c) => subtreeIds(c, out));
  return out;
}

export const MapCanvas = forwardRef<CanvasHandle, Props>(function MapCanvas(props, ref) {
  const { map, layout, theme, selectedId, editingId } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, []);

  const [drag, setDrag] = useState<{ id: string; x: number; y: number; target: string | null; shift?: boolean; group: string[] | null } | null>(null);
  // Selection box being drawn (map coordinates).
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const gesture = useRef<
    | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; trail: { x: number; y: number; t: number }[] }
    | { kind: 'topic'; id: string; sx: number; sy: number; ox: number; oy: number; dragging: boolean; group: string[] | null }
    | { kind: 'box'; additive: boolean }
    | null
  >(null);

  const setZoom = useCallback(
    (k: number, cx?: number, cy?: number) => {
      setView((v) => {
        const nk = clampK(k);
        const rect = sizeOf(wrap.current);
        const px = cx ?? (rect ? rect.width / 2 : 0);
        const py = cy ?? (rect ? rect.height / 2 : 0);
        // Keep the point under the cursor fixed.
        const mx = (px - v.x) / v.k, my = (py - v.y) / v.k;
        return { k: nk, x: px - mx * nk, y: py - my * nk };
      });
    },
    [],
  );

  // ---------- camera: eases toward a target view, and glides after a flick ----------
  const cam = useRef<{ target: View | null; anchor: Point | null; glide: Point | null; raf: number; last: number }>({
    target: null,
    anchor: null,
    glide: null,
    raf: 0,
    last: 0,
  });
  const stopCamera = useCallback(() => {
    const c = cam.current;
    c.target = null;
    c.anchor = null;
    c.glide = null;
  }, []);
  const tick = useCallback((now: number) => {
    const c = cam.current;
    const dt = Math.min(64, now - c.last);
    c.last = now;
    let v = viewRef.current;
    if (c.glide) {
      v = { ...v, x: v.x + c.glide.x * dt, y: v.y + c.glide.y * dt };
      const f = Math.exp(-dt / 260);
      c.glide = { x: c.glide.x * f, y: c.glide.y * f };
      if (Math.hypot(c.glide.x, c.glide.y) < 0.02) c.glide = null;
    }
    const tg = c.target;
    if (tg) {
      const s = 1 - Math.exp(-dt / 70);
      const k = Math.exp(Math.log(v.k) + (Math.log(tg.k) - Math.log(v.k)) * s);
      if (c.anchor) {
        // Keep the map point under the cursor in place at every step.
        const mx = (c.anchor.x - tg.x) / tg.k, my = (c.anchor.y - tg.y) / tg.k;
        v = { k, x: c.anchor.x - mx * k, y: c.anchor.y - my * k };
      } else {
        v = { k, x: v.x + (tg.x - v.x) * s, y: v.y + (tg.y - v.y) * s };
      }
      if (Math.abs(Math.log(tg.k / v.k)) < 1e-3 && Math.abs(tg.x - v.x) < 0.3 && Math.abs(tg.y - v.y) < 0.3) {
        v = tg;
        c.target = null;
        c.anchor = null;
      }
    }
    viewRef.current = v;
    setView(v);
    c.raf = c.target || c.glide ? requestAnimationFrame(tick) : 0;
  }, []);
  const kick = useCallback(() => {
    const c = cam.current;
    if (c.raf) return;
    c.last = performance.now();
    c.raf = requestAnimationFrame(tick);
  }, [tick]);
  useEffect(() => () => cancelAnimationFrame(cam.current.raf), []);

  /** Moves the camera to a view: eased, or at once when motion is reduced. */
  const animateTo = useCallback(
    (v: View, anchor: Point | null = null) => {
      if (reducedMotion()) {
        stopCamera();
        viewRef.current = v;
        setView(v);
        return;
      }
      cam.current.target = v;
      cam.current.anchor = anchor;
      kick();
    },
    [kick, stopCamera],
  );

  /** Zooms by a factor around a point on the canvas (its centre by default), eased. */
  const zoomAt = useCallback(
    (f: number, px?: number, py?: number) => {
      const rect = sizeOf(wrap.current);
      const ax = px ?? (rect ? rect.width / 2 : 0), ay = py ?? (rect ? rect.height / 2 : 0);
      const base = cam.current.anchor && cam.current.target ? cam.current.target : viewRef.current;
      const k = clampK(base.k * f);
      const mx = (ax - base.x) / base.k, my = (ay - base.y) / base.k;
      animateTo({ k, x: ax - mx * k, y: ay - my * k }, { x: ax, y: ay });
    },
    [animateTo],
  );

  const fitView = useCallback((): View | null => {
    const rect = sizeOf(wrap.current);
    if (!rect) return null;
    const { minX, minY, maxX, maxY } = layout.bounds;
    const w = maxX - minX + 120, h = maxY - minY + 120;
    const k = clampK(Math.min(rect.width / w, rect.height / h, 1.2));
    return { k, x: rect.width / 2 - ((minX + maxX) / 2) * k, y: rect.height / 2 - ((minY + maxY) / 2) * k };
  }, [layout]);

  const fit = useCallback(() => {
    const v = fitView();
    if (v) animateTo(v);
  }, [fitView, animateTo]);

  const centerRoot = useCallback(() => {
    const rect = sizeOf(wrap.current);
    if (!rect) return;
    setView((v) => ({ ...v, x: rect.width / 2, y: rect.height / 2 }));
  }, []);

  const centerView = useCallback(
    (id: string): View | null => {
      const rect = sizeOf(wrap.current);
      const b = layout.byId.get(id);
      if (!rect || !b) return null;
      const k = Math.max((cam.current.target ?? viewRef.current).k, 0.8);
      return { k, x: rect.width / 2 - b.x * k, y: rect.height / 2 - b.y * k };
    },
    [layout],
  );
  const centerOn = useCallback(
    (id: string) => {
      const v = centerView(id);
      if (v) animateTo(v);
    },
    [centerView, animateTo],
  );

  const topicRect = useCallback(
    (id: string) => {
      const rect = wrap.current?.getBoundingClientRect();
      const b = layout.byId.get(id);
      if (!rect || !b) return undefined;
      const v = viewRef.current;
      return new DOMRect(rect.left + v.x + (b.x - b.w / 2) * v.k, rect.top + v.y + (b.y - b.h / 2) * v.k, b.w * v.k, b.h * v.k);
    },
    [layout],
  );

  useImperativeHandle(
    ref,
    () => ({
      zoomBy: (f) => zoomAt(f),
      fit,
      centerRoot,
      centerOn,
      getView: () => viewRef.current,
      setView: (v) => {
        stopCamera();
        viewRef.current = v;
        setView(v);
      },
      screenRect: (id) => {
        const b = layout.byId.get(id);
        if (!b) return undefined;
        const v = viewRef.current;
        return { x: (b.x - b.w / 2) * v.k + v.x, y: (b.y - b.h / 2) * v.k + v.y, w: b.w * v.k, h: b.h * v.k };
      },
      element: () => wrap.current,
      resetZoom: () => zoomAt(1 / (cam.current.target ?? viewRef.current).k),
      topicRect,
    }),
    [zoomAt, fit, centerRoot, centerOn, stopCamera, layout, topicRect],
  );

  // Fit the map when it is opened (at once) and when its layout kind changes
  // (eased); when opened from a search, show the found topic instead.
  const opened = useRef(false);
  useLayoutEffect(() => {
    const v = !opened.current && props.focusId && props.focusId !== map.roots[0].id ? centerView(props.focusId) : fitView();
    if (v && !opened.current) {
      stopCamera();
      viewRef.current = v;
      setView(v);
    } else if (v) animateTo(v);
    opened.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map.id, map.layout]);

  // Entering or leaving an inner map: show the new map whole, at once.
  const shownKey = useRef(props.viewKey);
  useLayoutEffect(() => {
    if (shownKey.current === props.viewKey) return;
    shownKey.current = props.viewKey;
    // A focus mode left by the same switch must not move the camera too.
    lastScope.current = props.scopeId ?? null;
    viewBeforeFocus.current = null;
    const v = fitView();
    if (v) {
      stopCamera();
      viewRef.current = v;
      setView(v);
    }
  }, [props.viewKey, fitView, stopCamera]);

  // Focus mode: zoom to the focused branch, and back to the earlier view on leaving.
  const scope = props.scopeId ?? null;
  const lastScope = useRef(scope);
  const viewBeforeFocus = useRef<View | null>(null);
  useLayoutEffect(() => {
    const prev = lastScope.current;
    if (prev === scope) return;
    lastScope.current = scope;
    if (scope && !prev) viewBeforeFocus.current = cam.current.target ?? viewRef.current;
    const v = scope ? fitView() : viewBeforeFocus.current ?? fitView();
    if (!scope) viewBeforeFocus.current = null;
    if (v) animateTo(v);
  }, [scope, fitView, animateTo]);

  useEffect(() => props.onZoomChange(view.k), [view.k]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the selected topic on screen when navigating with the keyboard.
  useEffect(() => {
    if (!selectedId || gesture.current) return;
    const b = layout.byId.get(selectedId);
    const rect = sizeOf(wrap.current);
    if (!b || !rect) return;
    // Works on where the camera is heading, even a fit() started a moment ago.
    const v = cam.current.target ?? viewRef.current;
    const sx = b.x * v.k + v.x, sy = b.y * v.k + v.y;
    const mx = (b.w / 2) * v.k + 40, my = (b.h / 2) * v.k + 40;
    let dx = 0, dy = 0;
    if (sx - mx < 0) dx = mx - sx;
    else if (sx + mx > rect.width) dx = rect.width - sx - mx;
    if (sy - my < 0) dy = my - sy;
    else if (sy + my > rect.height) dy = rect.height - sy - my;
    if (dx || dy) animateTo({ ...v, x: v.x + dx, y: v.y + dy });
  }, [selectedId, layout]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wheel: a mouse wheel zooms toward the cursor (or pans, by setting);
  // a touchpad pans with two fingers and zooms with a pinch (Ctrl + wheel).
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let touchpadUntil = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        // Pinch sends many tiny steps: follow them directly.
        stopCamera();
        setZoom(viewRef.current.k * wheelZoomFactor(e), px, py);
        return;
      }
      const raw = { deltaMode: e.deltaMode, deltaX: e.deltaX, deltaY: e.deltaY, wheelDeltaY: (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY };
      // A touchpad scroll keeps sending events for a while (momentum): stay in pan mode.
      const mouse = performance.now() > touchpadUntil && isMouseWheel(raw);
      if (!mouse) touchpadUntil = performance.now() + 300;
      if (mouse && !e.shiftKey && getMotionPrefs().wheel === 'zoom') {
        zoomAt(wheelZoomFactor(e), px, py);
        return;
      }
      stopCamera();
      const lines = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? rect.height : 1;
      const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * lines, dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * lines;
      setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setZoom, zoomAt, stopCamera]);

  const toMap = (clientX: number, clientY: number) => {
    const rect = wrap.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - rect.left - v.x) / v.k, y: (clientY - rect.top - v.y) / v.k };
  };

  /** The dragged topics and everything under them. */
  const draggedIds = (id: string, group: string[] | null) => {
    const out = new Set<string>();
    for (const g of group ?? [id]) {
      const t = findTopic(map, g);
      if (t) subtreeIds(t, out);
    }
    return out;
  };
  const dragged = useMemo(() => (drag ? draggedIds(drag.id, drag.group) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drag?.id, drag?.group, map]);

  const hitTest = (x: number, y: number, exclude: Set<string> | null): NodeBox | undefined => {
    for (let i = layout.nodes.length - 1; i >= 0; i--) {
      const b = layout.nodes[i];
      if (!exclude?.has(b.id) && Math.abs(x - b.x) <= b.w / 2 + 6 && Math.abs(y - b.y) <= b.h / 2 + 6) return b;
    }
  };

  const simple = layout.nodes.length >= SIMPLE_MIN_TOPICS && view.k < SIMPLE_BELOW_K;
  const vp = size.w ? snappedViewport(view, size.w, size.h) : undefined;
  const vpKey = vp ? `${vp.minX},${vp.minY},${vp.maxX},${vp.maxY}` : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const viewport = useMemo(() => vp, [vpKey]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    const el = e.target as Element;
    // A click anywhere on the canvas closes an open note card (which saves it).
    if (props.noteId) props.onCloseNote?.();
    const badge = el.closest('[data-inner-badge]');
    if (badge && e.button === 0 && props.onEnterInner) {
      props.onEnterInner(badge.getAttribute('data-inner-badge')!);
      return;
    }
    const collapse = el.closest('[data-collapse-id]');
    if (collapse) {
      props.onToggleCollapse(collapse.getAttribute('data-collapse-id')!);
      return;
    }
    // Simplified drawing has no per-topic elements: find the topic by position.
    const pt = toMap(e.clientX, e.clientY);
    const topicId = el.closest('[data-topic-id]')?.getAttribute('data-topic-id') ?? (simple ? hitTest(pt.x, pt.y, null)?.id : undefined);
    if (props.relationFrom) {
      if (topicId) props.onPickRelationTarget(topicId);
      return;
    }
    if (props.painting) {
      if (topicId && e.button === 0) props.onPaint?.(topicId);
      return;
    }
    const additive = e.button === 0 && (e.shiftKey || e.ctrlKey || e.metaKey);
    if (topicId && additive && props.onSelectExtend && !el.closest('[data-link-glyph], [data-note-glyph]')) {
      props.onSelectExtend(topicId, e.ctrlKey || e.metaKey);
      return;
    }
    if (topicId && el.closest('[data-link-glyph]') && props.onOpenLink) {
      props.onSelect(topicId);
      props.onOpenLink(topicId);
      return;
    }
    const check = el.closest('[data-note-check]');
    if (topicId && check && e.button === 0 && !props.readOnly && props.onToggleNoteTask) {
      props.onSelect(topicId);
      props.onToggleNoteTask(topicId, Number(check.getAttribute('data-note-check')));
      return;
    }
    const noteHref = el.closest('[data-note-href]')?.getAttribute('data-note-href');
    if (topicId && noteHref && e.button === 0 && !additive && props.onOpenNoteLink) {
      props.onSelect(topicId);
      props.onOpenNoteLink(noteHref);
      return;
    }
    if (topicId && el.closest('[data-note-glyph]') && props.onOpenNote) {
      if (topicId !== editingId) props.onSelect(topicId);
      if (topicId !== props.noteId) props.onOpenNote(topicId);
      return;
    }
    const relation = el.closest('[data-relation-id]');
    if (relation && e.button === 0) {
      props.onSelectRelation(relation.getAttribute('data-relation-id')!);
      return;
    }
    const boundary = el.closest('[data-boundary-id]');
    if (boundary && e.button === 0 && !topicId && props.onSelectBoundary) {
      props.onSelectBoundary(boundary.getAttribute('data-boundary-id')!);
      return;
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (topicId && e.button === 0) {
      const id = topicId;
      // Grabbing one of several selected topics drags them all; a plain
      // click (no drag) then selects just that one.
      const sel = props.selectedIds;
      const group = sel && sel.size > 1 && sel.has(id) ? [...sel] : null;
      if (id !== editingId && !group) props.onSelect(id);
      // Remember where inside the box it was grabbed, so a moved root
      // doesn't jump to the pointer.
      const b = layout.byId.get(id);
      const p = toMap(e.clientX, e.clientY);
      gesture.current = { kind: 'topic', id, sx: e.clientX, sy: e.clientY, ox: b ? p.x - b.x : 0, oy: b ? p.y - b.y : 0, dragging: false, group };
    } else if (!topicId && additive && props.onSelectBox && !editingId) {
      stopCamera();
      gesture.current = { kind: 'box', additive: true };
      setBox({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y });
    } else {
      if (editingId) return;
      props.onSelect(null);
      stopCamera();
      const v0 = viewRef.current;
      gesture.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: v0.x, vy: v0.y, trail: [{ x: e.clientX, y: e.clientY, t: performance.now() }] };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (props.relationFrom) setPointer(toMap(e.clientX, e.clientY));
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pan') {
      const now = performance.now();
      g.trail.push({ x: e.clientX, y: e.clientY, t: now });
      while (g.trail.length > 2 && now - g.trail[0].t > 100) g.trail.shift();
      setView((v) => ({ ...v, x: g.vx + e.clientX - g.sx, y: g.vy + e.clientY - g.sy }));
      return;
    }
    if (g.kind === 'box') {
      const p = toMap(e.clientX, e.clientY);
      setBox((bx) => (bx ? { ...bx, x1: p.x, y1: p.y } : bx));
      return;
    }
    // The centre (main or focused topic) and summary topics stay where the layout puts them.
    if (g.id === map.roots[0].id || g.id === layout.focusId || layout.byId.get(g.id)?.summaryOf || g.id === editingId || props.readOnly) return;
    if (!g.dragging && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 5) return;
    g.dragging = true;
    const p = toMap(e.clientX, e.clientY);
    const exclude = draggedIds(g.id, g.group);
    // Roots keep their grab offset; other topics are carried by the pointer.
    const root = isRoot(map, g.id);
    const x = root ? p.x - g.ox : p.x, y = root ? p.y - g.oy : p.y;
    const over = hitTest(p.x, p.y, exclude);
    setDrag({ id: g.id, x, y, target: over && !over.summaryOf ? over.id : null, shift: e.shiftKey, group: g.group });
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.kind === 'pan' && !reducedMotion()) {
      // A flick keeps the map gliding for a moment.
      const a = g.trail[0], b = g.trail[g.trail.length - 1];
      const dt = b.t - a.t;
      if (dt > 0 && performance.now() - b.t < 60) {
        const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
        if (Math.hypot(vx, vy) > 0.3) {
          cam.current.glide = { x: vx, y: vy };
          kick();
        }
      }
    }
    if (g?.kind === 'box') {
      if (box) {
        const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1);
        const y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
        // Any topic the box touches is picked.
        const ids = layout.nodes.filter((b) => b.x + b.w / 2 >= x0 && b.x - b.w / 2 <= x1 && b.y + b.h / 2 >= y0 && b.y - b.h / 2 <= y1).map((b) => b.id);
        if (x1 - x0 > 2 || y1 - y0 > 2) props.onSelectBox?.(ids, g.additive);
      }
      setBox(null);
    }
    if (g?.kind === 'topic' && !g.dragging && g.group) props.onSelect(g.id);
    if (g?.kind === 'topic' && g.dragging && drag) {
      // Dropped on a topic: becomes its child. Dropped on empty canvas:
      // becomes (or stays) a free-floating tree at that spot.
      // Several selected topics always move (merging paths is one at a time).
      const from = layout.byId.get(g.id);
      if (drag.group) {
        if (drag.target) props.onMoveMany?.(drag.group, drag.target);
        else if (from) props.onFloatMany?.(drag.group, { x: drag.x - from.x, y: drag.y - from.y });
      } else if (drag.target) props.onMove(g.id, drag.target, mergeDrop);
      else props.onFloat(g.id, { x: Math.round(drag.x), y: Math.round(drag.y) });
    }
    setDrag(null);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // A Ctrl+click on macOS also sent a press: don't start a drag from it.
    gesture.current = null;
    setDrag(null);
    if (!props.onContextMenu || editingId) return;
    const el = e.target as Element;
    const p = toMap(e.clientX, e.clientY);
    const topicId = el.closest('[data-topic-id]')?.getAttribute('data-topic-id') ?? (simple ? hitTest(p.x, p.y, null)?.id : undefined);
    const relId = el.closest('[data-relation-id]')?.getAttribute('data-relation-id');
    const target: CanvasTarget = topicId ? { kind: 'topic', id: topicId } : relId ? { kind: 'relation', id: relId } : { kind: 'canvas', pos: { x: Math.round(p.x), y: Math.round(p.y) } };
    props.onContextMenu(target, e.clientX, e.clientY);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const p = toMap(e.clientX, e.clientY);
    // Pointer capture sends the double-click to the canvas itself, so find the topic by position too.
    const topicId = (e.target as Element).closest('[data-topic-id]')?.getAttribute('data-topic-id') ?? hitTest(p.x, p.y, null)?.id;
    if (topicId && layout.byId.get(topicId)?.topic.innerSize && props.onEnterInner) return props.onEnterInner(topicId);
    if (props.readOnly) return;
    // In a topic that shows its note, double-clicking the note edits the note.
    if (topicId && (e.target as Element).closest('[data-note-text]') && props.onOpenNote) {
      props.onSelect(topicId);
      props.onOpenNote(topicId);
    } else if (topicId) props.onStartEdit(topicId);
    else if (!(e.target as Element).closest('[data-relation-id], [data-boundary-id]')) props.onCreateFloating(toMap(e.clientX, e.clientY));
  };

  const drawn = useLayoutMotion(layout, `${map.id}|${props.viewKey ?? ""}`);
  const dragBox = drag ? layout.byId.get(drag.id) : undefined;
  const targetBox = drag?.target ? layout.byId.get(drag.target) : undefined;
  // Flow charts: dropping a step on another merges the paths (Shift moves it).
  const flowDrop = !!targetBox && targetBox.layout === 'flow' && layout.byId.get(drag!.id)?.layout === 'flow';
  const mergeDrop = flowDrop && !drag?.shift && !drag?.group;
  const editBox = editingId ? layout.byId.get(editingId) : undefined;
  const noteBox = props.noteId && !editingId ? layout.byId.get(props.noteId) : undefined;

  return (
    <div
      ref={wrap}
      className="canvas"
      style={{
        backgroundColor: theme.canvas,
        // The dot grid turns into a grey wash when zoomed far out.
        backgroundImage: view.k < 0.3 ? 'none' : `radial-gradient(${theme.grid} 1px, transparent 1px)`,
        backgroundSize: `${20 * view.k}px ${20 * view.k}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
        cursor: props.relationFrom || box ? 'crosshair' : props.painting ? BRUSH_CURSOR : gesture.current?.kind === 'pan' ? 'grabbing' : 'default',
      }}
    >
      <svg
        className="canvas-svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        role="application"
        aria-label={t('canvas.label', { title: map.title })}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {/* Nothing is drawn until the canvas size (and so the viewport) is known. */}
          {viewport && <MemoMapSvg
            map={map}
            layout={drawn.layout}
            fade={drawn.fade}
            theme={theme}
            selectedId={editingId ? undefined : selectedId ?? undefined}
            selectedIds={editingId ? undefined : props.selectedIds}
            selectedRelId={props.selectedRelId ?? undefined}
            selectedBoundaryId={props.selectedBoundaryId ?? undefined}
            dimIds={dragged ?? undefined}
            viewport={viewport}
            simple={simple}
          />}
          {props.peers?.map((p) => {
            const b = p.selectedId ? layout.byId.get(p.selectedId) : undefined;
            if (!b) return null;
            return (
              <g key={p.id} style={{ pointerEvents: 'none' }}>
                <rect x={b.x - b.w / 2 - 7} y={b.y - b.h / 2 - 7} width={b.w + 14} height={b.h + 14} rx={12} fill="none" stroke={p.color} strokeWidth={2} />
                <rect x={b.x - b.w / 2 - 7} y={b.y - b.h / 2 - 25} width={p.name.length * 7 + 12} height={18} rx={5} fill={p.color} />
                <text x={b.x - b.w / 2 - 1} y={b.y - b.h / 2 - 12} fontSize={11} fontWeight={600} fill="#fff" fontFamily="'Plus Jakarta Sans', system-ui, sans-serif">
                  {p.name}
                </text>
              </g>
            );
          })}
          {props.relationFrom && pointer && layout.byId.get(props.relationFrom) && (
            <line
              x1={layout.byId.get(props.relationFrom)!.x}
              y1={layout.byId.get(props.relationFrom)!.y}
              x2={pointer.x}
              y2={pointer.y}
              stroke={SELECT_COLOR}
              strokeWidth={1.5}
              strokeDasharray="6 4"
              style={{ pointerEvents: 'none' }}
            />
          )}
          {targetBox && (
            <rect
              x={targetBox.x - targetBox.w / 2 - 6}
              y={targetBox.y - targetBox.h / 2 - 6}
              width={targetBox.w + 12}
              height={targetBox.h + 12}
              rx={12}
              fill="none"
              stroke={SELECT_COLOR}
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          )}
          {targetBox && flowDrop && (
            <g style={{ pointerEvents: 'none' }} data-drop-hint="">
              {(() => {
                const label = t(mergeDrop ? 'drop.merge' : 'drop.move');
                const w = label.length * 6.2 + 20;
                const y = targetBox.y - targetBox.h / 2 - 34;
                return (
                  <>
                    <rect x={targetBox.x - w / 2} y={y} width={w} height={22} rx={11} fill={SELECT_COLOR} />
                    <text x={targetBox.x} y={y + 15} textAnchor="middle" fontSize={11.5} fontWeight={600} fill="#fff" fontFamily="'Plus Jakarta Sans', system-ui, sans-serif">{label}</text>
                  </>
                );
              })()}
            </g>
          )}
          {drag && dragBox && (
            <g opacity={0.85} style={{ pointerEvents: 'none' }}>
              {drag.group?.filter((id) => id !== drag.id && id !== map.roots[0].id).map((id) => {
                const b = layout.byId.get(id);
                return b ? <TopicView key={id} b={{ ...b, x: b.x + drag.x - dragBox.x, y: b.y + drag.y - dragBox.y }} theme={theme} /> : null;
              })}
              <TopicView b={{ ...dragBox, x: drag.x, y: drag.y }} theme={theme} />
            </g>
          )}
          {box && (
            <rect
              x={Math.min(box.x0, box.x1)}
              y={Math.min(box.y0, box.y1)}
              width={Math.abs(box.x1 - box.x0)}
              height={Math.abs(box.y1 - box.y0)}
              fill={SELECT_COLOR}
              fillOpacity={0.08}
              stroke={SELECT_COLOR}
              strokeWidth={1 / view.k}
              strokeDasharray={`${4 / view.k} ${3 / view.k}`}
              data-select-box=""
              style={{ pointerEvents: 'none' }}
            />
          )}
        </g>
      </svg>
      {editBox && (
        <EditBox
          key={editBox.id}
          box={editBox}
          view={view}
          theme={theme}
          initial={props.editSeed ?? editBox.topic.text}
          onCommit={(text) => props.onCommitEdit(editBox.id, text)}
          onCancel={props.onCancelEdit}
        />
      )}
      {noteBox && size.w > 0 && (
        <NotePopover
          key={noteBox.id}
          box={noteBox}
          view={view}
          size={size}
          readOnly={props.readOnly}
          edit={props.noteEdit}
          onSave={(save) => props.onSaveNote?.(noteBox.id, save)}
          onClose={() => props.onCloseNote?.()}
        />
      )}
    </div>
  );
});

function EditBox({ box, view, theme, initial, onCommit, onCancel }: { box: NodeBox; view: View; theme: Theme; initial: string; onCommit(text: string): void; onCancel(): void }) {
  const [value, setValue] = useState(initial);
  const ta = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    const el = ta.current!;
    el.focus();
    el.setSelectionRange(initial === box.topic.text ? 0 : el.value.length, el.value.length);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lines = value.split('\n');
  const textW = Math.max(...lines.map((l) => canvasMeasure(l || ' ', box.font)));
  const lead = box.lead ?? 0;
  const w = Math.max(box.w, textW + box.padX * 2 + lead + 8) * view.k;
  // The edit box covers the text area only, below any picture.
  const bodyH = box.h - box.imageH - (box.noteBlock?.h ?? 0);
  const padY = (bodyH - box.lineHeight * box.lines.length) / 2;
  const h = Math.max(bodyH, lines.length * box.lineHeight + padY * 2) * view.k;
  const { fill, text } = nodeColors(box, theme);
  const left = view.x + (box.x - box.w / 2) * view.k;
  const top = view.y + (box.y - box.h / 2 + box.imageH) * view.k;

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(value);
    else onCancel();
  };

  return (
    <textarea
      ref={ta}
      className="edit-box"
      aria-label={t('edit.topicText')}
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          finish(true);
        }
      }}
      style={{
        left,
        top,
        width: w,
        height: h,
        font: box.font,
        fontSize: box.fontSize * view.k,
        lineHeight: `${box.lineHeight * view.k}px`,
        padding: `${padY * view.k}px ${box.padX * view.k}px ${padY * view.k}px ${(box.padX + lead) * view.k}px`,
        color: text,
        background: fill === 'transparent' ? theme.canvas : fill,
        borderRadius: 8 * view.k,
      }}
    />
  );
}
