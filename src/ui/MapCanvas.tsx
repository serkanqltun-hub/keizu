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

export interface CanvasHandle {
  zoomBy(factor: number): void;
  fit(): void;
  centerRoot(): void;
  /** Pans (and zooms in if far out) so a topic sits in the middle. */
  centerOn(id: string): void;
}

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
  /** When set, the next topic click picks the target of a new relation. */
  relationFrom: string | null;
  onSelect(id: string | null): void;
  onSelectRelation(id: string): void;
  onPickRelationTarget(id: string): void;
  onFloat(id: string, pos: Point): void;
  onCreateFloating(pos: Point): void;
  onStartEdit(id: string): void;
  onCommitEdit(id: string, text: string): void;
  onCancelEdit(): void;
  onMove(id: string, parentId: string): void;
  onToggleCollapse(id: string): void;
  onZoomChange(k: number): void;
  /** The link icon on a topic was clicked. */
  onOpenLink?(id: string): void;
  /** View only: no dragging, no new topics. */
  readOnly?: boolean;
  /** Other people in a live session and the topic each has selected. */
  peers?: { id: string; name: string; color: string; selectedId?: string | null }[];
}

interface View {
  x: number;
  y: number;
  k: number;
}

const MIN_K = 0.05;
const MAX_K = 3;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

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

  const [drag, setDrag] = useState<{ id: string; x: number; y: number; target: string | null } | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const gesture = useRef<
    | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
    | { kind: 'topic'; id: string; sx: number; sy: number; ox: number; oy: number; dragging: boolean }
    | null
  >(null);

  const setZoom = useCallback(
    (k: number, cx?: number, cy?: number) => {
      setView((v) => {
        const nk = clampK(k);
        const rect = wrap.current?.getBoundingClientRect();
        const px = cx ?? (rect ? rect.width / 2 : 0);
        const py = cy ?? (rect ? rect.height / 2 : 0);
        // Keep the point under the cursor fixed.
        const mx = (px - v.x) / v.k, my = (py - v.y) / v.k;
        return { k: nk, x: px - mx * nk, y: py - my * nk };
      });
    },
    [],
  );

  const fit = useCallback(() => {
    const rect = wrap.current?.getBoundingClientRect();
    if (!rect) return;
    const { minX, minY, maxX, maxY } = layout.bounds;
    const w = maxX - minX + 120, h = maxY - minY + 120;
    const k = clampK(Math.min(rect.width / w, rect.height / h, 1.2));
    setView({ k, x: rect.width / 2 - ((minX + maxX) / 2) * k, y: rect.height / 2 - ((minY + maxY) / 2) * k });
  }, [layout]);

  const centerRoot = useCallback(() => {
    const rect = wrap.current?.getBoundingClientRect();
    if (!rect) return;
    setView((v) => ({ ...v, x: rect.width / 2, y: rect.height / 2 }));
  }, []);

  const centerOn = useCallback(
    (id: string) => {
      const rect = wrap.current?.getBoundingClientRect();
      const b = layout.byId.get(id);
      if (!rect || !b) return;
      const k = Math.max(viewRef.current.k, 0.8);
      setView({ k, x: rect.width / 2 - b.x * k, y: rect.height / 2 - b.y * k });
    },
    [layout],
  );

  useImperativeHandle(ref, () => ({ zoomBy: (f) => setZoom(viewRef.current.k * f), fit, centerRoot, centerOn }), [setZoom, fit, centerRoot, centerOn]);

  // Fit the map when it is opened and when its layout kind changes; when
  // opened from a search, show the found topic instead.
  const opened = useRef(false);
  useLayoutEffect(() => {
    if (!opened.current && props.focusId && props.focusId !== map.roots[0].id) centerOn(props.focusId);
    else fit();
    opened.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map.id, map.layout]);

  useEffect(() => props.onZoomChange(view.k), [view.k]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the selected topic on screen when navigating with the keyboard.
  useEffect(() => {
    if (!selectedId || gesture.current) return;
    const b = layout.byId.get(selectedId);
    const rect = wrap.current?.getBoundingClientRect();
    if (!b || !rect) return;
    // Updater form: works on the latest view, even one set by fit() a moment ago.
    setView((v) => {
      const sx = b.x * v.k + v.x, sy = b.y * v.k + v.y;
      const mx = (b.w / 2) * v.k + 40, my = (b.h / 2) * v.k + 40;
      let dx = 0, dy = 0;
      if (sx - mx < 0) dx = mx - sx;
      else if (sx + mx > rect.width) dx = rect.width - sx - mx;
      if (sy - my < 0) dy = my - sy;
      else if (sy + my > rect.height) dy = rect.height - sy - my;
      return dx || dy ? { ...v, x: v.x + dx, y: v.y + dy } : v;
    });
  }, [selectedId, layout]);

  // Wheel: pan, or zoom with Ctrl/⌘ (also what trackpad pinch sends).
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        setZoom(viewRef.current.k * Math.exp(-e.deltaY * 0.0025), e.clientX - rect.left, e.clientY - rect.top);
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setZoom]);

  const toMap = (clientX: number, clientY: number) => {
    const rect = wrap.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - rect.left - v.x) / v.k, y: (clientY - rect.top - v.y) / v.k };
  };

  const dragged = useMemo(() => {
    if (!drag) return null;
    const t = findTopic(map, drag.id);
    return t ? subtreeIds(t) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.id, map]);

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
    if (topicId && el.closest('[data-link-glyph]') && props.onOpenLink) {
      props.onSelect(topicId);
      props.onOpenLink(topicId);
      return;
    }
    const relation = el.closest('[data-relation-id]');
    if (relation && e.button === 0) {
      props.onSelectRelation(relation.getAttribute('data-relation-id')!);
      return;
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (topicId && e.button === 0) {
      const id = topicId;
      if (id !== editingId) props.onSelect(id);
      // Remember where inside the box it was grabbed, so a moved root
      // doesn't jump to the pointer.
      const b = layout.byId.get(id);
      const p = toMap(e.clientX, e.clientY);
      gesture.current = { kind: 'topic', id, sx: e.clientX, sy: e.clientY, ox: b ? p.x - b.x : 0, oy: b ? p.y - b.y : 0, dragging: false };
    } else {
      if (editingId) return;
      props.onSelect(null);
      gesture.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (props.relationFrom) setPointer(toMap(e.clientX, e.clientY));
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pan') {
      setView((v) => ({ ...v, x: g.vx + e.clientX - g.sx, y: g.vy + e.clientY - g.sy }));
      return;
    }
    if (g.id === map.roots[0].id || g.id === editingId || props.readOnly) return;
    if (!g.dragging && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 5) return;
    g.dragging = true;
    const p = toMap(e.clientX, e.clientY);
    const t = findTopic(map, g.id);
    const exclude = t ? subtreeIds(t) : null;
    // Roots keep their grab offset; other topics are carried by the pointer.
    const root = isRoot(map, g.id);
    const x = root ? p.x - g.ox : p.x, y = root ? p.y - g.oy : p.y;
    setDrag({ id: g.id, x, y, target: hitTest(p.x, p.y, exclude)?.id ?? null });
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.kind === 'topic' && g.dragging && drag) {
      // Dropped on a topic: becomes its child. Dropped on empty canvas:
      // becomes (or stays) a free-floating tree at that spot.
      if (drag.target) props.onMove(g.id, drag.target);
      else props.onFloat(g.id, { x: Math.round(drag.x), y: Math.round(drag.y) });
    }
    setDrag(null);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const p = toMap(e.clientX, e.clientY);
    const topicId = (e.target as Element).closest('[data-topic-id]')?.getAttribute('data-topic-id') ?? (simple ? hitTest(p.x, p.y, null)?.id : undefined);
    if (props.readOnly) return;
    if (topicId) props.onStartEdit(topicId);
    else if (!(e.target as Element).closest('[data-relation-id]')) props.onCreateFloating(toMap(e.clientX, e.clientY));
  };

  const dragBox = drag ? layout.byId.get(drag.id) : undefined;
  const targetBox = drag?.target ? layout.byId.get(drag.target) : undefined;
  const editBox = editingId ? layout.byId.get(editingId) : undefined;

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
        cursor: props.relationFrom ? 'crosshair' : gesture.current?.kind === 'pan' ? 'grabbing' : 'default',
      }}
    >
      <svg
        className="canvas-svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        role="application"
        aria-label={t('canvas.label', { title: map.title })}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {/* Nothing is drawn until the canvas size (and so the viewport) is known. */}
          {viewport && <MemoMapSvg
            map={map}
            layout={layout}
            theme={theme}
            selectedId={editingId ? undefined : selectedId ?? undefined}
            selectedRelId={props.selectedRelId ?? undefined}
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
          {drag && dragBox && (
            <g opacity={0.85} style={{ pointerEvents: 'none' }}>
              <TopicView b={{ ...dragBox, x: drag.x, y: drag.y }} theme={theme} />
            </g>
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
  const w = Math.max(box.w, textW + box.padX * 2 + 8) * view.k;
  // The edit box covers the text area only, below any picture.
  const bodyH = box.h - box.imageH;
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
        padding: `${padY * view.k}px ${box.padX * view.k}px`,
        color: text,
        background: fill === 'transparent' ? theme.canvas : fill,
        borderRadius: 8 * view.k,
      }}
    />
  );
}
