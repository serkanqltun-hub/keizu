import { describe, expect, it } from 'vitest';
import { LANGS, detectLang, t } from '../i18n';
import { tr } from '../i18n/tr';
import { COMMANDS, addBinding, commandFor, comboFromEvent, comboParts, getKeymap, removeBinding, resetBindings } from './keymap';

const ev = (key: string, mods: Partial<{ ctrl: boolean; shift: boolean; alt: boolean; code: string }> = {}) => ({
  key,
  code: mods.code ?? '',
  ctrlKey: !!mods.ctrl,
  metaKey: false,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
});

describe('keymap', () => {
  it('turns key events into bindings', () => {
    expect(comboFromEvent(ev('z', { ctrl: true }))).toBe('Mod+Z');
    expect(comboFromEvent(ev('Z', { ctrl: true, shift: true }))).toBe('Mod+Shift+Z');
    expect(comboFromEvent(ev('?', { shift: true }))).toBe('?'); // shift is part of the symbol
    expect(comboFromEvent(ev(' '))).toBe('Space');
    expect(comboFromEvent(ev('Tab', { shift: true }))).toBe('Shift+Tab');
    expect(comboFromEvent(ev('ø', { ctrl: true, alt: true, code: 'KeyO' }))).toBe('Mod+Alt+O');
    expect(comboFromEvent(ev('Shift', { shift: true }))).toBeNull();
    expect(comboParts('Mod++')).toEqual(['Mod', '+']);
  });

  it('prefers outline-only commands in the outline', () => {
    const km = getKeymap();
    expect(commandFor(km, 'Tab', false)).toBe('addChild');
    expect(commandFor(km, 'Tab', true)).toBe('indent');
    expect(commandFor(km, 'Shift+Tab', false)).toBeUndefined();
  });

  it('rebinds, moving a taken key away from its old command', () => {
    const taken = addBinding('fit', 'Mod+Z');
    expect(taken).toEqual(['undo']);
    expect(getKeymap().fit).toContain('Mod+Z');
    expect(getKeymap().undo).not.toContain('Mod+Z');
    removeBinding('fit', 'Mod+0');
    expect(getKeymap().fit).toEqual(['Mod+Z']);
    resetBindings();
    expect(getKeymap().undo).toEqual(['Mod+Z']);
  });

  it('has no duplicate default bindings within a scope', () => {
    const seen = new Map<string, string>();
    for (const c of COMMANDS)
      for (const k of c.keys) {
        const key = `${c.outlineOnly ? 'o' : 'm'}:${k}`;
        expect(seen.get(key), `${k} used by ${seen.get(key)} and ${c.id}`).toBeUndefined();
        seen.set(key, c.id);
      }
  });
});

describe('i18n', () => {
  it('translates every key into every language', () => {
    for (const l of LANGS) for (const k of Object.keys(tr)) expect(l.messages[k as keyof typeof tr], `${l.id}: ${k}`).toBeTruthy();
  });

  it('has a label for every command', () => {
    for (const c of COMMANDS) expect(tr[`cmd.${c.id}` as keyof typeof tr]).toBeTruthy();
  });

  it('fills placeholders and picks plural forms', () => {
    expect(t('common.topics', { n: 3 })).toMatch(/3/);
    expect(detectLang(['tr-TR', 'en'])).toBe('tr');
    expect(detectLang(['de-DE', 'en-GB'])).toBe('en');
    expect(detectLang(['fr'])).toBe('en');
  });
});
