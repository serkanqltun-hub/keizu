// Turns any supported file into Keizu maps, picking the reader by extension
// (and by content, for files with an unexpected name).

import { strFromU8 } from 'fflate';
import { decodeKeizu, isZip } from './archive';
import { fromMarkdown, fromOPML } from './io';
import type { MindMap } from './model';
import { fromXMind } from './xmind';

export function importFile(name: string, bytes: Uint8Array): MindMap[] {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const base = name.replace(/\.[^.]+$/, '') || 'İçe aktarılan';
  if (ext === 'xmind') return fromXMind(bytes, base);
  if (isZip(bytes)) {
    // A zip is either our package or an XMind file under another name.
    try {
      return [decodeKeizu(bytes)];
    } catch {
      return fromXMind(bytes, base);
    }
  }
  const text = strFromU8(bytes).replace(/^﻿/, '');
  if (ext === 'opml' || /^\s*(<\?xml[^>]*>\s*)?<opml[\s>]/i.test(text)) return [fromOPML(text, base)];
  if (ext === 'md' || ext === 'markdown' || ext === 'txt') return [fromMarkdown(text, base)];
  return [decodeKeizu(bytes)];
}
