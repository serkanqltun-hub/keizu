// Exports: SVG, PNG, PDF, Markdown, OPML and .keizu files. On the desktop
// each one asks where to save; in the browser it downloads.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { encodeKeizu, encodePlainJson } from '../core/archive';
import { toMarkdown, toOPML } from '../core/io';
import { buildImagePdf } from '../core/pdf';
import type { MapLayout } from '../core/layout';
import type { MindMap } from '../core/model';
import type { Theme } from '../core/themes';
import { MapSvg } from './MapSvg';
import { saveExport } from './platform';

import latin400 from '@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-400-normal.woff2?url';
import latin600 from '@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-600-normal.woff2?url';
import latin700 from '@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-700-normal.woff2?url';
import ext400 from '@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-ext-400-normal.woff2?url';
import ext600 from '@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-ext-600-normal.woff2?url';
import ext700 from '@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-ext-700-normal.woff2?url';

const PAD = 40;

export function safeFileName(title: string): string {
  return (title || 'harita').replace(/[\\/:*?"<>|\n]+/g, ' ').trim().slice(0, 80) || 'harita';
}

async function toDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

let fontCss: Promise<string> | null = null;
/** @font-face rules with the font embedded, so exports look right anywhere. */
function embeddedFontCss(): Promise<string> {
  fontCss ??= (async () => {
    const faces: [string, number, string][] = [
      [latin400, 400, 'U+0000-00FF'],
      [latin600, 600, 'U+0000-00FF'],
      [latin700, 700, 'U+0000-00FF'],
      [ext400, 400, 'U+0100-024F'],
      [ext600, 600, 'U+0100-024F'],
      [ext700, 700, 'U+0100-024F'],
    ];
    const rules = await Promise.all(
      faces.map(async ([url, weight, range]) => {
        const data = await toDataUrl(url);
        return `@font-face{font-family:'Plus Jakarta Sans';font-weight:${weight};src:url(${data}) format('woff2');unicode-range:${range};}`;
      }),
    );
    return rules.join('');
  })().catch(() => '');
  return fontCss;
}

export async function buildSvg(map: MindMap, layout: MapLayout, theme: Theme): Promise<{ svg: string; width: number; height: number }> {
  const { minX, minY, maxX, maxY } = layout.bounds;
  const width = Math.ceil(maxX - minX + PAD * 2 + 24);
  const height = Math.ceil(maxY - minY + PAD * 2 + 24);
  const body = renderToStaticMarkup(createElement(MapSvg, { map, layout, theme }));
  const css = await embeddedFontCss();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX - PAD - 12} ${minY - PAD - 12} ${width} ${height}">` +
    `<style>${css}</style>` +
    `<rect x="${minX - PAD - 12}" y="${minY - PAD - 12}" width="${width}" height="${height}" fill="${theme.canvas}"/>` +
    body +
    `</svg>`;
  return { svg, width, height };
}

/** Draws the map onto a canvas at `scale`. */
async function rasterize(map: MindMap, layout: MapLayout, theme: Theme, scale: number) {
  const { svg, width, height } = await buildSvg(map, layout, theme);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Görsel oluşturulamadı.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = theme.canvas;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    return { canvas, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Görsel oluşturulamadı.'))), type, quality));

/** Exported picture size in px, before scaling (bounds plus padding). */
const approxSize = (l: MapLayout): [number, number] => [l.bounds.maxX - l.bounds.minX + PAD * 2 + 24, l.bounds.maxY - l.bounds.minY + PAD * 2 + 24];

/** Largest scale that keeps the canvas within browser limits. */
function safeScale(width: number, height: number, wanted: number, maxSide = 12000, maxArea = 60e6): number {
  return Math.max(0.25, Math.min(wanted, maxSide / Math.max(width, height), Math.sqrt(maxArea / (width * height))));
}

export async function exportSvg(map: MindMap, layout: MapLayout, theme: Theme) {
  const { svg } = await buildSvg(map, layout, theme);
  return saveExport(`${safeFileName(map.title)}.svg`, svg, 'image/svg+xml');
}

export async function exportPng(map: MindMap, layout: MapLayout, theme: Theme, scale = 2) {
  const { canvas } = await rasterize(map, layout, theme, safeScale(...approxSize(layout), scale));
  return saveExport(`${safeFileName(map.title)}.png`, await toBlob(canvas, 'image/png'), 'image/png');
}

/** PDF holding a high-resolution picture of the map, fitted to an A4 page. */
export async function exportPdf(map: MindMap, layout: MapLayout, theme: Theme) {
  const [w, h] = approxSize(layout);
  // Aim for about 300 dpi on A4 (≈3500 px on the long side), more for big maps.
  const scale = safeScale(w, h, Math.max(2, 3500 / Math.max(w, h)), 9000, 50e6);
  const { canvas, width, height } = await rasterize(map, layout, theme, scale);
  const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
  const pdf = buildImagePdf(jpeg, {
    width: canvas.width,
    height: canvas.height,
    displayWidth: width * 0.75,
    displayHeight: height * 0.75,
    title: map.title,
  });
  return saveExport(`${safeFileName(map.title)}.pdf`, pdf, 'application/pdf');
}

export function exportMarkdown(map: MindMap) {
  return saveExport(`${safeFileName(map.title)}.md`, toMarkdown(map), 'text/markdown');
}

export function exportOpml(map: MindMap) {
  return saveExport(`${safeFileName(map.title)}.opml`, toOPML(map), 'text/x-opml');
}

export function exportKeizu(map: MindMap) {
  return saveExport(`${safeFileName(map.title)}.keizu`, encodeKeizu(map), 'application/x-keizu');
}

/** Single readable JSON file with images inlined: diff-friendly for git. */
export function exportPlainJson(map: MindMap) {
  return saveExport(`${safeFileName(map.title)}.json`, encodePlainJson(map), 'application/json');
}
