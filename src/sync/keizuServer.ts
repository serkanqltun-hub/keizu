// Keizu Server: finding it from a bare address, signing in (password or
// pairing code) and the sync adapter for its REST API.

import { normalizeMap, type MindMap } from '../core/model';
import { AuthError, ConflictError, NetworkError, type RemoteMap, type RemoteSummary, type SyncAdapter } from './types';

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The sync API this app speaks, and the oldest server API it can use. */
export const CLIENT_API = 1;
export const MIN_SERVER_API = 1;

export interface ServerInfo {
  /** Where the server lives, e.g. https://notlar.example.com */
  server: string;
  /** Absolute API base, e.g. https://notlar.example.com/api/v1 */
  api: string;
  name: string;
  version: string;
  apiVersion: number;
  minClientApi: number;
  /** 'ok', or which side needs an update. */
  compat: 'ok' | 'update-server' | 'update-app';
}

export interface Session {
  token: string;
  user: { id: number; username: string; admin: boolean };
}

/** "notlar.example.com" → "https://notlar.example.com". Keeps http:// when typed. */
export function normalizeServer(input: string): string {
  let s = input.trim();
  if (!s) throw new Error('Sunucu adresi boş.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  const u = new URL(s);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Adres http:// veya https:// ile başlamalı.');
  const path = u.pathname.replace(/\/+$/, '').replace(/\/\.well-known\/keizu$/, '');
  return `${u.protocol}//${u.host}${path}`;
}

async function call(f: Fetch, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await f(url, init);
  } catch (e) {
    throw new NetworkError(`Sunucuya ulaşılamadı (${(e as Error).message || 'ağ hatası'}).`);
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const j = await res.json();
    if (j?.message) return String(j.message);
  } catch {
    /* not JSON */
  }
  return `${res.status} ${res.statusText}`.trim();
}

/** Looks up /.well-known/keizu on the server. */
export async function discover(f: Fetch, address: string): Promise<ServerInfo> {
  const server = normalizeServer(address);
  const res = await call(f, `${server}/.well-known/keizu`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(res.status === 404 ? 'Bu adreste bir Keizu Server bulunamadı.' : await errorMessage(res));
  let info: Record<string, unknown>;
  try {
    info = await res.json();
  } catch {
    throw new Error('Bu adreste bir Keizu Server bulunamadı.');
  }
  if (info.keizu !== 'server' || typeof info.api !== 'string') throw new Error('Bu adreste bir Keizu Server bulunamadı.');
  const apiVersion = Number(info.apiVersion) || 1;
  const minClientApi = Number(info.minClientApi) || 1;
  return {
    server,
    api: new URL(info.api, `${server}/`).toString().replace(/\/+$/, ''),
    name: String(info.name ?? 'Keizu Server'),
    version: String(info.version ?? '?'),
    apiVersion,
    minClientApi,
    compat: apiVersion < MIN_SERVER_API ? 'update-server' : minClientApi > CLIENT_API ? 'update-app' : 'ok',
  };
}

async function signIn(f: Fetch, api: string, path: string, body: unknown): Promise<Session> {
  const res = await call(f, `${api}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as Session;
}

export const login = (f: Fetch, api: string, username: string, password: string, device: string) =>
  signIn(f, api, '/auth/login', { username, password, device });

export const pair = (f: Fetch, api: string, code: string, device: string) => signIn(f, api, '/auth/pair', { code, device });

/** Parses keizu://connect?server=…&code=… (also accepts the same query on an https link). */
export function parseConnectLink(link: string): { server: string; code?: string } | undefined {
  try {
    const u = new URL(link);
    const server = u.searchParams.get('server');
    if (!server) return undefined;
    const code = u.searchParams.get('code')?.replace(/\D/g, '') || undefined;
    return { server: normalizeServer(server), code };
  } catch {
    return undefined;
  }
}

export class KeizuServerAdapter implements SyncAdapter {
  readonly kind = 'keizu' as const;

  constructor(
    private f: Fetch,
    private api: string,
    private token: string,
    private device = 'Keizu',
  ) {}

  private async req(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    headers.set('X-Keizu-Device', this.device);
    const res = await call(this.f, `${this.api}${path}`, { ...init, headers });
    if (res.status === 401) throw new AuthError('Sunucu oturumu kapandı. Yeniden bağlan.');
    return res;
  }

  private async ok(res: Response): Promise<Response> {
    if (!res.ok) throw new Error(await errorMessage(res));
    return res;
  }

  async me(): Promise<{ user: Session['user']; usedBytes: number; quotaBytes: number }> {
    return (await this.ok(await this.req('/me'))).json();
  }

  async list(): Promise<RemoteSummary[]> {
    const { maps } = (await (await this.ok(await this.req('/maps'))).json()) as {
      maps: { id: string; title: string; version: number; updatedAt: string }[];
    };
    return maps.map((m) => ({ id: m.id, title: m.title, rev: String(m.version), updatedAt: m.updatedAt }));
  }

  async pull(id: string): Promise<RemoteMap | undefined> {
    const res = await this.req(`/maps/${encodeURIComponent(id)}`);
    if (res.status === 404) return undefined;
    await this.ok(res);
    const rev = res.headers.get('X-Keizu-Version') ?? res.headers.get('ETag')?.replace(/\D/g, '') ?? '0';
    return { map: normalizeMap(await res.json()), rev };
  }

  async push(map: MindMap, baseRev: string | null): Promise<{ rev: string }> {
    const res = await this.req(`/maps/${encodeURIComponent(map.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(baseRev === null ? { 'If-None-Match': '*' } : { 'If-Match': `"${baseRev}"` }) },
      body: JSON.stringify(map),
    });
    if (res.status === 409 || res.status === 412) {
      const j = (await res.json()) as { version: number; map: MindMap };
      throw new ConflictError({ map: normalizeMap(j.map), rev: String(j.version) });
    }
    await this.ok(res);
    const { version } = (await res.json()) as { version: number };
    return { rev: String(version) };
  }

  async remove(id: string): Promise<void> {
    const res = await this.req(`/maps/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.status !== 404) await this.ok(res);
  }

  async logout(): Promise<void> {
    await this.req('/auth/logout', { method: 'POST' }).catch(() => {});
  }

  /** A pairing code (and QR) to sign another device in. */
  async pairCode(): Promise<{ code: string; expiresAt: string; link: string; qrSvg: string }> {
    return (await this.ok(await this.req('/pair-codes', { method: 'POST' }))).json();
  }

  async versions(id: string): Promise<{ version: number; savedAt: string; device: string; size: number }[]> {
    const res = await this.req(`/maps/${encodeURIComponent(id)}/versions`);
    if (res.status === 404) return [];
    return ((await (await this.ok(res)).json()) as { versions: [] }).versions;
  }

  async version(id: string, v: number): Promise<MindMap> {
    return normalizeMap(await (await this.ok(await this.req(`/maps/${encodeURIComponent(id)}/versions/${v}`))).json());
  }
}
