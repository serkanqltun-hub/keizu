// Local version history policy: when to take a snapshot and which old
// snapshots to thin out. Pure, so it is easy to test.

import type { MindMap } from './model';

/** Minimum time between automatic snapshots while editing. */
export const SNAPSHOT_EVERY_MS = 5 * 60 * 1000;
export const MAX_VERSIONS = 100;

export interface VersionStamp {
  id: number;
  savedAt: string;
}

/** A cheap fingerprint of a map's content, ignoring save counters. */
export function contentHash(map: MindMap): string {
  const { version: _v, updatedAt: _u, ...rest } = map;
  const s = JSON.stringify(rest);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}-${s.length.toString(36)}`;
}

/**
 * Snapshots to delete. Keeps everything from the last hour, one per hour for
 * the last day, one per day for the last 30 days, one per week before that,
 * and never more than MAX_VERSIONS in total.
 */
export function versionsToDrop(list: VersionStamp[], now = Date.now()): number[] {
  const sorted = [...list].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const seen = new Set<string>();
  const drop: number[] = [];
  let kept = 0;
  for (const v of sorted) {
    const t = Date.parse(v.savedAt);
    const age = now - t;
    const bucket =
      age < 3600e3 ? `v${v.id}` : age < 86400e3 ? `h${Math.floor(t / 3600e3)}` : age < 30 * 86400e3 ? `d${Math.floor(t / 86400e3)}` : `w${Math.floor(t / (7 * 86400e3))}`;
    if (seen.has(bucket) || kept >= MAX_VERSIONS) {
      drop.push(v.id);
      continue;
    }
    seen.add(bucket);
    kept++;
  }
  return drop;
}
