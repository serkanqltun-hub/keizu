// Share a map on your Keizu Server: with people on the same server (view or
// edit), and/or as a read-only link anyone can open.

import { useEffect, useState } from 'react';
import type { MindMap } from '../core/model';
import { sync } from '../sync/controller';
import { KeizuServerAdapter, type ShareInfo, type ShareRole } from '../sync/keizuServer';
import { t } from '../i18n';

interface Props {
  map: MindMap;
  onClose(): void;
  /** Called after the first person was added, so the editor goes live. */
  onShared(): void;
}

export function ShareDialog({ map, onClose, onShared }: Props) {
  const [adapter, setAdapter] = useState<KeizuServerAdapter | null>(null);
  const [info, setInfo] = useState<ShareInfo | null | undefined>(undefined);
  const [user, setUser] = useState('');
  const [role, setRole] = useState<ShareRole>('edit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const encrypted = !!sync.getConfig() && sync.getEncryption();

  const load = async () => {
    const a = await sync.adapter();
    if (!(a instanceof KeizuServerAdapter)) return setInfo(null);
    setAdapter(a);
    try {
      setInfo((await a.shares(map.id)) ?? null);
    } catch (e) {
      setError((e as Error).message);
      setInfo(null);
    }
  };
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<ShareInfo>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      if (next.shares.length && !info?.shares.length) onShared();
      setInfo(next);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const syncFirst = async () => {
    setBusy(true);
    await sync.syncNow();
    setBusy(false);
    load();
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the link stays visible to copy by hand */
    }
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog share" role="dialog" aria-label={t('share.title')} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="sc-head">
          <strong>{t('share.title')}</strong>
          <button className="ib" aria-label={t('common.close')} onClick={onClose}>×</button>
        </div>

        {encrypted ? (
          <p className="muted">{t('share.encrypted')}</p>
        ) : info === undefined ? (
          <p className="muted">{t('share.loading')}</p>
        ) : info === null ? (
          <>
            <p className="muted">{error ?? t('share.notSynced')}</p>
            {!error && (
              <div>
                <button className="btn primary" disabled={busy} onClick={syncFirst}>{t('share.syncNow')}</button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="muted small">{t('share.intro')}</p>
            <form
              className="row share-add"
              onSubmit={async (e) => {
                e.preventDefault();
                const name = user.trim();
                if (!name || !adapter) return;
                if (await run(() => adapter.share(map.id, name, role))) setUser('');
              }}
            >
              <input
                className="text-input"
                value={user}
                placeholder={t('share.userPlaceholder')}
                aria-label={t('share.user')}
                onChange={(e) => setUser(e.target.value)}
                autoFocus
                spellCheck={false}
                autoCapitalize="off"
              />
              <select className="share-role" value={role} aria-label={t('share.role')} onChange={(e) => setRole(e.target.value as ShareRole)}>
                <option value="edit">{t('share.role.edit')}</option>
                <option value="view">{t('share.role.view')}</option>
              </select>
              <button className="btn primary" disabled={busy || !user.trim()}>{t('share.add')}</button>
            </form>
            {error && <p className="share-error" role="alert">{error}</p>}

            <section className="share-list">
              {info.shares.length === 0 ? (
                <p className="muted small">{t('share.nobody')}</p>
              ) : (
                info.shares.map((s) => (
                  <div className="share-row" key={s.username}>
                    <span className="avatar" aria-hidden="true">{s.username.slice(0, 1).toUpperCase()}</span>
                    <span className="share-name">{s.username}</span>
                    <select
                      className="share-role"
                      value={s.role}
                      aria-label={t('share.roleFor', { name: s.username })}
                      disabled={busy}
                      onChange={(e) => adapter && run(() => adapter.share(map.id, s.username, e.target.value as ShareRole))}
                    >
                      <option value="edit">{t('share.role.edit')}</option>
                      <option value="view">{t('share.role.view')}</option>
                    </select>
                    <button className="btn" disabled={busy} onClick={() => adapter && run(() => adapter.unshare(map.id, s.username))}>
                      {t('share.remove')}
                    </button>
                  </div>
                ))
              )}
            </section>

            <section className="share-link">
              <h3 className="lbl">{t('share.linkTitle')}</h3>
              {info.link ? (
                <>
                  <div className="row">
                    <input className="text-input" readOnly value={info.link} aria-label={t('share.linkTitle')} onFocus={(e) => e.target.select()} />
                    <button className="btn" onClick={() => copy(info.link!)}>{copied ? t('sync.copied') : t('sync.copy')}</button>
                  </div>
                  <p className="muted small">{t('share.linkOn')}</p>
                  <div>
                    <button className="btn" disabled={busy} onClick={() => adapter && run(() => adapter.removeLink(map.id))}>{t('share.linkOff')}</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="muted small">{t('share.linkHint')}</p>
                  <div>
                    <button className="btn" disabled={busy} onClick={() => adapter && run(() => adapter.createLink(map.id))}>{t('share.linkCreate')}</button>
                  </div>
                </>
              )}
            </section>
            {info.live > 0 && <p className="muted small">{t('share.liveNow', { n: info.live })}</p>}
          </>
        )}
      </div>
    </div>
  );
}
