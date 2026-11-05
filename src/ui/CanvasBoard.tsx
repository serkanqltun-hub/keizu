// The drawing canvas ("Tuval"): Excalidraw inside Keizu. Loaded only when a
// view is switched to canvas mode, so the map editor stays as light as before.
//
// Keizu owns the data: the drawing is stored in the map (see core/canvas.ts)
// and Excalidraw edits a copy. Changes flow out after a short pause; changes
// coming in (undo, sync, a collaborator) are put into the scene unless they
// are the ones that just went out. In "both" mode the view's topics appear as
// shapes, joined by connectors; they are made from the map every time it
// changes and never saved as drawing, only their positions are.

import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';
import { CaptureUpdateAction, Excalidraw, convertToExcalidrawElements, exportToBlob, exportToSvg, restoreElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFileData, BinaryFiles, DataURL, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { buildImagePdf } from '../core/pdf';
import type { CanvasData, CanvasElement, CanvasMode, Point } from '../core/model';
import { safeFileName } from './exporters';
import { preInvert } from './preInvert';
import { saveExport } from './platform';

/** A topic as a shape on the canvas ("both" mode). */
export interface BoardTopic {
  id: string;
  text: string;
  parentId?: string;
  /** Box the map layout gives it (centre x/y), used until the topic is moved. */
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string;
  fill: string;
  textColor: string;
  depth: number;
}

export interface CanvasBoardHandle {
  /** Nothing selected, no tool or text editing in progress: Esc may leave. */
  idle(): boolean;
  exportAs(kind: 'png' | 'svg' | 'pdf', title: string): Promise<unknown>;
}

interface Props {
  canvas: CanvasData | undefined;
  mode: CanvasMode;
  topics: BoardTopic[];
  resources: Record<string, string> | undefined;
  dark: boolean;
  lang: string;
  readOnly: boolean;
  /** Background of the light theme (Excalidraw inverts it in dark mode). */
  background: string;
  onChange(canvas: CanvasData | undefined, files: Record<string, string>): void;
  onTopicText(id: string, text: string): void;
  /** Shown at the top right, next to the shape library button. */
  topRight?: ReactNode;
}

const TOPIC = 'keizu-topic';
const LABEL = 'keizu-label';
const LINK = 'keizu-link';
const rectId = (topic: string) => `kt_${topic}`;
const kindOf = (e: { customData?: Record<string, unknown> }) => e.customData?.keizu as string | undefined;

type El = ExcalidrawElement;

/** Signature of the user's own drawing: ids and versions. */
const signature = (list: readonly { id: string; version: number; isDeleted?: boolean }[]) =>
  list
    .filter((e) => !e.isDeleted)
    .map((e) => `${e.id}:${e.version}`)
    .sort()
    .join('|');

const topicsSignature = (topics: BoardTopic[]) => JSON.stringify(topics.map((t) => [t.id, t.text, t.parentId, t.stroke, t.fill, t.textColor]));

/** The elements to keep: drawn by the user, not deleted, as plain JSON. */
function ownElements(list: readonly El[]): CanvasElement[] {
  return list.filter((e) => !e.isDeleted && !kindOf(e)).map((e) => JSON.parse(JSON.stringify(e)) as CanvasElement);
}

/**
 * Topic shapes and connectors for "both" mode. Topics keep where they are
 * in the scene, else their saved position, else their place in the map
 * layout moved next to the drawing.
 */
function buildTopics(topics: BoardTopic[], scene: readonly El[], saved: Record<string, Point> | undefined): El[] {
  if (!topics.length) return [];
  const at = new Map<string, Point>();
  for (const e of scene) if (!e.isDeleted && kindOf(e) === TOPIC) at.set(e.customData!.topic as string, { x: e.x, y: e.y });
  // Where the map goes the first time: right of the drawing, top-aligned.
  const own = scene.filter((e) => !e.isDeleted && !kindOf(e));
  const minX = Math.min(...topics.map((t) => t.x - t.w / 2));
  const minY = Math.min(...topics.map((t) => t.y - t.h / 2));
  const dx = own.length ? Math.max(...own.map((e) => e.x + Math.abs(e.width))) + 120 - minX : -minX;
  const dy = own.length ? Math.min(...own.map((e) => e.y)) - minY : -minY;
  const skeleton: ExcalidrawElementSkeleton[] = [];
  const ids = new Set(topics.map((t) => t.id));
  for (const t of topics) {
    const p = at.get(t.id) ?? saved?.[t.id] ?? { x: t.x - t.w / 2 + dx, y: t.y - t.h / 2 + dy };
    skeleton.push({
      type: 'rectangle',
      id: rectId(t.id),
      x: p.x,
      y: p.y,
      width: t.w,
      height: t.h,
      strokeColor: t.stroke,
      backgroundColor: t.fill,
      fillStyle: 'solid',
      strokeWidth: t.depth === 0 ? 2 : 1,
      roughness: 0,
      roundness: { type: 3 },
      customData: { keizu: TOPIC, topic: t.id, text: t.text },
      label: { text: t.text || ' ', strokeColor: t.textColor, fontSize: t.depth === 0 ? 20 : 16, fontFamily: 6 },
    } as ExcalidrawElementSkeleton);
  }
  // Connectors: from the parent's edge to the child's edge, bound at both ends
  // so they follow when either shape moves.
  const box = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const sk of skeleton) box.set((sk as { id: string }).id, { x: sk.x ?? 0, y: sk.y ?? 0, w: (sk as { width: number }).width, h: (sk as { height: number }).height });
  const edge = (b: { x: number; y: number; w: number; h: number }, tx: number, ty: number) => {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const dx = tx - cx, dy = ty - cy;
    const k = 1 / Math.max(Math.abs(dx) / (b.w / 2 + 6) || 0, Math.abs(dy) / (b.h / 2 + 6) || 0, 1e-6);
    return { x: cx + dx * Math.min(k, 1), y: cy + dy * Math.min(k, 1) };
  };
  for (const t of topics) {
    if (!t.parentId || !ids.has(t.parentId)) continue;
    const pb = box.get(rectId(t.parentId))!, cb = box.get(rectId(t.id))!;
    const a = edge(pb, cb.x + cb.w / 2, cb.y + cb.h / 2);
    const z = edge(cb, pb.x + pb.w / 2, pb.y + pb.h / 2);
    skeleton.push({
      type: 'arrow',
      id: `kl_${t.id}`,
      x: a.x,
      y: a.y,
      width: z.x - a.x,
      height: z.y - a.y,
      points: [
        [0, 0],
        [z.x - a.x, z.y - a.y],
      ],
      strokeColor: t.stroke,
      strokeWidth: 2,
      roughness: 0,
      endArrowhead: null,
      startArrowhead: null,
      customData: { keizu: LINK, topic: t.id },
      start: { id: rectId(t.parentId) },
      end: { id: rectId(t.id) },
    } as unknown as ExcalidrawElementSkeleton);
  }
  const out = convertToExcalidrawElements(skeleton, { regenerateIds: false }) as El[];
  return out.map((e) => (e.type === 'text' && !kindOf(e) ? ({ ...e, customData: { keizu: LABEL, topic: (e as { containerId?: string }).containerId?.slice(3) } } as El) : e));
}

/** Topic shapes list every arrow bound to them, the user's own included. */
function fixBindings(list: El[]): El[] {
  const arrows = new Map<string, string[]>();
  for (const e of list) {
    if (e.type !== 'arrow' || e.isDeleted) continue;
    const a = e as El & { startBinding?: { elementId: string } | null; endBinding?: { elementId: string } | null };
    for (const b of [a.startBinding, a.endBinding]) if (b) arrows.set(b.elementId, [...(arrows.get(b.elementId) ?? []), e.id]);
  }
  return list.map((e) => {
    if (kindOf(e) !== TOPIC) return e;
    const keep = (e.boundElements ?? []).filter((b) => b.type === 'text');
    const bound = [...keep, ...[...new Set(arrows.get(e.id) ?? [])].map((id) => ({ id, type: 'arrow' as const }))];
    return { ...e, boundElements: bound } as El;
  });
}

function filesFor(elements: readonly unknown[], resources: Record<string, string> | undefined, have: BinaryFiles): BinaryFileData[] {
  const out: BinaryFileData[] = [];
  for (const e of elements) {
    const id = (e as { fileId?: string | null }).fileId;
    if (!id || have[id] || !resources?.[id]) continue;
    const url = resources[id];
    const mimeType = (url.slice(5, url.indexOf(';')) || 'image/png') as BinaryFileData['mimeType'];
    out.push({ id: id as BinaryFileData['id'], dataURL: url as DataURL, mimeType, created: Date.now() });
  }
  return out;
}

const LANGS: Record<string, string> = { tr: 'tr-TR', en: 'en' };


/** Topics with colours as Excalidraw needs them (pre-inverted in dark mode). */
const shown = (p: Props): BoardTopic[] =>
  p.dark ? p.topics.map((t) => ({ ...t, stroke: preInvert(t.stroke), fill: t.fill === 'transparent' ? t.fill : preInvert(t.fill), textColor: preInvert(t.textColor) })) : p.topics;

export const CanvasBoard = forwardRef<CanvasBoardHandle, Props>(function CanvasBoard(props, ref) {
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const latest = useRef(props);
  latest.current = props;
  // What the map holds, as last seen or sent: incoming copies equal to it are echoes.
  const sent = useRef(signature(props.canvas?.elements ?? []));
  const sentTopics = useRef(JSON.stringify(props.canvas?.topics ?? {}));
  const topicsSig = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scene = () => api.current?.getSceneElementsIncludingDeleted() ?? [];

  /** Puts the drawing and (in "both" mode) the topic shapes into the scene. */
  const render = (own: readonly El[], keepTopics: boolean) => {
    const a = api.current;
    if (!a) return;
    const p = latest.current;
    const cur = scene();
    const topics = p.mode === 'both' ? (keepTopics ? cur.filter((e) => kindOf(e) && !e.isDeleted) : buildTopics(shown(p), [...cur, ...own], p.canvas?.topics)) : [];
    topicsSig.current = p.mode === 'both' ? topicsSignature(p.topics) : '';
    const files = filesFor(own, p.resources, a.getFiles());
    if (files.length) a.addFiles(files);
    a.updateScene({ elements: fixBindings([...topics, ...own]), captureUpdate: CaptureUpdateAction.NEVER });
  };

  // Changes from outside (undo, sync, another person): into the scene.
  useEffect(() => {
    if (!api.current) return;
    const sig = signature(props.canvas?.elements ?? []);
    if (sig === sent.current) return;
    const prevSent = new Set(sent.current.split('|').map((x) => x.slice(0, x.lastIndexOf(':'))));
    sent.current = sig;
    let own = restoreElements((props.canvas?.elements ?? []) as unknown as El[], null) as El[];
    if (timer.current) {
      // Drawn here but not saved yet: keep it on top of what came in.
      const incoming = new Map(own.map((e) => [e.id, e]));
      const local = scene().filter((e) => !e.isDeleted && !kindOf(e));
      for (const e of local) {
        const other = incoming.get(e.id);
        if (other) incoming.set(e.id, e.version > other.version ? e : other);
        else if (!prevSent.has(e.id)) incoming.set(e.id, e);
      }
      own = [...incoming.values()].sort((a, b) => ((a.index ?? '') < (b.index ?? '') ? -1 : (a.index ?? '') > (b.index ?? '') ? 1 : 0));
    }
    render(own, true);
  }, [props.canvas]);

  // Topics changed (text, colours, added or removed), or the mode did.
  useEffect(() => {
    if (!api.current) return;
    const sig = props.mode === 'both' ? topicsSignature(props.topics) : '';
    if (sig === topicsSig.current) return;
    render(scene().filter((e) => !kindOf(e) && !e.isDeleted), false);
  }, [props.topics, props.mode]);

  // Theme changed: new background.
  useEffect(() => {
    api.current?.updateScene({ appState: { viewBackgroundColor: props.background }, captureUpdate: CaptureUpdateAction.NEVER });
  }, [props.background]);

  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      flush();
    }
  }, []);

  /** Sends the drawing out: own elements, topic positions, new pictures, topic text edits. */
  const flush = () => {
    timer.current = null;
    const a = api.current;
    if (!a) return;
    const p = latest.current;
    const st = a.getAppState();
    if (st.editingTextElement || st.newElement || st.resizingElement || st.selectedLinearElement?.isDragging) {
      schedule();
      return;
    }
    const all = scene();
    const own = ownElements(all);
    const sig = signature(own);
    const live = all.filter((e) => !e.isDeleted);
    // Topic text typed on the canvas goes back to the topic.
    if (p.mode === 'both') {
      for (const e of live) {
        if (kindOf(e) !== LABEL) continue;
        const topic = e.customData!.topic as string;
        const src = p.topics.find((t) => t.id === topic);
        const text = (e as El & { originalText?: string }).originalText ?? (e as El & { text: string }).text;
        if (src && text.trim() && text !== src.text && text !== (src.text || ' ')) p.onTopicText(topic, text);
      }
    }
    let positions = p.canvas?.topics;
    if (p.mode === 'both') {
      positions = { ...(positions ?? {}) };
      for (const e of live) if (kindOf(e) === TOPIC) positions[e.customData!.topic as string] = { x: Math.round(e.x), y: Math.round(e.y) };
      if (!Object.keys(positions).length) positions = undefined;
      // A topic shape deleted on the canvas comes back: topics are removed on the map.
      if (p.topics.some((t) => !live.some((e) => kindOf(e) === TOPIC && e.customData!.topic === t.id))) {
        render(all.filter((e) => !kindOf(e) && !e.isDeleted), false);
      }
    }
    const posSig = JSON.stringify(positions ?? {});
    if (sig === sent.current && posSig === sentTopics.current) return;
    sent.current = sig;
    sentTopics.current = posSig;
    const files: Record<string, string> = {};
    const have = a.getFiles();
    for (const e of own) {
      const id = e.fileId;
      if (id && !p.resources?.[id] && have[id]) files[id] = have[id].dataURL;
    }
    const next: CanvasData = { elements: own };
    if (positions) next.topics = positions;
    p.onChange(next.elements.length || next.topics ? next : undefined, files);
  };

  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 350);
  };

  useImperativeHandle(ref, () => ({
    idle() {
      const st = api.current?.getAppState();
      if (!st) return true;
      return !st.editingTextElement && !st.newElement && !Object.keys(st.selectedElementIds).length && st.activeTool.type === 'selection';
    },
    async exportAs(kind, title) {
      const a = api.current;
      if (!a) return;
      if (timer.current) flush();
      const elements = a.getSceneElements();
      const appState: Partial<AppState> = { ...a.getAppState(), exportBackground: true, exportWithDarkMode: latest.current.dark, exportEmbedScene: false };
      const name = safeFileName(title);
      if (kind === 'svg') {
        const svg = await exportToSvg({ elements, appState, files: a.getFiles(), exportPadding: 24 });
        return saveExport(`${name}.svg`, new XMLSerializer().serializeToString(svg), 'image/svg+xml');
      }
      const scale = kind === 'pdf' ? 3 : 2;
      const blob = await exportToBlob({
        elements,
        appState: { ...appState, exportScale: scale },
        files: a.getFiles(),
        exportPadding: 24,
        mimeType: kind === 'pdf' ? 'image/jpeg' : 'image/png',
        quality: 0.92,
      });
      if (kind === 'png') return saveExport(`${name}.png`, blob, 'image/png');
      const bmp = await createImageBitmap(blob);
      const pdf = buildImagePdf(new Uint8Array(await blob.arrayBuffer()), {
        width: bmp.width,
        height: bmp.height,
        displayWidth: (bmp.width / scale) * 0.75,
        displayHeight: (bmp.height / scale) * 0.75,
        title,
      });
      bmp.close();
      return saveExport(`${name}.pdf`, pdf, 'application/pdf');
    },
  }));

  const initial = () => {
    const own = restoreElements((props.canvas?.elements ?? []) as unknown as El[], null) as El[];
    const topics = props.mode === 'both' ? buildTopics(shown(props), own, props.canvas?.topics) : [];
    topicsSig.current = props.mode === 'both' ? topicsSignature(props.topics) : '';
    const files: BinaryFiles = {};
    for (const f of filesFor(own, props.resources, {})) files[f.id] = f;
    return {
      elements: fixBindings([...topics, ...own]),
      files,
      appState: { viewBackgroundColor: props.background, currentItemFontFamily: 5 },
      scrollToContent: true,
    };
  };

  const init = useRef<ReturnType<typeof initial> | null>(null);
  if (!init.current) init.current = initial();

  return (
    <div className="canvas-board">
      <Excalidraw
        excalidrawAPI={(a) => (api.current = a)}
        initialData={init.current}
        onChange={(_els, st) => {
          if (props.readOnly) return;
          // Scrolling and selecting change nothing worth saving; the signature check in flush filters them.
          if (st.editingTextElement) return;
          schedule();
        }}
        langCode={LANGS[props.lang] ?? 'en'}
        theme={props.dark ? 'dark' : 'light'}
        viewModeEnabled={props.readOnly}
        handleKeyboardGlobally={false}
        renderTopRightUI={() => <>{props.topRight}</>}
        UIOptions={{
          canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: null, changeViewBackgroundColor: false },
        }}
      />
    </div>
  );
});

export default CanvasBoard;
