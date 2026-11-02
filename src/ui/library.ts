// Bringing files into the on-device library.

import { importFile } from '../core/importFile';
import { newId, type MindMap } from '../core/model';
import type { FileLink, LibraryStore } from '../sync/types';
import type { PickedFile } from './platform';

async function sameFile(a: FileLink | undefined, b: FileLink): Promise<boolean> {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === 'path' && b.kind === 'path') return a.path === b.path;
  if (a.kind === 'handle' && b.kind === 'handle') return a.handle.isSameEntry(b.handle).catch(() => false);
  return false;
}

/**
 * Adds files to the library and returns the maps to open. A .keizu file that
 * is already linked to a library map refreshes that map (the file wins; the
 * library copy is kept in version history first). Any other file whose map id
 * is already taken comes in as a copy, so nothing is overwritten silently.
 */
export async function importIntoLibrary(store: LibraryStore, files: PickedFile[]): Promise<{ maps: MindMap[]; errors: string[] }> {
  const maps: MindMap[] = [];
  const errors: string[] = [];
  for (const file of files) {
    let found: MindMap[];
    try {
      found = importFile(file.name, file.bytes);
    } catch (e) {
      errors.push(`${file.name}: ${(e as Error).message || 'açılamadı'}`);
      continue;
    }
    for (let map of found) {
      const link = found.length === 1 ? file.link : undefined;
      const linkedId = link?.kind === 'path' ? await store.findByPath(link.path) : undefined;
      const existing = await store.get(linkedId ?? map.id);
      if (existing) {
        const same = !!link && (linkedId !== undefined || (await sameFile(await store.getLink(existing.id), link)));
        if (same) {
          await store.addVersion(existing, 'open');
          map = { ...map, id: existing.id };
        } else {
          map = { ...map, id: newId('m') };
        }
      }
      await store.save(map);
      if (link) await store.setLink(map.id, link);
      maps.push(map);
    }
  }
  return { maps, errors };
}
