// The app's side of live collaboration: a WebSocket to Keizu Server's room
// for one map. Local edits become CRDT register writes (see core/crdt.ts),
// are applied here at once and sent; edits from others arrive the same way.
// Edits made while the connection is down wait and are sent on reconnect.
// Undo and redo only touch this person's own edits.

import { applyOps, cloneDoc, diff, inverse, materialize, stamp, valueOf, type Change, type CrdtDoc, type MapLike, type Op } from '../core/crdt';

export type LiveRole = 'owner' | 'edit' | 'view';
export type LiveState = 'connecting' | 'live' | 'offline' | 'closed';

export interface LivePeer {
  id: string;
  name: string;
  color: string;
  role: LiveRole;
  sel: string | null;
}

export interface LiveWelcome {
  role: LiveRole;
  owner: { id: number; username: string };
  /** Stored top-level fields of the map (id, format...). */
  base: Record<string, unknown>;
  map: MapLike;
}

export interface LiveEvents {
  /** First connection: the map as the server has it. */
  onWelcome(w: LiveWelcome): void;
  /** Someone else changed the map. */
  onRemote(map: MapLike): void;
  onPeers(peers: LivePeer[], you: string): void;
  onState(state: LiveState): void;
  onRole(role: LiveRole): void;
  /** The server saved the map (version number). */
  onSaved?(version: number, map: MapLike): void;
  /** A message to show (save failed, access removed...). `fatal` ends the session. */
  onError(message: string, fatal: boolean, code: string): void;
}

export interface LiveOptions {
  url: string;
  token: string;
  mapId: string;
  /** Owner's user id, for a map someone shared with you. */
  owner?: number;
  /** For tests: a WebSocket constructor. */
  WebSocketImpl?: typeof WebSocket;
}

interface UndoEntry {
  /** Writes that made the edit, and the values from before it. */
  forward: Change[];
  back: Change[];
}

const RETRY_MS = [500, 1000, 2000, 5000, 10000, 20000];
const FATAL = new Set(['unauthorized', 'not_found', 'forbidden', 'deleted', 'bad_hello']);

export class LiveSession {
  doc: CrdtDoc | null = null;
  role: LiveRole = 'view';
  state: LiveState = 'connecting';
  private ws: WebSocket | null = null;
  private actor = '';
  private you = '';
  private seq = 0;
  /** Sent (or waiting to be sent) and not yet confirmed by the server. */
  private pending: { seq: number; ops: Op[] }[] = [];
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private welcomed = false;
  private sel: string | null = null;
  private peers: LivePeer[] = [];

  constructor(
    private opts: LiveOptions,
    private ev: LiveEvents,
  ) {
    this.connect();
  }

  private connect() {
    if (this.closed) return;
    this.setState('connecting');
    const WS = this.opts.WebSocketImpl ?? WebSocket;
    let ws: WebSocket;
    try {
      ws = new WS(this.opts.url);
    } catch {
      return this.again();
    }
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', token: this.opts.token, map: this.opts.mapId, owner: this.opts.owner }));
    ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(String(e.data)));
      } catch {
        /* ignore malformed messages */
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (!this.closed) this.again();
    };
    ws.onerror = () => ws.close();
  }

  private again() {
    if (this.closed) return;
    this.setState('offline');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), RETRY_MS[Math.min(this.retry++, RETRY_MS.length - 1)]);
  }

  private setState(s: LiveState) {
    if (this.state === s) return;
    this.state = s;
    this.ev.onState(s);
  }

  private onMessage(msg: Record<string, any>) {
    switch (msg.type) {
      case 'welcome': {
        this.retry = 0;
        this.actor = msg.actor;
        this.you = msg.you;
        this.role = msg.role;
        const doc: CrdtDoc = msg.doc;
        // Edits made while offline (or not confirmed before the drop): apply
        // them again on top of the server's copy, under this connection's
        // name and newer times, in their original order, and send them.
        const waiting = this.welcomed && this.role !== 'view' ? this.pending.map((p) => p.ops) : [];
        this.pending = [];
        const resend = waiting.map((ops) => {
          const t: [number, string] = [doc.clock + 1, this.actor];
          const again = ops.map((o) => ({ ...o, t }));
          applyOps(doc, again);
          return again;
        });
        this.doc = doc;
        this.peers = msg.peers ?? [];
        this.setState('live');
        if (!this.welcomed) {
          this.welcomed = true;
          this.ev.onWelcome({ role: msg.role, owner: msg.owner, base: msg.base ?? {}, map: materialize(doc) });
        } else {
          this.ev.onRole(msg.role);
          this.ev.onRemote(materialize(doc));
        }
        for (const ops of resend) this.send(ops);
        if (this.sel) this.ws?.send(JSON.stringify({ type: 'sel', id: this.sel }));
        this.ev.onPeers(this.peers, this.you);
        break;
      }
      case 'ops':
        if (this.doc && applyOps(this.doc, msg.ops)) this.ev.onRemote(materialize(this.doc));
        break;
      case 'ack':
        this.pending = this.pending.filter((p) => p.seq > msg.seq);
        break;
      case 'peers':
        this.peers = msg.peers;
        this.ev.onPeers(this.peers, this.you);
        break;
      case 'sel':
        this.peers = this.peers.map((p) => (p.id === msg.peer ? { ...p, sel: msg.id } : p));
        this.ev.onPeers(this.peers, this.you);
        break;
      case 'role':
        this.role = msg.role;
        this.ev.onRole(msg.role);
        break;
      case 'saved':
        if (this.doc) this.ev.onSaved?.(msg.version, materialize(this.doc));
        break;
      case 'error': {
        const fatal = FATAL.has(msg.code);
        this.ev.onError(String(msg.message ?? msg.code), fatal, String(msg.code));
        if (fatal) this.close();
        break;
      }
    }
  }

  private send(ops: Op[]) {
    if (!ops.length) return;
    const entry = { seq: ++this.seq, ops };
    this.pending.push(entry);
    if (this.ws?.readyState === 1 && this.state === 'live') this.ws.send(JSON.stringify({ type: 'ops', ops, seq: entry.seq }));
  }

  /** Writes and sends `changes`; returns the map afterwards. */
  private write(changes: Change[]): MapLike | undefined {
    if (!this.doc || !changes.length) return undefined;
    // Before the first welcome there is no author name yet; it is replaced on send.
    const ops = stamp(this.doc, changes, this.actor || 'local');
    applyOps(this.doc, ops);
    this.send(ops);
    return materialize(this.doc);
  }

  /** The map changed here (any edit): send the difference. */
  localChange(next: MapLike) {
    if (!this.doc || this.role === 'view') return;
    const changes = diff(this.doc, next);
    if (!changes.length) return;
    const before = cloneDoc(this.doc);
    this.write(changes);
    this.undoStack.push({ forward: changes, back: inverse(before, changes) });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Writes that still make sense: skip registers someone else changed since. */
  private still(expect: Change[], apply: Change[]): Change[] {
    const doc = this.doc!;
    return apply.filter((c, i) => JSON.stringify(valueOf(doc, c.k, c.id, c.f)) === JSON.stringify(expect[i].v ?? null));
  }

  canUndo = () => this.undoStack.length > 0 && this.role !== 'view';
  canRedo = () => this.redoStack.length > 0 && this.role !== 'view';

  /** Undoes this person's last edit. Returns the new map, if anything changed. */
  undo(): MapLike | undefined {
    const e = this.undoStack.pop();
    if (!e || !this.doc) return undefined;
    this.redoStack.push(e);
    return this.write(this.still(e.forward, e.back)) ?? materialize(this.doc);
  }

  redo(): MapLike | undefined {
    const e = this.redoStack.pop();
    if (!e || !this.doc) return undefined;
    this.undoStack.push(e);
    return this.write(this.still(e.back, e.forward)) ?? materialize(this.doc);
  }

  /** Tells the others which topic this person has selected. */
  select(id: string | null) {
    if (id === this.sel) return;
    this.sel = id;
    if (this.ws?.readyState === 1 && this.state === 'live') this.ws.send(JSON.stringify({ type: 'sel', id }));
  }

  /** The map as this session has it now. */
  snapshot(): MapLike | undefined {
    return this.doc ? materialize(this.doc) : undefined;
  }

  /** Edits not yet confirmed by the server. */
  get unsent(): number {
    return this.pending.length;
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
    this.setState('closed');
  }
}
