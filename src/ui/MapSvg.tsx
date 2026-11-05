// Pure rendering of a laid-out map. Used both by the live canvas and by the
// SVG/PNG exporters, so what you export is exactly what you see.

import { NOTE_GAP, edgeShape, relationPath, type MapLayout, type NodeBox } from '../core/layout';
import { FLAG_COLORS, MARKER_GAP, MARKER_SIZE, PRIORITY_COLORS } from '../core/markers';
import type { MindMap } from '../core/model';
import { tint, type Theme } from '../core/themes';
import { visibleIn, type Rect } from '../core/viewport';

export const SELECT_COLOR = '#4C5FD5';
const FONT = "'Plus Jakarta Sans', system-ui, sans-serif";

function isDark(hex: string): boolean {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return false;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

export function nodeColors(b: NodeBox, theme: Theme) {
  const s = b.topic.style ?? {};
  let fill: string;
  if (b.depth === 0) fill = s.fill ?? theme.centralFill;
  else if (b.shape === 'underline' || b.shape === 'none') fill = s.fill ?? 'transparent';
  else if (b.depth === 1) fill = s.fill ?? tint(b.color, theme.dark);
  else fill = s.fill ?? (theme.dark ? '#1C222A' : '#FFFFFF');
  const text = s.textColor ?? (fill === 'transparent' ? theme.text : isDark(fill) ? '#FFFFFF' : '#1D232B');
  return { fill, text };
}

export function MarkerGlyph({ id, x, y }: { id: string; x: number; y: number }) {
  const [group, value] = id.split('-');
  const r = MARKER_SIZE / 2;
  const cx = x + r, cy = y + r;
  if (group === 'priority') {
    const n = Number(value);
    return (
      <g>
        <circle cx={cx} cy={cy} r={r} fill={PRIORITY_COLORS[n - 1] ?? '#888'} />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff" fontFamily={FONT}>{n}</text>
      </g>
    );
  }
  if (group === 'task') {
    const p = Number(value) / 100;
    const a = p * 2 * Math.PI;
    const ex = cx + (r - 2) * Math.sin(a), ey = cy - (r - 2) * Math.cos(a);
    return (
      <g>
        <circle cx={cx} cy={cy} r={r - 1} fill="#fff" stroke="#2B8A3E" strokeWidth={1.5} />
        {p >= 1 ? (
          <>
            <circle cx={cx} cy={cy} r={r - 1} fill="#2B8A3E" />
            <path d={`M${cx - 4} ${cy}l3 3 5-6`} stroke="#fff" strokeWidth={1.8} fill="none" strokeLinecap="round" />
          </>
        ) : p > 0 ? (
          <path d={`M${cx} ${cy}V${cy - r + 2}A${r - 2} ${r - 2} 0 ${p > 0.5 ? 1 : 0} 1 ${ex} ${ey}Z`} fill="#2B8A3E" />
        ) : null}
      </g>
    );
  }
  if (group === 'flag') {
    return <path d={`M${x + 4} ${y + 17}V${y + 2}h10l-2.5 4 2.5 4H${x + 4}`} fill={FLAG_COLORS[value] ?? '#888'} stroke={FLAG_COLORS[value] ?? '#888'} strokeWidth={1.4} strokeLinejoin="round" />;
  }
  if (value === 'star') {
    const pts = Array.from({ length: 10 }, (_, i) => {
      const rr = i % 2 ? r * 0.45 : r;
      const ang = (Math.PI / 5) * i - Math.PI / 2;
      return `${cx + rr * Math.cos(ang)},${cy + rr * Math.sin(ang)}`;
    }).join(' ');
    return <polygon points={pts} fill="#F59F00" />;
  }
  if (value === 'question') {
    return (
      <g>
        <circle cx={cx} cy={cy} r={r} fill="#1971C2" />
        <text x={cx} y={cy + 4.5} textAnchor="middle" fontSize={12} fontWeight={700} fill="#fff" fontFamily={FONT}>?</text>
      </g>
    );
  }
  // idea: a small bulb
  return (
    <g fill="none" stroke="#E67700" strokeWidth={1.6} strokeLinecap="round">
      <path d={`M${cx - 3} ${cy + 4}c0-2-4-3-4-7a7 7 0 0 1 14 0c0 4-4 5-4 7z`} fill="#FFE8A3" />
      <path d={`M${cx - 2.5} ${cy + 7}h5`} />
    </g>
  );
}

function NoteGlyph({ x, y, color, note }: { x: number; y: number; color: string; note: string }) {
  return (
    <g fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.75} data-note-glyph="" style={{ cursor: 'pointer' }}>
      <title>{note.length > 400 ? `${note.slice(0, 400)}…` : note}</title>
      {/* Invisible hit area: the outline alone is a small target. */}
      <rect x={x} y={y} width={MARKER_SIZE} height={MARKER_SIZE} fill="transparent" stroke="none" />
      <path d={`M${x + 4} ${y + 2}h7l4 4v11H${x + 4}z`} />
      <path d={`M${x + 7} ${y + 10}h5M${x + 7} ${y + 13}h5`} />
    </g>
  );
}

function LinkGlyph({ x, y, color, internal }: { x: number; y: number; color: string; internal: boolean }) {
  return (
    <g fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" opacity={0.8} data-link-glyph="">
      {internal ? (
        <>
          <rect x={x + 2} y={y + 5} width={9} height={9} rx={2} />
          <path d={`M${x + 8} ${y + 2}h7v7M${x + 15} ${y + 2}l-6 6`} />
        </>
      ) : (
        <path d={`M${x + 8} ${y + 11}l3-3a3 3 0 0 0-4-4l-1.5 1.5M${x + 10} ${y + 7}l-3 3a3 3 0 0 0 4 4l1.5-1.5M${x + 7} ${y + 12}l4-4`} />
      )}
    </g>
  );
}

export function TopicView({ b, theme, selected, dimmed }: { b: NodeBox; theme: Theme; selected?: boolean; dimmed?: boolean }) {
  const { fill, text } = nodeColors(b, theme);
  const s = b.topic.style ?? {};
  const markers = b.topic.markers ?? [];
  const rx = b.shape === 'pill' ? b.h / 2 : b.shape === 'rect' ? 3 : b.depth === 0 ? 14 : b.depth === 1 ? 10 : 7;
  const stroke = b.depth === 0 || b.shape === 'underline' || b.shape === 'none' ? 'none' : b.color;
  const strokeW = b.depth === 1 ? 2 : 1.25;
  const textX = b.padX + markers.length * (MARKER_SIZE + MARKER_GAP);
  const textBlockH = b.lines.length * b.lineHeight;
  // Text and icons sit below the picture (if any) and above a shown note.
  const nb = b.noteBlock;
  const bodyH = b.h - b.imageH - (nb?.h ?? 0);
  const firstBaseline = b.imageH + (bodyH - textBlockH) / 2 + b.lineHeight / 2 + b.fontSize * 0.35;
  const iconY = b.imageH + (bodyH - MARKER_SIZE) / 2;
  const imgPad = b.image ? Math.min(b.padX, 8) : 0;
  const weight = /(\d{3})/.exec(b.font)?.[1] ?? '400';

  return (
    <g transform={`translate(${b.x - b.w / 2} ${b.y - b.h / 2})`} opacity={dimmed ? 0.35 : 1} data-topic-id={b.id}>
      {selected && (
        <rect x={-4} y={-4} width={b.w + 8} height={b.h + 8} rx={rx + 3} fill="none" stroke={SELECT_COLOR} strokeWidth={2} />
      )}
      <rect width={b.w} height={b.h} rx={rx} fill={fill} stroke={stroke} strokeWidth={stroke === 'none' ? 0 : strokeW} />
      {b.shape === 'underline' && <path d={`M0 ${b.h}H${b.w}`} stroke={b.color} strokeWidth={1.5} strokeLinecap="round" />}
      {b.image && (
        <image href={b.image.href} x={(b.w - b.image.w) / 2} y={imgPad} width={b.image.w} height={b.image.h - imgPad} preserveAspectRatio="xMidYMid meet" />
      )}
      {markers.map((m, i) => (
        <MarkerGlyph key={m} id={m} x={b.padX + i * (MARKER_SIZE + MARKER_GAP)} y={iconY} />
      ))}
      <text
        x={textX}
        y={firstBaseline}
        fontFamily="'Plus Jakarta Sans', system-ui, sans-serif"
        fontSize={b.fontSize}
        fontWeight={weight}
        fontStyle={s.italic ? 'italic' : undefined}
        fill={text}
      >
        {b.lines.map((line, i) => (
          <tspan key={i} x={textX} dy={i === 0 ? 0 : b.lineHeight}>
            {line || ' '}
          </tspan>
        ))}
      </text>
      {nb && (
        <g>
          <path d={`M${b.padX} ${b.h - nb.h}H${b.w - b.padX}`} stroke={text} strokeOpacity={0.18} strokeWidth={1} />
          <text x={b.padX} y={b.h - nb.h + NOTE_GAP + nb.lineHeight / 2 + nb.fontSize * 0.35} fontFamily={FONT} fontSize={nb.fontSize} fill={text} fillOpacity={0.78} data-note-text="">
            {nb.lines.map((line, i) => (
              <tspan key={i} x={b.padX} dy={i === 0 ? 0 : nb.lineHeight}>
                {line || ' '}
              </tspan>
            ))}
          </text>
        </g>
      )}
      {b.topic.note && <NoteGlyph x={b.w - b.padX - MARKER_SIZE} y={iconY} color={text} note={b.topic.note} />}
      {b.topic.href && (
        <LinkGlyph
          x={b.w - b.padX - MARKER_SIZE * (b.topic.note ? 2 : 1) - (b.topic.note ? MARKER_GAP : 0)}
          y={iconY}
          color={text}
          internal={b.topic.href.startsWith('keizu:')}
        />
      )}
    </g>
  );
}

export function CollapseBadge({ b, theme }: { b: NodeBox; theme: Theme }) {
  if (!b.hidden) return null;
  const down = b.flow === 'down';
  const tree = b.flow === 'tree' || b.flow === 'treeUp' || b.flow === 'matrixCol';
  const cx = down ? b.x : tree ? b.x - b.w / 2 + 12 : b.x + (b.flow === 'left' ? -1 : 1) * (b.w / 2 + 12);
  const cy = down || (tree && b.flow !== 'treeUp') ? b.y + b.h / 2 + 12 : b.flow === 'treeUp' ? b.y - b.h / 2 - 12 : b.shape === 'underline' ? b.y + b.h / 2 : b.y;
  const label = b.hidden > 99 ? '99+' : String(b.hidden);
  return (
    <g data-collapse-id={b.id} style={{ cursor: 'pointer' }}>
      <circle cx={cx} cy={cy} r={10} fill={theme.dark ? '#1C222A' : '#FFFFFF'} stroke={b.color} strokeWidth={1.5} />
      <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize={label.length > 2 ? 8 : 10} fontWeight={700} fill={b.color} fontFamily="'Plus Jakarta Sans', system-ui, sans-serif">
        {label}
      </text>
    </g>
  );
}

function Relations({ map, layout, theme, selectedRelId }: { map: MindMap; layout: MapLayout; theme: Theme; selectedRelId?: string }) {
  const base = theme.dark ? '#9AA1AB' : '#6B7480';
  return (
    <g>
      <defs>
        <marker id="kz-rel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill={base} />
        </marker>
        <marker id="kz-rel-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill={SELECT_COLOR} />
        </marker>
      </defs>
      {map.relations.map((r) => {
        const a = layout.byId.get(r.from), b = layout.byId.get(r.to);
        if (!a || !b) return null; // hidden inside a collapsed branch
        const { d, mid } = relationPath(a, b);
        const on = r.id === selectedRelId;
        const color = on ? SELECT_COLOR : base;
        const labelW = r.label ? r.label.length * 6.4 + 16 : 0;
        return (
          <g key={r.id} data-relation-id={r.id} style={{ cursor: 'pointer' }}>
            <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
            <path d={d} fill="none" stroke={color} strokeWidth={on ? 2 : 1.5} strokeDasharray="6 4" markerEnd={`url(#${on ? 'kz-rel-on' : 'kz-rel'})`} />
            {r.label && (
              <g>
                <rect x={mid.x - labelW / 2} y={mid.y - 11} width={labelW} height={22} rx={6} fill={theme.dark ? '#1C222A' : '#FFFFFF'} stroke={on ? SELECT_COLOR : theme.grid} />
                <text x={mid.x} y={mid.y + 4} textAnchor="middle" fontSize={11} fill={theme.text} fontFamily="'Plus Jakarta Sans', system-ui, sans-serif">
                  {r.label}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** Words on connectors (Topic.linkLabel), as in concept maps. */
function LinkLabels({ map, layout, edges, theme }: { map: MindMap; layout: MapLayout; edges: NodeBox[]; theme: Theme }) {
  const labelled = edges.filter((c) => c.topic.linkLabel && !c.noEdge);
  if (!labelled.length) return null;
  return (
    <g>
      {labelled.map((c) => {
        const p = layout.byId.get(c.parentId!)!;
        const { mid } = edgeShape(p, c, map.branchStyle);
        const label = c.topic.linkLabel!;
        const w = label.length * 6.4 + 12;
        return (
          <g key={`l-${c.id}`}>
            <rect x={mid.x - w / 2} y={mid.y - 10} width={w} height={20} rx={5} fill={theme.canvas} opacity={0.92} />
            <text x={mid.x} y={mid.y + 4} textAnchor="middle" fontSize={11} fontStyle="italic" fill={c.color} fontFamily={FONT}>
              {label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

interface MapSvgProps {
  map: MindMap;
  layout: MapLayout;
  theme: Theme;
  selectedId?: string;
  selectedRelId?: string;
  dimIds?: Set<string>;
  /** Draw only what touches this map-space rectangle. */
  viewport?: Rect;
  /** Zoomed far out on a big map: plain shapes, no text, few DOM nodes. */
  simple?: boolean;
}

export function MapSvg({ map, layout, theme, selectedId, selectedRelId, dimIds, viewport, simple }: MapSvgProps) {
  const vis = visibleIn(layout, viewport);
  if (simple) return <SimpleMap map={map} layout={layout} theme={theme} nodes={vis.nodes} edges={vis.edges} selectedId={selectedId} />;
  return (
    <g>
      <g fill="none" strokeLinecap="round">
        {vis.edges.map((c) => {
          if (c.noEdge) return null;
          const p = layout.byId.get(c.parentId!)!;
          const { d } = edgeShape(p, c, map.branchStyle);
          return <path key={c.id} d={d} stroke={c.color} strokeWidth={c.depth === 1 || p.flow === 'fishbone' ? 2.5 : 1.5} opacity={dimIds?.has(c.id) ? 0.35 : 1} />;
        })}
      </g>
      <LinkLabels map={map} layout={layout} edges={vis.edges} theme={theme} />
      {vis.nodes.map((b) => (
        <TopicView key={b.id} b={b} theme={theme} selected={b.id === selectedId} dimmed={dimIds?.has(b.id)} />
      ))}
      {vis.nodes.map((b) => (
        <CollapseBadge key={`c-${b.id}`} b={b} theme={theme} />
      ))}
      <Relations map={map} layout={layout} theme={theme} selectedRelId={selectedRelId} />
    </g>
  );
}

/**
 * Level-of-detail rendering: every connector of one colour is a single path
 * and every topic of one fill is a single path, so even 10,000 topics are a
 * handful of DOM nodes. Text is unreadable at this zoom anyway.
 */
function SimpleMap({ map, layout, theme, nodes, edges, selectedId }: { map: MindMap; layout: MapLayout; theme: Theme; nodes: NodeBox[]; edges: NodeBox[]; selectedId?: string }) {
  const edgeD = new Map<string, string[]>();
  for (const c of edges) {
    if (c.noEdge) continue;
    const p = layout.byId.get(c.parentId!)!;
    const list = edgeD.get(c.color) ?? [];
    list.push(edgeShape(p, c, map.branchStyle).d);
    edgeD.set(c.color, list);
  }
  const fillD = new Map<string, string[]>();
  for (const b of nodes) {
    const { fill } = nodeColors(b, theme);
    // Shapeless topics get a faint bar so the structure stays visible.
    const color = fill === 'transparent' ? b.color : fill;
    const h = fill === 'transparent' ? Math.max(4, b.h * 0.3) : b.h;
    const list = fillD.get(color) ?? [];
    list.push(`M${b.x - b.w / 2} ${b.y + b.h / 2 - h}h${b.w}v${h}h${-b.w}z`);
    fillD.set(color, list);
  }
  const sel = selectedId ? layout.byId.get(selectedId) : undefined;
  return (
    <g>
      <g fill="none" strokeWidth={2}>
        {[...edgeD].map(([color, ds]) => <path key={color} d={ds.join('')} stroke={color} />)}
      </g>
      {[...fillD].map(([color, ds]) => <path key={color} d={ds.join('')} fill={color} opacity={0.85} />)}
      {sel && <rect x={sel.x - sel.w / 2 - 6} y={sel.y - sel.h / 2 - 6} width={sel.w + 12} height={sel.h + 12} rx={8} fill="none" stroke={SELECT_COLOR} strokeWidth={4} />}
    </g>
  );
}
