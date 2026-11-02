// Interface language. Turkish is the source language; every other language
// must translate every key (the type checker enforces it). Adding a language
// is one new file plus a line in LANGS.

import { useSyncExternalStore } from 'react';
import { en } from './en';
import { tr, type MessageKey } from './tr';

export type { MessageKey };
export type Lang = 'tr' | 'en';

export const LANGS: { id: Lang; name: string; locale: string; messages: Record<MessageKey, string> }[] = [
  { id: 'tr', name: 'Türkçe', locale: 'tr-TR', messages: tr },
  { id: 'en', name: 'English', locale: 'en-US', messages: en },
];

const STORAGE_KEY = 'keizu:lang';

export function detectLang(preferred: readonly string[] = globalThis.navigator?.languages ?? []): Lang {
  for (const p of preferred) {
    const code = p.toLowerCase().split('-')[0];
    if (LANGS.some((l) => l.id === code)) return code as Lang;
  }
  return 'en';
}

function initialLang(): Lang {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (saved && LANGS.some((l) => l.id === saved)) return saved as Lang;
  } catch {
    /* storage blocked */
  }
  return detectLang();
}

let lang: Lang = initialLang();
const listeners = new Set<() => void>();

export const getLang = () => lang;
export const locale = () => LANGS.find((l) => l.id === lang)!.locale;

export function setLang(next: Lang) {
  if (next === lang) return;
  lang = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    /* the choice lasts for this session */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  listeners.forEach((l) => l());
}

/** Re-renders the calling component when the language changes. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getLang,
    getLang,
  );
}

/**
 * Translates a key. `{name}` placeholders are filled from `vars`; a message
 * of the form "one|many" picks a form by `vars.n`.
 */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let msg: string = LANGS.find((l) => l.id === lang)!.messages[key] ?? tr[key] ?? key;
  if (msg.includes('|') && vars && typeof vars.n === 'number') {
    const [one, many] = msg.split('|');
    msg = vars.n === 1 ? one : many;
  }
  return vars ? msg.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : msg;
}

/** Locale-aware lowercase for the current language. */
export const lower = (s: string) => s.toLocaleLowerCase(locale());
