// A minimal PDF writer: one page holding one JPEG image. The map is drawn to
// a high-resolution image first (see the PDF exporter), which keeps the
// output identical to what is on screen without bundling a PDF library.

const A4: [number, number] = [595.28, 841.89]; // points
const MARGIN = 28;

function utf16Hex(s: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `(D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z)`;
}

export interface PdfImageOptions {
  /** Image size in pixels. */
  width: number;
  height: number;
  /** Size the image is shown at, in points (1/72 inch). */
  displayWidth: number;
  displayHeight: number;
  title?: string;
  /** "a4" fits the picture on an A4 page; "fit" makes the page the picture's size. */
  page?: 'a4' | 'fit';
  date?: Date;
}

/** Wraps JPEG bytes in a single-page PDF. */
export function buildImagePdf(jpeg: Uint8Array, o: PdfImageOptions): Uint8Array {
  let pageW: number, pageH: number, drawW: number, drawH: number;
  if (o.page === 'fit') {
    pageW = o.displayWidth + MARGIN * 2;
    pageH = o.displayHeight + MARGIN * 2;
    drawW = o.displayWidth;
    drawH = o.displayHeight;
  } else {
    const landscape = o.displayWidth > o.displayHeight;
    [pageW, pageH] = landscape ? [A4[1], A4[0]] : A4;
    const k = Math.min((pageW - MARGIN * 2) / o.displayWidth, (pageH - MARGIN * 2) / o.displayHeight);
    drawW = o.displayWidth * k;
    drawH = o.displayHeight * k;
  }
  const x = (pageW - drawW) / 2, y = (pageH - drawH) / 2;
  const f = (n: number) => n.toFixed(2);
  const content = `q ${f(drawW)} 0 0 ${f(drawH)} ${f(x)} ${f(y)} cm /Im0 Do Q`;

  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const write = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n: number, body: string | (string | Uint8Array)[]) => {
    offsets[n] = length;
    write(`${n} 0 obj\n`);
    (Array.isArray(body) ? body : [body]).forEach(write);
    write('\nendobj\n');
  };

  write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pageW)} ${f(pageH)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, [
    `<< /Type /XObject /Subtype /Image /Width ${o.width} /Height ${o.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    jpeg,
    '\nendstream',
  ]);
  obj(5, `<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`);
  obj(6, `<< /Title ${utf16Hex(o.title ?? 'Keizu')} /Producer (Keizu) /CreationDate ${pdfDate(o.date ?? new Date())} >>`);

  const xref = length;
  write(`xref\n0 7\n0000000000 65535 f \n`);
  for (let n = 1; n <= 6; n++) write(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  write(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
