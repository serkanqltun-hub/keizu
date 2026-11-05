// Rich-text notes. A note is stored as Markdown (a small, common subset):
// **bold**, *italic*, ~~strike~~, `code`, [links](https://…), # headings,
// "-" / "1." lists, "- [ ]" checklists, "> " quotes, ``` code blocks and
// "---" rules. Every line of the note is its own line on screen, so plain
// notes written before rich text look exactly as they did.
//
// This file parses notes, lays them out for the SVG map (with word wrap),
// turns them into plain text, and holds the text edits behind the note
// editor's buttons and shortcuts.

type Measure = (text: string, font: string) => number;

const FONT_FAMILY = "'Plus Jakarta Sans', system-ui, sans-serif";

export interface Span {
  text: string;
  b?: boolean;
  i?: boolean;
  s?: boolean;
  code?: boolean;
  href?: string;
}

export type Block =
  | { type: 'p'; spans: Span[]; line: number }
  | { type: 'blank'; line: number }
  | { type: 'h'; level: 1 | 2 | 3; spans: Span[]; line: number }
  | {
      type: 'li';
      /** Nesting level, 0 for the outermost list. */
      depth: number;
      /** '•' for bullets, '3.' for numbered items. */
      marker: string;
      /** Set for checklist items. */
      check?: boolean;
      spans: Span[];
      line: number;
    }
  | { type: 'quote'; spans: Span[]; line: number }
  | { type: 'code'; text: string; line: number }
  | { type: 'hr'; line: number };

const SAFE_HREF = /^(https?:|mailto:|keizu:)/i;

/** Only web, mail and Keizu map links are kept as links. */
export function safeHref(href: string): string | undefined {
  const h = href.trim();
  return SAFE_HREF.test(h) ? h : undefined;
}

type Style = Omit<Span, 'text'>;

const PUNCT = /[!-/:-@[-`{-~]/;
const WORD = /[\p{L}\p{N}]/u;

/** Inline Markdown to styled runs of text. */
export function parseInline(src: string, style: Style = {}): Span[] {
  const out: Span[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ text: buf, ...style });
    buf = '';
  };
  const pushAll = (spans: Span[]) => {
    flush();
    out.push(...spans);
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const rest = src.slice(i);
    const prev = i > 0 ? src[i - 1] : '';
    if (c === '\\' && i + 1 < src.length && PUNCT.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (c === '`' && !style.code) {
      const m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest);
      if (m) {
        flush();
        out.push({ text: m[2], ...style, code: true });
        i += m[0].length;
        continue;
      }
    }
    if (c === '[' && !style.href) {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
      if (m) {
        const href = safeHref(m[2]);
        pushAll(parseInline(m[1], href ? { ...style, href } : style));
        i += m[0].length;
        continue;
      }
    }
    if (c === 'h' && !style.href && !WORD.test(prev)) {
      const m = /^https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]]/.exec(rest);
      if (m) {
        flush();
        out.push({ text: m[0], ...style, href: m[0] });
        i += m[0].length;
        continue;
      }
    }
    // Bold, strike, then italic; the closing marker must follow non-space text.
    const pair = rest.startsWith('**') ? '**' : rest.startsWith('__') ? '__' : rest.startsWith('~~') ? '~~' : '';
    if (pair && !/\s/.test(src[i + 2] ?? ' ') && !(pair === '__' && WORD.test(prev))) {
      const end = findClose(src, i + 2, pair);
      if (end > i + 2) {
        const inner = src.slice(i + 2, end);
        pushAll(parseInline(inner, pair === '~~' ? { ...style, s: true } : { ...style, b: true }));
        i = end + 2;
        continue;
      }
    }
    if ((c === '*' || c === '_') && !/\s/.test(src[i + 1] ?? ' ') && !(c === '_' && WORD.test(prev))) {
      const end = findClose(src, i + 1, c);
      if (end > i + 1) {
        pushAll(parseInline(src.slice(i + 1, end), { ...style, i: true }));
        i = end + 1;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return merge(out);
}

/** Where `mark` closes an emphasis opened before `from`, or -1. */
function findClose(src: string, from: number, mark: string): number {
  let i = from;
  while (i < src.length) {
    if (src[i] === '\\') {
      i += 2;
      continue;
    }
    if (src[i] === '`') {
      const m = /^(`+)[\s\S]*?[^`]\1(?!`)/.exec(src.slice(i));
      if (m) {
        i += m[0].length;
        continue;
      }
    }
    if (src.startsWith(mark, i) && !/\s/.test(src[i - 1])) {
      // In a run like "***", close with its last marks.
      if (mark.length === 2) while (src[i + 2] === mark[0]) i++;
      // A single "*" must not be half of a "**".
      if (mark.length === 1 && src[i + 1] === mark) {
        const close = findClose(src, i + 2, mark + mark);
        if (close > 0) {
          i = close + 2;
          continue;
        }
      }
      const after = src[i + mark.length] ?? '';
      if (mark[0] === '_' && WORD.test(after)) {
        i++;
        continue;
      }
      return i;
    }
    i++;
  }
  return -1;
}

function sameStyle(a: Span, b: Span) {
  return !!a.b === !!b.b && !!a.i === !!b.i && !!a.s === !!b.s && !!a.code === !!b.code && a.href === b.href;
}

function merge(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    if (!s.text) continue;
    const last = out[out.length - 1];
    if (last && sameStyle(last, s)) last.text += s.text;
    else out.push({ ...s });
  }
  return out;
}

const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;
const LIST_EMPTY = /^(\s*)([-*+]|\d{1,9}[.)])(?:\s+\[([ xX])\])?\s*$/;

/** A note as a list of blocks, one per source line (code blocks span several). */
export function parseNote(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    const fence = /^\s*(```|~~~)/.exec(raw);
    if (fence) {
      const body: string[] = [];
      let k = n + 1;
      while (k < lines.length && !lines[k].trim().startsWith(fence[1])) body.push(lines[k++]);
      out.push({ type: 'code', text: body.join('\n'), line: n });
      n = k;
      continue;
    }
    if (!raw.trim()) {
      out.push({ type: 'blank', line: n });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (h) {
      out.push({ type: 'h', level: Math.min(3, h[1].length) as 1 | 2 | 3, spans: parseInline(h[2].replace(/\s+#+\s*$/, '')), line: n });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) {
      out.push({ type: 'hr', line: n });
      continue;
    }
    const li = LIST.exec(raw) ?? LIST_EMPTY.exec(raw);
    if (li) {
      const indent = li[1].replace(/\t/g, '    ').length;
      const ordered = /\d/.test(li[2]);
      out.push({
        type: 'li',
        depth: Math.min(6, Math.floor(indent / 2)),
        marker: ordered ? `${parseInt(li[2], 10)}.` : '•',
        check: li[3] === undefined ? undefined : li[3] !== ' ',
        spans: parseInline(li[4] ?? ''),
        line: n,
      });
      continue;
    }
    const q = /^\s*>\s?(.*)$/.exec(raw);
    if (q) {
      out.push({ type: 'quote', spans: parseInline(q[1]), line: n });
      continue;
    }
    out.push({ type: 'p', spans: parseInline(raw), line: n });
  }
  return out;
}

function spansText(spans: Span[]) {
  return spans.map((s) => s.text).join('');
}

/** The note without Markdown marks, for tooltips and plain-text exports. */
export function notePlainText(md: string): string {
  return parseNote(md)
    .map((b) => {
      switch (b.type) {
        case 'blank':
          return '';
        case 'hr':
          return '———';
        case 'code':
          return b.text;
        case 'li':
          return `${'  '.repeat(b.depth)}${b.check === undefined ? b.marker : b.check ? '☑' : '☐'} ${spansText(b.spans)}`;
        default:
          return spansText(b.spans);
      }
    })
    .join('\n');
}

/** Whether a note uses any Markdown at all (plain notes need no rich drawing). */
export function isRich(md: string): boolean {
  return parseNote(md).some((b) => (b.type === 'p' ? b.spans.some((s) => s.b || s.i || s.s || s.code || s.href) : b.type !== 'blank'));
}

/** Ticks or unticks the checklist item on source line `line`. */
export function toggleTask(md: string, line: number): string {
  const lines = md.split('\n');
  const l = lines[line];
  if (l === undefined) return md;
  const m = /^(\s*(?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])(\])/.exec(l);
  if (!m) return md;
  lines[line] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3] + l.slice(m[0].length);
  return lines.join('\n');
}

// ---------- drawing on the map ----------

export interface RichRun {
  x: number;
  w: number;
  text: string;
  font: string;
  b?: boolean;
  i?: boolean;
  s?: boolean;
  code?: boolean;
  href?: string;
}

export interface RichLine {
  /** Top of the line inside the note block. */
  top: number;
  h: number;
  /** Baseline, from the top of the note block. */
  baseline: number;
  fontSize: number;
  runs: RichRun[];
  /** List bullet, number or checkbox drawn before the first line of an item. */
  mark?: { x: number; kind: 'bullet' | 'number' | 'check'; text?: string; checked?: boolean; line: number };
  /** Drawn on the line's background. */
  deco?: 'code' | 'quote' | 'rule';
  /** Left edge of the decoration (quotes and code blocks inside lists). */
  decoX?: number;
  /** Ticked checklist items and quotes are drawn fainter. */
  faint?: boolean;
}

export interface RichLayout {
  lines: RichLine[];
  /** Width of the widest line. */
  w: number;
  h: number;
  /** True when the note was cut to fit `maxLines`. */
  cut: boolean;
}

export const CODE_FONT_FAMILY = "'JetBrains Mono', ui-monospace, monospace";

export function runFont(size: number, st: Style, weight = 400): string {
  if (st.code) return `400 ${Math.round(size * 0.9)}px ${CODE_FONT_FAMILY}`;
  return `${st.i ? 'italic ' : ''}${st.b ? 700 : weight} ${size}px ${FONT_FAMILY}`;
}

interface Piece {
  text: string;
  st: Style;
  space: boolean;
}

function pieces(spans: Span[]): Piece[] {
  const out: Piece[] = [];
  for (const s of spans) {
    const { text, ...st } = s;
    for (const part of text.split(/(\s+)/)) if (part) out.push({ text: part, st, space: /^\s+$/.test(part) });
  }
  return out;
}

/**
 * Lays out a note for the SVG map: each block wrapped to `maxW`, with list
 * marks, heading sizes and code backgrounds. `maxLines` cuts long notes.
 */
export function layoutNote(md: string, fontSize: number, maxW: number, measure: Measure, maxLines = Infinity): RichLayout {
  const lines: RichLine[] = [];
  const lh = (size: number) => Math.round(size * 1.4);
  let y = 0;
  const indentStep = Math.round(fontSize * 1.25);

  const addLine = (size: number, runs: RichRun[], extra: Partial<RichLine> = {}, h = lh(size)) => {
    lines.push({ top: y, h, baseline: y + h / 2 + size * 0.35, fontSize: size, runs, ...extra });
    y += h;
  };

  /** Wraps styled text from x0 to maxW; returns lines of runs. */
  const wrap = (spans: Span[], size: number, x0: number, weight = 400): RichRun[][] => {
    const rows: RichRun[][] = [[]];
    let x = x0;
    const push = (text: string, st: Style) => {
      const font = runFont(size, st, weight);
      const row = rows[rows.length - 1];
      const last = row[row.length - 1];
      const ww = measure(text, font);
      if (last && last.font === font && sameStyle(last as Span, { text, ...st } as Span)) {
        last.text += text;
        last.w = measure(last.text, font);
      } else row.push({ x, w: ww, text, font, ...st });
      x = row[row.length - 1].x + row[row.length - 1].w;
    };
    for (const p of pieces(spans)) {
      const font = runFont(size, p.st, weight);
      const pw = measure(p.text, font);
      const row = rows[rows.length - 1];
      if (p.space) {
        if (row.length) push(p.text, p.st);
        continue;
      }
      if (x + pw > maxW && row.length) {
        // Drop the trailing space and start a new line.
        const last = row[row.length - 1];
        if (/\s$/.test(last.text)) {
          last.text = last.text.trimEnd();
          last.w = measure(last.text, last.font);
          if (!last.text) row.pop();
        }
        rows.push([]);
        x = x0;
      }
      // A word wider than the whole line is cut by characters.
      let word = p.text;
      while (x + measure(word, font) > maxW && word.length > 1) {
        let n = word.length - 1;
        while (n > 1 && x + measure(word.slice(0, n), font) > maxW) n--;
        push(word.slice(0, n), p.st);
        rows.push([]);
        x = x0;
        word = word.slice(n);
      }
      push(word, p.st);
    }
    return rows;
  };

  for (const b of parseNote(md)) {
    switch (b.type) {
      case 'blank':
        addLine(fontSize, []);
        break;
      case 'hr':
        addLine(fontSize, [], { deco: 'rule' }, Math.round(lh(fontSize) * 0.7));
        break;
      case 'h': {
        const size = Math.round(fontSize * (b.level === 1 ? 1.3 : b.level === 2 ? 1.15 : 1.05));
        wrap(b.spans, size, 0, 700).forEach((runs) => addLine(size, runs));
        break;
      }
      case 'p':
        wrap(b.spans, fontSize, 0).forEach((runs) => addLine(fontSize, runs));
        break;
      case 'quote': {
        const x0 = Math.round(fontSize * 0.8);
        wrap(b.spans, fontSize, x0).forEach((runs) => addLine(fontSize, runs, { deco: 'quote', decoX: 0, faint: true }));
        break;
      }
      case 'code': {
        const font = runFont(fontSize, { code: true });
        const pad = Math.round(fontSize * 0.5);
        const size = Math.round(fontSize * 0.9);
        for (const src of b.text.split('\n')) {
          // Code keeps its spacing and is cut by characters, not words.
          let rest = src.replace(/\t/g, '  ');
          do {
            let n = rest.length;
            while (n > 1 && pad + measure(rest.slice(0, n), font) > maxW - pad) n--;
            const part = rest.slice(0, n);
            addLine(size, part ? [{ x: pad, w: measure(part, font), text: part, font, code: true }] : [], { deco: 'code', decoX: 0 }, lh(fontSize));
            rest = rest.slice(n);
          } while (rest);
        }
        break;
      }
      case 'li': {
        const x = b.depth * indentStep;
        const markW = b.check !== undefined ? Math.round(fontSize * 1.35) : b.marker === '•' ? Math.round(fontSize * 1.1) : Math.round(measure(b.marker, runFont(fontSize, {})) + fontSize * 0.45);
        const rows = wrap(b.spans, fontSize, x + markW);
        rows.forEach((runs, k) =>
          addLine(fontSize, runs, {
            ...(k === 0
              ? { mark: { x, kind: b.check !== undefined ? 'check' : b.marker === '•' ? 'bullet' : 'number', text: b.marker, checked: b.check, line: b.line } as RichLine['mark'] }
              : {}),
            faint: !!b.check,
          }),
        );
        break;
      }
    }
  }

  // Drop blank lines at the end (and start) of the note.
  while (lines.length && !lines[lines.length - 1].runs.length && !lines[lines.length - 1].deco && !lines[lines.length - 1].mark) lines.pop();

  let cut = false;
  if (lines.length > maxLines) {
    lines.length = maxLines;
    cut = true;
    const last = lines[lines.length - 1];
    const lastRun = last.runs[last.runs.length - 1];
    if (lastRun) {
      lastRun.text += '…';
      lastRun.w = measure(lastRun.text, lastRun.font);
    } else last.runs.push({ x: last.mark ? last.mark.x : 0, w: measure('…', runFont(last.fontSize, {})), text: '…', font: runFont(last.fontSize, {}) });
  }
  let w = 0;
  for (const l of lines) {
    const r = l.runs[l.runs.length - 1];
    if (r) w = Math.max(w, r.x + r.w);
  }
  const h = lines.length ? lines[lines.length - 1].top + lines[lines.length - 1].h : 0;
  return { lines, w: Math.min(w, maxW), h, cut };
}

// ---------- editing ----------

export interface TextEdit {
  value: string;
  start: number;
  end: number;
}

/** Wraps the selection in a mark (`**`, `*`, `~~`, `` ` ``), or removes it if already there. */
export function toggleWrap(e: TextEdit, mark: string): TextEdit {
  const { value, start, end } = e;
  const before = value.slice(0, start);
  const sel = value.slice(start, end);
  const after = value.slice(end);
  // Already wrapped just outside the selection: unwrap.
  if (before.endsWith(mark) && after.startsWith(mark) && !(mark === '*' && before.endsWith('**') && !before.endsWith('***'))) {
    return { value: before.slice(0, -mark.length) + sel + after.slice(mark.length), start: start - mark.length, end: end - mark.length };
  }
  // Selection includes the marks: unwrap.
  if (sel.length >= mark.length * 2 && sel.startsWith(mark) && sel.endsWith(mark)) {
    const inner = sel.slice(mark.length, sel.length - mark.length);
    return { value: before + inner + after, start, end: start + inner.length };
  }
  // Keep spaces at the edges of the selection outside the marks.
  const lead = /^\s*/.exec(sel)![0];
  const trail = sel.length > lead.length ? /\s*$/.exec(sel)![0] : '';
  const core = sel.slice(lead.length, sel.length - trail.length);
  const v = before + lead + mark + core + mark + trail + after;
  const s = start + lead.length + mark.length;
  return { value: v, start: s, end: s + core.length };
}

export type LineKind = 'ul' | 'ol' | 'task' | 'h1' | 'h2' | 'h3' | 'quote';

const PREFIX = /^(\s*)(?:#{1,6}\s+|>\s?|(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?)?/;

function kindOf(line: string): LineKind | undefined {
  if (/^\s*#\s/.test(line)) return 'h1';
  if (/^\s*##\s/.test(line)) return 'h2';
  if (/^\s*###+\s/.test(line)) return 'h3';
  if (/^\s*>/.test(line)) return 'quote';
  if (/^\s*(?:[-*+]|\d{1,9}[.)])\s+\[[ xX]\]/.test(line)) return 'task';
  if (/^\s*\d{1,9}[.)]\s/.test(line)) return 'ol';
  if (/^\s*[-*+]\s/.test(line)) return 'ul';
}

/** Turns the selected lines into a list, checklist, heading or quote; again turns them back. */
export function toggleLines(e: TextEdit, kind: LineKind): TextEdit {
  const { value } = e;
  const from = value.lastIndexOf('\n', e.start - 1) + 1;
  let to = value.indexOf('\n', Math.max(e.end - (e.end > e.start && value[e.end - 1] === '\n' ? 1 : 0), e.start));
  if (to < 0) to = value.length;
  const lines = value.slice(from, to).split('\n');
  const off = lines.some((l) => l.trim()) && lines.every((l) => !l.trim() || kindOf(l) === kind);
  let n = 0;
  const next = lines.map((l) => {
    if (!l.trim() && lines.length > 1) return l;
    const m = PREFIX.exec(l)!;
    const indent = m[1];
    const body = l.slice(m[0].length);
    if (off) return indent + body;
    n++;
    const head = { ul: '- ', ol: `${n}. `, task: '- [ ] ', h1: '# ', h2: '## ', h3: '### ', quote: '> ' }[kind];
    return (kind.startsWith('h') ? '' : indent) + head + body;
  });
  const out = next.join('\n');
  const v = value.slice(0, from) + out + value.slice(to);
  // Keep the caret at the same spot in its line's text.
  if (e.start === e.end && lines.length === 1) {
    const caret = Math.max(from + (out.length - (lines[0].length - (e.start - from))), from);
    const pos = Math.min(Math.max(caret, from + PREFIX.exec(out)![0].length), from + out.length);
    return { value: v, start: pos, end: pos };
  }
  return { value: v, start: from, end: from + out.length };
}

/** Wraps the selection in a link, with the address selected for typing. */
export function insertLink(e: TextEdit, placeholder = 'bağlantı', url = 'https://'): TextEdit {
  const sel = e.value.slice(e.start, e.end);
  if (/^https?:\/\/\S+$/.test(sel)) {
    const v = `${e.value.slice(0, e.start)}[${sel}](${sel})${e.value.slice(e.end)}`;
    return { value: v, start: e.start + 1, end: e.start + 1 + sel.length };
  }
  const text = sel || placeholder;
  const v = `${e.value.slice(0, e.start)}[${text}](${url})${e.value.slice(e.end)}`;
  const s = e.start + text.length + 3;
  return sel ? { value: v, start: s, end: s + url.length } : { value: v, start: e.start + 1, end: e.start + 1 + text.length };
}

/**
 * Enter inside a list item: starts the next item (numbered one higher, with an
 * empty checkbox). On an empty item, ends the list instead. Undefined when the
 * caret is not in a list.
 */
export function continueList(e: TextEdit): TextEdit | undefined {
  if (e.start !== e.end) return;
  const { value, start } = e;
  const from = value.lastIndexOf('\n', start - 1) + 1;
  const line = value.slice(from, start);
  const m = /^(\s*)([-*+]|\d{1,9}([.)]))(\s+)(\[[ xX]\]\s+)?/.exec(line) ?? /^(\s*)([-*+]|\d{1,9}([.)]))(\s+)(\[[ xX]\])?$/.exec(line);
  const q = /^(\s*>\s?)/.exec(line);
  if (!m && !q) return;
  const rest = value.slice(start, (value.indexOf('\n', start) + 1 || value.length + 1) - 1);
  const prefix = m ? m[0] : q![0];
  if (!line.slice(prefix.length).trim() && !rest.trim()) {
    // Empty item: end the list (outdent first if nested).
    if (m && m[1].length >= 2) {
      const v = value.slice(0, from) + line.slice(2) + value.slice(start);
      return { value: v, start: start - 2, end: start - 2 };
    }
    const v = value.slice(0, from) + value.slice(start);
    return { value: v, start: from, end: from };
  }
  let head: string;
  if (q && !m) head = q[1];
  else {
    const [, indent, marker, delim, gap, box] = m!;
    const num = /\d/.test(marker) ? `${parseInt(marker, 10) + 1}${delim}` : marker;
    head = indent + num + gap + (box !== undefined ? '[ ] ' : '');
  }
  const v = `${value.slice(0, start)}\n${head}${value.slice(start)}`;
  const pos = start + 1 + head.length;
  return { value: v, start: pos, end: pos };
}

/** Tab / Shift+Tab on list lines: nest or un-nest them by two spaces. */
export function indentLines(e: TextEdit, out: boolean): TextEdit | undefined {
  const { value } = e;
  const from = value.lastIndexOf('\n', e.start - 1) + 1;
  let to = value.indexOf('\n', e.end);
  if (to < 0) to = value.length;
  const lines = value.slice(from, to).split('\n');
  if (!lines.some((l) => kindOf(l) === 'ul' || kindOf(l) === 'ol' || kindOf(l) === 'task')) return;
  let first = 0;
  let total = 0;
  const next = lines.map((l, k) => {
    if (!out) {
      if (k === 0) first = 2;
      total += 2;
      return `  ${l}`;
    }
    const n = /^ {1,2}|^\t/.exec(l)?.[0].length ?? 0;
    if (k === 0) first = -n;
    total -= n;
    return l.slice(n);
  });
  const v = value.slice(0, from) + next.join('\n') + value.slice(to);
  return { value: v, start: Math.max(from, e.start + first), end: Math.max(from, e.end + total) };
}
