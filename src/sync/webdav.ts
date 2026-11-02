// WebDAV adapter, for people who already have Nextcloud, ownCloud or another
// WebDAV share and don't want to run Keizu Server. Each map is one JSON file
// (<id>.keizu.json) in a folder; the file's ETag serves as its revision, and
// If-Match / If-None-Match make pushes safe against concurrent edits.

import { normalizeMap, type MindMap } from '../core/model';
import { decodeEntities, parseXml, type XmlNode } from '../core/xml';
import { AuthError, ConflictError, NetworkError, type RemoteMap, type RemoteSummary, type SyncAdapter } from './types';
import type { Fetch } from './keizuServer';

const SUFFIX = '.keizu.json';

const local = (name: string) => name.slice(name.indexOf(':') + 1).toLowerCase();

function find(n: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of n.children) {
    if (local(c.name) === name) out.push(c);
    find(c, name, out);
  }
  return out;
}

const textOf = (n: XmlNode | undefined): string => (n ? decodeEntities(n.text + n.children.map(textOf).join('')).trim() : '');

/** Lists the map files in a PROPFIND multistatus reply. */
export function parsePropfind(xml: string): { name: string; etag: string; modified?: string }[] {
  const out: { name: string; etag: string; modified?: string }[] = [];
  for (const r of find(parseXml(xml), 'response')) {
    const href = textOf(find(r, 'href')[0]);
    const name = decodeURIComponent(href.replace(/\/+$/, '').split('/').pop() ?? '');
    if (!name.endsWith(SUFFIX)) continue;
    const etag = textOf(find(r, 'getetag')[0]);
    const modified = textOf(find(r, 'getlastmodified')[0]) || undefined;
    out.push({ name, etag, modified });
  }
  return out;
}

export class WebDavAdapter implements SyncAdapter {
  readonly kind = 'webdav' as const;
  private folder: string;
  private auth: string;

  constructor(
    private f: Fetch,
    folderUrl: string,
    username: string,
    password: string,
  ) {
    this.folder = folderUrl.replace(/\/+$/, '') + '/';
    this.auth = `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${username}:${password}`)))}`;
  }

  private url(id: string) {
    return this.folder + encodeURIComponent(id) + SUFFIX;
  }

  private async req(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', this.auth);
    let res: Response;
    try {
      res = await this.f(url, { ...init, headers });
    } catch (e) {
      throw new NetworkError(`WebDAV sunucusuna ulaşılamadı (${(e as Error).message || 'ağ hatası'}).`);
    }
    if (res.status === 401 || res.status === 403) throw new AuthError('WebDAV kullanıcı adı veya şifresi kabul edilmedi.');
    return res;
  }

  /** Checks the folder exists, creating it when missing. */
  async check(): Promise<void> {
    const res = await this.req(this.folder, { method: 'PROPFIND', headers: { Depth: '0' } });
    if (res.status === 404) {
      const mk = await this.req(this.folder, { method: 'MKCOL' });
      if (!mk.ok) throw new Error(`Klasör oluşturulamadı (${mk.status}).`);
      return;
    }
    if (res.status !== 207 && !res.ok) throw new Error(`WebDAV klasörü okunamadı (${res.status}).`);
  }

  async list(): Promise<RemoteSummary[]> {
    const res = await this.req(this.folder, {
      method: 'PROPFIND',
      headers: { Depth: '1', 'Content-Type': 'application/xml' },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:getlastmodified/></d:prop></d:propfind>',
    });
    if (res.status === 404) return [];
    if (res.status !== 207) throw new Error(`WebDAV listesi alınamadı (${res.status}).`);
    return parsePropfind(await res.text()).map((e) => ({
      id: e.name.slice(0, -SUFFIX.length),
      title: e.name.slice(0, -SUFFIX.length),
      rev: e.etag || e.modified || '',
      updatedAt: e.modified,
    }));
  }

  async pull(id: string): Promise<RemoteMap | undefined> {
    const res = await this.req(this.url(id));
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`Harita indirilemedi (${res.status}).`);
    const rev = res.headers.get('ETag') ?? res.headers.get('Last-Modified') ?? '';
    return { map: normalizeMap(await res.json()), rev };
  }

  async push(map: MindMap, baseRev: string | null): Promise<{ rev: string }> {
    const cond: Record<string, string> = baseRev === null ? { 'If-None-Match': '*' } : baseRev.startsWith('"') || baseRev.startsWith('W/') ? { 'If-Match': baseRev } : {};
    const res = await this.req(this.url(map.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...cond },
      body: JSON.stringify(map),
    });
    if (res.status === 412) {
      const theirs = await this.pull(map.id);
      if (theirs) throw new ConflictError(theirs);
      return this.push(map, ''); // vanished meanwhile: write without a condition
    }
    if (!res.ok) throw new Error(`Harita gönderilemedi (${res.status}).`);
    let rev = res.headers.get('ETag');
    if (!rev) {
      // Some servers leave ETag off PUT replies: ask for it.
      const head = await this.req(this.url(map.id), { method: 'HEAD' });
      rev = head.headers.get('ETag') ?? head.headers.get('Last-Modified') ?? String(Date.now());
    }
    return { rev };
  }

  async remove(id: string): Promise<void> {
    const res = await this.req(this.url(id), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`Harita silinemedi (${res.status}).`);
  }
}
