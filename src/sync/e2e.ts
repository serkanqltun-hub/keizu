// Optional end-to-end encryption for sync. With it on, a map leaves this
// device only as ciphertext (AES-GCM, key from a passphrase via PBKDF2): the
// server stores it but can't read it. The price: an encrypted map can't be
// shared or edited live, since the server can't see what changed.

import { normalizeMap, type MindMap } from '../core/model';
import type { RemoteMap, RemoteSummary, SyncAdapter } from './types';
import { ConflictError } from './types';

export const E2E_ITERATIONS = 310_000;

export interface Envelope {
  v: 1;
  alg: 'AES-GCM';
  kdf: 'PBKDF2-SHA256';
  iter: number;
  salt: string;
  iv: string;
  data: string;
}

/** Thrown when a map can't be decrypted (wrong passphrase, damaged data). */
export class DecryptError extends Error {}

const b64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function newSalt(): string {
  return b64(crypto.getRandomValues(new Uint8Array(16)));
}

const keys = new Map<string, Promise<CryptoKey>>();

/** The AES key for a passphrase and salt (cached: derivation is slow on purpose). */
function keyFor(passphrase: string, salt: string, iter: number): Promise<CryptoKey> {
  const id = `${iter}:${salt}:${passphrase}`;
  let k = keys.get(id);
  if (!k) {
    k = crypto.subtle
      .importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
      .then((base) =>
        crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ]),
      );
    keys.set(id, k);
  }
  return k;
}

/** The map as the server sees it: valid Keizu JSON with nothing readable in it. */
export async function encryptMap(map: MindMap, passphrase: string, salt: string): Promise<MindMap> {
  const key = await keyFor(passphrase, salt, E2E_ITERATIONS);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(map));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const encrypted: Envelope = { v: 1, alg: 'AES-GCM', kdf: 'PBKDF2-SHA256', iter: E2E_ITERATIONS, salt, iv: b64(iv), data: b64(data) };
  return {
    format: 'keizu/1',
    id: map.id,
    title: '🔒',
    version: map.version,
    updatedAt: map.updatedAt,
    theme: 'fresh',
    layout: 'mindmap',
    branchStyle: 'curve',
    multicolor: true,
    roots: [{ id: 'locked', text: '🔒', children: [] }],
    relations: [],
    encrypted,
  } as MindMap & { encrypted: Envelope };
}

export function isEncrypted(map: unknown): map is MindMap & { encrypted: Envelope } {
  const e = (map as { encrypted?: Envelope })?.encrypted;
  return !!e && e.v === 1 && typeof e.data === 'string';
}

export async function decryptMap(map: MindMap, passphrase: string): Promise<MindMap> {
  if (!isEncrypted(map)) return map;
  const e = map.encrypted;
  try {
    const key = await keyFor(passphrase, e.salt, e.iter);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(e.iv) }, key, unb64(e.data));
    return normalizeMap(JSON.parse(new TextDecoder().decode(plain)));
  } catch {
    throw new DecryptError('Şifreli harita çözülemedi: uçtan uca şifreleme parolası bu cihazda farklı olabilir.');
  }
}

/**
 * Wraps a sync target so maps are encrypted on the way out and decrypted on
 * the way in. Maps stored in plain text earlier are still read, and become
 * encrypted the next time they are pushed.
 */
export class EncryptingAdapter implements SyncAdapter {
  readonly kind: SyncAdapter['kind'];
  constructor(
    private inner: SyncAdapter,
    private passphrase: string,
    private salt: string,
  ) {
    this.kind = inner.kind;
  }

  list(): Promise<RemoteSummary[]> {
    return this.inner.list();
  }

  async pull(id: string): Promise<RemoteMap | undefined> {
    const r = await this.inner.pull(id);
    return r && { ...r, map: await decryptMap(r.map, this.passphrase) };
  }

  async push(map: MindMap, baseRev: string | null): Promise<{ rev: string }> {
    try {
      return await this.inner.push(await encryptMap(map, this.passphrase, this.salt), baseRev);
    } catch (e) {
      // The engine merges against the readable version.
      if (e instanceof ConflictError) throw new ConflictError({ ...e.remote, map: await decryptMap(e.remote.map, this.passphrase) });
      throw e;
    }
  }

  remove(id: string): Promise<void> {
    return this.inner.remove(id);
  }
}
