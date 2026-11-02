import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { decodeKeizu, encodeKeizu, encodePlainJson, isZip, parseDataUrl } from './archive';
import { imageSize } from './imageSize';
import { importFile } from './importFile';
import { fromOPML, toJSON, toOPML } from './io';
import { approxMeasure, layoutMap } from './layout';
import { addRelation, createMap, findTopic, setTopicImage, updateTopic } from './model';
import { buildImagePdf } from './pdf';
import { contentHash, MAX_VERSIONS, versionsToDrop } from './versions';
import { fromXMind, mapMarker } from './xmind';
import { parseXml } from './xml';

// 1×1 transparent PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_URL = `data:image/png;base64,${PNG_B64}`;

function sampleMap() {
  let m = createMap('Örnek');
  const [a, b] = m.roots[0].children;
  m = updateTopic(m, a.id, { note: 'çok satırlı\nnot & <özel>' });
  m = setTopicImage(m, b.id, PNG_URL, 1, 1);
  m = addRelation(m, a.id, b.id, 'besler').map;
  return m;
}

describe('.keizu package', () => {
  it('round-trips a map with an image through the zip package', () => {
    const m = sampleMap();
    const bytes = encodeKeizu(m);
    expect(isZip(bytes)).toBe(true);
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(expect.arrayContaining(['manifest.json', 'map.json']));
    const res = Object.keys(files).find((f) => f.startsWith('resources/'))!;
    expect(res).toMatch(/\.png$/);
    // map.json points at the file instead of embedding it
    expect(strFromU8(files['map.json'])).not.toContain('base64');
    const back = decodeKeizu(bytes);
    expect(back).toEqual(m);
  });

  it('reads plain JSON (phase 1 files and the git-friendly option)', () => {
    const m = sampleMap();
    expect(decodeKeizu(strToU8(toJSON(m)))).toEqual(m);
    expect(decodeKeizu(strToU8(encodePlainJson(m)))).toEqual(m);
  });

  it('drops images no topic uses when writing', () => {
    let m = sampleMap();
    const b = m.roots[0].children[1];
    m = setTopicImage(m, b.id, PNG_URL, 1, 1); // replaces the first one
    expect(Object.keys(m.resources!)).toHaveLength(2);
    expect(Object.keys(decodeKeizu(encodeKeizu(m)).resources!)).toHaveLength(1);
  });

  it('rejects zips that are not Keizu maps', () => {
    expect(() => decodeKeizu(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/Keizu/);
  });

  it('parses data URLs', () => {
    expect(parseDataUrl(PNG_URL)?.mime).toBe('image/png');
    expect(imageSize(parseDataUrl(PNG_URL)!.bytes)).toEqual({ width: 1, height: 1 });
  });
});

describe('images in the layout', () => {
  it('makes room for a topic picture above its text', () => {
    const m = sampleMap();
    const b = m.roots[0].children[1];
    const plain = layoutMap({ ...m, resources: undefined }, approxMeasure).byId.get(b.id)!;
    const big = setTopicImage(m, b.id, PNG_URL, 400, 300);
    const box = layoutMap(big, approxMeasure).byId.get(b.id)!;
    expect(box.image).toEqual({ href: PNG_URL, w: 320, h: 240 });
    expect(box.h).toBeGreaterThan(plain.h + 240);
    expect(box.w).toBeGreaterThanOrEqual(320);
  });
});

describe('OPML', () => {
  it('round-trips topics and notes, escaping special characters', () => {
    const m = sampleMap();
    const xml = toOPML(m);
    expect(xml).toContain('_note="çok satırlı&#10;not &amp; &lt;özel&gt;"');
    const back = fromOPML(xml);
    expect(back.roots[0].text).toBe('Örnek');
    expect(back.roots[0].children.map((c) => c.text)).toEqual(m.roots[0].children.map((c) => c.text));
    expect(back.roots[0].children[0].note).toBe('çok satırlı\nnot & <özel>');
  });

  it('puts several top-level outlines under the document title', () => {
    const xml = `<?xml version="1.0"?><opml version="1.0"><head><title>Liste</title></head><body>
      <outline text="Bir"><outline text="Bir.a"/></outline><outline title="İki"/></body></opml>`;
    const m = fromOPML(xml);
    expect(m.roots[0].text).toBe('Liste');
    expect(m.roots[0].children.map((c) => c.text)).toEqual(['Bir', 'İki']);
    expect(m.roots[0].children[0].children[0].text).toBe('Bir.a');
  });

  it('is recognised by importFile even with another extension', () => {
    const [m] = importFile('x.xml', strToU8('<opml><body><outline text="Tek"/></body></opml>'));
    expect(m.roots[0].text).toBe('Tek');
  });
});

describe('XML reader', () => {
  it('handles entities, CDATA, comments and namespaces', () => {
    const doc = parseXml('<?xml version="1.0"?><!-- c --><a x="1 &gt; 0"><b:c>t&#252;<![CDATA[<raw>]]></b:c><d/></a>');
    expect(doc.name).toBe('a');
    expect(doc.attrs.x).toBe('1 > 0');
    expect(doc.children[0].name).toBe('c');
    expect(doc.children[0].text).toBe('tü<raw>');
    expect(doc.children[1].name).toBe('d');
  });
});

describe('.xmind import', () => {
  it('reads content.json: sheets, floating topics, notes, markers, images, relations', () => {
    const content = [
      {
        title: 'Sayfa 1',
        rootTopic: {
          id: 'root',
          title: 'Merkez',
          structureClass: 'org.xmind.ui.logic.right',
          children: {
            attached: [
              { id: 'a', title: 'A', markers: [{ markerId: 'priority-7' }, { markerId: 'task-half' }], notes: { plain: { content: 'not' } } },
              { id: 'b', title: 'B', image: { src: 'xap:resources/p.png' }, branch: 'folded', children: { attached: [{ id: 'b1', title: 'B1' }] } },
            ],
            detached: [{ id: 'f', title: 'Serbest', position: { x: 300, y: -120 } }],
          },
        },
        relationships: [{ id: 'r', end1Id: 'a', end2Id: 'f', title: 'ilgili' }],
      },
      { title: 'Sayfa 2', rootTopic: { id: 'r2', title: 'İkinci' } },
    ];
    const bytes = zipSync({
      'content.json': strToU8(JSON.stringify(content)),
      'resources/p.png': parseDataUrl(PNG_URL)!.bytes,
      'content.xml': strToU8('<xmap-content/>'),
    });
    const maps = fromXMind(bytes);
    expect(maps).toHaveLength(2);
    const [m, m2] = maps;
    expect(m.title).toBe('Sayfa 1');
    expect(m2.title).toBe('Sayfa 2');
    expect(m.layout).toBe('logic');
    const [a, b] = m.roots[0].children;
    expect(a.markers).toEqual(['priority-5', 'task-50']);
    expect(a.note).toBe('not');
    expect(b.collapsed).toBe(true);
    expect(b.image).toMatchObject({ width: 1, height: 1 });
    expect(m.resources![b.image!.res]).toBe(PNG_URL);
    expect(m.roots[1]).toMatchObject({ text: 'Serbest', pos: { x: 300, y: -120 } });
    expect(m.relations).toHaveLength(1);
    expect(findTopic(m, m.relations[0].to)?.text).toBe('Serbest');
    expect(m.relations[0].label).toBe('ilgili');
  });

  it('reads XMind 8 content.xml', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0" xmlns:svg="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml" version="2.0">
  <sheet id="s1"><title>Eski</title>
    <topic id="t0" structure-class="org.xmind.ui.org-chart.down"><title>Kök</title>
      <children>
        <topics type="attached">
          <topic id="t1"><title>Bir</title><marker-refs><marker-ref marker-id="flag-orange"/><marker-ref marker-id="smiley-smile"/></marker-refs>
            <notes><plain>Düz not</plain><html><xhtml:p>Düz not</xhtml:p></html></notes></topic>
          <topic id="t2"><title>İki &amp; Üç</title><xhtml:img xhtml:src="xap:attachments/p.png" svg:width="40" svg:height="20"/></topic>
        </topics>
        <topics type="detached"><topic id="t3"><position svg:x="100" svg:y="200"/><title>Ayrı</title></topic></topics>
      </children>
    </topic>
    <relationships><relationship end1="t1" end2="t3" id="r1"><title>bağ</title></relationship></relationships>
  </sheet>
</xmap-content>`;
    const bytes = zipSync({ 'content.xml': strToU8(xml), 'attachments/p.png': parseDataUrl(PNG_URL)!.bytes });
    const [m] = importFile('eski.xmind', bytes);
    expect(m.layout).toBe('org');
    expect(m.roots[0].text).toBe('Kök');
    const [one, two] = m.roots[0].children;
    expect(one.markers).toEqual(['flag-red']);
    expect(one.note).toBe('Düz not');
    expect(two.text).toBe('İki & Üç');
    expect(two.image).toMatchObject({ width: 40, height: 20 });
    expect(m.roots[1]).toMatchObject({ text: 'Ayrı', pos: { x: 100, y: 200 } });
    expect(m.relations[0].label).toBe('bağ');
  });

  it('maps markers it knows and skips the rest', () => {
    expect(mapMarker('task-done')).toBe('task-100');
    expect(mapMarker('star-red')).toBe('symbol-star');
    expect(mapMarker('people-red')).toBeUndefined();
  });

  it('explains files that are not XMind maps', () => {
    expect(() => fromXMind(strToU8('hello'))).toThrow(/XMind/);
    expect(() => fromXMind(zipSync({ 'x.txt': strToU8('x') }))).toThrow(/bulunamadı/);
  });
});

describe('PDF', () => {
  it('writes a well-formed single page PDF with a correct xref table', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const pdf = buildImagePdf(jpeg, { width: 10, height: 5, displayWidth: 800, displayHeight: 400, title: 'Şema' });
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/MediaBox [0 0 841.89 595.28]'); // wide map → landscape A4
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    offsets.forEach((off, i) => expect(text.slice(off, off + 7)).toBe(`${i + 1} 0 obj`));
  });
});

describe('version history', () => {
  it('ignores save counters when fingerprinting content', () => {
    const m = createMap();
    expect(contentHash({ ...m, version: 9, updatedAt: 'x' })).toBe(contentHash(m));
    expect(contentHash(updateTopic(m, m.roots[0].id, { text: 'Başka' }))).not.toBe(contentHash(m));
  });

  it('keeps recent snapshots and thins out older ones', () => {
    const now = Date.parse('2026-11-02T12:00:00Z');
    const at = (msAgo: number, id: number) => ({ id, savedAt: new Date(now - msAgo).toISOString() });
    const list = [
      at(60e3, 1), at(120e3, 2), // last hour: both kept
      at(2.5 * 3600e3, 3), at(2.5 * 3600e3 + 60e3, 4), // same hour: one kept
      at(3 * 86400e3, 5), at(3 * 86400e3 + 3600e3, 6), // same day (usually)
    ];
    const drop = versionsToDrop(list, now);
    expect(drop).not.toContain(1);
    expect(drop).not.toContain(2);
    expect(drop).toContain(4);
    expect(drop).not.toContain(3);
    const many = Array.from({ length: MAX_VERSIONS + 20 }, (_, i) => at(i * 1000, i + 1));
    expect(versionsToDrop(many, now)).toHaveLength(20);
  });
});
