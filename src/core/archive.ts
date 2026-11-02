// The .keizu file: a zip package holding the map as readable JSON plus its
// images as separate files. Plain JSON (the phase 1 format, and the
// git-friendly option) is still read and written; images are then inlined
// as data URLs.
//
//   manifest.json          { "format": "keizu/1", "package": 1 }
//   map.json               the map; resources point at files below
//   resources/<id>.<ext>   topic images

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { fromJSON, toJSON } from './io';
import { pruneResources, type MindMap } from './model';

export const PACKAGE_VERSION = 1;

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};
const MIME: Record<string, string> = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));
MIME.jpeg = 'image/jpeg';

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Splits a data URL into its type and bytes. */
export function parseDataUrl(url: string): { mime: string; bytes: Uint8Array } | undefined {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!m) return undefined;
  const mime = m[1] || 'application/octet-stream';
  const bytes = m[2] ? base64ToBytes(m[3]) : strToU8(decodeURIComponent(m[3]));
  return { mime, bytes };
}

export function toDataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

export function mimeFromName(name: string): string {
  return MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

/** Builds a .keizu package. */
export function encodeKeizu(input: MindMap): Uint8Array {
  const map = pruneResources(input);
  const files: Zippable = {};
  const refs: Record<string, string> = {};
  for (const [id, url] of Object.entries(map.resources ?? {})) {
    const parsed = parseDataUrl(url);
    if (!parsed) continue;
    const path = `resources/${id}.${EXT[parsed.mime] ?? 'bin'}`;
    files[path] = [parsed.bytes, { level: 0 }]; // images are already compressed
    refs[id] = path;
  }
  const content: MindMap = { ...map, resources: Object.keys(refs).length ? refs : undefined };
  files['manifest.json'] = strToU8(JSON.stringify({ format: 'keizu/1', package: PACKAGE_VERSION }, null, 2));
  files['map.json'] = strToU8(toJSON(content));
  return zipSync(files, { level: 6, mtime: new Date(map.updatedAt) });
}

/** Plain JSON with images inlined: one readable text file, friendly to git diffs. */
export function encodePlainJson(input: MindMap): string {
  return toJSON(pruneResources(input));
}

/** Reads any .keizu file: a zip package or plain JSON. */
export function decodeKeizu(bytes: Uint8Array): MindMap {
  if (!isZip(bytes)) return fromJSON(strFromU8(bytes).replace(/^﻿/, ''));
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('Dosya bozuk görünüyor: paket açılamadı.');
  }
  const json = files['map.json'];
  if (!json) throw new Error('Bu paket bir Keizu haritası içermiyor.');
  const map = fromJSON(strFromU8(json));
  if (map.resources) {
    const resources: Record<string, string> = {};
    for (const [id, ref] of Object.entries(map.resources)) {
      if (ref.startsWith('data:')) resources[id] = ref;
      else if (files[ref]) resources[id] = toDataUrl(mimeFromName(ref), files[ref]);
    }
    map.resources = Object.keys(resources).length ? resources : undefined;
  }
  return map;
}
