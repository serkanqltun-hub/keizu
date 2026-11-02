// The HTTP API. Plain node:http, no framework: the surface is small and the
// image stays tiny. Every route except discovery, sign-in and the panel's
// static files needs `Authorization: Bearer <token>`.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync, createReadStream, rmSync, statSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import type { Db } from './db.ts';
import {
  Limiter,
  acceptInvite,
  createInvite,
  createPairCode,
  findInvite,
  findUser,
  getUser,
  inviteLink,
  issueToken,
  redeemPairCode,
  setPassword,
  userForToken,
  verifyPassword,
  type User,
} from './auth.ts';
import {
  changesSince,
  deleteMap,
  getMap,
  getVersion,
  listMaps,
  listTrash,
  listVersions,
  putMap,
  restoreMap,
  totalBytes,
  usedBytes,
  validId,
} from './maps.ts';
import { backupNow } from './backup.ts';
import { LiveHub } from './live.ts';
import {
  accessTo,
  ensureViewLink,
  getViewLink,
  isRole,
  listShares,
  removeShare,
  removeViewLink,
  setShare,
  shareCounts,
  sharedWith,
  viewLinkTarget,
  viewLinkUrl,
} from './shares.ts';

export const SERVER_VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
/** The sync API this server speaks, and the oldest one it still accepts. */
export const API_VERSION = 1;
export const MIN_CLIENT_API = 1;

export interface Config {
  db: Db;
  /** Where backups go. */
  backupDir: string;
  /** Trust X-Forwarded-For / X-Forwarded-Proto (set when behind a reverse proxy). */
  trustProxy: boolean;
  maxBodyBytes: number;
  /** Public address, e.g. https://keizu.example.com. Guessed from the request when empty. */
  publicUrl?: string;
  /** Default quota for new users, in bytes (0 = unlimited). */
  defaultQuotaBytes: number;
  /** Largest picture in a map, in bytes (0 = unlimited). */
  maxImageBytes?: number;
  /** Cap on all data stored on the server, in bytes (0 = unlimited). */
  totalBytes?: number;
  /** Stop writing when the data disk has less free space than this. */
  minFreeBytes?: number;
  /** Free bytes on the data disk. */
  freeBytes?: () => number;
  log?: (msg: string) => void;
  /** Built web app (the Keizu editor) served at "/". Without it "/" opens the panel. */
  webDir?: string;
  /** Live collaboration rooms; made by createApp. */
  live?: LiveHub;
}

class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Req = IncomingMessage & { params: Record<string, string>; query: URLSearchParams; ip: string };
type Ctx = { req: Req; res: ServerResponse; cfg: Config };
type Handler = (ctx: Ctx & { user: User; tokenId: number }) => unknown | Promise<unknown>;
type PublicHandler = (ctx: Ctx) => unknown | Promise<unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  auth: 'none' | 'user' | 'admin';
  fn: Handler | PublicHandler;
}

const routes: Route[] = [];
function open(method: string, path: string, fn: PublicHandler) {
  add(method, path, 'none', fn);
}
function route(method: string, path: string, auth: 'user' | 'admin', fn: Handler) {
  add(method, path, auth, fn);
}
function add(method: string, path: string, auth: Route['auth'], fn: Handler | PublicHandler) {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' +
      path.replace(/:(\w+)/g, (_, k) => {
        keys.push(k);
        return '([^/]+)';
      }) +
      '$',
  );
  routes.push({ method, pattern, keys, auth, fn });
}

// ---------- helpers ----------

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
// The admin/account panel lives under /panel/; the web app (if bundled) at "/".
const PANEL: Record<string, string> = {
  '/panel/': 'index.html',
  '/panel/panel.js': 'panel.js',
  '/panel/panel.css': 'panel.css',
  '/panel/icon.svg': 'icon.svg',
};
const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json',
  map: 'application/json; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  ico: 'image/x-icon',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
  wasm: 'application/wasm',
};
const PANEL_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'";
// The editor sets inline styles and talks to whatever server the user connects to.
const WEB_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "font-src 'self' data:; connect-src 'self' https: http:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'";

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(text);
}

async function readBody(req: IncomingMessage, max: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > max) throw new HttpError(413, 'too_large', `Gövde çok büyük (en çok ${Math.round(max / 1048576)} MB).`);
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson<T = Record<string, unknown>>(ctx: Ctx): Promise<T> {
  const text = await readBody(ctx.req, 1 << 20);
  try {
    const v = JSON.parse(text || '{}');
    if (v && typeof v === 'object') return v as T;
  } catch {
    /* fall through */
  }
  throw new HttpError(400, 'bad_json', 'Geçersiz JSON.');
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

function publicUrl(ctx: Ctx): string {
  if (ctx.cfg.publicUrl) return ctx.cfg.publicUrl.replace(/\/+$/, '');
  const fwdProto = ctx.cfg.trustProxy ? String(ctx.req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() : '';
  const fwdHost = ctx.cfg.trustProxy ? String(ctx.req.headers['x-forwarded-host'] ?? '').split(',')[0].trim() : '';
  const proto = fwdProto || ((ctx.req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http');
  return `${proto}://${fwdHost || ctx.req.headers.host || 'localhost'}`;
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress ?? '?';
}

function parseVersionHeader(v: string | string[] | undefined): number | null | undefined {
  if (v === undefined) return undefined;
  const s = String(v).trim().replace(/^W\//, '').replace(/"/g, '');
  if (s === '*') return undefined;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function serverInfo() {
  return {
    keizu: 'server',
    name: 'Keizu Server',
    version: SERVER_VERSION,
    api: '/api/v1',
    apiVersion: API_VERSION,
    minClientApi: MIN_CLIENT_API,
    signup: false,
    pairing: true,
    /** Optional abilities newer apps can use: per-person sharing, live editing, read-only links. */
    features: ['share', 'live', 'viewLinks'],
  };
}

// ---------- discovery ----------

open('GET', '/healthz', ({ res }) => send(res, 200, { ok: true }));
open('GET', '/.well-known/keizu', ({ res }) => send(res, 200, serverInfo(), { 'Cache-Control': 'max-age=60' }));
open('GET', '/api/v1/info', ({ res }) => send(res, 200, serverInfo()));

// ---------- sign-in ----------

// Failed sign-ins per IP and per account; failed pairing codes per IP and
// in total, since a 6-digit code is only safe while guessing stays slow.
const loginIp = new Limiter(20, 15 * 60e3);
const loginUser = new Limiter(10, 15 * 60e3);
const pairIp = new Limiter(10, 15 * 60e3);
const pairAll = new Limiter(100, 10 * 60e3);

function signedIn(db: Db, user: User, device: string) {
  return { token: issueToken(db, user.id, device), user: { id: user.id, username: user.username, admin: !!user.is_admin } };
}

open('POST', '/api/v1/auth/login', async (ctx) => {
  const { db } = ctx.cfg;
  const body = await readJson(ctx);
  const username = str(body.username, 40).trim();
  const password = str(body.password, 500);
  const ipKey = ctx.req.ip;
  const userKey = username.toLowerCase();
  if (loginIp.blocked(ipKey) || loginUser.blocked(userKey)) {
    throw new HttpError(429, 'rate_limited', 'Çok fazla hatalı deneme. 15 dakika sonra yeniden dene.');
  }
  const user = username ? findUser(db, username) : undefined;
  if (!user || !verifyPassword(password, user.password_hash)) {
    loginIp.fail(ipKey);
    loginUser.fail(userKey);
    throw new HttpError(401, 'bad_credentials', 'Kullanıcı adı veya şifre yanlış.');
  }
  loginUser.reset(userKey);
  send(ctx.res, 200, signedIn(db, user, str(body.device, 80) || 'Cihaz'));
});

open('POST', '/api/v1/auth/pair', async (ctx) => {
  const { db } = ctx.cfg;
  const body = await readJson(ctx);
  if (pairIp.blocked(ctx.req.ip) || pairAll.blocked('all')) {
    throw new HttpError(429, 'rate_limited', 'Çok fazla hatalı kod denendi. Birkaç dakika sonra yeniden dene.');
  }
  const userId = redeemPairCode(db, str(body.code, 20));
  const user = userId ? getUser(db, userId) : undefined;
  if (!user) {
    pairIp.fail(ctx.req.ip);
    pairAll.fail('all');
    throw new HttpError(401, 'bad_code', 'Kod yanlış veya süresi dolmuş. Sunucu panelinden yeni bir kod al.');
  }
  send(ctx.res, 200, signedIn(db, user, str(body.device, 80) || 'Cihaz'));
});

route('POST', '/api/v1/auth/logout', 'user', ({ cfg, res, tokenId }) => {
  cfg.db.prepare('DELETE FROM tokens WHERE id = ?').run(tokenId);
  send(res, 200, { ok: true });
});

// ---------- account ----------

route('GET', '/api/v1/me', 'user', ({ cfg, res, user }) => {
  send(res, 200, {
    user: { id: user.id, username: user.username, admin: !!user.is_admin },
    usedBytes: usedBytes(cfg.db, user.id),
    quotaBytes: user.quota_bytes,
  });
});

route('PUT', '/api/v1/me/password', 'user', async (ctx) => {
  const { db } = ctx.cfg;
  const body = await readJson(ctx);
  const full = findUser(db, ctx.user.username)!;
  if (!verifyPassword(str(body.current, 500), full.password_hash)) throw new HttpError(401, 'bad_credentials', 'Mevcut şifre yanlış.');
  try {
    setPassword(db, ctx.user.id, str(body.next, 500));
  } catch (e) {
    throw new HttpError(400, 'weak_password', (e as Error).message);
  }
  send(ctx.res, 200, { ok: true, token: issueToken(db, ctx.user.id, 'Panel') });
});

route('GET', '/api/v1/devices', 'user', ({ cfg, res, user, tokenId }) => {
  const rows = cfg.db
    .prepare('SELECT id, device, created_at AS createdAt, last_used_at AS lastUsedAt FROM tokens WHERE user_id = ? ORDER BY last_used_at DESC')
    .all(user.id) as { id: number }[];
  send(res, 200, { devices: rows.map((r) => ({ ...r, current: r.id === tokenId })) });
});

route('DELETE', '/api/v1/devices/:id', 'user', ({ cfg, res, req, user }) => {
  cfg.db.prepare('DELETE FROM tokens WHERE id = ? AND user_id = ?').run(Number(req.params.id), user.id);
  send(res, 200, { ok: true });
});

route('POST', '/api/v1/pair-codes', 'user', async (ctx) => {
  const { code, expiresAt } = createPairCode(ctx.cfg.db, ctx.user.id);
  const server = publicUrl(ctx);
  const link = `keizu://connect?server=${encodeURIComponent(server)}&code=${code}`;
  const qrSvg = await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  send(ctx.res, 200, { code, expiresAt: new Date(expiresAt).toISOString(), server, link, qrSvg });
});

// ---------- maps ----------

route('GET', '/api/v1/maps', 'user', ({ cfg, res, user }) => {
  const counts = shareCounts(cfg.db, user.id);
  const maps = listMaps(cfg.db, user.id).map((m) => (counts[m.id] ? { ...m, sharedWith: counts[m.id] } : m));
  send(res, 200, { maps, cursor: changesSince(cfg.db, user.id, 0).cursor });
});

route('GET', '/api/v1/changes', 'user', ({ cfg, res, req, user }) => {
  const since = Math.max(0, Number(req.query.get('since') ?? 0) || 0);
  send(res, 200, changesSince(cfg.db, user.id, since));
});

route('GET', '/api/v1/maps/:id', 'user', ({ cfg, res, req, user }) => {
  const m = getMap(cfg.db, user.id, req.params.id);
  if (!m) throw new HttpError(404, 'not_found', 'Harita bulunamadı.');
  send(res, 200, m.data, { ETag: `"${m.version}"`, 'X-Keizu-Version': String(m.version) });
});

route('PUT', '/api/v1/maps/:id', 'user', async (ctx) => {
  const { req, res, cfg, user } = ctx;
  const id = req.params.id;
  if (!validId(id)) throw new HttpError(400, 'bad_id', 'Geçersiz harita kimliği.');
  const ifMatch = parseVersionHeader(req.headers['if-match']);
  const create = String(req.headers['if-none-match'] ?? '').trim() === '*';
  if (ifMatch === null) throw new HttpError(400, 'bad_version', 'If-Match bir sürüm numarası olmalı.');
  if (ifMatch === undefined && !create) throw new HttpError(428, 'version_required', 'If-Match (sürüm) veya If-None-Match: * gerekli.');
  const body = await readBody(req, cfg.maxBodyBytes);
  const device = String(req.headers['x-keizu-device'] ?? '').slice(0, 80);
  const r = putMap(cfg.db, user.id, id, body, ifMatch ?? null, {
    device,
    quotaBytes: user.quota_bytes,
    maxImageBytes: cfg.maxImageBytes,
    totalBytes: cfg.totalBytes,
    minFreeBytes: cfg.minFreeBytes,
    freeBytes: cfg.freeBytes,
  });
  if (r.ok) {
    cfg.live?.external(user.id, id);
    return send(res, 200, { version: r.version, updatedAt: r.updatedAt }, { ETag: `"${r.version}"` });
  }
  if (r.reason === 'conflict' || r.reason === 'exists') {
    return send(res, r.reason === 'exists' ? 412 : 409, `{"error":"${r.reason}","version":${r.current.version},"map":${r.current.data}}`);
  }
  if (r.reason === 'quota') {
    throw new HttpError(413, 'quota', `Depolama kotan doldu (${Math.round(r.used / 1048576)} / ${Math.round(r.quota / 1048576)} MB).`);
  }
  if (r.reason === 'image') {
    throw new HttpError(413, 'image_too_large', `Haritadaki bir görsel çok büyük (${(r.size / 1048576).toFixed(1)} MB; en çok ${Math.round(r.max / 1048576)} MB).`);
  }
  if (r.reason === 'full') {
    cfg.log?.('UYARI: sunucu depolama sınırına ulaştı; yeni kayıtlar reddediliyor.');
    throw new HttpError(507, 'server_full', 'Sunucunun depolama alanı doldu. Sunucu yöneticisine haber ver.');
  }
  throw new HttpError(400, 'invalid', r.message);
});

route('DELETE', '/api/v1/maps/:id', 'user', ({ cfg, res, req, user }) => {
  if (!deleteMap(cfg.db, user.id, req.params.id)) throw new HttpError(404, 'not_found', 'Harita bulunamadı.');
  cfg.live?.external(user.id, req.params.id);
  send(res, 200, { ok: true });
});

route('POST', '/api/v1/maps/:id/restore', 'user', ({ cfg, res, req, user }) => {
  if (!restoreMap(cfg.db, user.id, req.params.id)) throw new HttpError(404, 'not_found', 'Çöp kutusunda böyle bir harita yok.');
  send(res, 200, { ok: true });
});

route('GET', '/api/v1/trash', 'user', ({ cfg, res, user }) => send(res, 200, { maps: listTrash(cfg.db, user.id) }));

route('GET', '/api/v1/maps/:id/versions', 'user', ({ cfg, res, req, user }) => {
  send(res, 200, { versions: listVersions(cfg.db, user.id, req.params.id) });
});

route('GET', '/api/v1/maps/:id/versions/:v', 'user', ({ cfg, res, req, user }) => {
  const data = getVersion(cfg.db, user.id, req.params.id, Number(req.params.v));
  if (!data) throw new HttpError(404, 'not_found', 'Sürüm bulunamadı.');
  send(res, 200, data, { 'X-Keizu-Version': req.params.v });
});

// ---------- sharing ----------

function ownMap(ctx: Ctx & { user: User }): string {
  const id = ctx.req.params.id;
  if (accessTo(ctx.cfg.db, ctx.user.id, ctx.user.id, id) !== 'owner') {
    throw new HttpError(404, 'not_found', 'Harita bulunamadı. Paylaşmadan önce haritanın sunucuya senkronlanmış olması gerekir.');
  }
  return id;
}

function sharesOf(ctx: Ctx & { user: User }, id: string) {
  const token = getViewLink(ctx.cfg.db, ctx.user.id, id);
  return {
    shares: listShares(ctx.cfg.db, ctx.user.id, id),
    link: token ? viewLinkUrl(publicUrl(ctx), token) : null,
    live: ctx.cfg.live?.present(ctx.user.id, id) ?? 0,
  };
}

route('GET', '/api/v1/maps/:id/shares', 'user', (ctx) => send(ctx.res, 200, sharesOf(ctx, ownMap(ctx))));

route('PUT', '/api/v1/maps/:id/shares/:username', 'user', async (ctx) => {
  const id = ownMap(ctx);
  const body = await readJson(ctx);
  if (!isRole(body.role)) throw new HttpError(400, 'bad_role', 'Yetki "view" (görüntüleyebilir) veya "edit" (düzenleyebilir) olmalı.');
  const target = findUser(ctx.cfg.db, ctx.req.params.username);
  if (!target) throw new HttpError(404, 'no_user', 'Bu sunucuda böyle bir kullanıcı yok. Kullanıcı adını kontrol et.');
  if (target.id === ctx.user.id) throw new HttpError(400, 'self', 'Haritayı kendinle paylaşamazsın.');
  setShare(ctx.cfg.db, ctx.user.id, id, target.id, body.role);
  ctx.cfg.live?.recheck(ctx.user.id, id);
  send(ctx.res, 200, sharesOf(ctx, id));
});

route('DELETE', '/api/v1/maps/:id/shares/:username', 'user', (ctx) => {
  const id = ownMap(ctx);
  const target = findUser(ctx.cfg.db, ctx.req.params.username);
  if (target) removeShare(ctx.cfg.db, ctx.user.id, id, target.id);
  ctx.cfg.live?.recheck(ctx.user.id, id);
  send(ctx.res, 200, sharesOf(ctx, id));
});

route('POST', '/api/v1/maps/:id/link', 'user', (ctx) => {
  const id = ownMap(ctx);
  ensureViewLink(ctx.cfg.db, ctx.user.id, id);
  send(ctx.res, 200, sharesOf(ctx, id));
});

route('DELETE', '/api/v1/maps/:id/link', 'user', (ctx) => {
  const id = ownMap(ctx);
  removeViewLink(ctx.cfg.db, ctx.user.id, id);
  send(ctx.res, 200, sharesOf(ctx, id));
});

route('GET', '/api/v1/shared', 'user', ({ cfg, res, user }) => send(res, 200, { maps: sharedWith(cfg.db, user.id) }));

route('GET', '/api/v1/shared/:owner/:id', 'user', ({ cfg, res, req, user }) => {
  const ownerId = Number(req.params.owner);
  const role = accessTo(cfg.db, user.id, ownerId, req.params.id);
  const m = role ? getMap(cfg.db, ownerId, req.params.id) : undefined;
  if (!m) throw new HttpError(404, 'not_found', 'Harita bulunamadı ya da sana paylaşılmamış.');
  send(res, 200, m.data, { ETag: `"${m.version}"`, 'X-Keizu-Version': String(m.version), 'X-Keizu-Role': role! });
});

// Read-only links work without an account. Wrong tokens count against the
// caller's IP so links can't be guessed.
const linkIp = new Limiter(60, 15 * 60e3);
open('GET', '/api/v1/public/:token', ({ cfg, res, req }) => {
  if (linkIp.blocked(req.ip)) throw new HttpError(429, 'rate_limited', 'Çok fazla deneme. Biraz sonra yeniden dene.');
  const target = viewLinkTarget(cfg.db, req.params.token);
  const m = target ? getMap(cfg.db, target.ownerId, target.mapId) : undefined;
  if (!m) {
    linkIp.fail(req.ip);
    throw new HttpError(404, 'bad_link', 'Bu paylaşım linki geçersiz ya da iptal edilmiş.');
  }
  send(res, 200, m.data, { 'X-Keizu-Version': String(m.version) });
});

// ---------- administration ----------

const MB = 1048576;
const userRow = (db: Db, u: User) => ({
  id: u.id,
  username: u.username,
  admin: !!u.is_admin,
  quotaMb: Math.round(u.quota_bytes / MB),
  usedMb: Math.round((usedBytes(db, u.id) / MB) * 10) / 10,
  maps: (db.prepare('SELECT COUNT(*) AS n FROM maps WHERE user_id = ? AND deleted_at IS NULL').get(u.id) as { n: number }).n,
  devices: (db.prepare('SELECT COUNT(*) AS n FROM tokens WHERE user_id = ?').get(u.id) as { n: number }).n,
  createdAt: u.created_at,
});

route('GET', '/api/v1/admin/users', 'admin', ({ cfg, res }) => {
  const users = cfg.db.prepare('SELECT id, username, is_admin, quota_bytes, created_at FROM users ORDER BY username').all() as unknown as User[];
  send(res, 200, {
    users: users.map((u) => userRow(cfg.db, u)),
    storage: {
      usedMb: Math.round((totalBytes(cfg.db) / MB) * 10) / 10,
      limitMb: Math.round((cfg.totalBytes ?? 0) / MB),
      diskFreeMb: cfg.freeBytes ? Math.round(cfg.freeBytes() / MB) : undefined,
      maxImageMb: Math.round((cfg.maxImageBytes ?? 0) / MB),
      defaultQuotaMb: Math.round(cfg.defaultQuotaBytes / MB),
    },
  });
});

// Accounts are made by invitation only: the admin gets a one-time link and
// the invitee chooses their own username and password on it.
route('POST', '/api/v1/admin/invites', 'admin', async (ctx) => {
  const body = await readJson(ctx);
  const quota = typeof body.quotaMb === 'number' ? Math.max(0, body.quotaMb) * MB : ctx.cfg.defaultQuotaBytes;
  const { token, expiresAt } = createInvite(ctx.cfg.db, { kind: 'signup', admin: body.admin === true, quotaBytes: quota, note: str(body.note, 100) });
  send(ctx.res, 201, { link: inviteLink(publicUrl(ctx), token), expiresAt: new Date(expiresAt).toISOString() });
});

route('GET', '/api/v1/admin/invites', 'admin', ({ cfg, res }) => {
  const rows = cfg.db
    .prepare(
      `SELECT i.id, i.kind, i.note, i.is_admin AS admin, i.created_at AS createdAt, i.expires_at AS expiresAt, u.username
       FROM invites i LEFT JOIN users u ON u.id = i.user_id WHERE i.expires_at >= ? ORDER BY i.created_at DESC`,
    )
    .all(Date.now()) as { expiresAt: number; admin: number }[];
  send(res, 200, { invites: rows.map((r) => ({ ...r, admin: !!r.admin, expiresAt: new Date(r.expiresAt).toISOString() })) });
});

route('DELETE', '/api/v1/admin/invites/:id', 'admin', ({ cfg, res, req }) => {
  cfg.db.prepare('DELETE FROM invites WHERE id = ?').run(Number(req.params.id));
  send(res, 200, { ok: true });
});

const inviteIp = new Limiter(30, 15 * 60e3);

open('GET', '/api/v1/invites/:token', ({ cfg, res, req }) => {
  if (inviteIp.blocked(req.ip)) throw new HttpError(429, 'rate_limited', 'Çok fazla deneme. Biraz sonra yeniden dene.');
  const inv = findInvite(cfg.db, req.params.token);
  if (!inv) {
    inviteIp.fail(req.ip);
    throw new HttpError(404, 'bad_invite', 'Davet linki geçersiz, kullanılmış veya süresi dolmuş. Yöneticiden yeni bir link iste.');
  }
  send(res, 200, {
    kind: inv.kind,
    username: inv.user_id ? getUser(cfg.db, inv.user_id)?.username : undefined,
    admin: !!inv.is_admin,
    expiresAt: new Date(inv.expires_at).toISOString(),
  });
});

open('POST', '/api/v1/invites/:token', async (ctx) => {
  const { db } = ctx.cfg;
  if (inviteIp.blocked(ctx.req.ip)) throw new HttpError(429, 'rate_limited', 'Çok fazla deneme. Biraz sonra yeniden dene.');
  const body = await readJson(ctx);
  if (!findInvite(db, ctx.req.params.token)) {
    inviteIp.fail(ctx.req.ip);
    throw new HttpError(404, 'bad_invite', 'Davet linki geçersiz, kullanılmış veya süresi dolmuş. Yöneticiden yeni bir link iste.');
  }
  try {
    const user = acceptInvite(db, ctx.req.params.token, str(body.username, 40).trim(), str(body.password, 500));
    send(ctx.res, 200, signedIn(db, user, str(body.device, 80) || 'Panel (tarayıcı)'));
  } catch (e) {
    throw new HttpError(400, 'invalid', (e as Error).message);
  }
});

route('PATCH', '/api/v1/admin/users/:id', 'admin', async (ctx) => {
  const { db } = ctx.cfg;
  const target = getUser(db, Number(ctx.req.params.id));
  if (!target) throw new HttpError(404, 'not_found', 'Kullanıcı bulunamadı.');
  const body = await readJson(ctx);
  if (typeof body.quotaMb === 'number') db.prepare('UPDATE users SET quota_bytes = ? WHERE id = ?').run(Math.max(0, body.quotaMb) * MB, target.id);
  if (typeof body.admin === 'boolean') {
    if (!body.admin && target.id === ctx.user.id) throw new HttpError(400, 'self', 'Kendi yöneticiliğini kaldıramazsın.');
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(body.admin ? 1 : 0, target.id);
  }
  // A reset hands out a link; the user picks the new password themselves.
  let resetLink: string | undefined;
  if (body.resetPassword === true) resetLink = inviteLink(publicUrl(ctx), createInvite(db, { kind: 'reset', userId: target.id }).token);
  send(ctx.res, 200, { user: userRow(db, getUser(db, target.id)!), resetLink });
});

route('DELETE', '/api/v1/admin/users/:id', 'admin', ({ cfg, res, req, user }) => {
  const id = Number(req.params.id);
  if (id === user.id) throw new HttpError(400, 'self', 'Kendi hesabını silemezsin.');
  cfg.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  send(res, 200, { ok: true });
});

route('GET', '/api/v1/admin/backup', 'admin', ({ cfg, res }) => {
  const file = backupNow(cfg.db, join(tmpdir(), `keizu-dl-${process.pid}-${Date.now()}`));
  res.writeHead(200, {
    'Content-Type': 'application/vnd.sqlite3',
    'Content-Length': String(statSync(file).size),
    'Content-Disposition': `attachment; filename="keizu-yedek-${new Date().toISOString().slice(0, 10)}.db"`,
    'Cache-Control': 'no-store',
  });
  const s = createReadStream(file);
  s.pipe(res);
  s.on('close', () => rmSync(dirname(file), { recursive: true, force: true }));
});

// ---------- server ----------

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match, If-None-Match, X-Keizu-Device',
  'Access-Control-Expose-Headers': 'ETag, X-Keizu-Version, X-Keizu-Role',
  'Access-Control-Max-Age': '86400',
};

function serveFile(req: IncomingMessage, res: ServerResponse, file: string, size: number, csp: string, immutable = false) {
  const ext = file.split('.').pop()!.toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': String(size),
    'Cache-Control': ext === 'html' ? 'no-cache' : immutable ? 'public, max-age=31536000, immutable' : 'max-age=3600',
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

function fileSize(file: string): number | undefined {
  try {
    const st = statSync(file);
    return st.isFile() ? st.size : undefined;
  } catch {
    return undefined;
  }
}

/** Serves the web app; unknown paths without an extension get index.html. Returns false if nothing fits. */
function serveWeb(req: IncomingMessage, res: ServerResponse, root: string, pathname: string): boolean {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const base = resolve(root);
  let file = resolve(base, '.' + rel);
  if (file !== base && !file.startsWith(base + sep)) return false;
  if (rel.endsWith('/')) file = join(file, 'index.html');
  let size = fileSize(file);
  if (size === undefined && !/\.[\w]+$/.test(rel)) size = fileSize((file = join(base, 'index.html')));
  if (size === undefined) return false;
  serveFile(req, res, file, size, WEB_CSP, rel.startsWith('/assets/'));
  return true;
}

function redirect(res: ServerResponse, to: string) {
  res.writeHead(302, { Location: to, 'Cache-Control': 'no-cache' });
  res.end();
}

export async function handle(cfg: Config, rawReq: IncomingMessage, res: ServerResponse) {
  const url = new URL(rawReq.url ?? '/', 'http://x');
  const req = rawReq as Req;
  req.query = url.searchParams;
  req.ip = clientIp(rawReq, cfg.trustProxy);
  const isApi = url.pathname.startsWith('/api/') || url.pathname.startsWith('/.well-known/');
  if (isApi) for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  try {
    if (rawReq.method === 'OPTIONS' && isApi) {
      res.writeHead(204);
      return res.end();
    }
    const isGet = rawReq.method === 'GET' || rawReq.method === 'HEAD';
    if (isGet && !isApi) {
      if (url.pathname === '/panel') return redirect(res, '/panel/' + url.search);
      const panelFile = PANEL[url.pathname];
      if (panelFile) {
        const file = join(PUBLIC_DIR, panelFile);
        return serveFile(rawReq, res, file, fileSize(file) ?? 0, PANEL_CSP);
      }
      if (!cfg.webDir && url.pathname === '/') return redirect(res, '/panel/');
    }
    let pathMatched = false;
    for (const r of routes) {
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== rawReq.method) continue;
      req.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const ctx = { req, res, cfg };
      if (r.auth === 'none') return await (r.fn as PublicHandler)(ctx);
      const header = String(rawReq.headers.authorization ?? '');
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      const who = token ? userForToken(cfg.db, token) : undefined;
      if (!who) throw new HttpError(401, 'unauthorized', 'Oturum yok veya süresi dolmuş. Yeniden bağlan.');
      if (r.auth === 'admin' && !who.user.is_admin) throw new HttpError(403, 'forbidden', 'Bu işlem için yönetici olmalısın.');
      return await (r.fn as Handler)({ ...ctx, ...who });
    }
    if (isGet && !isApi && !pathMatched && cfg.webDir && serveWeb(rawReq, res, cfg.webDir, url.pathname)) return;
    throw pathMatched ? new HttpError(405, 'method', 'Bu yöntem desteklenmiyor.') : new HttpError(404, 'not_found', 'Bulunamadı.');
  } catch (err) {
    if (res.headersSent) return res.destroy();
    if (err instanceof HttpError) return send(res, err.status, { error: err.code, message: err.message });
    cfg.log?.(`HATA ${rawReq.method} ${url.pathname}: ${(err as Error).stack ?? err}`);
    send(res, 500, { error: 'internal', message: 'Sunucu hatası.' });
  }
}

export function createApp(cfg: Config): Server {
  const server = createServer((req, res) => {
    handle(cfg, req, res);
  });
  const live = (cfg.live ??= new LiveHub({
    db: cfg.db,
    log: cfg.log,
    limits: (ownerId) => ({
      quotaBytes: getUser(cfg.db, ownerId)?.quota_bytes ?? cfg.defaultQuotaBytes,
      maxImageBytes: cfg.maxImageBytes,
      totalBytes: cfg.totalBytes,
      minFreeBytes: cfg.minFreeBytes,
      freeBytes: cfg.freeBytes,
    }),
  }));
  live.attach(server);
  server.on('close', () => live.close());
  return server;
}
