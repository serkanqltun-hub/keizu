// Files on disk, on both platforms. The desktop shell reads and writes any
// path through its own commands and native dialogs. In the browser, Chromium
// based browsers get real file handles (File System Access API) so a map can
// stay linked to a file; other browsers fall back to upload and download.

import { encodeKeizu, encodePlainJson } from '../core/archive';
import type { MindMap } from '../core/model';
import type { FileLink } from '../sync/types';

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
  /** Set when the map can be saved back to this file. */
  link?: FileLink;
}

/** Extensions Keizu can open. */
export const OPEN_EXTENSIONS = ['keizu', 'json', 'xmind', 'opml', 'md', 'markdown', 'txt'];
const LINKABLE = /\.(keizu|json)$/i;

// Parts of the File System Access API that TypeScript's DOM types lack.
type PermissionMode = { mode: 'read' | 'readwrite' };
interface HandleWithPermissions extends FileSystemFileHandle {
  queryPermission?(o: PermissionMode): Promise<PermissionState>;
  requestPermission?(o: PermissionMode): Promise<PermissionState>;
}
interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}
interface FsWindow {
  showOpenFilePicker?(o: { multiple?: boolean; types?: PickerType[]; excludeAcceptAllOption?: boolean }): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?(o: { suggestedName?: string; types?: PickerType[] }): Promise<FileSystemFileHandle>;
}
const fsWindow = () => window as unknown as FsWindow;

/** True when the browser can keep a map linked to a file on disk. */
export const canLinkFiles = () => isDesktop || typeof fsWindow().showSaveFilePicker === 'function';

const KEIZU_TYPES: PickerType[] = [
  { description: 'Keizu haritası', accept: { 'application/x-keizu': ['.keizu'] } },
  { description: 'Düz JSON (git dostu)', accept: { 'application/json': ['.json'] } },
];

async function tauri() {
  const [{ invoke }, dialog] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/plugin-dialog')]);
  return { invoke, dialog };
}

const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

const isAbort = (e: unknown) => (e as DOMException)?.name === 'AbortError';

// ---------- opening ----------

/** Reads a file by path (desktop only). */
export async function readPath(path: string): Promise<PickedFile> {
  const { invoke } = await tauri();
  const buf = await invoke<ArrayBuffer>('read_file', { path });
  const name = baseName(path);
  return { name, bytes: new Uint8Array(buf), link: LINKABLE.test(name) ? { kind: 'path', path, name } : undefined };
}

/** Shows an open dialog. Resolves with nothing when the user cancels. */
export async function pickFiles(): Promise<PickedFile[]> {
  if (isDesktop) {
    const { dialog } = await tauri();
    const picked = await dialog.open({ multiple: true, filters: [{ name: 'Haritalar', extensions: OPEN_EXTENSIONS }] });
    const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
    return Promise.all(paths.map(readPath));
  }
  const w = fsWindow();
  if (w.showOpenFilePicker) {
    try {
      const handles = await w.showOpenFilePicker({
        multiple: true,
        types: [{ description: 'Haritalar', accept: { 'application/octet-stream': OPEN_EXTENSIONS.map((e) => `.${e}`) } }],
      });
      return Promise.all(
        handles.map(async (handle) => {
          const file = await handle.getFile();
          const link: FileLink | undefined = LINKABLE.test(file.name) ? { kind: 'handle', handle, name: file.name } : undefined;
          return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), link };
        }),
      );
    } catch (e) {
      if (isAbort(e)) return [];
      throw e;
    }
  }
  return pickWithInput();
}

function pickWithInput(): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = OPEN_EXTENSIONS.map((e) => `.${e}`).join(',');
    input.onchange = () => resolve(fromFileList(input.files));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

/** Files dropped on the window or chosen with a plain file input. */
export async function fromFileList(list: FileList | null): Promise<PickedFile[]> {
  return Promise.all([...(list ?? [])].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

// ---------- saving ----------

/** File contents for a map, chosen by the file's extension. */
export function encodeForFile(map: MindMap, name: string): Uint8Array {
  return /\.json$/i.test(name) ? new TextEncoder().encode(encodePlainJson(map)) : encodeKeizu(map);
}

/** Asks where to keep a map. Undefined when cancelled or not supported. */
export async function chooseSaveTarget(suggestedName: string): Promise<FileLink | undefined> {
  if (isDesktop) {
    const { dialog } = await tauri();
    const path = await dialog.save({
      defaultPath: suggestedName,
      filters: [
        { name: 'Keizu haritası', extensions: ['keizu'] },
        { name: 'Düz JSON (git dostu)', extensions: ['json'] },
      ],
    });
    return path ? { kind: 'path', path, name: baseName(path) } : undefined;
  }
  const w = fsWindow();
  if (!w.showSaveFilePicker) return undefined;
  try {
    const handle = await w.showSaveFilePicker({ suggestedName, types: KEIZU_TYPES });
    return { kind: 'handle', handle, name: handle.name };
  } catch (e) {
    if (isAbort(e)) return undefined;
    throw e;
  }
}

/**
 * Writes to a linked file. In the browser the permission may have lapsed
 * since the last visit; it is only asked for again when `interactive` (the
 * request needs a click). Returns false when permission is missing.
 */
export async function writeLink(link: FileLink, bytes: Uint8Array, interactive = false): Promise<boolean> {
  if (link.kind === 'path') {
    const { invoke } = await tauri();
    await invoke('write_file', bytes, { headers: { path: encodeURIComponent(link.path) } });
    return true;
  }
  const handle = link.handle as HandleWithPermissions;
  let state = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
  if (state !== 'granted' && interactive) state = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
  if (state !== 'granted') return false;
  const writable = await handle.createWritable();
  await writable.write(bytes as Uint8Array<ArrayBuffer>);
  await writable.close();
  return true;
}

/** Whether a linked file can be written without asking first. */
export async function linkWritable(link: FileLink): Promise<boolean> {
  if (link.kind === 'path') return true;
  const handle = link.handle as HandleWithPermissions;
  return ((await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted') === 'granted';
}

/** Browser download through a temporary link. */
export function download(name: string, data: Blob | string | Uint8Array, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Saves an export (PNG, PDF, OPML...). The desktop app asks where; the
 * browser downloads it. Returns false when the user cancelled.
 */
export async function saveExport(name: string, data: Blob | string | Uint8Array, type: string): Promise<boolean> {
  if (!isDesktop) {
    download(name, data, type);
    return true;
  }
  const ext = name.split('.').pop() ?? '';
  const { dialog, invoke } = await tauri();
  const path = await dialog.save({ defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (!path) return false;
  const bytes =
    typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
  await invoke('write_file', bytes, { headers: { path: encodeURIComponent(path) } });
  return true;
}

/** Files the desktop app was asked to open (double-click, command line). */
export async function takeOpenedFiles(): Promise<string[]> {
  if (!isDesktop) return [];
  const { invoke } = await tauri();
  return invoke<string[]>('take_opened_files');
}

/** Calls `fn` when the OS asks the running desktop app to open files. */
export async function onOpenFiles(fn: (paths: string[]) => void): Promise<() => void> {
  if (!isDesktop) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<string[]>('open-files', (e) => fn(e.payload));
}
