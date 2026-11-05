// Settings → Cloud sync. The only place a server comes up: nothing asks the
// user to connect anything on first launch.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { locale, t, type MessageKey } from '../i18n';
import { deviceName, httpFetch, sync, type SyncStatus } from '../sync/controller';
import type { ConflictPolicy, SyncEvent } from '../sync/engine';
import { discover, login, pair, KeizuServerAdapter, type ServerInfo } from '../sync/keizuServer';
import * as I from './Icons';
import { isDesktop } from './platform';
import { setMotionPrefs, useMotionPrefs, type MotionMode, type WheelMode } from './motion';

export const GUIDE_URL = 'https://github.com/serkanqltun-hub/keizu/blob/main/docs/server/hetzner.md';
export const INSTALL_CMD = 'curl -fsSL https://raw.githubusercontent.com/serkanqltun-hub/keizu/main/server/deploy/install.sh | sudo bash';

type Tab = 'address' | 'code' | 'webdav';

interface Props {
  onBack(): void;
  /** Pre-filled from a keizu://connect link. */
  link?: { server: string; code?: string } | null;
}

function useSync() {
  const status = useSyncExternalStore((f) => sync.subscribe(f), sync.getStatus);
  const config = useSyncExternalStore((f) => sync.subscribe(f), sync.getConfig);
  const prefs = useSyncExternalStore((f) => sync.subscribe(f), sync.getPrefs);
  const activity = useSyncExternalStore((f) => sync.subscribe(f), sync.getActivity);
  return { status, config, prefs, activity };
}

export function fmtWhen(iso?: string): string {
  if (!iso) return t('sync.never');
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return t('time.justNow');
  if (diff < 3600) return t('time.minutesAgo', { n: Math.floor(diff / 60) });
  return d.toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function statusText(s: SyncStatus): string {
  return t(`sync.state.${s.state}` as MessageKey);
}

const dotClass = (s: SyncStatus) => (s.state === 'idle' || s.state === 'syncing' ? 'ok' : s.state === 'off' ? '' : 'warn');

function CopyField({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="copy-field">
      <code>{text}</code>
      <button
        className="btn"
        onClick={() =>
          navigator.clipboard?.writeText(text).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          })
        }
      >
        {done ? t('sync.copied') : t('sync.copy')}
      </button>
    </div>
  );
}

function ConnectForm({ link }: { link?: Props['link'] }) {
  const [tab, setTab] = useState<Tab>(link?.code ? 'code' : 'address');
  const [address, setAddress] = useState(link?.server ?? '');
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [finding, setFinding] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState(link?.code ?? '');
  const [davUrl, setDavUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const find = async (addr = address): Promise<ServerInfo | null> => {
    if (!addr.trim()) return null;
    setFinding(true);
    setError(null);
    try {
      const i = await discover(await httpFetch(), addr);
      setInfo(i);
      return i;
    } catch (e) {
      setInfo(null);
      setError((e as Error).message);
      return null;
    } finally {
      setFinding(false);
    }
  };

  useEffect(() => {
    if (link?.server) {
      find(link.server);
      return;
    }
    // Opened from a Keizu Server's own address: offer that server, quietly.
    if (isDesktop || !/^https?:$/.test(location.protocol)) return;
    discover(globalThis.fetch.bind(globalThis), location.origin)
      .then((i) => {
        setAddress((a) => a || i.server);
        setInfo((cur) => cur ?? i);
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (tab === 'webdav') {
        await sync.connectWebdav(davUrl.trim(), username, password);
        return;
      }
      const i = info && address ? info : await find();
      if (!i) return;
      if (i.compat === 'update-app') throw new Error(t('sync.updateApp'));
      const f = await httpFetch();
      const session = tab === 'code' ? await pair(f, i.api, code, deviceName()) : await login(f, i.api, username, password, deviceName());
      await sync.connectKeizu(i, session);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tabs: Tab[] = ['address', 'code', 'webdav'];
  return (
    <form className="set-card" onSubmit={submit}>
      <div className="set-head">
        <strong>{t('sync.connectTitle')}</strong>
        <span className="dot-label">
          <span className="dot" />
          {t('sync.notConnected')}
        </span>
      </div>
      <div role="tablist" className="seg-tabs">
        {tabs.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {t(`sync.tab.${id}`)}
          </button>
        ))}
      </div>

      {tab !== 'webdav' ? (
        <>
          <label className="fld-label">
            {t('sync.server')}
            <span className="fld-row">
              <input
                className="fld"
                value={address}
                placeholder={t('sync.serverPlaceholder')}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setInfo(null);
                }}
                onBlur={() => !info && address.trim() && find()}
              />
              <button type="button" className="btn" onClick={() => find()} disabled={finding}>
                {finding ? t('sync.finding') : t('sync.find')}
              </button>
            </span>
          </label>
          {info && (
            <div className={`found-box ${info.server.startsWith('https:') ? '' : 'warn'}`}>
              <I.Check size={18} />
              <span>
                <strong>{t('sync.found', { name: info.name, version: info.version })}</strong>
                <span>{t('sync.foundDetail', { secure: info.server.startsWith('https:') ? t('sync.https') : t('sync.noHttps'), api: info.apiVersion })}</span>
                {info.compat === 'update-server' && <span>{t('sync.updateServer', { version: info.version })}</span>}
                {info.compat === 'update-app' && <span>{t('sync.updateApp')}</span>}
              </span>
            </div>
          )}
        </>
      ) : (
        <>
          <label className="fld-label">
            {t('sync.webdavUrl')}
            <input className="fld" value={davUrl} placeholder={t('sync.webdavPlaceholder')} onChange={(e) => setDavUrl(e.target.value)} required spellCheck={false} />
          </label>
          <p className="muted small">{t('sync.webdavNote')}</p>
        </>
      )}

      {tab === 'code' ? (
        <label className="fld-label">
          {t('sync.code')}
          <input
            className="fld code-input"
            value={code}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="482 917"
            onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, '').slice(0, 7))}
            required
          />
          <span className="muted small">{t('sync.codeHint')}</span>
        </label>
      ) : (
        <div className="fld-grid">
          <label className="fld-label">
            {t('sync.username')}
            <input className="fld" value={username} autoComplete="username" autoCapitalize="off" onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label className="fld-label">
            {t('sync.password')}
            <input className="fld" type="password" value={password} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} required />
          </label>
        </div>
      )}

      {error && <div className="error" role="alert">{error}</div>}
      <div className="set-actions">
        <button className="btn primary" disabled={busy}>
          {busy ? t('sync.connecting') : t('sync.connect')}
        </button>
        {tab !== 'webdav' && <span className="muted small">{t('sync.tokenNote')}</span>}
      </div>
    </form>
  );
}

function Connected() {
  const { status, config } = useSync();
  if (!config) return null;
  const isKeizu = config.kind === 'keizu';
  return (
    <section className="set-card">
      <div className="set-head">
        <strong>{t('sync.connectedTo', { server: isKeizu ? config.server.replace(/^https?:\/\//, '') : config.url.replace(/^https?:\/\//, '') })}</strong>
        <span className="dot-label">
          <span className={`dot ${dotClass(status)}`} />
          {statusText(status)}
        </span>
      </div>
      <p className="muted small">
        {isKeizu ? `${config.serverName} ${config.serverVersion} · ${t('sync.signedInAs', { user: config.username })}` : t('sync.webdavAs', { user: config.username })}
        {' · '}
        {t('sync.lastSync', { when: fmtWhen(status.lastSyncAt) })}
      </p>
      {status.message && status.state !== 'idle' && <div className="error">{status.message}</div>}
      {isKeizu && config.compat === 'update-server' && <div className="error">{t('sync.updateServer', { version: config.serverVersion })}</div>}
      <div className="set-actions">
        {status.state === 'signedOut' ? (
          <button className="btn primary" onClick={() => sync.disconnect()}>
            {t('sync.reconnect')}
          </button>
        ) : (
          <button className="btn primary" onClick={() => sync.syncNow()} disabled={status.state === 'syncing'}>
            {t('sync.syncNow')}
          </button>
        )}
        <button className="btn" onClick={() => window.confirm(t('sync.confirmDisconnect')) && sync.disconnect()}>
          {t('sync.disconnect')}
        </button>
      </div>
    </section>
  );
}

function PairCard() {
  const [p, setP] = useState<{ code: string; expiresAt: string; qrSvg: string } | null>(null);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!p) return;
    const tick = () => setLeft(Math.max(0, Math.round((Date.parse(p.expiresAt) - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [p]);
  const make = async () => {
    setError(null);
    try {
      const a = await sync.adapter();
      if (a instanceof KeizuServerAdapter) setP(await a.pairCode());
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="set-card side">
      <strong>{t('sync.pairTitle')}</strong>
      {p && left > 0 ? (
        <div className="pair-row">
          {/* An <img> can't run anything inside the server's SVG. */}
          <img className="pair-qr" alt={t('sync.pairQr')} width={104} height={104} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(p.qrSvg)}`} />
          <span className="pair-text">
            <span className="muted small">{t('sync.pairIntro')}</span>
            <span className="pair-code">{`${p.code.slice(0, 3)} ${p.code.slice(3)}`}</span>
            <span className="muted small">{t('sync.pairExpires', { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` })}</span>
          </span>
        </div>
      ) : (
        <>
          <span className="muted small">{p ? t('sync.pairExpired') : t('sync.pairIntro')}</span>
          <button className="btn" onClick={make}>
            {t('sync.pairMake')}
          </button>
        </>
      )}
      {error && <div className="error">{error}</div>}
    </section>
  );
}

function NoServerCard() {
  return (
    <section className="set-card side">
      <strong>{t('sync.noServerTitle')}</strong>
      <span className="muted small">{t('sync.noServerText')}</span>
      <CopyField text={INSTALL_CMD} />
      <a href={GUIDE_URL} target="_blank" rel="noreferrer">
        {t('sync.guide')}
      </a>
    </section>
  );
}

function Activity({ items }: { items: SyncEvent[] }) {
  return (
    <section className="set-activity">
      <h2>{t('sync.activity')}</h2>
      <div className="set-table">
        <table>
          <thead>
            <tr>
              <th>{t('sync.col.time')}</th>
              <th>{t('sync.col.map')}</th>
              <th>{t('sync.col.action')}</th>
            </tr>
          </thead>
          <tbody>
            {items.length ? (
              items.map((e, i) => (
                <tr key={i}>
                  <td>{fmtWhen(e.at)}</td>
                  <td>{e.title}</td>
                  <td className={e.action === 'error' ? 'bad' : e.action === 'copied' || e.action === 'merged' || e.action === 'keptRemote' ? 'warn' : ''}>
                    {t(`sync.action.${e.action}` as MessageKey)}
                    {e.message ? `: ${e.message}` : ''}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className="muted">
                  {t('sync.activityEmpty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function SyncSettings({ onBack, link }: Props) {
  const { config, prefs, activity } = useSync();
  const [page, setPage] = useState<'sync' | 'motion'>('sync');
  return (
    <div className="settings">
      <aside className="settings-side">
        <button className="back-link" onClick={onBack}>
          <I.Back size={16} /> {t('settings.back')}
        </button>
        <span className="settings-title">{t('settings.title')}</span>
        <nav aria-label={t('settings.title')}>
          <button className={`nav-item ${page === 'sync' ? 'on' : ''}`} aria-current={page === 'sync' ? 'page' : undefined} onClick={() => setPage('sync')}>
            <I.Cloud size={16} /> {t('sync.title')}
          </button>
          <button className={`nav-item ${page === 'motion' ? 'on' : ''}`} aria-current={page === 'motion' ? 'page' : undefined} onClick={() => setPage('motion')}>
            <I.MapIcon size={16} /> {t('motion.title')}
          </button>
        </nav>
      </aside>
      {page === 'motion' ? (
        <main className="settings-main">
          <MotionSettings />
        </main>
      ) : (
      <main className="settings-main">
        <div>
          <h1>{t('sync.title')}</h1>
          <p className="muted">{t('sync.intro')}</p>
        </div>
        <div className="set-cols">
          <div className="set-col-main">{config ? <Connected /> : <ConnectForm link={link} />}</div>
          <div className="set-col-side">{config?.kind === 'keizu' ? <PairCard /> : <NoServerCard />}</div>
        </div>
        {config && (
          <section className="set-card">
            <label className="set-row">
              <span>
                <strong>{t('sync.auto')}</strong>
                <span className="muted small">{t('sync.autoHint')}</span>
              </span>
              <input type="checkbox" checked={prefs.auto} onChange={(e) => sync.setPrefs({ auto: e.target.checked })} />
            </label>
            <div className="set-sep" />
            <label className="set-row">
              <span>
                <strong>{t('sync.policy')}</strong>
                <span className="muted small">{t('sync.policyHint')}</span>
              </span>
              <select className="fld" value={prefs.policy} onChange={(e) => sync.setPrefs({ policy: e.target.value as ConflictPolicy })}>
                {(['merge', 'copy', 'server'] as const).map((p) => (
                  <option key={p} value={p}>
                    {t(`sync.policy.${p}`)}
                  </option>
                ))}
              </select>
            </label>
          </section>
        )}
        {config && <EncryptionCard />}
        {config && <Activity items={activity} />}
      </main>
      )}
    </div>
  );
}

/** How the canvas moves: the mouse wheel and animations. */
function MotionSettings() {
  const p = useMotionPrefs();
  return (
    <>
      <div>
        <h1>{t('motion.title')}</h1>
        <p className="muted">{t('motion.intro')}</p>
      </div>
      <section className="set-card">
        <label className="set-row">
          <span>
            <strong>{t('motion.wheel')}</strong>
            <span className="muted small">{t('motion.wheelHint')}</span>
          </span>
          <select className="fld" value={p.wheel} onChange={(e) => setMotionPrefs({ wheel: e.target.value as WheelMode })}>
            <option value="zoom">{t('motion.wheel.zoom')}</option>
            <option value="pan">{t('motion.wheel.pan')}</option>
          </select>
        </label>
        <div className="set-sep" />
        <label className="set-row">
          <span>
            <strong>{t('motion.anim')}</strong>
            <span className="muted small">{t('motion.animHint')}</span>
          </span>
          <select className="fld" value={p.motion} onChange={(e) => setMotionPrefs({ motion: e.target.value as MotionMode })}>
            <option value="system">{t('motion.anim.system')}</option>
            <option value="full">{t('motion.anim.full')}</option>
            <option value="reduced">{t('motion.anim.reduced')}</option>
          </select>
        </label>
      </section>
    </>
  );
}

/** Optional end-to-end encryption of synced maps, with its trade-offs spelled out. */
function EncryptionCard() {
  const [on, setOn] = useState(sync.getEncryption());
  const [editing, setEditing] = useState(false);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    setError(null);
    if (pass !== pass2) return setError(t('e2e.mismatch'));
    try {
      sync.setEncryption(true, pass);
      setOn(true);
      setEditing(false);
      setPass('');
      setPass2('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="set-card">
      <div className="set-head">
        <strong>
          <I.Lock size={16} /> {t('e2e.title')}
        </strong>
        <span className={`pill ${on ? 'ok' : ''}`}>{on ? t('e2e.on') : t('e2e.off')}</span>
      </div>
      <p className="muted small">{t('e2e.intro')}</p>
      <ul className="muted small e2e-list">
        <li>{t('e2e.noShare')}</li>
        <li>{t('e2e.samePass')}</li>
        <li>{t('e2e.lost')}</li>
      </ul>
      {editing ? (
        <form
          className="e2e-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input className="fld" type="password" autoComplete="new-password" placeholder={t('e2e.pass')} value={pass} onChange={(e) => setPass(e.target.value)} />
          <input className="fld" type="password" autoComplete="new-password" placeholder={t('e2e.pass2')} value={pass2} onChange={(e) => setPass2(e.target.value)} />
          {error && <p className="share-error" role="alert">{error}</p>}
          <div className="row">
            <button className="btn primary" disabled={!pass}>{t('e2e.enable')}</button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
          </div>
        </form>
      ) : on ? (
        <div className="row">
          <button
            className="btn"
            onClick={() => {
              if (!window.confirm(t('e2e.confirmOff'))) return;
              sync.setEncryption(false);
              setOn(false);
            }}
          >
            {t('e2e.disable')}
          </button>
        </div>
      ) : (
        <div className="row">
          <button className="btn" onClick={() => setEditing(true)}>{t('e2e.setup')}</button>
        </div>
      )}
    </section>
  );
}
