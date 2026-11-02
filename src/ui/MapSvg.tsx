// Pure rendering of a laid-out map. Used both by the live canvas and by the
// SVG/PNG exporters, so what you export is exactly what you see.

import { edgePath, edgePoints, relationPath, type MapLayout, type NodeBox } from '../core/layout';
import { FLAG_COLORS, MARKER_GAP, MARKER_SIZE, PRIORITY_COLORS } from '../core/markers';
import type { MindMap } from '../core/model';
import { tint, type Theme } from '../core/themes';

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

function NoteGlyph({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.75}>
      <path d={`M${x + 4} ${y + 2}h7l4 4v11H${x + 4}z`} />
      <path d={`M${x + 7} ${y + 10}h5M${x + 7} ${y + 13}h5`} />
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
  const firstBaseline = (b.h - textBlockH) / 2 + b.lineHeight / 2 + b.fontSize * 0.35;
  const iconY = (b.h - MARKER_SIZE) / 2;
  const weight = /(\d{3})/.exec(b.font)?.[1] ?? '400';

  return (
    <g transform={`translate(${b.x - b.w / 2} ${b.y - b.h / 2})`} opacity={dimmed ? 0.35 : 1} data-topic-id={b.id}>
      {selected && (
        <rect x={-4} y={-4} width={b.w + 8} height={b.h + 8} rx={rx + 3} fill="none" stroke={SELECT_COLOR} strokeWidth={2} />
      )}
      <rect width={b.w} height={b.h} rx={rx} fill={fill} stroke={stroke} strokeWidth={stroke === 'none' ? 0 : strokeW} />
      {b.shape === 'underline' && <path d={`M0 ${b.h}H${b.w}`} stroke={b.color} strokeWidth={1.5} strokeLinecap="round" />}
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
      {b.topic.note && <NoteGlyph x={b.w - b.padX - MARKER_SIZE} y={iconY} color={text} />}
    </g>
  );
}

export function CollapseBadge({ b, theme }: { b: NodeBox; theme: Theme }) {
  const layoutKind = b.layout;
  if (!b.hidden) return null;
  const cx = layoutKind === 'org' ? b.x : b.x + (b.side || 1) * (b.w / 2 + 12);
  const cy = layoutKind === 'org' ? b.y + b.h / 2 + 12 : b.shape === 'underline' ? b.y + b.h / 2 : b.y;
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

export function MapSvg({ map, layout, theme, selectedId, selectedRelId, dimIds }: { map: MindMap; layout: MapLayout; theme: Theme; selectedId?: string; selectedRelId?: string; dimIds?: Set<string> }) {
  return (
    <g>
      <g fill="none" strokeLinecap="round">
        {layout.nodes.map((c) => {
          if (!c.parentId) return null;
          const p = layout.byId.get(c.parentId)!;
          const { from, to } = edgePoints(p, c);
          return (
            <path
              key={c.id}
              d={edgePath(c.layout, map.branchStyle, from, to)}
              stroke={c.color}
              strokeWidth={c.depth === 1 ? 2.5 : 1.5}
              opacity={dimIds?.has(c.id) ? 0.35 : 1}
            />
          );
        })}
      </g>
      {layout.nodes.map((b) => (
        <TopicView key={b.id} b={b} theme={theme} selected={b.id === selectedId} dimmed={dimIds?.has(b.id)} />
      ))}
      {layout.nodes.map((b) => (
        <CollapseBadge key={`c-${b.id}`} b={b} theme={theme} />
      ))}
      <Relations map={map} layout={layout} theme={theme} selectedRelId={selectedRelId} />
    </g>
  );
}
