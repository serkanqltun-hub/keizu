// Browser-side exports: SVG, PNG, Markdown and .keizu files.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { toJSON, toMarkdown } from '../core/io';
import type { MapLayout } from '../core/layout';
import type { MindMap } from '../core/model';
import type { Theme } from '../core/themes';
import { MapSvg } from './MapSvg';

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

export function download(name: string, data: Blob | string, type = 'application/octet-stream') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

export async function exportSvg(map: MindMap, layout: MapLayout, theme: Theme) {
  const { svg } = await buildSvg(map, layout, theme);
  download(`${safeFileName(map.title)}.svg`, svg, 'image/svg+xml');
}

export async function exportPng(map: MindMap, layout: MapLayout, theme: Theme, scale = 2) {
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
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('PNG oluşturulamadı.');
    download(`${safeFileName(map.title)}.png`, blob);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function exportMarkdown(map: MindMap) {
  download(`${safeFileName(map.title)}.md`, toMarkdown(map), 'text/markdown');
}

export function exportKeizu(map: MindMap) {
  download(`${safeFileName(map.title)}.keizu`, toJSON(map), 'application/json');
}
