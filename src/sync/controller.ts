// Runs sync in the background once the user has connected a server in
// Settings. Without a connection it does nothing at all: Keizu stays a
// purely local app. Settings live in localStorage on this device.

import { t } from '../i18n';
import { isDesktop } from '../ui/platform';
import { syncOnce, type ConflictPolicy, type SyncEvent } from './engine';
import { KeizuServerAdapter, type Fetch, type ServerInfo, type Session } from './keizuServer';
import { AuthError, NetworkError, type LibraryStore, type SyncAdapter } from './types';
import { WebDavAdapter } from './webdav';

export type SyncConfig =
  | {
      kind: 'keizu';
      server: string;
      api: string;
      username: string;
      token: string;
      serverName: string;
      serverVersion: string;
      compat: ServerInfo['compat'];
    }
  | { kind: 'webdav'; url: string; username: string; password: string };

export interface SyncPrefs {
  auto: boolean;
  policy: ConflictPolicy;
}

export type SyncState = 'off' | 'idle' | 'syncing' | 'error' | 'offline' | 'signedOut';

export interface SyncStatus {
  state: SyncState;
  lastSyncAt?: string;
  message?: string;
}

const KEY_CONFIG = 'keizu:sync:config';
const KEY_PREFS = 'keizu:sync:prefs';
const KEY_ACTIVITY = 'keizu:sync:activity';
const KEY_LAST = 'keizu:sync:last';
const MAX_ACTIVITY = 40;
const EVERY_MS = 60_000;
const AFTER_EDIT_MS = 3_000;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function loadList<T>(key: string): T[] {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(key) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function store(key: string, value: unknown) {
  try {
    if (value === undefined) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: settings last for this session */
  }
}

/** fetch for talking to servers: the desktop shell's own (no CORS limits), else the browser's. */
export async function httpFetch(): Promise<Fetch> {
  if (isDesktop) {
    const { fetch } = await import('@tauri-apps/plugin-http');
    return fetch as Fetch;
  }
  return (input, init) => globalThis.fetch(input, init);
}

/** A name for this device, shown in the server's device list. */
export function deviceName(): string {
  const ua = globalThis.navigator?.userAgent ?? '';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return isDesktop ? `Keizu ${t('sync.device.desktop')}${os ? ` (${os})` : ''}` : `Keizu web${browser ? ` (${browser}${os ? `, ${os}` : ''})` : ''}`;
}

class SyncController {
  private store: LibraryStore | null = null;
  private config: SyncConfig | null = load<SyncConfig | null>(KEY_CONFIG, null);
  private prefs: SyncPrefs = load<SyncPrefs>(KEY_PREFS, { auto: true, policy: 'merge' });
  private status: SyncStatus = { state: this.config ? 'idle' : 'off', lastSyncAt: load<{ at?: string }>(KEY_LAST, {}).at };
  private activity: SyncEvent[] = loadList<SyncEvent>(KEY_ACTIVITY);
  private listeners = new Set<() => void>();
  private changeListeners = new Set<(ids: string[]) => void>();
  private busy = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | null = null;
  private again = false;
  private fetcher: Fetch | null = null;

  /** Starts background sync for this library (only acts when connected). */
  attach(store: LibraryStore) {
    this.store = store;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onWake);
      window.addEventListener('focus', this.onWake);
    }
    this.schedule();
    if (this.config && this.prefs.auto) this.syncNow();
  }

  private onWake = () => {
    if (this.config && this.prefs.auto) this.nudge(500);
  };

  private schedule() {
    clearInterval(this.interval);
    if (this.config && this.prefs.auto) this.interval = setInterval(() => this.syncNow(), EVERY_MS);
  }

  // ---------- state for the UI ----------

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Called with map ids whose local copy a sync changed. */
  onMapsChanged(fn: (ids: string[]) => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((f) => f());
  }

  getConfig = () => this.config;
  getPrefs = () => this.prefs;
  getStatus = () => this.status;
  getActivity = () => this.activity;

  private setStatus(s: SyncStatus) {
    this.status = s;
    this.emit();
  }

  setPrefs(p: Partial<SyncPrefs>) {
    this.prefs = { ...this.prefs, ...p };
    store(KEY_PREFS, this.prefs);
    this.schedule();
    this.emit();
  }

  // ---------- connecting ----------

  async connectKeizu(info: ServerInfo, session: Session) {
    await this.reset();
    this.config = {
      kind: 'keizu',
      server: info.server,
      api: info.api,
      username: session.user.username,
      token: session.token,
      serverName: info.name,
      serverVersion: info.version,
      compat: info.compat,
    };
    this.connected();
  }

  async connectWebdav(url: string, username: string, password: string) {
    const adapter = new WebDavAdapter(await httpFetch(), url, username, password);
    await adapter.check();
    await this.reset();
    this.config = { kind: 'webdav', url, username, password };
    this.connected();
  }

  private connected() {
    store(KEY_CONFIG, this.config);
    this.setStatus({ state: 'idle' });
    this.schedule();
    this.syncNow();
  }

  /** Signs this device out. Maps stay on the device. */
  async disconnect() {
    const a = await this.adapter();
    if (a instanceof KeizuServerAdapter) await a.logout();
    await this.reset();
    this.config = null;
    store(KEY_CONFIG, undefined);
    this.schedule();
    this.setStatus({ state: 'off' });
  }

  /** Forgets what was synced where, so a new server starts from scratch. */
  private async reset() {
    await this.store?.clearSync().catch(() => {});
    this.activity = [];
    store(KEY_ACTIVITY, undefined);
    store(KEY_LAST, undefined);
  }

  async adapter(): Promise<SyncAdapter | undefined> {
    const c = this.config;
    if (!c) return undefined;
    this.fetcher ??= await httpFetch();
    return c.kind === 'keizu'
      ? new KeizuServerAdapter(this.fetcher, c.api, c.token, deviceName())
      : new WebDavAdapter(this.fetcher, c.url, c.username, c.password);
  }

  // ---------- running ----------

  /** Maps open in the editor are pushed but not overwritten while open. */
  setBusy(id: string, on: boolean) {
    if (on) this.busy.add(id);
    else {
      this.busy.delete(id);
      this.nudge(500);
    }
  }

  /** A local change happened: sync a little later. */
  nudge(delay = AFTER_EDIT_MS) {
    if (!this.config || !this.prefs.auto || this.status.state === 'signedOut') return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.syncNow(), delay);
  }

  syncNow(): Promise<void> {
    if (!this.config || !this.store) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        this.syncNow();
      }
    });
    return this.running;
  }

  private async run() {
    const adapter = await this.adapter();
    if (!adapter || !this.store) return;
    this.setStatus({ ...this.status, state: 'syncing', message: undefined });
    try {
      const { events, changed } = await syncOnce(this.store, adapter, {
        policy: this.prefs.policy,
        busy: this.busy,
        copyTitle: (title) => t('sync.copyTitle', { title }),
      });
      if (events.length) {
        this.activity = [...events.reverse(), ...this.activity].slice(0, MAX_ACTIVITY);
        store(KEY_ACTIVITY, this.activity);
      }
      const at = new Date().toISOString();
      store(KEY_LAST, { at });
      const failed = events.find((e) => e.action === 'error');
      this.setStatus({ state: failed ? 'error' : 'idle', lastSyncAt: at, message: failed?.message });
      if (changed.length) this.changeListeners.forEach((f) => f(changed));
    } catch (e) {
      if (e instanceof AuthError) {
        clearInterval(this.interval);
        this.setStatus({ ...this.status, state: 'signedOut', message: e.message });
      } else if (e instanceof NetworkError) {
        this.setStatus({ ...this.status, state: 'offline', message: e.message });
      } else {
        this.setStatus({ ...this.status, state: 'error', message: (e as Error).message });
      }
    }
  }
}

export const sync = new SyncController();

/** Wraps a library so every local save or delete nudges the sync. */
export function withSyncHooks(store: LibraryStore, onChange: () => void): LibraryStore {
  return new Proxy(store, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target);
      if (typeof v !== 'function') return v;
      if (prop === 'save' || prop === 'remove') {
        return async (...args: unknown[]) => {
          const r = await (v as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          onChange();
          return r;
        };
      }
      return v.bind(target);
    },
  });
}
