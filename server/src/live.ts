// Live collaboration over WebSocket (/api/v1/live). Everyone editing a map
// joins its room. The room holds the map as a CRDT (see src/core/crdt.ts,
// shared with the app): edits arrive as register writes, are applied,
// passed on to the others in the room, and the map is saved like any other
// save a couple of seconds after the last edit. Saves made outside the room
// (a device syncing over REST) are merged in, so nothing is lost either way.

import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { applyOps, cloneDoc, diff, docFromMap, materialize, stamp, valueOf, type CrdtDoc, type Op } from '../../src/core/crdt.ts';
import type { Db } from './db.ts';
import { getUser, userForToken } from './auth.ts';
import { getMap, largestImage, putMap, type Limits } from './maps.ts';
import { accessTo, type Access } from './shares.ts';

export const LIVE_PATH = '/api/v1/live';
const SAVE_AFTER_MS = 1500;
const MAX_OPS_PER_MESSAGE = 5000;
const MAX_MESSAGE_BYTES = 32 * 1048576;
const COLORS = ['#E8590C', '#1971C2', '#2B8A3E', '#9C36B5', '#C2255C', '#0B7285', '#E67700', '#5F3DC4'];

export interface Peer {
  id: string;
  name: string;
  color: string;
  role: Exclude<Access, undefined>;
  sel: string | null;
}

interface Client {
  ws: WebSocket;
  peer: Peer;
  userId: number;
  tokenId: number;
}

interface Room {
  key: string;
  ownerId: number;
  mapId: string;
  doc: CrdtDoc;
  /** The CRDT as it was last saved, to tell which parts an outside save changed. */
  saved: CrdtDoc;
  version: number;
  /** Top-level fields of the stored map that the CRDT doesn't keep (format, id...). */
  base: Record<string, unknown>;
  clients: Set<Client>;
  dirty: boolean;
  timer?: ReturnType<typeof setTimeout>;
  colorNext: number;
}

export interface LiveOptions {
  db: Db;
  limits: (ownerId: number) => Limits;
  log?: (msg: string) => void;
}

const send = (ws: WebSocket, msg: unknown) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
};

function validOps(ops: unknown, actor: string, clock: number): ops is Op[] {
  if (!Array.isArray(ops) || ops.length > MAX_OPS_PER_MESSAGE) return false;
  return ops.every(
    (o) =>
      o &&
      (o.k === 'm' || o.k === 't' || o.k === 'r') &&
      typeof o.id === 'string' &&
      o.id.length <= 100 &&
      (o.k === 'm' ? o.id === '' : /^[A-Za-z0-9_-]+$/.test(o.id)) &&
      typeof o.f === 'string' &&
      o.f.length > 0 &&
      o.f.length <= 120 &&
      Array.isArray(o.t) &&
      Number.isInteger(o.t[0]) &&
      o.t[0] > 0 &&
      o.t[0] <= clock + 1_000_000 &&
      o.t[1] === actor,
  );
}

export class LiveHub {
  private rooms = new Map<string, Room>();
  private wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  private opts: LiveOptions;
  private alive = new WeakSet<WebSocket>();
  private heartbeat: ReturnType<typeof setInterval>;
  constructor(opts: LiveOptions) {
    this.opts = opts;
    // Proxies drop quiet connections, and dead ones should leave their room.
    this.heartbeat = setInterval(() => {
      for (const ws of this.wss.clients) {
        if (!this.alive.has(ws)) {
          ws.terminate();
          continue;
        }
        this.alive.delete(ws);
        ws.ping();
      }
    }, 30_000);
    this.heartbeat.unref?.();
  }

  /** Hooks the WebSocket endpoint into the HTTP server. */
  attach(server: Server) {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      if (path !== LIVE_PATH) {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.welcome(ws));
    });
  }

  /** Number of people in a map's room right now. */
  present(ownerId: number, mapId: string): number {
    return this.rooms.get(`${ownerId}:${mapId}`)?.clients.size ?? 0;
  }

  /** A save over REST happened: fold it into the open room, if any. */
  external(ownerId: number, mapId: string) {
    const room = this.rooms.get(`${ownerId}:${mapId}`);
    if (room) this.mergeStored(room);
  }

  /** Access changed (share removed, map deleted): drop people who lost it. */
  recheck(ownerId: number, mapId: string) {
    const room = this.rooms.get(`${ownerId}:${mapId}`);
    if (!room) return;
    for (const c of [...room.clients]) {
      const access = accessTo(this.opts.db, c.userId, ownerId, mapId);
      if (!access) {
        send(c.ws, { type: 'error', code: 'forbidden', message: 'Bu haritaya erişimin kaldırıldı.' });
        c.ws.close(4403, 'forbidden');
      } else if (access !== c.peer.role) {
        c.peer.role = access;
        send(c.ws, { type: 'role', role: access });
        this.peers(room);
      }
    }
  }

  close() {
    for (const room of this.rooms.values()) {
      this.save(room);
      for (const c of room.clients) c.ws.close(1001, 'shutdown');
    }
    this.rooms.clear();
    clearInterval(this.heartbeat);
    this.wss.close();
  }

  private welcome(ws: WebSocket) {
    this.alive.add(ws);
    ws.on('pong', () => this.alive.add(ws));
    let client: Client | undefined;
    let room: Room | undefined;
    // The first message must be a hello with the session token.
    const timeout = setTimeout(() => ws.close(4401, 'no hello'), 10_000);
    ws.on('message', (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (!client) {
        clearTimeout(timeout);
        const joined = this.join(ws, msg);
        if (!joined) return;
        ({ client, room } = joined);
        return;
      }
      if (!room) return;
      if (msg.type === 'ops') {
        this.onOps(room, client, msg.ops);
        // Lets the app forget edits the server has taken (or refused).
        if (typeof msg.seq === 'number') send(client.ws, { type: 'ack', seq: msg.seq });
      }
      else if (msg.type === 'sel') {
        client.peer.sel = typeof msg.id === 'string' ? msg.id.slice(0, 100) : null;
        this.broadcast(room, { type: 'sel', peer: client.peer.id, id: client.peer.sel }, client);
      }
    });
    ws.on('close', () => {
      clearTimeout(timeout);
      if (room && client) this.leave(room, client);
    });
    ws.on('error', () => ws.terminate());
  }

  private join(ws: WebSocket, msg: Record<string, unknown>): { client: Client; room: Room } | undefined {
    const { db } = this.opts;
    const fail = (code: string, message: string, close = 4400) => {
      send(ws, { type: 'error', code, message });
      ws.close(close, code);
      return undefined;
    };
    if (msg.type !== 'hello' || typeof msg.token !== 'string' || typeof msg.map !== 'string') return fail('bad_hello', 'Geçersiz bağlantı isteği.');
    const who = userForToken(db, msg.token);
    if (!who) return fail('unauthorized', 'Oturum yok veya süresi dolmuş. Yeniden bağlan.', 4401);
    const ownerId = typeof msg.owner === 'number' ? msg.owner : who.user.id;
    const mapId = msg.map;
    const access = accessTo(db, who.user.id, ownerId, mapId);
    if (!access) return fail('not_found', 'Harita bulunamadı ya da sana paylaşılmamış.', 4404);
    const room = this.room(ownerId, mapId);
    if (!room) return fail('not_found', 'Harita bulunamadı.', 4404);
    const peer: Peer = {
      id: randomBytes(6).toString('base64url'),
      name: who.user.username,
      color: COLORS[room.colorNext++ % COLORS.length],
      role: access,
      sel: null,
    };
    const client: Client = { ws, peer, userId: who.user.id, tokenId: who.tokenId };
    room.clients.add(client);
    const owner = getUser(db, ownerId);
    send(ws, {
      type: 'welcome',
      role: access,
      actor: `${who.user.id}.${peer.id}`,
      you: peer.id,
      owner: { id: ownerId, username: owner?.username ?? '?' },
      version: room.version,
      doc: room.doc,
      base: room.base,
      peers: [...room.clients].map((c) => c.peer),
    });
    this.peers(room, client);
    return { client, room };
  }

  private room(ownerId: number, mapId: string): Room | undefined {
    const key = `${ownerId}:${mapId}`;
    const open = this.rooms.get(key);
    if (open) return open;
    const stored = getMap(this.opts.db, ownerId, mapId);
    if (!stored) return undefined;
    const map = JSON.parse(stored.data);
    const doc = docFromMap(map, 'server');
    const { roots: _r, relations: _l, resources: _s, ...base } = map;
    const room: Room = { key, ownerId, mapId, doc, saved: cloneDoc(doc), version: stored.version, base, clients: new Set(), dirty: false, colorNext: 0 };
    this.rooms.set(key, room);
    return room;
  }

  private onOps(room: Room, client: Client, ops: unknown) {
    if (client.peer.role === 'view') return send(client.ws, { type: 'error', code: 'read_only', message: 'Bu haritayı yalnızca görüntüleyebilirsin.' });
    const actor = `${client.userId}.${client.peer.id}`;
    if (!validOps(ops, actor, room.doc.clock)) return send(client.ws, { type: 'error', code: 'bad_ops', message: 'Geçersiz değişiklik.' });
    const max = this.opts.limits(room.ownerId).maxImageBytes;
    if (max) {
      const pics: Record<string, unknown> = {};
      for (const o of ops) if (o.k === 'm' && o.f.startsWith('res:')) pics[o.f] = o.v;
      if (largestImage({ resources: pics }) > max) {
        return send(client.ws, { type: 'error', code: 'image_too_large', message: `Görsel çok büyük (en çok ${Math.round(max / 1048576)} MB).` });
      }
    }
    applyOps(room.doc, ops);
    this.broadcast(room, { type: 'ops', ops }, client);
    room.dirty = true;
    clearTimeout(room.timer);
    room.timer = setTimeout(() => this.save(room), SAVE_AFTER_MS);
  }

  private leave(room: Room, client: Client) {
    room.clients.delete(client);
    this.peers(room);
    if (!room.clients.size) {
      this.save(room);
      clearTimeout(room.timer);
      this.rooms.delete(room.key);
    }
  }

  private broadcast(room: Room, msg: unknown, except?: Client) {
    const text = JSON.stringify(msg);
    for (const c of room.clients) if (c !== except && c.ws.readyState === c.ws.OPEN) c.ws.send(text);
  }

  private peers(room: Room, except?: Client) {
    this.broadcast(room, { type: 'peers', peers: [...room.clients].map((c) => c.peer) }, except);
  }

  /** Writes the room's map to storage; merges first if someone saved meanwhile. */
  private save(room: Room) {
    if (!room.dirty) return;
    const { db, log } = this.opts;
    for (let attempt = 0; attempt < 3; attempt++) {
      const body = JSON.stringify({ ...room.base, ...materialize(room.doc), id: room.mapId, updatedAt: new Date().toISOString() });
      const r = putMap(db, room.ownerId, room.mapId, body, room.version, { device: 'Canlı oturum', ...this.opts.limits(room.ownerId) });
      if (r.ok) {
        room.version = r.version;
        room.saved = cloneDoc(room.doc);
        room.dirty = false;
        this.broadcast(room, { type: 'saved', version: r.version });
        return;
      }
      if (r.reason === 'conflict') {
        this.mergeStored(room);
        continue;
      }
      const message =
        r.reason === 'quota'
          ? 'Harita sahibinin depolama kotası doldu; değişiklikler kaydedilemiyor.'
          : r.reason === 'image'
            ? 'Haritadaki bir görsel çok büyük; kaydedilemiyor.'
            : r.reason === 'full'
              ? 'Sunucunun depolama alanı doldu; değişiklikler kaydedilemiyor.'
              : 'Harita kaydedilemedi.';
      log?.(`Canlı oturum kaydedilemedi (${room.key}): ${r.reason}`);
      this.broadcast(room, { type: 'error', code: 'save_failed', message });
      return;
    }
  }

  /**
   * Folds the stored map into the room: whatever changed between the last
   * save the room knows and what is stored now is applied as new edits, so
   * edits made in the room meanwhile survive.
   */
  private mergeStored(room: Room) {
    const stored = getMap(this.opts.db, room.ownerId, room.mapId);
    if (!stored) {
      for (const c of room.clients) {
        send(c.ws, { type: 'error', code: 'deleted', message: 'Harita silindi.' });
        c.ws.close(4410, 'deleted');
      }
      return;
    }
    if (stored.version === room.version) return;
    const map = JSON.parse(stored.data);
    const changes = diff(room.saved, map).filter((c) => JSON.stringify(valueOf(room.doc, c.k, c.id, c.f)) !== JSON.stringify(c.v));
    const ops = stamp(room.doc, changes, 'server');
    applyOps(room.doc, ops);
    applyOps(room.saved, ops);
    room.version = stored.version;
    const { roots: _r, relations: _l, resources: _s, ...base } = map;
    room.base = { ...room.base, ...base };
    if (ops.length) {
      this.broadcast(room, { type: 'ops', ops });
      // The stored copy may still miss the room's own edits.
      room.dirty = true;
      clearTimeout(room.timer);
      room.timer = setTimeout(() => this.save(room), SAVE_AFTER_MS);
    }
  }
}
