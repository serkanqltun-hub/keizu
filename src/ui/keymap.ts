// Rebindable keyboard shortcuts. Bindings are strings like "Mod+Shift+Z";
// "Mod" is ⌘ on macOS and Ctrl elsewhere. Only the user's changes are
// stored (localStorage), so new defaults reach people who never customised.

import { useSyncExternalStore } from 'react';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export type CommandId =
  | 'palette'
  | 'addChild'
  | 'addSibling'
  | 'addSiblingBefore'
  | 'edit'
  | 'remove'
  | 'undo'
  | 'redo'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'collapse'
  | 'moveUp'
  | 'moveDown'
  | 'indent'
  | 'outdent'
  | 'navLeft'
  | 'navRight'
  | 'navUp'
  | 'navDown'
  | 'relation'
  | 'floating'
  | 'note'
  | 'save'
  | 'saveAs'
  | 'toggleOutline'
  | 'zoomIn'
  | 'zoomOut'
  | 'fit'
  | 'centerSelected'
  | 'history'
  | 'panel'
  | 'shortcuts'
  | 'language'
  | 'back'
  | 'present'
  | 'openLink'
  | 'share';

export interface CommandDef {
  id: CommandId;
  /** Default bindings (empty: reachable from the palette only). */
  keys: string[];
  /** Only active in the outline view (checked before other commands). */
  outlineOnly?: boolean;
  group: 'general' | 'edit' | 'navigate' | 'view' | 'file';
}

export const COMMANDS: CommandDef[] = [
  { id: 'palette', keys: ['Mod+K'], group: 'general' },
  { id: 'shortcuts', keys: ['?'], group: 'general' },
  { id: 'language', keys: [], group: 'general' },
  { id: 'back', keys: [], group: 'general' },
  { id: 'addChild', keys: ['Tab', 'Insert'], group: 'edit' },
  { id: 'addSibling', keys: ['Enter'], group: 'edit' },
  { id: 'addSiblingBefore', keys: ['Shift+Enter'], group: 'edit' },
  { id: 'edit', keys: ['F2', 'Space'], group: 'edit' },
  { id: 'remove', keys: ['Delete', 'Backspace'], group: 'edit' },
  { id: 'undo', keys: ['Mod+Z'], group: 'edit' },
  { id: 'redo', keys: ['Mod+Shift+Z', 'Mod+Y'], group: 'edit' },
  { id: 'copy', keys: ['Mod+C'], group: 'edit' },
  { id: 'cut', keys: ['Mod+X'], group: 'edit' },
  { id: 'paste', keys: ['Mod+V'], group: 'edit' },
  { id: 'moveUp', keys: ['Alt+ArrowUp'], group: 'edit' },
  { id: 'moveDown', keys: ['Alt+ArrowDown'], group: 'edit' },
  { id: 'indent', keys: ['Tab'], outlineOnly: true, group: 'edit' },
  { id: 'outdent', keys: ['Shift+Tab'], outlineOnly: true, group: 'edit' },
  { id: 'relation', keys: [], group: 'edit' },
  { id: 'floating', keys: [], group: 'edit' },
  { id: 'note', keys: [], group: 'edit' },
  { id: 'navLeft', keys: ['ArrowLeft'], group: 'navigate' },
  { id: 'navRight', keys: ['ArrowRight'], group: 'navigate' },
  { id: 'navUp', keys: ['ArrowUp'], group: 'navigate' },
  { id: 'navDown', keys: ['ArrowDown'], group: 'navigate' },
  { id: 'collapse', keys: ['Mod+/'], group: 'navigate' },
  { id: 'centerSelected', keys: ['Mod+Enter'], group: 'navigate' },
  { id: 'toggleOutline', keys: ['Mod+Alt+O'], group: 'view' },
  { id: 'zoomIn', keys: ['Mod+=', 'Mod++'], group: 'view' },
  { id: 'zoomOut', keys: ['Mod+-'], group: 'view' },
  { id: 'fit', keys: ['Mod+0'], group: 'view' },
  { id: 'history', keys: [], group: 'view' },
  { id: 'panel', keys: [], group: 'view' },
  { id: 'present', keys: ['F5'], group: 'view' },
  { id: 'openLink', keys: ['Alt+Enter'], group: 'navigate' },
  { id: 'share', keys: [], group: 'file' },
  { id: 'save', keys: ['Mod+S'], group: 'file' },
  { id: 'saveAs', keys: ['Mod+Shift+S'], group: 'file' },
];

export const COMMAND_BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

export type Keymap = Record<CommandId, string[]>;
type Overrides = Partial<Record<CommandId, string[]>>;

const STORAGE_KEY = 'keizu:keys';
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn', 'OS']);

/** The binding string for a key event, or null for a bare modifier press. */
export function comboFromEvent(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  let key = e.key;
  // Alt changes the character on macOS (Alt+O gives "ø"): use the physical key.
  if (e.altKey) {
    const m = /^(?:Key([A-Z])|Digit(\d))$/.exec(e.code);
    if (m) key = m[1] ?? m[2];
  }
  if (key === ' ') key = 'Space';
  if (key.length === 1) key = key.toUpperCase();
  const isLetter = key.length === 1 && key.toLowerCase() !== key.toUpperCase();
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const parts: string[] = [];
  if (mod) parts.push('Mod');
  if (isMac && e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  // A symbol like "?" already says Shift was held (and which Shift key it
  // takes differs between keyboard layouts), so it isn't repeated.
  if (e.shiftKey && (key.length > 1 || isLetter)) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/** Splits a binding into its parts ("Mod++" is Mod and "+"). */
export function comboParts(combo: string): string[] {
  if (combo === '+') return ['+'];
  if (combo.endsWith('++')) return [...combo.slice(0, -2).split('+'), '+'];
  return combo.split('+');
}

const KEY_NAMES: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
  Delete: 'Del',
  Backspace: '⌫',
};

/** Human-readable form, e.g. "Ctrl+Shift+Z" or "⌘⇧Z". */
export function formatCombo(combo: string, spaceName = 'Space'): string {
  const parts = comboParts(combo).map((p) => {
    if (p === 'Mod') return isMac ? '⌘' : 'Ctrl';
    if (p === 'Alt') return isMac ? '⌥' : 'Alt';
    if (p === 'Shift') return isMac ? '⇧' : 'Shift';
    if (p === 'Ctrl') return isMac ? '⌃' : 'Ctrl';
    if (p === 'Space') return spaceName;
    return KEY_NAMES[p] ?? p;
  });
  return isMac ? parts.join('') : parts.join('+');
}

function readOverrides(): Overrides {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const out: Overrides = {};
    for (const [id, keys] of Object.entries(parsed)) {
      if (COMMAND_BY_ID.has(id as CommandId) && Array.isArray(keys) && keys.every((k) => typeof k === 'string')) out[id as CommandId] = keys;
    }
    return out;
  } catch {
    return {};
  }
}

let overrides = readOverrides();
let current = build(overrides);
const listeners = new Set<() => void>();

function build(o: Overrides): Keymap {
  const map = {} as Keymap;
  for (const c of COMMANDS) map[c.id] = o[c.id] ?? c.keys;
  return map;
}

function commitOverrides(next: Overrides) {
  overrides = next;
  current = build(next);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private mode: the change lasts for this session */
  }
  listeners.forEach((l) => l());
}

export const getKeymap = () => current;

export function useKeymap(): Keymap {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getKeymap,
    getKeymap,
  );
}

const sameKeys = (a: string[], b: string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

function setKeys(o: Overrides, id: CommandId, keys: string[]) {
  if (sameKeys(keys, COMMAND_BY_ID.get(id)!.keys)) delete o[id];
  else o[id] = keys;
}

/** Commands (other than `except`) that already use a binding in the same scope. */
export function conflictsFor(keymap: Keymap, combo: string, except: CommandId): CommandId[] {
  const scopeOf = (id: CommandId) => !!COMMAND_BY_ID.get(id)!.outlineOnly;
  return COMMANDS.filter((c) => c.id !== except && scopeOf(c.id) === scopeOf(except) && keymap[c.id].includes(combo)).map((c) => c.id);
}

/** Adds a binding to a command, taking it away from any command that had it. */
export function addBinding(id: CommandId, combo: string): CommandId[] {
  const taken = conflictsFor(current, combo, id);
  const next = { ...overrides };
  for (const other of taken) setKeys(next, other, current[other].filter((k) => k !== combo));
  if (!current[id].includes(combo)) setKeys(next, id, [...current[id], combo]);
  commitOverrides(next);
  return taken;
}

export function removeBinding(id: CommandId, combo: string) {
  const next = { ...overrides };
  setKeys(next, id, current[id].filter((k) => k !== combo));
  commitOverrides(next);
}

export function resetBindings(id?: CommandId) {
  if (!id) return commitOverrides({});
  const next = { ...overrides };
  delete next[id];
  commitOverrides(next);
}

export const isCustomised = (id: CommandId) => id in overrides;

/**
 * The command a binding runs. In the outline view, outline-only commands
 * win (Tab indents there); elsewhere they are ignored.
 */
export function commandFor(keymap: Keymap, combo: string, outline: boolean): CommandId | undefined {
  let fallback: CommandId | undefined;
  for (const c of COMMANDS) {
    if (!keymap[c.id].includes(combo)) continue;
    if (c.outlineOnly) {
      if (outline) return c.id;
    } else fallback ??= c.id;
  }
  return fallback;
}
