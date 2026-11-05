// Automatic layout. Pure functions: given a map and a text measurer, returns
// a box for every visible topic. Coordinates are box centres; the central
// topic sits at (0, 0).

import { layeredLayout, roundedPath, routePoints, type FlowEdgeIn, type FlowRoute } from './flow';
import { MARKER_GAP, MARKER_SIZE } from './markers';
import type { LayoutKind, MindMap, Point, Relation, Summary, Topic, TopicShape } from './model';
export type { Point };
import { countTopics, findTopic, rangeIndices } from './model';
import { layoutNote, type RichLine } from './richText';
import { getTheme } from './themes';

export type Measure = (text: string, font: string) => number;

/**
 * How a topic's children are arranged around it: to one side, to both
 * sides (mind map), below it (org chart, concept map), as an indented list
 * going down or up (inside timelines, fishbones and matrices), along a time
 * axis, as the bones of a fishbone, as the columns of a matrix, or as the
 * steps of a flow chart (every topic of a flow chart has flow 'flow').
 */
export type Flow = 'right' | 'left' | 'both' | 'down' | 'tree' | 'treeUp' | 'timeline' | 'fishbone' | 'matrix' | 'matrixCol' | 'flow';

/** Flows whose children hang below (or above) the parent rather than beside it. */
export const isVerticalFlow = (f: Flow) => f === 'down';

export interface NodeBox {
  id: string;
  /** Root topic of the tree this box belongs to. */
  rootId: string;
  /** Layout in effect at this topic: its own override, or inherited. */
  layout: LayoutKind;
  /** How this topic's children are arranged. */
  flow: Flow;
  topic: Topic;
  parentId?: string;
  depth: number;
  /** +1 right of its parent, -1 left, 0 below it (or the root itself). */
  side: 1 | -1 | 0;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  shape: TopicShape;
  lines: string[];
  font: string;
  fontSize: number;
  lineHeight: number;
  padX: number;
  /** Extra space before the text for the leading dot (signature themes), else 0. */
  lead: number;
  /** Children hidden by collapsing, 0 when expanded. */
  hidden: number;
  /** No connector is drawn from the parent (matrix cells). */
  noEdge?: boolean;
  /** Topic picture drawn above the text, if any. */
  image?: { href: string; w: number; h: number };
  /** Vertical space the picture takes at the top of the box (0 without one). */
  imageH: number;
  /** The note, when it is shown inside the topic below the text. */
  noteBlock?: NoteBlock;
  /** Set on summary topics: the topic whose children they sum up. */
  summaryOf?: string;
}

/** An outline around a run of sibling branches. */
export interface BoundaryBox {
  id: string;
  ownerId: string;
  /** Every topic drawn inside it (the branches and all they show). */
  members: string[];
  label?: string;
  color: string;
}

/** The bracket of a summary topic. */
export interface BracketBox {
  /** The summary topic's id. */
  id: string;
  ownerId: string;
  members: string[];
  /** 'h': the bracket stands beside the run, 'v': it lies below it. */
  orient: 'h' | 'v';
  /** Which side of the run the bracket is on ('h' only). */
  dir: 1 | -1;
  color: string;
}

/** A topic's note drawn inside its box: rich text, wrapped to fit. */
export interface NoteBlock {
  lines: RichLine[];
  /** Width of the note's text area. */
  w: number;
  font: string;
  fontSize: number;
  lineHeight: number;
  /** Vertical space it takes at the bottom of the box, gaps included. */
  h: number;
}

/** An arrow between two steps of a flow chart. */
export interface FlowEdge {
  /** 't:' + child id for a tree connector, else the flow link's relation id. */
  key: string;
  /** The flow chart's first step: route coordinates are relative to it. */
  owner: string;
  from: string;
  to: string;
  route: FlowRoute;
  /** Set for flow links (Relation.kind 'flow'). */
  relId?: string;
}

export interface MapLayout {
  kind: LayoutKind;
  nodes: NodeBox[];
  byId: Map<string, NodeBox>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Arrows of flow charts (their tree connectors and flow links). */
  flowEdges: FlowEdge[];
  boundaries: BoundaryBox[];
  brackets: BracketBox[];
  /** Set in focus mode: the topic whose branch alone is shown. */
  focusId?: string;
}

/** Space between a boundary's outline and what it holds. */
export const BOUNDARY_PAD = 10;
/** Extra room at the top of a boundary for its label. */
export const BOUNDARY_LABEL_H = 22;
/** Width of a summary bracket, and the gap on either side of it. */
export const BRACKET_W = 14;
export const BRACKET_GAP = 8;

/** Focus mode: show only one branch, drawn where it stands on the full map. */
export interface FocusOptions {
  id: string;
  /** Where the focused topic's centre is drawn. */
  anchor?: Point;
  /** Colour for its branches (its own branch colour), so they keep their look. */
  color?: string;
}

/**
 * The map as seen in focus mode: the focused topic's branch as the only
 * tree, laid out as it was on the full map. Undefined if the topic is gone.
 */
export function focusView(map: MindMap, id: string): MindMap | undefined {
  const t = findTopic(map, id);
  if (!t) return undefined;
  let kind: LayoutKind | undefined;
  const walk = (x: Topic, inherited: LayoutKind): boolean => {
    const own = x.layout ?? inherited;
    if (x.id === id) {
      kind = own;
      return true;
    }
    return x.children.some((c) => walk(c, own));
  };
  if (!map.roots.some((r) => walk(r, r.layout ?? map.layout))) return undefined; // a summary topic
  // A mind-map branch keeps growing to one side, as it did on the full map,
  // so its boundaries and summaries stay whole. Its own layout setting wins.
  const own = t.layout ?? (kind === 'mindmap' && !map.roots.some((r) => r.id === id) ? 'logic' : kind!);
  return { ...map, layout: own, roots: [{ ...t, pos: undefined, collapsed: undefined, layout: undefined }] };
}

export const FONT_FAMILY = "'Plus Jakarta Sans', system-ui, sans-serif";

interface Metrics {
  fontSize: number;
  weight: number;
  padX: number;
  padY: number;
  minW: number;
  shape: TopicShape;
}

function metricsFor(depth: number, boxed: boolean, t: Topic, signature = false): Metrics {
  const base: Metrics = signature
    ? depth === 0
      ? { fontSize: 20, weight: 800, padX: 22, padY: 14, minW: 120, shape: 'rounded' }
      : depth === 1
        ? { fontSize: 15, weight: 700, padX: 14, padY: 9, minW: 64, shape: 'rounded' }
        : { fontSize: 14, weight: 600, padX: 11, padY: 6, minW: 24, shape: 'rounded' }
    : depth === 0
      ? { fontSize: 20, weight: 700, padX: 24, padY: 16, minW: 120, shape: 'rounded' }
      : depth === 1
        ? { fontSize: 15, weight: 600, padX: 16, padY: 9, minW: 64, shape: 'rounded' }
        : { fontSize: 14, weight: 400, padX: 6, padY: 5, minW: 24, shape: boxed ? 'rounded' : 'underline' };
  const s = t.style ?? {};
  return {
    ...base,
    fontSize: s.fontSize ?? base.fontSize,
    weight: s.bold === undefined ? base.weight : s.bold ? 700 : 400,
    shape: s.shape ?? base.shape,
  };
}

const IMAGE_MAX_W = 320;
const IMAGE_MAX_H = 240;
const IMAGE_GAP = 6;
/** Space between the line above a shown note and its first line. */
export const NOTE_GAP = 4;
const NOTE_MIN_W = 180;
const NOTE_MAX_W = 320;
/** A shown note longer than this is cut, with "…" at the end. */
const NOTE_MAX_LINES = 12;
/** Notebook mode shows whole notes, in wider cards. */
const NOTEBOOK_MIN_W = 260;
const NOTEBOOK_MAX_W = 420;

/** Breaks text into lines no wider than maxW, at spaces where it can. */
export function wrapText(text: string, font: string, maxW: number, measure: Measure): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      const next = line + word;
      if (!line || measure(next, font) <= maxW) {
        line = next;
        continue;
      }
      out.push(line.trimEnd());
      line = word.trimStart();
    }
    // A single word wider than the box is cut by characters.
    while (line && measure(line, font) > maxW && line.length > 1) {
      let n = line.length - 1;
      while (n > 1 && measure(line.slice(0, n), font) > maxW) n--;
      out.push(line.slice(0, n));
      line = line.slice(n);
    }
    out.push(line);
  }
  return out;
}

function noteBlockFor(t: Topic, fontSize: number, padY: number, contentW: number, measure: Measure, notebook = false): NoteBlock | undefined {
  const note = notebook || t.style?.showNote ? t.note?.trim() : undefined;
  if (!note) return;
  const size = Math.max(notebook ? 12 : 11, Math.round(fontSize * (notebook ? 0.86 : 0.8)));
  const font = `400 ${size}px ${FONT_FAMILY}`;
  const maxW = notebook
    ? Math.min(NOTEBOOK_MAX_W, Math.max(NOTEBOOK_MIN_W, contentW))
    : Math.min(NOTE_MAX_W, Math.max(NOTE_MIN_W, contentW));
  const rich = layoutNote(note, size, maxW, measure, notebook ? Infinity : NOTE_MAX_LINES);
  const lineHeight = Math.round(size * 1.4);
  return { lines: rich.lines, w: rich.w, font, fontSize: size, lineHeight, h: NOTE_GAP + rich.h + padY };
}

/** Room for the leading dot of signature-theme topics. */
export const LEAD_DOT = 12;

function sizeNode(t: Topic, depth: number, boxed: boolean, measure: Measure, resources?: Record<string, string>, signature = false, notebook = false) {
  // A topic shown as a notebook card is always a box.
  const card = notebook && !!t.note?.trim();
  const m = metricsFor(depth, boxed || card, t, signature);
  if (card) {
    m.padX = Math.max(m.padX, 14);
    m.padY = Math.max(m.padY, 9);
    if (m.shape === 'underline' || m.shape === 'none') m.shape = 'rounded';
  }
  // Signature themes put a small dot before the text of boxed, non-central topics.
  const lead = signature && depth > 0 && (m.shape === 'rounded' || m.shape === 'pill' || m.shape === 'rect') ? LEAD_DOT : 0;
  const font = `${t.style?.italic ? 'italic ' : ''}${m.weight} ${m.fontSize}px ${FONT_FAMILY}`;
  const lines = (t.text || ' ').split('\n');
  const textW = Math.max(...lines.map((l) => measure(l || ' ', font)));
  const lineHeight = Math.round(m.fontSize * 1.35);
  const icons = (t.markers?.length ?? 0) + (t.note ? 1 : 0) + (t.href ? 1 : 0);
  const iconW = icons * (MARKER_SIZE + MARKER_GAP);
  const href = t.image && resources?.[t.image.res];
  let image: NodeBox['image'];
  if (href && t.image) {
    const k = Math.min(1, IMAGE_MAX_W / t.image.width, IMAGE_MAX_H / t.image.height);
    image = { href, w: Math.round(t.image.width * k), h: Math.round(t.image.height * k) };
  }
  const imageH = image ? image.h + IMAGE_GAP : 0;
  const noteBlock = noteBlockFor(t, m.fontSize, m.padY, textW + iconW, measure, notebook);
  const noteW = noteBlock?.w ?? 0;
  const w = Math.max(m.minW, Math.ceil(textW + iconW + lead + m.padX * 2), image ? image.w + m.padX * 2 : 0, Math.ceil(noteW + m.padX * 2));
  const h = Math.max(lines.length * lineHeight, icons ? MARKER_SIZE : 0) + m.padY * 2 + imageH + (noteBlock?.h ?? 0);
  return { w, h, lines, font, fontSize: m.fontSize, lineHeight, padX: m.padX, lead, shape: m.shape, image, imageH, noteBlock };
}

const H_GAP = (depth: number) => (depth === 0 ? 64 : 40);
const V_GAP = (depth: number) => (depth <= 1 ? 20 : 8);
const ORG_H_GAP = 24;
const ORG_V_GAP = 48;
/** Concept maps leave room for words on the connectors. */
const CONCEPT_V_GAP = 76;
const CONCEPT_H_GAP = 36;
const TREE_INDENT = 22;
const TREE_GAP = 8;
const TIMELINE_GAP = 36;
const FISH_SPINE_GAP = 34;
const FISH_GAP = 28;
/** Fishbone bones lean this far (in x) over their height. */
export const FISH_SLANT = 0.45;

/** Layouts that draw every topic in a box (no underline-only topics). */
const BOXED: LayoutKind[] = ['org', 'concept', 'timeline', 'fishbone', 'matrix', 'flow'];

export function layoutMap(map: MindMap, measure: Measure, focus?: FocusOptions): MapLayout {
  if (focus) {
    const view = focusView(map, focus.id);
    if (view) {
      const l = layoutWhole(view, measure, focus.color);
      const dx = focus.anchor?.x ?? 0, dy = focus.anchor?.y ?? 0;
      for (const b of l.nodes) {
        b.x += dx;
        b.y += dy;
      }
      const { minX, minY, maxX, maxY } = l.bounds;
      return { ...l, bounds: { minX: minX + dx, minY: minY + dy, maxX: maxX + dx, maxY: maxY + dy }, focusId: focus.id };
    }
  }
  return layoutWhole(map, measure);
}

function layoutWhole(map: MindMap, measure: Measure, branchColor?: string): MapLayout {
  const theme = getTheme(map.theme);
  const nodes: NodeBox[] = [];
  const byId = new Map<string, NodeBox>();
  const boundaries: BoundaryBox[] = [];
  const brackets: BracketBox[] = [];
  const mainKind = map.layout;
  const palette = (i: number) => branchColor ?? (map.multicolor ? theme.palette[i % theme.palette.length] : theme.mono);
  let colorIndex = map.roots[0]?.children.length ?? 0;
  let maxY = 0;
  const flowEdges: FlowEdge[] = [];
  const links = map.relations.filter((r) => r.kind === 'flow');

  map.roots.forEach((root, ri) => {
    const kind = root.layout ?? mainKind;
    // Floating roots are drawn one level down (like a main topic) so the
    // central topic stays visually unique.
    const baseDepth = ri === 0 ? 0 : 1;
    const rootColor = ri === 0 ? theme.mono : palette(colorIndex++);
    const tree = layoutTree(root, kind, baseDepth, rootColor, palette, theme.mono, measure, map.resources, theme.signature, !!map.notebook, links);
    flowEdges.push(...tree.flowEdges);
    let pos = root.pos;
    if (!pos && ri > 0) {
      // No stored position: park it under everything laid out so far.
      pos = { x: 0, y: maxY + 80 + (tree.root.y - tree.minY) };
    }
    const dx = pos?.x ?? 0, dy = pos?.y ?? 0;
    for (const b of tree.nodes) {
      b.x += dx;
      b.y += dy;
      b.rootId = root.id;
      nodes.push(b);
      byId.set(b.id, b);
      maxY = Math.max(maxY, b.y + b.h / 2);
    }
    boundaries.push(...tree.boundaries);
    brackets.push(...tree.brackets);
  });

  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const b of nodes) {
    bounds.minX = Math.min(bounds.minX, b.x - b.w / 2);
    bounds.maxX = Math.max(bounds.maxX, b.x + b.w / 2);
    bounds.minY = Math.min(bounds.minY, b.y - b.h / 2);
    bounds.maxY = Math.max(bounds.maxY, b.y + b.h / 2);
  }
  if (!nodes.length) Object.assign(bounds, { minX: 0, minY: 0, maxX: 0, maxY: 0 });
  // Room for the outlines of boundaries on the outside of the map.
  if (boundaries.length) {
    bounds.minX -= BOUNDARY_PAD;
    bounds.maxX += BOUNDARY_PAD;
    bounds.minY -= BOUNDARY_PAD + BOUNDARY_LABEL_H;
    bounds.maxY += BOUNDARY_PAD;
  }
  return { kind: mainKind, nodes, byId, bounds, flowEdges, boundaries, brackets };
}

/** Extent of a laid-out subtree around its root's centre (all >= 0). */
interface Ext {
  l: number;
  r: number;
  t: number;
  b: number;
}

/**
 * Lays out one tree with its root at (0, 0). Any topic may override the
 * layout for its own branch (Topic.layout); its children then follow that
 * layout until another override.
 */
function layoutTree(
  root: Topic,
  kind: LayoutKind,
  baseDepth: number,
  rootColor: string,
  palette: (i: number) => string,
  mono: string,
  measure: Measure,
  resources?: Record<string, string>,
  signature = false,
  notebook = false,
  links: Relation[] = [],
): { nodes: NodeBox[]; root: NodeBox; minY: number; flowEdges: FlowEdge[]; boundaries: BoundaryBox[]; brackets: BracketBox[] } {
  const flowEdges: FlowEdge[] = [];
  const nodes: NodeBox[] = [];
  const byId = new Map<string, NodeBox>();
  /** Summaries to place, by owner id, with the child index run they cover. */
  const summaryRuns = new Map<string, { s: Summary; lo: number; hi: number }[]>();
  /** Boundaries each branch stands in (as one of the run), innermost owner first. */
  const memberOf = new Map<string, { labelled: boolean; first: boolean; last: boolean }[]>();
  const boundaryRuns: { id: string; owner: Topic; lo: number; hi: number; label?: string; color?: string }[] = [];
  const bracketOut = new Map<string, Omit<BracketBox, 'members'> & { owner: Topic; lo: number; hi: number }>();
  /** Topics whose layout is set explicitly (the tree root counts). */
  const explicit = new Set<string>([root.id]);

  const build = (t: Topic, depth: number, color: string, inherited: LayoutKind, parentDown: boolean, parentId?: string) => {
    const own = t === root ? kind : t.layout ?? inherited;
    if (t !== root && t.layout) explicit.add(t.id);
    const size = sizeNode(t, depth, signature || parentDown || BOXED.includes(own), measure, resources, signature, notebook);
    const hidden = t.collapsed && t.children.length ? countTopics(t) - 1 : 0;
    const box: NodeBox = { id: t.id, rootId: root.id, layout: own, flow: 'right', topic: t, parentId, depth, side: 0, x: 0, y: 0, color, hidden, ...size };
    nodes.push(box);
    byId.set(t.id, box);
    if (hidden) return;
    t.children.forEach((c, i) => build(c, depth + 1, depth === 0 ? palette(i) : color, own, BOXED.includes(own), t.id));
    // Flow charts lay out steps in columns of their own: no boundaries or summaries there.
    if (own === 'flow') return;
    for (const s of t.summaries ?? []) {
      const ix = rangeIndices(t, s);
      if (!ix) continue;
      const st = s.topic;
      const sColor = byId.get(t.children[ix[0]].id)?.color ?? color;
      const sSize = sizeNode(st, depth + 1, signature || BOXED.includes(own), measure, resources, signature, notebook);
      const sBox: NodeBox = { id: st.id, rootId: root.id, layout: own, flow: 'right', topic: st, parentId: t.id, depth: depth + 1, side: 0, x: 0, y: 0, color: sColor, hidden: 0, noEdge: true, summaryOf: t.id, ...sSize };
      nodes.push(sBox);
      byId.set(st.id, sBox);
      summaryRuns.set(t.id, [...(summaryRuns.get(t.id) ?? []), { s, lo: ix[0], hi: ix[1] }]);
    }
    for (const bd of t.boundaries ?? []) {
      const ix = rangeIndices(t, bd);
      if (!ix) continue;
      boundaryRuns.push({ id: bd.id, owner: t, lo: ix[0], hi: ix[1], label: bd.label, color: bd.color });
      for (let k = ix[0]; k <= ix[1]; k++) {
        const id = t.children[k].id;
        memberOf.set(id, [...(memberOf.get(id) ?? []), { labelled: !!bd.label, first: k === ix[0], last: k === ix[1] }]);
      }
    }
  };
  build(root, baseDepth, baseDepth === 0 ? mono : rootColor, kind, false);

  const kids = (t: Topic) => (byId.get(t.id)!.hidden ? [] : t.children);
  /** Offset of each topic's centre from its parent's centre. */
  const off = new Map<string, Point>();

  const flowOf = (b: NodeBox, side: -1 | 0 | 1, given?: Flow): Flow => {
    // Inside a timeline, fishbone or matrix the parent decides, unless this
    // topic picks a layout of its own.
    if (given && !explicit.has(b.id)) return given;
    switch (b.layout) {
      case 'org':
      case 'concept':
        return 'down';
      case 'timeline':
        return explicit.has(b.id) ? 'timeline' : 'tree';
      case 'fishbone':
        return explicit.has(b.id) ? 'fishbone' : 'tree';
      case 'matrix':
        return explicit.has(b.id) ? 'matrix' : 'tree';
      case 'mindmap':
        if (explicit.has(b.id)) return 'both';
        break;
      case 'flow':
        return 'flow';
    }
    return side < 0 ? 'left' : 'right';
  };

  /**
   * A flow chart starting at `t`: every visible topic below it is a step,
   * laid out in columns together with the flow links between them.
   */
  const arrangeFlow = (t: Topic, e: Ext): Ext => {
    const steps: Topic[] = [];
    const parentOf = new Map<string, string>();
    const collect = (x: Topic) => {
      steps.push(x);
      for (const c of kids(x)) {
        parentOf.set(c.id, x.id);
        collect(c);
      }
    };
    collect(t);
    const inside = new Set(steps.map((x) => x.id));
    const edges: FlowEdgeIn[] = [];
    for (const x of steps) if (x !== t) edges.push({ key: `t:${x.id}`, from: parentOf.get(x.id)!, to: x.id });
    for (const r of links) if (inside.has(r.from) && inside.has(r.to)) edges.push({ key: r.id, from: r.from, to: r.to });
    const res = layeredLayout(
      steps.map((x) => ({ id: x.id, w: byId.get(x.id)!.w, h: byId.get(x.id)!.h })),
      edges,
    );
    for (const x of steps) {
      const sb = byId.get(x.id)!;
      const p = res.pos.get(x.id)!;
      if (x !== t) {
        sb.side = 1;
        sb.flow = 'flow';
        sb.noEdge = undefined;
        const pp = res.pos.get(parentOf.get(x.id)!)!;
        off.set(x.id, { x: p.x - pp.x, y: p.y - pp.y });
      }
      e.l = Math.max(e.l, sb.w / 2 - p.x);
      e.r = Math.max(e.r, p.x + sb.w / 2);
      e.t = Math.max(e.t, sb.h / 2 - p.y);
      e.b = Math.max(e.b, p.y + sb.h / 2);
    }
    for (const ed of edges) {
      const route = res.routes.get(ed.key);
      if (route) flowEdges.push({ key: ed.key, owner: t.id, from: ed.from, to: ed.to, route, relId: ed.key.startsWith('t:') ? undefined : ed.key });
    }
    return e;
  };

  /** Extent of each placed subtree, boundary room included. */
  const extOf = new Map<string, Ext>();

  /**
   * Places the subtree of `t` (on `side` of its parent) and returns its
   * extent, with its summaries placed and room for the boundaries it is in.
   */
  const arrange = (t: Topic, side: -1 | 0 | 1, given?: Flow): Ext => {
    const e = arrangeOwn(t, side, given);
    const b = byId.get(t.id)!;
    for (const run of summaryRuns.get(t.id) ?? []) placeSummary(t, b, e, run);
    const pads = memberOf.get(t.id);
    if (pads) {
      const pf = b.parentId ? byId.get(b.parentId)?.flow : undefined;
      // Room only on the outside of the run: between its own branches the usual gap is enough.
      const across = pf === 'down' || pf === 'timeline';
      const stacked = !across && pf !== 'fishbone' && pf !== 'matrix';
      // Left of a mind map and in upward lists the run is drawn bottom to top.
      const flipped = (pf === 'both' && side === -1) || pf === 'treeUp';
      for (const p of pads) {
        const top = stacked ? (flipped ? p.last : p.first) : true;
        const bottom = stacked ? (flipped ? p.first : p.last) : true;
        e.l += !across || p.first ? BOUNDARY_PAD : 0;
        e.r += !across || p.last ? BOUNDARY_PAD : 0;
        e.b += bottom ? BOUNDARY_PAD : 0;
        // Side by side every branch keeps the label's room, so they stay level.
        e.t += top ? BOUNDARY_PAD + (p.labelled ? BOUNDARY_LABEL_H : 0) : 0;
      }
    }
    extOf.set(t.id, e);
    return e;
  };

  /** Puts a summary topic beside (or below) the run of children it sums up. */
  const placeSummary = (t: Topic, b: NodeBox, e: Ext, run: { s: Summary; lo: number; hi: number }) => {
    let l = Infinity, r = -Infinity, top = Infinity, bot = -Infinity;
    for (let k = run.lo; k <= run.hi; k++) {
      const c = t.children[k];
      const o = off.get(c.id), ce = extOf.get(c.id);
      if (!o || !ce) continue;
      l = Math.min(l, o.x - ce.l);
      r = Math.max(r, o.x + ce.r);
      top = Math.min(top, o.y - ce.t);
      bot = Math.max(bot, o.y + ce.b);
    }
    if (l === Infinity) return;
    const st = run.s.topic;
    const vertical = b.flow === 'down' || b.flow === 'timeline' || b.flow === 'matrix' || b.flow === 'fishbone';
    const dir: 1 | -1 = vertical ? 1 : byId.get(t.children[run.lo].id)?.side === -1 ? -1 : 1;
    const se = arrangeOwn(st, vertical ? 0 : dir);
    const sb = byId.get(st.id)!;
    sb.noEdge = true;
    const reach = BRACKET_GAP * 2 + BRACKET_W;
    const dx = vertical ? (l + r) / 2 : dir > 0 ? r + reach + se.l : l - reach - se.r;
    const dy = vertical ? bot + reach + se.t : (top + bot) / 2;
    off.set(st.id, { x: dx, y: dy });
    e.l = Math.max(e.l, se.l - dx);
    e.r = Math.max(e.r, dx + se.r);
    e.t = Math.max(e.t, se.t - dy);
    e.b = Math.max(e.b, dy + se.b);
    bracketOut.set(st.id, { id: st.id, ownerId: t.id, orient: vertical ? 'v' : 'h', dir, color: sb.color, owner: t, lo: run.lo, hi: run.hi });
  };

  const arrangeOwn = (t: Topic, side: -1 | 0 | 1, given?: Flow): Ext => {
    const b = byId.get(t.id)!;
    b.side = side;
    b.flow = flowOf(b, side, given);
    b.noEdge = given === 'matrixCol' || given === 'matrix' ? true : undefined;
    const e: Ext = { l: b.w / 2, r: b.w / 2, t: b.h / 2, b: b.h / 2 };
    const cs = kids(t);
    if (!cs.length) return e;
    if (b.flow === 'flow') return arrangeFlow(t, e);
    const grow = (c: Topic, ce: Ext, dx: number, dy: number) => {
      off.set(c.id, { x: dx, y: dy });
      e.l = Math.max(e.l, ce.l - dx);
      e.r = Math.max(e.r, dx + ce.r);
      e.t = Math.max(e.t, ce.t - dy);
      e.b = Math.max(e.b, dy + ce.b);
    };

    if (b.flow === 'down') {
      const concept = b.layout === 'concept';
      const hGap = concept ? CONCEPT_H_GAP : ORG_H_GAP;
      const exts = cs.map((c) => arrange(c, 0));
      const total = exts.reduce((s, x) => s + x.l + x.r, 0) + hGap * (cs.length - 1);
      let left = -total / 2;
      cs.forEach((c, i) => {
        const ce = exts[i];
        grow(c, ce, left + ce.l, b.h / 2 + (concept ? CONCEPT_V_GAP : ORG_V_GAP) + ce.t);
        left += ce.l + ce.r + hGap;
      });
      return e;
    }

    if (b.flow === 'tree' || b.flow === 'treeUp' || b.flow === 'matrixCol') {
      // An indented list below (or above) the topic, like an outline.
      const up = b.flow === 'treeUp';
      const childFlow = up ? 'treeUp' : 'tree';
      let cursor = up ? -b.h / 2 - TREE_GAP : b.h / 2 + TREE_GAP;
      for (const c of cs) {
        const ce = arrange(c, 1, childFlow);
        const dx = b.flow === 'matrixCol' ? 0 : -b.w / 2 + TREE_INDENT + ce.l;
        grow(c, ce, dx, up ? cursor - ce.b : cursor + ce.t);
        cursor += up ? -(ce.t + ce.b + TREE_GAP) : ce.t + ce.b + TREE_GAP;
      }
      return e;
    }

    if (b.flow === 'timeline') {
      // Events along a horizontal axis; their details alternate above and below.
      let cursor = b.w / 2 + TIMELINE_GAP;
      cs.forEach((c, i) => {
        const ce = arrange(c, 1, i % 2 ? 'treeUp' : 'tree');
        grow(c, ce, cursor + ce.l, 0);
        cursor += ce.l + ce.r + TIMELINE_GAP;
      });
      return e;
    }

    if (b.flow === 'fishbone') {
      // The topic is the head; the spine runs left from it. Bones alternate
      // above and below the spine, causes listed along each bone.
      let cursor = -b.w / 2 - FISH_GAP;
      for (let i = 0; i < cs.length; i += 2) {
        const pair = cs.slice(i, i + 2).map((c, k) => ({ c, top: k === 0, ce: arrange(c, -1, k === 0 ? 'tree' : 'treeUp') }));
        let width = 0;
        for (const { c, top, ce } of pair) {
          const dy = top ? -FISH_SPINE_GAP - ce.b : FISH_SPINE_GAP + ce.t;
          // The bone meets the spine to the right of the label: keep it clear of the bone before.
          const lean = Math.abs(dy) * FISH_SLANT;
          const right = cursor - lean;
          grow(c, ce, right - ce.r, dy);
          width = Math.max(width, ce.l + ce.r + lean);
        }
        cursor -= width + FISH_GAP;
      }
      return e;
    }

    if (b.flow === 'matrix') {
      // Children are column headers; their children are the cells below.
      const cols = cs.map((h) => {
        const hb = byId.get(h.id)!;
        const cells = kids(h);
        const first = cells.map((c) => arrange(c, 0, 'tree'));
        const w = Math.max(hb.w, ...first.map((x) => x.l + x.r));
        return { h, hb, cells, w };
      });
      const headH = Math.max(b.h, ...cols.map((c) => c.hb.h));
      b.h = headH;
      e.t = e.b = headH / 2;
      const rows: number[] = [];
      const cellExt = cols.map((col) =>
        col.cells.map((c, r) => {
          byId.get(c.id)!.w = col.w;
          const ce = arrange(c, 0, 'tree');
          rows[r] = Math.max(rows[r] ?? 0, ce.t + ce.b);
          return ce;
        }),
      );
      let x = b.w / 2;
      cols.forEach((col, ci) => {
        col.hb.w = col.w;
        col.hb.h = headH;
        col.hb.flow = 'matrixCol';
        col.hb.side = 1;
        col.hb.noEdge = true;
        if (!col.h.style?.shape) col.hb.shape = 'rect';
        let y = headH / 2;
        const ce: Ext = { l: col.w / 2, r: col.w / 2, t: headH / 2, b: headH / 2 };
        col.cells.forEach((c, r) => {
          const cb = byId.get(c.id)!;
          cb.noEdge = true;
          if (!c.style?.shape) cb.shape = 'rect';
          if (!kids(c).length) cb.h = rows[r];
          const x2 = cellExt[ci][r];
          const dy = y + (kids(c).length ? x2.t : rows[r] / 2);
          off.set(c.id, { x: 0, y: dy });
          ce.b = Math.max(ce.b, y + rows[r]);
          ce.r = Math.max(ce.r, x2.r);
          y += rows[r];
        });
        grow(col.h, ce, x + col.w / 2, 0);
        x += col.w;
      });
      return e;
    }

    const stack = (group: Topic[], exts: Ext[], dir: 1 | -1) => {
      const gapV = V_GAP(b.depth);
      const total = exts.reduce((s, x) => s + x.t + x.b, 0) + gapV * Math.max(0, group.length - 1);
      let yTop = -total / 2;
      group.forEach((c, i) => {
        const ce = exts[i];
        const reach = b.w / 2 + H_GAP(b.depth);
        grow(c, ce, dir > 0 ? reach + ce.l : -reach - ce.r, yTop + ce.t);
        yTop += ce.t + ce.b + gapV;
      });
    };

    if (b.flow !== 'both') {
      const dir = b.flow === 'left' ? -1 : 1;
      stack(cs, cs.map((c) => arrange(c, dir)), dir);
      return e;
    }
    // Both sides: fill the right side until it holds about half the height,
    // then the left side, going clockwise (left side listed bottom to top).
    const exts = cs.map((c) => arrange(c, 1));
    const hs = exts.map((x) => x.t + x.b);
    const total = hs.reduce((s, h) => s + h, 0);
    let n = 0, acc = 0;
    while (n < cs.length && (n === 0 || (acc < total / 2 && n < Math.ceil(cs.length / 2)))) acc += hs[n++];
    stack(cs.slice(0, n), exts.slice(0, n), 1);
    const left = cs.slice(n).reverse();
    stack(left, left.map((c) => arrange(c, -1)), -1);
    return e;
  };
  arrange(root, 0);

  // Turn parent-relative offsets into tree coordinates.
  const place = (t: Topic, x: number, y: number) => {
    const b = byId.get(t.id)!;
    b.x = x;
    b.y = y;
    for (const c of kids(t)) {
      const o = off.get(c.id)!;
      place(c, x + o.x, y + o.y);
    }
    if (b.hidden) return;
    for (const s of t.summaries ?? []) {
      const o = off.get(s.topic.id);
      const sb = byId.get(s.topic.id);
      if (o && sb) {
        sb.x = x + o.x;
        sb.y = y + o.y;
      }
    }
  };
  place(root, 0, 0);

  /** Ids of every topic drawn for the children lo..hi of `owner`. */
  const shownIn = (owner: Topic, lo: number, hi: number) => {
    const out: string[] = [];
    const walk = (t: Topic) => {
      if (!byId.has(t.id)) return;
      out.push(t.id);
      if (byId.get(t.id)!.hidden) return;
      t.children.forEach(walk);
      t.summaries?.forEach((s) => byId.has(s.topic.id) && out.push(s.topic.id));
    };
    for (let k = lo; k <= hi; k++) walk(owner.children[k]);
    return out;
  };
  const boundaries: BoundaryBox[] = boundaryRuns
    .map((r) => ({ id: r.id, ownerId: r.owner.id, members: shownIn(r.owner, r.lo, r.hi), label: r.label, color: r.color ?? byId.get(r.owner.children[r.lo].id)?.color ?? mono }))
    .filter((x) => x.members.length);
  const brackets: BracketBox[] = [...bracketOut.values()].map(({ owner, lo, hi, ...rest }) => ({ ...rest, members: shownIn(owner, lo, hi) }));
  const minY = nodes.reduce((m, b) => Math.min(m, b.y - b.h / 2), 0);
  return { nodes, root: byId.get(root.id)!, minY, flowEdges, boundaries, brackets };
}

/** Rough measurer for tests and non-browser contexts. */
export const approxMeasure: Measure = (text, font) => {
  const size = Number(/(\d+)px/.exec(font)?.[1] ?? 14);
  return text.length * size * 0.56;
};

// ---------- connectors ----------


/** Where a connector leaves the parent and reaches the child. */
export function edgePoints(p: NodeBox, c: NodeBox): { from: Point; to: Point } {
  switch (p.flow) {
    case 'down':
      return { from: { x: p.x, y: p.y + p.h / 2 }, to: { x: c.x, y: c.y - c.h / 2 } };
    case 'tree':
      return { from: { x: p.x - p.w / 2 + TREE_INDENT / 2, y: p.y + p.h / 2 }, to: { x: c.x - c.w / 2, y: c.y } };
    case 'treeUp':
      return { from: { x: p.x - p.w / 2 + TREE_INDENT / 2, y: p.y - p.h / 2 }, to: { x: c.x - c.w / 2, y: c.y } };
    case 'timeline':
      return { from: { x: p.x + p.w / 2, y: p.y }, to: { x: c.x - c.w / 2, y: c.y } };
    case 'fishbone': {
      const top = c.y < p.y;
      const to = { x: c.x + c.w / 2, y: top ? c.y + c.h / 2 : c.y - c.h / 2 };
      return { from: { x: to.x + Math.abs(p.y - to.y) * FISH_SLANT, y: p.y }, to };
    }
  }
  const dir = c.side || 1;
  const underlineP = p.depth >= 2 && p.shape === 'underline';
  const underlineC = c.shape === 'underline';
  const from = { x: p.x + (dir * p.w) / 2, y: underlineP ? p.y + p.h / 2 : p.y };
  const to = { x: c.x - (dir * c.w) / 2, y: underlineC ? c.y + c.h / 2 : c.y };
  return { from, to };
}

/** Corner radius of elbow connectors. */
const ELBOW_R = 10;

/** Connector path; `vertical` for children placed below their parent. */
export function edgePath(vertical: boolean, style: 'curve' | 'elbow' | 'straight', a: Point, b: Point): string {
  if (style === 'straight') return `M${a.x} ${a.y}L${b.x} ${b.y}`;
  if (vertical) {
    const my = (a.y + b.y) / 2;
    if (style === 'elbow') {
      const dx = b.x - a.x, sy = Math.sign(b.y - a.y) || 1, sx = Math.sign(dx);
      const r = Math.min(ELBOW_R, Math.abs(dx) / 2, Math.abs(my - a.y));
      if (r < 0.5) return `M${a.x} ${a.y}V${my}H${b.x}V${b.y}`;
      return `M${a.x} ${a.y}V${my - sy * r}Q${a.x} ${my} ${a.x + sx * r} ${my}H${b.x - sx * r}Q${b.x} ${my} ${b.x} ${my + sy * r}V${b.y}`;
    }
    return `M${a.x} ${a.y}C${a.x} ${my} ${b.x} ${my} ${b.x} ${b.y}`;
  }
  const mx = (a.x + b.x) / 2;
  if (style === 'elbow') {
    // Rounded corners, never wider than half of either leg.
    const dy = b.y - a.y, sx = Math.sign(b.x - a.x) || 1, sy = Math.sign(dy);
    const r = Math.min(ELBOW_R, Math.abs(dy) / 2, Math.abs(mx - a.x));
    if (r < 0.5) return `M${a.x} ${a.y}H${mx}V${b.y}H${b.x}`;
    return `M${a.x} ${a.y}H${mx - sx * r}Q${mx} ${a.y} ${mx} ${a.y + sy * r}V${b.y - sy * r}Q${mx} ${b.y} ${mx + sx * r} ${b.y}H${b.x}`;
  }
  return `M${a.x} ${a.y}C${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}`;
}

/**
 * The connector from parent `p` to child `c` (empty for matrix cells), and
 * the point where words on it (Topic.linkLabel) go.
 */
export function edgeShape(p: NodeBox, c: NodeBox, style: 'curve' | 'elbow' | 'straight'): { d: string; mid: Point } {
  if (c.noEdge) return { d: '', mid: { x: c.x, y: c.y } };
  const { from, to } = edgePoints(p, c);
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  switch (p.flow) {
    case 'tree':
    case 'treeUp':
      return { d: `M${from.x} ${from.y}V${to.y}H${to.x}`, mid };
    case 'timeline':
      return { d: `M${from.x} ${from.y}H${to.x}`, mid };
    case 'fishbone':
      // The spine from the head to this bone, then the bone itself.
      return { d: `M${p.x - p.w / 2} ${p.y}H${from.x}L${to.x} ${to.y}`, mid: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } };
  }
  const st = p.layout === 'concept' && p.flow === 'down' ? 'straight' : style;
  return { d: edgePath(p.flow === 'down', st, from, to), mid };
}

/** Point where the ray from the box centre towards `to` leaves the box. */
function borderPoint(b: NodeBox, to: Point): Point {
  const dx = to.x - b.x, dy = to.y - b.y;
  if (!dx && !dy) return { x: b.x, y: b.y };
  const sx = dx ? b.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy ? b.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: b.x + dx * s, y: b.y + dy * s };
}

/** A gently bowed curve between two topics, for relation arrows. */
export function relationPath(a: NodeBox, b: NodeBox): { d: string; mid: Point } {
  const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / dist, ny = (b.x - a.x) / dist;
  const bow = Math.min(120, dist * 0.25);
  const c1 = { x: a.x + (b.x - a.x) * 0.3 + nx * bow, y: a.y + (b.y - a.y) * 0.3 + ny * bow };
  const c2 = { x: a.x + (b.x - a.x) * 0.7 + nx * bow, y: a.y + (b.y - a.y) * 0.7 + ny * bow };
  const p1 = borderPoint(a, c1);
  const p2 = borderPoint(b, c2);
  const e1 = { x: p1.x + nx * 4, y: p1.y + ny * 4 }; // tiny offset keeps the start off the edge line
  const mid = {
    x: 0.125 * e1.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * p2.x,
    y: 0.125 * e1.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * p2.y,
  };
  return { d: `M${e1.x} ${e1.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`, mid };
}

// ---------- flow chart arrows ----------

/**
 * The arrow of a flow chart edge as drawn from the current boxes (which may
 * be mid-animation): its path, the point for words on it, and its head.
 */
export function flowEdgeShape(fe: FlowEdge, byId: Map<string, NodeBox>): { d: string; mid: Point; head: string } | undefined {
  const a = byId.get(fe.from), b = byId.get(fe.to), o = byId.get(fe.owner);
  if (!a || !b || !o) return undefined;
  const pts = routePoints({ x: a.x + a.w / 2, y: a.y }, { x: b.x - b.w / 2, y: b.y }, fe.route, o.x, o.y);
  // Words go on the first stretch after the path turns, near where it starts.
  let mid = { x: (pts[0].x + pts[pts.length - 1].x) / 2, y: (pts[0].y + pts[pts.length - 1].y) / 2 };
  for (let i = 1; i + 1 < pts.length; i++) {
    const p = pts[i], q = pts[i + 1];
    if (i >= 2 && Math.abs(p.y - q.y) < 0.01) {
      mid = { x: (p.x + q.x) / 2, y: p.y };
      break;
    }
  }
  if (pts.length === 2) mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  const end = pts[pts.length - 1], prev = pts[pts.length - 2];
  const len = Math.hypot(end.x - prev.x, end.y - prev.y) || 1;
  const ux = (end.x - prev.x) / len, uy = (end.y - prev.y) / len;
  const L = 8, W = 4.5;
  const bx = end.x - ux * L, by = end.y - uy * L;
  const head = `M${end.x} ${end.y}L${bx - uy * W} ${by + ux * W}L${bx + uy * W} ${by - ux * W}Z`;
  // The line stops at the base of the head so the tip stays sharp.
  const line = [...pts.slice(0, -1), { x: bx, y: by }];
  return { d: roundedPath(line), mid, head };
}
