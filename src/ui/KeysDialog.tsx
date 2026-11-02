// Keyboard shortcuts: a cheat sheet that doubles as the place to change them.

import { useEffect, useState } from 'react';
import { t, type MessageKey } from '../i18n';
import {
  COMMANDS,
  addBinding,
  comboFromEvent,
  formatCombo,
  isCustomised,
  removeBinding,
  resetBindings,
  useKeymap,
  type CommandDef,
  type CommandId,
} from './keymap';

const GROUPS: CommandDef['group'][] = ['general', 'edit', 'navigate', 'view', 'file'];

export const cmdLabel = (id: CommandId) => t(`cmd.${id}` as MessageKey);
export const fmt = (combo: string) => formatCombo(combo, t('key.space'));

export function KeysDialog({ onClose }: { onClose(): void }) {
  const keymap = useKeymap();
  const [recording, setRecording] = useState<CommandId | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // While recording, the next key press becomes the new binding.
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setRecording(null);
      const combo = comboFromEvent(e);
      if (!combo) return;
      const taken = addBinding(recording, combo);
      setNotice(taken.length ? t('keys.moved', { key: fmt(combo), from: taken.map(cmdLabel).join(', '), to: cmdLabel(recording) }) : null);
      setRecording(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording]);

  const fixed: [string, MessageKey][] = [
    ['Shift+Enter', 'keys.fixed.newline'],
    ['A–Z', 'keys.fixed.type'],
    ['Esc', 'keys.fixed.escape'],
    [t('keys.fixed.dragKey'), 'keys.fixed.drag'],
    [t('keys.fixed.dblKey'), 'keys.fixed.dbl'],
    [`${fmt('Mod')}+${t('keys.fixed.wheel')}`, 'keys.fixed.zoom'],
  ];

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog keys" role="dialog" aria-label={t('keys.title')} onKeyDown={(e) => e.key === 'Escape' && !recording && onClose()}>
        <div className="sc-head">
          <strong>{t('keys.title')}</strong>
          <button className="ib" aria-label={t('common.close')} onClick={onClose}>×</button>
        </div>
        <p className="muted small">{t('keys.intro')}</p>
        {notice && <div className="keys-notice" role="status">{notice}</div>}
        <div className="keys-body">
          {GROUPS.map((g) => (
            <section key={g}>
              <h3 className="lbl">{t(`keys.group.${g}` as MessageKey)}</h3>
              {COMMANDS.filter((c) => c.group === g).map((c) => (
                <div className="keys-row" key={c.id}>
                  <span className="keys-name">
                    {cmdLabel(c.id)}
                    {c.outlineOnly && <span className="pi-tag">{t('keys.outlineOnly')}</span>}
                  </span>
                  <span className="keys-chips">
                    {keymap[c.id].map((k) => (
                      <span className="chipkey" key={k}>
                        <kbd>{fmt(k)}</kbd>
                        <button className="chip-x" aria-label={t('keys.remove', { key: fmt(k) })} onClick={() => removeBinding(c.id, k)}>×</button>
                      </span>
                    ))}
                    {recording === c.id ? (
                      <span className="recording">{t('keys.press')}</span>
                    ) : (
                      <button className="link-btn" onClick={() => { setNotice(null); setRecording(c.id); }}>{t('keys.add')}</button>
                    )}
                    {isCustomised(c.id) && (
                      <button className="link-btn" onClick={() => resetBindings(c.id)}>{t('keys.reset')}</button>
                    )}
                  </span>
                </div>
              ))}
            </section>
          ))}
          <section>
            <h3 className="lbl">{t('keys.group.fixed')}</h3>
            {fixed.map(([k, label]) => (
              <div className="keys-row" key={label}>
                <span className="keys-name">{t(label)}</span>
                <span className="keys-chips"><kbd>{k}</kbd></span>
              </div>
            ))}
          </section>
        </div>
        <div className="row">
          <button className="btn" onClick={() => { resetBindings(); setNotice(null); }}>{t('keys.resetAll')}</button>
        </div>
      </div>
    </div>
  );
}
