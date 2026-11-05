// Pure rendering of a laid-out map. Used both by the live canvas and by the
// SVG/PNG exporters, so what you export is exactly what you see.

import { BOUNDARY_LABEL_H, BOUNDARY_PAD, BRACKET_GAP, BRACKET_W, META_BAR_W, META_CHIP_H, META_FONT, META_ICON_W, NOTE_GAP, edgeShape, flowEdgeShape, relationPath, type MapLayout, type NodeBox, type NoteBlock } from '../core/layout';
import { notePlainText } from '../core/richText';
import { FLAG_COLORS, MARKER_GAP, MARKER_SIZE, PRIORITY_COLORS } from '../core/markers';
import type { MindMap } from '../core/model';
import { isOverdue, tagColor, today } from '../core/tasks';
import { deepen, tint, type Theme } from '../core/themes';
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
  else if (theme.signature) {
    // Main topics in their branch colour, deeper ones in a light tint of it.
    if (b.depth === 1) fill = s.fill ?? b.color;
    else fill = s.fill ?? tint(b.color, theme.dark, theme.dark ? 0.2 : 0.12);
    const auto = b.depth >= 2 && !s.fill ? deepen(b.color, theme.dark) : isDark(fill) ? '#FFFFFF' : '#14181E';
    return { fill, text: s.textColor ?? (fill === 'transparent' ? theme.text : auto) };
  } else if (b.depth === 1) fill = s.fill ?? tint(b.color, theme.dark);
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

const DONE_COLOR = '#2B8A3E';
const LATE_COLOR = '#E03131';

/** A task's checkbox, left of its text. Clicking it checks the task. */
export function TaskCheck({ x, y, done, color }: { x: number; y: number; done: boolean; color: string }) {
  const s = MARKER_SIZE - 2;
  return (
    <g data-task-check="" style={{ cursor: 'pointer' }}>
      <rect x={x + 1} y={y + 1} width={s} height={s} rx={4} fill={done ? DONE_COLOR : 'transparent'} stroke={done ? DONE_COLOR : color} strokeOpacity={done ? 1 : 0.7} strokeWidth={1.6} />
      {done && <path d={`M${x + 5} ${y + 9.5}l3 3 5.5-6.5`} stroke="#fff" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
    </g>
  );
}

/** The row of progress, date, person and tag chips under a topic's text. */
function MetaChips({ b, x, y, text, dark }: { b: NodeBox; x: number; y: number; text: string; /** The chips sit on a dark fill. */ dark: boolean }) {
  const meta = b.meta!;
  const late = isOverdue(b.topic, today());
  const h = META_CHIP_H;
  return (
    <g data-meta-row="" fontFamily={FONT}>
      {meta.chips.map((c, i) => {
        const cx = x + c.x;
        const ty = y + h / 2 + 3.6;
        if (c.kind === 'tag') {
          const col = tagColor(c.tag!);
          return (
            <g key={i} data-tag={c.tag} style={{ cursor: 'pointer' }}>
              <rect x={cx} y={y} width={c.w} height={h} rx={h / 2} fill={dark ? '#FFFFFF' : col} fillOpacity={dark ? 0.9 : 0.13} />
              <text x={cx + 6} y={ty} style={{ font: META_FONT }} fill={col}>{c.label}</text>
            </g>
          );
        }
        if (c.kind === 'progress') {
          const full = c.ratio! >= 1;
          const col = full && !dark ? DONE_COLOR : text;
          return (
            <g key={i} data-progress="">
              <rect x={cx} y={y} width={c.w} height={h} rx={h / 2} fill={col} fillOpacity={0.1} />
              <rect x={cx + 6} y={y + h / 2 - 2} width={META_BAR_W} height={4} rx={2} fill={col} fillOpacity={0.22} />
              <rect x={cx + 6} y={y + h / 2 - 2} width={Math.max(c.ratio! > 0 ? 3 : 0, META_BAR_W * c.ratio!)} height={4} rx={2} fill={full && !dark ? DONE_COLOR : text} />
              <text x={cx + 6 + META_BAR_W + 4} y={ty} style={{ font: META_FONT }} fill={col} fillOpacity={full ? 1 : 0.85}>{c.label}</text>
            </g>
          );
        }
        const col = c.kind === 'due' && late ? LATE_COLOR : text;
        const ix = cx + 5, iy = y + h / 2;
        return (
          <g key={i} data-chip={c.kind}>
            <rect x={cx} y={y} width={c.w} height={h} rx={h / 2} fill={col} fillOpacity={c.kind === 'due' && late ? 0.14 : 0.08} />
            <g fill="none" stroke={col} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" opacity={0.85}>
              {c.kind === 'due' ? (
                <>
                  <rect x={ix} y={iy - 4} width={9} height={8.5} rx={1.5} />
                  <path d={`M${ix} ${iy - 1}h9M${ix + 2.5} ${iy - 5.5}v2M${ix + 6.5} ${iy - 5.5}v2`} />
                </>
              ) : (
                <>
                  <circle cx={ix + 4.5} cy={iy - 2} r={2.3} />
                  <path d={`M${ix} ${iy + 4.8}c.6-2.6 2.3-3.8 4.5-3.8s3.9 1.2 4.5 3.8`} />
                </>
              )}
            </g>
            <text x={cx + 6 + META_ICON_W - 1} y={ty} style={{ font: META_FONT }} fill={col}>{c.label}</text>
          </g>
        );
      })}
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

/** A note drawn inside its topic: rich text laid out by layoutNote. */
function RichNoteSvg({ nb, x, y, w, color, bg }: { nb: NoteBlock; x: number; y: number; w: number; color: string; bg: string }) {
  return (
    <g transform={`translate(${x} ${y})`} fill={color} data-note-text="">
      {nb.lines.map((l, i) => {
        const dx = l.decoX ?? 0;
        const m = l.mark;
        const box = Math.round(l.fontSize * 0.85);
        return (
          <g key={i} fillOpacity={l.faint ? 0.55 : 0.8}>
            {l.deco === 'code' && <rect x={dx} y={l.top} width={w - dx} height={l.h} fill={color} fillOpacity={0.07} />}
            {l.deco === 'quote' && <rect x={dx} y={l.top + 1} width={2.5} height={l.h - 2} rx={1} fill={color} fillOpacity={0.35} />}
            {l.deco === 'rule' && <path d={`M0 ${l.top + l.h / 2}H${w}`} stroke={color} strokeOpacity={0.25} strokeWidth={1} />}
            {m?.kind === 'bullet' && <circle cx={m.x + l.fontSize * 0.4} cy={l.baseline - l.fontSize * 0.32} r={Math.max(1.6, l.fontSize * 0.14)} />}
            {m?.kind === 'number' && (
              <text x={m.x} y={l.baseline} fontFamily={FONT} fontSize={l.fontSize}>
                {m.text}
              </text>
            )}
            {m?.kind === 'check' && (
              <g data-note-check={m.line} style={{ cursor: 'pointer' }}>
                <rect x={m.x} y={l.baseline - l.fontSize * 0.35 - box / 2 - 0.5} width={box} height={box} rx={2.5} fill={m.checked ? color : 'transparent'} fillOpacity={m.checked ? 0.7 : 1} stroke={color} strokeOpacity={0.6} strokeWidth={1.2} />
                {m.checked && (
                  <path
                    d={`M${m.x + box * 0.22} ${l.baseline - l.fontSize * 0.35}l${box * 0.2} ${box * 0.22}l${box * 0.38} ${-box * 0.42}`}
                    transform={`translate(0 ${-0.5})`}
                    fill="none"
                    stroke={bg}
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </g>
            )}
            {l.runs.map((r, k) =>
              r.code ? (
                <rect key={`c${k}`} x={r.x - 2} y={l.baseline - l.fontSize * 0.95} width={r.w + 4} height={l.fontSize * 1.25} rx={3} fill={color} fillOpacity={l.deco === 'code' ? 0 : 0.09} />
              ) : null,
            )}
            {l.runs.length > 0 && (
              <text y={l.baseline} xmlSpace="preserve">
                {l.runs.map((r, k) => {
                  const deco = [r.href ? 'underline' : '', r.s || (m?.checked ?? false) ? 'line-through' : ''].filter(Boolean).join(' ');
                  return (
                    <tspan
                      key={k}
                      x={r.x}
                      style={{ font: r.font }}
                      textDecoration={deco || undefined}
                      {...(r.href ? { 'data-note-href': r.href, cursor: 'pointer' } : {})}
                    >
                      {r.text}
                    </tspan>
                  );
                })}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

export function TopicView({ b, theme, selected, dimmed, opacity = 1 }: { b: NodeBox; theme: Theme; selected?: boolean; dimmed?: boolean; opacity?: number }) {
  const { fill, text } = nodeColors(b, theme);
  const s = b.topic.style ?? {};
  const markers = b.topic.markers ?? [];
  const sig = !!theme.signature;
  const rx = b.shape === 'pill' ? b.h / 2 : b.shape === 'rect' ? 3 : b.depth === 0 ? (sig ? 12 : 14) : b.depth === 1 ? (sig ? 9 : 10) : 7;
  // Signature topics are filled, so they need no outline unless the user set a fill of their own.
  const stroke = b.depth === 0 || b.shape === 'underline' || b.shape === 'none' || (sig && !s.fill) ? 'none' : b.color;
  const strokeW = b.depth === 1 ? 2 : 1.25;
  const lead = b.lead ?? 0;
  const task = b.topic.task;
  const leftIcons = markers.length + (task ? 1 : 0);
  const textX = b.padX + lead + leftIcons * (MARKER_SIZE + MARKER_GAP);
  const selColor = sig ? theme.text : SELECT_COLOR;
  const textBlockH = b.lines.length * b.lineHeight;
  // Text and icons sit below the picture (if any) and above a shown note.
  const nb = b.noteBlock;
  const meta = b.meta;
  const bodyH = b.h - b.imageH - (meta?.h ?? 0) - (nb?.h ?? 0);
  const firstBaseline = b.imageH + (bodyH - textBlockH) / 2 + b.lineHeight / 2 + b.fontSize * 0.35;
  const iconY = b.imageH + (bodyH - MARKER_SIZE) / 2;
  const imgPad = b.image ? Math.min(b.padX, 8) : 0;
  const weight = /(\d{3})/.exec(b.font)?.[1] ?? '400';

  return (
    <g transform={`translate(${b.x - b.w / 2} ${b.y - b.h / 2})`} opacity={(dimmed ? 0.35 : 1) * opacity} data-topic-id={b.id}>
      {selected && (
        <rect x={-4} y={-4} width={b.w + 8} height={b.h + 8} rx={rx + 3} fill="none" stroke={selColor} strokeWidth={sig ? 1.5 : 2} data-selection="" />
      )}
      {selected && sig && (
        <g fill={theme.canvas} stroke={selColor} strokeWidth={1.5}>
          <circle cx={-4} cy={b.h / 2} r={4} />
          <circle cx={b.w + 4} cy={b.h / 2} r={4} />
        </g>
      )}
      {!!b.topic.innerSize && (
        // A second box peeking out behind: "there is more inside".
        <rect x={4} y={4} width={b.w} height={b.h} rx={rx} fill={theme.canvas} stroke={b.color} strokeOpacity={0.55} strokeWidth={1.5} data-inner-edge="" />
      )}
      <rect width={b.w} height={b.h} rx={rx} fill={fill} stroke={stroke} strokeWidth={stroke === 'none' ? 0 : strokeW} />
      {sig && b.depth === 0 && theme.rootDot && <circle cx={b.w - 12} cy={b.h - 12} r={3.5} fill={theme.rootDot} data-root-dot="" />}
      {lead > 0 && (
        <circle cx={b.padX + 3.5} cy={b.imageH + bodyH / 2} r={b.depth === 1 ? 4 : 3} fill={b.depth === 1 && !s.fill ? text : b.color} data-lead-dot="" />
      )}
      {b.shape === 'underline' && <path d={`M0 ${b.h}H${b.w}`} stroke={b.color} strokeWidth={1.5} strokeLinecap="round" />}
      {b.image && (
        <image href={b.image.href} x={(b.w - b.image.w) / 2} y={imgPad} width={b.image.w} height={b.image.h - imgPad} preserveAspectRatio="xMidYMid meet" />
      )}
      {task && <TaskCheck x={b.padX + lead} y={iconY} done={task === 'done'} color={text} />}
      {markers.map((m, i) => (
        <MarkerGlyph key={m} id={m} x={b.padX + lead + (i + (task ? 1 : 0)) * (MARKER_SIZE + MARKER_GAP)} y={iconY} />
      ))}
      <text
        x={textX}
        y={firstBaseline}
        fontFamily="'Plus Jakarta Sans', system-ui, sans-serif"
        fontSize={b.fontSize}
        fontWeight={weight}
        fontStyle={s.italic ? 'italic' : undefined}
        fill={text}
        fillOpacity={task === 'done' ? 0.55 : undefined}
        textDecoration={task === 'done' ? 'line-through' : undefined}
      >
        {b.lines.map((line, i) => (
          <tspan key={i} x={textX} dy={i === 0 ? 0 : b.lineHeight}>
            {line || ' '}
          </tspan>
        ))}
      </text>
      {meta && <MetaChips b={b} x={b.padX + lead} y={b.imageH + (bodyH + Math.max(textBlockH, MARKER_SIZE)) / 2 + 3} text={text} dark={fill === 'transparent' ? !!theme.dark : isDark(fill)} />}
      {nb && (
        <g>
          <path d={`M${b.padX} ${b.h - nb.h}H${b.w - b.padX}`} stroke={text} strokeOpacity={0.18} strokeWidth={1} />
          <RichNoteSvg nb={nb} x={b.padX} y={b.h - nb.h + NOTE_GAP} w={b.w - b.padX * 2} color={text} bg={fill && fill !== 'none' && fill !== 'transparent' ? fill : theme.canvas} />
        </g>
      )}
      {b.topic.note && <NoteGlyph x={b.w - b.padX - MARKER_SIZE} y={iconY} color={text} note={notePlainText(b.topic.note)} />}
      {b.topic.href && (
        <LinkGlyph
          x={b.w - b.padX - MARKER_SIZE * (b.topic.note ? 2 : 1) - (b.topic.note ? MARKER_GAP : 0)}
          y={iconY}
          color={text}
          internal={b.topic.href.startsWith('keizu:')}
        />
      )}
      {!!b.topic.innerSize && <InnerBadge b={b} theme={theme} />}
    </g>
  );
}

/** Corner badge of a topic with an inner map: an icon and how many topics it holds. */
function InnerBadge({ b, theme }: { b: NodeBox; theme: Theme }) {
  const n = b.topic.innerSize ?? 0;
  const label = n > 999 ? '999+' : String(n);
  const w = 24 + label.length * 6.2;
  const x = b.w - w + 10, y = -10;
  return (
    <g transform={`translate(${x} ${y})`} data-inner-badge={b.id} style={{ cursor: 'zoom-in' }}>
      <rect width={w} height={20} rx={10} fill={theme.dark ? '#1C222A' : '#FFFFFF'} stroke={b.color} strokeWidth={1.5} />
      <g fill="none" stroke={b.color} strokeWidth={1.5}>
        <rect x={6} y={4.5} width={11} height={11} rx={3} />
        <rect x={9.5} y={8} width={4} height={4} rx={1} />
      </g>
      <text x={20} y={14} fontSize={10.5} fontWeight={700} fill={b.color} fontFamily={FONT}>
        {label}
      </text>
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
  const routed = new Set(layout.flowEdges.map((f) => f.relId).filter(Boolean));
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
        if (routed.has(r.id)) return null; // drawn as a flow chart arrow
        const a = layout.byId.get(r.from), b = layout.byId.get(r.to);
        if (!a || !b) return null; // hidden inside a collapsed branch
        const { d, mid } = relationPath(a, b);
        const on = r.id === selectedRelId;
        const color = on ? SELECT_COLOR : theme.signature ? b.color : base;
        const labelW = r.label ? r.label.length * 6.4 + 16 : 0;
        return (
          <g key={r.id} data-relation-id={r.id} style={{ cursor: 'pointer' }}>
            <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
            {theme.signature && !on && (
              <defs>
                <marker id={`kz-rel-${r.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0L10 5L0 10z" fill={color} />
                </marker>
              </defs>
            )}
            <path d={d} fill="none" stroke={color} strokeWidth={on ? 2 : 1.5} strokeDasharray="6 4" markerEnd={`url(#${on ? 'kz-rel-on' : theme.signature ? `kz-rel-${r.id}` : 'kz-rel'})`} />
            {r.label && (
              <g>
                <rect x={mid.x - labelW / 2} y={mid.y - 11} width={labelW} height={22} rx={theme.signature ? 11 : 6} fill={theme.dark ? '#1C222A' : '#FFFFFF'} stroke={on ? SELECT_COLOR : theme.signature ? color : theme.grid} />
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
  // Flow chart connectors carry their words themselves (FlowArrows).
  const labelled = edges.filter((c) => c.topic.linkLabel && !c.noEdge && c.flow !== 'flow');
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

/**
 * Flow chart arrows: tree connectors and flow links alike, with words on
 * them (the topic's linkLabel or the link's label). Flow links can be
 * selected like relations.
 */
function FlowArrows({ map, layout, theme, selectedRelId, dimIds, fade }: { map: MindMap; layout: MapLayout; theme: Theme; selectedRelId?: string; dimIds?: Set<string>; fade?: Map<string, number> }) {
  if (!layout.flowEdges.length) return null;
  const rels = new Map(map.relations.map((r) => [r.id, r]));
  return (
    <g data-flow-arrows="">
      {layout.flowEdges.map((fe) => {
        const shape = flowEdgeShape(fe, layout.byId);
        if (!shape) return null;
        const src = layout.byId.get(fe.from)!, dst = layout.byId.get(fe.to)!;
        const on = !!fe.relId && fe.relId === selectedRelId;
        // A tree connector takes the colour of the step it leads to; a link
        // keeps the colour of the path it comes from.
        const color = on ? SELECT_COLOR : fe.relId ? src.color : dst.color;
        const label = fe.relId ? rels.get(fe.relId)?.label : dst.topic.linkLabel;
        const opacity = (dimIds?.has(fe.to) || dimIds?.has(fe.from) ? 0.35 : 1) * Math.min(fade?.get(fe.to) ?? 1, fade?.get(fe.from) ?? 1);
        const labelW = label ? label.length * 6.4 + 14 : 0;
        return (
          <g key={fe.key} opacity={opacity} data-relation-id={fe.relId} style={fe.relId ? { cursor: 'pointer' } : undefined}>
            {fe.relId && <path d={shape.d} fill="none" stroke="transparent" strokeWidth={14} />}
            <path d={shape.d} fill="none" stroke={color} strokeWidth={on ? 2.2 : theme.signature ? 1.6 : 2} strokeLinejoin="round" strokeLinecap="round" />
            <path d={shape.head} fill={color} />
            {label && (
              <g>
                <rect x={shape.mid.x - labelW / 2} y={shape.mid.y - 10} width={labelW} height={20} rx={10} fill={theme.canvas} stroke={on ? SELECT_COLOR : color} strokeOpacity={0.6} />
                <text x={shape.mid.x} y={shape.mid.y + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill={color} fontFamily={FONT}>
                  {label}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function unionOf(ids: string[], layout: MapLayout, extra: Box[]): Box | undefined {
  let r: Box | undefined;
  const add = (minX: number, minY: number, maxX: number, maxY: number) => {
    if (!r) r = { minX, minY, maxX, maxY };
    else r = { minX: Math.min(r.minX, minX), minY: Math.min(r.minY, minY), maxX: Math.max(r.maxX, maxX), maxY: Math.max(r.maxY, maxY) };
  };
  for (const id of ids) {
    const b = layout.byId.get(id);
    if (b) add(b.x - b.w / 2, b.y - b.h / 2, b.x + b.w / 2, b.y + b.h / 2);
  }
  for (const x of extra) add(x.minX, x.minY, x.maxX, x.maxY);
  return r;
}

/**
 * Where each boundary's outline goes, from where its topics are drawn right
 * now (so outlines follow topics while they move). Inner boundaries first:
 * an outer one wraps the inner outlines too.
 */
export function boundaryRects(layout: MapLayout): Map<string, Box> {
  const out = new Map<string, Box>();
  const sorted = [...layout.boundaries].sort((a, b) => a.members.length - b.members.length);
  const done: { set: Set<string>; first: string; box: Box }[] = [];
  for (const bd of sorted) {
    const set = new Set(bd.members);
    const inner = done.filter((d) => d.set.size <= set.size && set.has(d.first) && d.box).map((d) => d.box);
    const u = unionOf(bd.members, layout, inner);
    if (!u) continue;
    const box = { minX: u.minX - BOUNDARY_PAD, minY: u.minY - BOUNDARY_PAD - (bd.label ? BOUNDARY_LABEL_H : 0), maxX: u.maxX + BOUNDARY_PAD, maxY: u.maxY + BOUNDARY_PAD };
    out.set(bd.id, box);
    done.push({ set, first: bd.members[0], box });
  }
  return out;
}

/** A curly bracket along one side of a span, its tip pointing away. */
export function bracePath(orient: 'h' | 'v', dir: 1 | -1, base: number, from: number, to: number): string {
  const w = BRACKET_W * dir;
  const q = Math.min(BRACKET_W / 2, Math.abs(to - from) / 4);
  const half = w / 2;
  const m = (from + to) / 2;
  if (orient === 'h') {
    const P = (x: number, y: number) => `${base + x} ${y}`;
    return `M${P(0, from)}Q${P(half, from)} ${P(half, from + q)}L${P(half, m - q)}Q${P(half, m)} ${P(w, m)}Q${P(half, m)} ${P(half, m + q)}L${P(half, to - q)}Q${P(half, to)} ${P(0, to)}`;
  }
  const P = (y: number, x: number) => `${x} ${base + y}`;
  return `M${P(0, from)}Q${P(half, from)} ${P(half, from + q)}L${P(half, m - q)}Q${P(half, m)} ${P(w, m)}Q${P(half, m)} ${P(half, m + q)}L${P(half, to - q)}Q${P(half, to)} ${P(0, to)}`;
}

function Boundaries({ layout, theme, selectedId }: { layout: MapLayout; theme: Theme; selectedId?: string }) {
  if (!layout.boundaries.length) return null;
  const rects = boundaryRects(layout);
  return (
    <g>
      {layout.boundaries.map((bd) => {
        const r = rects.get(bd.id);
        if (!r) return null;
        const on = bd.id === selectedId;
        const stroke = on ? SELECT_COLOR : bd.color;
        const w = r.maxX - r.minX, h = r.maxY - r.minY;
        const labelW = bd.label ? Math.min(w - 16, bd.label.length * 6.6 + 18) : 0;
        return (
          <g key={bd.id} data-boundary-id={bd.id}>
            <rect x={r.minX} y={r.minY} width={w} height={h} rx={14} fill={bd.color} fillOpacity={theme.dark ? 0.12 : 0.07} stroke="none" style={{ pointerEvents: 'none' }} />
            {/* Wide invisible outline: the part of a boundary that picks it. */}
            <rect x={r.minX} y={r.minY} width={w} height={h} rx={14} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: 'pointer' }} />
            <rect x={r.minX} y={r.minY} width={w} height={h} rx={14} fill="none" stroke={stroke} strokeWidth={on ? 2 : 1.4} strokeDasharray={on ? undefined : '6 4'} style={{ pointerEvents: 'none' }} />
            {bd.label && (
              <g style={{ cursor: 'pointer' }}>
                <rect x={r.minX + 10} y={r.minY + 6} width={labelW} height={18} rx={9} fill={stroke} />
                <text x={r.minX + 10 + labelW / 2} y={r.minY + 19} textAnchor="middle" fontSize={11} fontWeight={600} fill={isDark(stroke) || on ? '#FFFFFF' : '#14181E'} fontFamily={FONT}>
                  {bd.label}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}

function Brackets({ layout }: { layout: MapLayout }) {
  if (!layout.brackets.length) return null;
  const rects = layout.boundaries.length ? boundaryRects(layout) : undefined;
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'none' }}>
      {layout.brackets.map((br) => {
        const s = layout.byId.get(br.id);
        if (!s) return null;
        const set = new Set(br.members);
        const inner = rects ? layout.boundaries.filter((bd) => set.has(bd.members[0])).map((bd) => rects.get(bd.id)!).filter(Boolean) : [];
        const u = unionOf(br.members, layout, inner);
        if (!u) return null;
        const d =
          br.orient === 'h'
            ? bracePath('h', br.dir, br.dir > 0 ? s.x - s.w / 2 - BRACKET_GAP - BRACKET_W : s.x + s.w / 2 + BRACKET_GAP + BRACKET_W, u.minY, u.maxY)
            : bracePath('v', 1, s.y - s.h / 2 - BRACKET_GAP - BRACKET_W, u.minX, u.maxX);
        return <path key={br.id} d={d} stroke={s.color} strokeWidth={1.6} data-bracket-id={br.id} />;
      })}
    </g>
  );
}

interface MapSvgProps {
  map: MindMap;
  layout: MapLayout;
  theme: Theme;
  selectedId?: string;
  /** Every selected topic when several are (multi-select). */
  selectedIds?: ReadonlySet<string>;
  selectedRelId?: string;
  selectedBoundaryId?: string;
  dimIds?: Set<string>;
  /** Draw only what touches this map-space rectangle. */
  viewport?: Rect;
  /** Zoomed far out on a big map: plain shapes, no text, few DOM nodes. */
  simple?: boolean;
  /** Topics fading in or out during a layout change, by id. */
  fade?: Map<string, number>;
}

export function MapSvg({ map, layout, theme, selectedId, selectedIds, selectedRelId, selectedBoundaryId, dimIds, viewport, simple, fade }: MapSvgProps) {
  const vis = visibleIn(layout, viewport);
  const isSel = (id: string) => id === selectedId || !!selectedIds?.has(id);
  if (simple) return <SimpleMap map={map} layout={layout} theme={theme} nodes={vis.nodes} edges={vis.edges} isSel={isSel} />;
  return (
    <g>
      <Boundaries layout={layout} theme={theme} selectedId={selectedBoundaryId} />
      <Brackets layout={layout} />
      <g fill="none" strokeLinecap="round">
        {vis.edges.map((c) => {
          if (c.noEdge || c.flow === 'flow') return null;
          const p = layout.byId.get(c.parentId!)!;
          const { d } = edgeShape(p, c, map.branchStyle);
          const main = c.depth === 1 || p.flow === 'fishbone';
          const width = theme.signature ? (main ? 1.8 : 1.3) : main ? 2.5 : 1.5;
          return <path key={c.id} d={d} stroke={c.color} strokeWidth={width} strokeLinejoin="round" opacity={(dimIds?.has(c.id) ? 0.35 : 1) * (fade?.get(c.id) ?? 1)} />;
        })}
      </g>
      <FlowArrows map={map} layout={layout} theme={theme} selectedRelId={selectedRelId} dimIds={dimIds} fade={fade} />
      <LinkLabels map={map} layout={layout} edges={vis.edges} theme={theme} />
      {vis.nodes.map((b) => (
        <TopicView key={b.id} b={b} theme={theme} selected={isSel(b.id)} dimmed={dimIds?.has(b.id)} opacity={fade?.get(b.id) ?? 1} />
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
function SimpleMap({ map, layout, theme, nodes, edges, isSel }: { map: MindMap; layout: MapLayout; theme: Theme; nodes: NodeBox[]; edges: NodeBox[]; isSel(id: string): boolean }) {
  const edgeD = new Map<string, string[]>();
  for (const c of edges) {
    if (c.noEdge || c.flow === 'flow') continue;
    const p = layout.byId.get(c.parentId!)!;
    const list = edgeD.get(c.color) ?? [];
    list.push(edgeShape(p, c, map.branchStyle).d);
    edgeD.set(c.color, list);
  }
  for (const fe of layout.flowEdges) {
    const shape = flowEdgeShape(fe, layout.byId);
    const color = layout.byId.get(fe.to)?.color;
    if (!shape || !color) continue;
    const list = edgeD.get(color) ?? [];
    list.push(shape.d);
    edgeD.set(color, list);
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
  const sel = nodes.filter((b) => isSel(b.id));
  return (
    <g>
      <g fill="none" strokeWidth={2}>
        {[...edgeD].map(([color, ds]) => <path key={color} d={ds.join('')} stroke={color} />)}
      </g>
      {[...fillD].map(([color, ds]) => <path key={color} d={ds.join('')} fill={color} opacity={0.85} />)}
      {sel.map((b) => <rect key={b.id} x={b.x - b.w / 2 - 6} y={b.y - b.h / 2 - 6} width={b.w + 12} height={b.h + 12} rx={8} fill="none" stroke={SELECT_COLOR} strokeWidth={4} />)}
    </g>
  );
}
