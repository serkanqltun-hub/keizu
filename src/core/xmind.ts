// Import of .xmind files (one-way: Keizu does not write .xmind). Newer files
// keep the map in content.json; XMind 8 and older use content.xml. Each
// sheet becomes its own Keizu map.

import { strFromU8, unzipSync } from 'fflate';
import { isZip, mimeFromName, toDataUrl } from './archive';
import { imageSize } from './imageSize';
import { emptyMap } from './io';
import { createTopic, newId, type LayoutKind, type MindMap, type Relation, type Topic } from './model';
import { child, childrenNamed, parseXml, type XmlNode } from './xml';

const TASK: Record<string, number> = {
  start: 0, oct: 25, quarter: 25, '3oct': 50, half: 50, '5oct': 75, '3quar': 75, '7oct': 75, done: 100,
};

/** Maps an XMind marker id to the closest Keizu marker, if there is one. */
export function mapMarker(id: string): string | undefined {
  const [group, value = ''] = [id.slice(0, id.indexOf('-')), id.slice(id.indexOf('-') + 1)];
  if (group === 'priority') {
    const n = Number(value);
    return n >= 1 ? `priority-${Math.min(5, n)}` : undefined;
  }
  if (group === 'task') return value in TASK ? `task-${TASK[value]}` : undefined;
  if (group === 'flag') {
    if (value === 'red' || value === 'orange') return 'flag-red';
    if (value === 'blue' || value === 'dark-blue' || value === 'purple') return 'flag-blue';
    if (value === 'green') return 'flag-green';
    return undefined;
  }
  if (id.includes('star')) return 'symbol-star';
  if (id.includes('question')) return 'symbol-question';
  if (id.includes('idea') || id.includes('lightbulb')) return 'symbol-idea';
  return undefined;
}

function layoutFrom(structure?: string): LayoutKind {
  if (!structure) return 'mindmap';
  if (structure.includes('fishbone')) return 'fishbone';
  if (structure.includes('timeline')) return 'timeline';
  if (structure.includes('spreadsheet') || structure.includes('matrix')) return 'matrix';
  if (structure.includes('org-chart') || structure.includes('tree')) return 'org';
  if (structure.includes('logic')) return 'logic';
  return 'mindmap';
}

function addMarker(t: Topic, xmindId: string) {
  const m = mapMarker(xmindId);
  if (!m) return;
  const group = m.split('-')[0];
  t.markers = [...(t.markers ?? []).filter((x) => x.split('-')[0] !== group), m];
}

interface Ctx {
  files: Record<string, Uint8Array>;
  resources: Record<string, string>;
  /** XMind topic id → Keizu topic id, for relations. */
  ids: Map<string, string>;
}

function attachImage(ctx: Ctx, t: Topic, src: string | undefined, w?: number, h?: number) {
  if (!src) return;
  const path = src.replace(/^xap:/, '');
  const bytes = ctx.files[path];
  if (!bytes) return;
  const mime = mimeFromName(path);
  const size = imageSize(bytes);
  const width = Number(w) || size?.width || 200;
  const height = Number(h) || size?.height || 150;
  const res = `img_${Object.keys(ctx.resources).length + 1}`;
  ctx.resources[res] = toDataUrl(mime, bytes);
  t.image = { res, width, height };
}

// ---------- content.json (XMind 2020 and later) ----------

interface JTopic {
  id?: string;
  title?: string;
  structureClass?: string;
  children?: { attached?: JTopic[]; detached?: JTopic[]; summary?: JTopic[] };
  boundaries?: { range?: string; title?: string }[];
  summaries?: { range?: string; topicId?: string }[];
  notes?: { plain?: { content?: string } };
  markers?: { markerId: string }[];
  image?: { src?: string; width?: number; height?: number };
  position?: { x: number; y: number };
  branch?: string;
}

interface JSheet {
  title?: string;
  rootTopic?: JTopic;
  relationships?: { id?: string; end1Id: string; end2Id: string; title?: string }[];
}

function fromJsonTopic(ctx: Ctx, j: JTopic): Topic {
  const t = createTopic((j.title ?? '').trim() || 'Konu', (j.children?.attached ?? []).map((c) => fromJsonTopic(ctx, c)));
  if (j.id) ctx.ids.set(j.id, t.id);
  const note = j.notes?.plain?.content?.trim();
  if (note) t.note = note;
  j.markers?.forEach((m) => addMarker(t, m.markerId));
  if (j.image) attachImage(ctx, t, j.image.src, j.image.width, j.image.height);
  if (j.branch === 'folded' && t.children.length) t.collapsed = true;
  addRuns(t, j);
  return t;
}

/** Child ids for an XMind range like "(0,2)"; undefined if it does not fit. */
function runOf(t: Topic, range?: string): { from: string; to: string } | undefined {
  const m = /^\((\d+),(\d+)\)$/.exec(range?.replace(/\s/g, '') ?? '');
  if (!m) return undefined;
  const a = t.children[Number(m[1])], b = t.children[Number(m[2])];
  return a && b ? { from: a.id, to: b.id } : undefined;
}

/** XMind boundaries and summaries of a topic's children. */
function addRuns(t: Topic, j: JTopic) {
  const boundaries = (j.boundaries ?? []).flatMap((b) => {
    const run = runOf(t, b.range);
    const label = b.title?.trim();
    return run ? [{ id: newId('b'), ...run, ...(label ? { label } : {}) }] : [];
  });
  if (boundaries.length) t.boundaries = boundaries;
  const sumTopics = new Map((j.children?.summary ?? []).map((s) => [s.id, s]));
  const summaries = (j.summaries ?? []).flatMap((s) => {
    const run = runOf(t, s.range);
    const jt = s.topicId ? sumTopics.get(s.topicId) : undefined;
    if (!run || !jt) return [];
    return [{ ...run, topic: createTopic((jt.title ?? '').trim() || 'Özet') }];
  });
  if (summaries.length) t.summaries = summaries;
}

function sheetFromJson(ctx: Ctx, s: JSheet): MindMap | undefined {
  const rt = s.rootTopic;
  if (!rt) return undefined;
  const main = fromJsonTopic(ctx, rt);
  main.collapsed = undefined;
  const floating = (rt.children?.detached ?? []).map((d) => {
    const t = fromJsonTopic(ctx, d);
    if (d.position) t.pos = { x: d.position.x, y: d.position.y };
    return t;
  });
  const map = emptyMap(main, [main, ...floating]);
  map.layout = layoutFrom(rt.structureClass);
  map.relations = relationsFrom(ctx, (s.relationships ?? []).map((r) => [r.end1Id, r.end2Id, r.title]));
  return map;
}

// ---------- content.xml (XMind 8 and older) ----------

const textOf = (n?: XmlNode): string => (n ? (n.text + n.children.map((c) => textOf(c)).join('')).trim() : '');

function fromXmlTopic(ctx: Ctx, x: XmlNode, detachedOut?: Topic[]): Topic {
  const kids = child(x, 'children');
  const groups = kids ? childrenNamed(kids, 'topics') : [];
  const attached = groups.filter((g) => (g.attrs.type ?? 'attached') === 'attached').flatMap((g) => childrenNamed(g, 'topic'));
  const t = createTopic(textOf(child(x, 'title')) || 'Konu', attached.map((c) => fromXmlTopic(ctx, c)));
  if (x.attrs.id) ctx.ids.set(x.attrs.id, t.id);
  const note = textOf(child(child(x, 'notes') ?? x, 'plain'));
  if (note && child(x, 'notes')) t.note = note;
  const refs = child(x, 'marker-refs');
  refs?.children.forEach((r) => r.attrs['marker-id'] && addMarker(t, r.attrs['marker-id']));
  const img = child(x, 'img');
  if (img) attachImage(ctx, t, img.attrs['xhtml:src'] ?? img.attrs.src, Number(img.attrs['svg:width']), Number(img.attrs['svg:height']));
  if (x.attrs.branch === 'folded' && t.children.length) t.collapsed = true;
  if (detachedOut) {
    for (const g of groups.filter((g) => g.attrs.type === 'detached')) {
      for (const d of childrenNamed(g, 'topic')) {
        const f = fromXmlTopic(ctx, d);
        const p = child(d, 'position');
        if (p) f.pos = { x: Number(p.attrs['svg:x']) || 0, y: Number(p.attrs['svg:y']) || 0 };
        detachedOut.push(f);
      }
    }
  }
  return t;
}

function sheetFromXml(ctx: Ctx, sheet: XmlNode): MindMap | undefined {
  const rt = child(sheet, 'topic');
  if (!rt) return undefined;
  const floating: Topic[] = [];
  const main = fromXmlTopic(ctx, rt, floating);
  main.collapsed = undefined;
  const map = emptyMap(main, [main, ...floating]);
  map.layout = layoutFrom(rt.attrs['structure-class']);
  const rels = child(sheet, 'relationships');
  map.relations = relationsFrom(
    ctx,
    (rels ? childrenNamed(rels, 'relationship') : []).map((r) => [r.attrs.end1, r.attrs.end2, textOf(child(r, 'title')) || undefined]),
  );
  return map;
}

function relationsFrom(ctx: Ctx, list: [string, string, string | undefined][]): Relation[] {
  const out: Relation[] = [];
  list.forEach(([a, b, label], i) => {
    const from = ctx.ids.get(a), to = ctx.ids.get(b);
    if (from && to && from !== to) out.push({ id: `r_x${i + 1}`, from, to, label: label?.trim() || undefined });
  });
  return out;
}

/** Reads every sheet of an .xmind file into Keizu maps. */
export function fromXMind(bytes: Uint8Array, fallbackTitle = 'İçe aktarılan'): MindMap[] {
  if (!isZip(bytes)) throw new Error('Bu dosya bir XMind dosyası değil.');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('XMind dosyası açılamadı.');
  }
  const maps: MindMap[] = [];
  const sheetTitles: (string | undefined)[] = [];
  const newCtx = (): Ctx => ({ files, resources: {}, ids: new Map() });
  const finish = (ctx: Ctx, m: MindMap | undefined, title?: string) => {
    if (!m) return;
    if (Object.keys(ctx.resources).length) m.resources = ctx.resources;
    maps.push(m);
    sheetTitles.push(title);
  };

  if (files['content.json']) {
    let sheets: JSheet[];
    try {
      sheets = JSON.parse(strFromU8(files['content.json']));
    } catch {
      throw new Error('XMind içeriği okunamadı.');
    }
    for (const s of Array.isArray(sheets) ? sheets : []) {
      const ctx = newCtx();
      finish(ctx, sheetFromJson(ctx, s), s.title);
    }
  } else if (files['content.xml']) {
    const doc = parseXml(strFromU8(files['content.xml']));
    for (const s of childrenNamed(doc, 'sheet')) {
      const ctx = newCtx();
      finish(ctx, sheetFromXml(ctx, s), textOf(child(s, 'title')));
    }
  }
  if (!maps.length) throw new Error('XMind dosyasında harita bulunamadı.');
  // With several sheets, keep the sheet name so the maps are told apart.
  maps.forEach((m, i) => {
    const sheet = sheetTitles[i]?.trim();
    m.title = maps.length > 1 && sheet ? sheet : m.roots[0].text || sheet || fallbackTitle;
  });
  return maps;
}
