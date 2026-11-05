// Desktop auto-update. The desktop app asks GitHub Releases for latest.json
// (address in tauri.conf.json → plugins.updater), checks the update's
// signature against the public key built into the app, then downloads and
// installs it. The web app never updates this way: a fresh page load is
// already the newest version.

import { useEffect, useState } from 'react';
import { getLang, useLang } from '../i18n';
import * as I from './Icons';
import { isDesktop } from './platform';

// The strings live here so this feature stays in one file.
const STRINGS = {
  tr: {
    title: 'Güncellemeler',
    intro: 'Keizu yeni bir sürüm çıktığında sana sorar, onaylarsan indirip kurar.',
    current: 'Yüklü sürüm',
    check: 'Güncellemeleri denetle',
    checking: 'Denetleniyor…',
    upToDate: 'En yeni sürümü kullanıyorsun.',
    failed: 'Güncelleme denetlenemedi: {msg}',
    auto: 'Açılışta denetle',
    autoHint: 'Uygulama açıldığında yeni sürüm var mı diye bakar. Sormadan hiçbir şey kurmaz.',
    available: 'Keizu {version} hazır',
    availableHint: 'Şu an {current} kullanıyorsun.',
    notes: 'Neler yeni',
    install: 'Şimdi güncelle',
    later: 'Sonra',
    downloading: 'İndiriliyor… {pct}',
    installing: 'Kuruluyor, Keizu yeniden açılacak…',
    webOnly: 'Web sürümü her açılışta zaten en yeni sürümdür. Otomatik güncelleme masaüstü uygulaması içindir.',
  },
  en: {
    title: 'Updates',
    intro: 'When a new version is out, Keizu asks you first, then downloads and installs it.',
    current: 'Installed version',
    check: 'Check for updates',
    checking: 'Checking…',
    upToDate: "You're on the latest version.",
    failed: "Couldn't check for updates: {msg}",
    auto: 'Check on startup',
    autoHint: 'Looks for a new version when the app opens. Nothing is installed without asking.',
    available: 'Keizu {version} is ready',
    availableHint: "You're on {current}.",
    notes: "What's new",
    install: 'Update now',
    later: 'Later',
    downloading: 'Downloading… {pct}',
    installing: 'Installing, Keizu will restart…',
    webOnly: 'The web version is always the newest one when you open it. Auto-update is for the desktop app.',
  },
} satisfies Record<'tr' | 'en', Record<string, string>>;

type Key = keyof (typeof STRINGS)['tr'];
const s = (key: Key, vars: Record<string, string> = {}) =>
  STRINGS[getLang()][key].replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');

/** The Settings page name, in the current language. */
export const updatesTitle = () => s('title');

// ---------- the update itself ----------

export interface FoundUpdate {
  version: string;
  current: string;
  notes?: string;
  install(onProgress: (pct: number | null) => void): Promise<void>;
}

/** Asks the release feed for a newer version. Null when up to date (or on the web). */
export async function checkForUpdate(): Promise<FoundUpdate | null> {
  if (!isDesktop) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    current: update.currentVersion,
    notes: update.body?.trim() || undefined,
    async install(onProgress) {
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((e) => {
        if (e.event === 'Started') total = e.data.contentLength ?? 0;
        else if (e.event === 'Progress') {
          done += e.data.chunkLength;
          onProgress(total ? Math.min(100, Math.round((done / total) * 100)) : null);
        } else onProgress(100);
      });
      // On Windows the installer closes the app itself; elsewhere restart it.
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    },
  };
}

const AUTO_KEY = 'keizu:update-auto';
const SKIP_KEY = 'keizu:update-skip';

export function getAutoCheck(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== 'off';
  } catch {
    return true;
  }
}

function setAutoCheck(on: boolean) {
  try {
    localStorage.setItem(AUTO_KEY, on ? 'on' : 'off');
  } catch {
    /* lasts for this session only */
  }
}

// ---------- UI ----------

function InstallButton({ update }: { update: FoundUpdate }) {
  const [state, setState] = useState<{ pct: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (state) {
    const text = state.pct === 100 ? s('installing') : s('downloading', { pct: state.pct == null ? '' : `%${state.pct}` });
    return <span className="muted small" role="status">{text}</span>;
  }
  return (
    <>
      <button
        className="btn primary"
        onClick={() => {
          setError(null);
          setState({ pct: 0 });
          update.install((pct) => setState({ pct })).catch((e: unknown) => {
            setState(null);
            setError(s('failed', { msg: String((e as Error)?.message ?? e) }));
          });
        }}
      >
        <I.Import size={16} /> {s('install')}
      </button>
      {error && <span className="share-error" role="alert">{error}</span>}
    </>
  );
}

/**
 * Shown once per launch when a newer version is found at startup. "Later"
 * hides it until the next launch; it never installs without a click.
 */
export function UpdatePrompt() {
  useLang();
  const [update, setUpdate] = useState<FoundUpdate | null>(null);
  useEffect(() => {
    if (!isDesktop || !getAutoCheck()) return;
    // Give the app a moment to open before going to the network.
    const timer = setTimeout(() => {
      checkForUpdate()
        .then((u) => {
          if (u && sessionStorage.getItem(SKIP_KEY) !== u.version) setUpdate(u);
        })
        .catch(() => {}); // offline or no release yet: stay quiet
    }, 4000);
    return () => clearTimeout(timer);
  }, []);
  if (!update) return null;
  return (
    <div className="update-prompt" role="dialog" aria-label={s('available', { version: update.version })}>
      <strong>{s('available', { version: update.version })}</strong>
      <span className="muted small">{s('availableHint', { current: update.current })}</span>
      {update.notes && (
        <details className="small">
          <summary>{s('notes')}</summary>
          <p className="update-notes">{update.notes}</p>
        </details>
      )}
      <div className="row">
        <InstallButton update={update} />
        <button
          className="btn"
          onClick={() => {
            sessionStorage.setItem(SKIP_KEY, update.version);
            setUpdate(null);
          }}
        >
          {s('later')}
        </button>
      </div>
    </div>
  );
}

/** Settings → Updates. */
export function UpdateSettings() {
  useLang();
  const [current, setCurrent] = useState<string>('');
  const [auto, setAuto] = useState(getAutoCheck());
  const [status, setStatus] = useState<{ kind: 'idle' | 'checking' | 'none' | 'error'; msg?: string }>({ kind: 'idle' });
  const [update, setUpdate] = useState<FoundUpdate | null>(null);
  useEffect(() => {
    if (!isDesktop) return;
    import('@tauri-apps/api/app').then((a) => a.getVersion()).then(setCurrent, () => {});
  }, []);
  const runCheck = async () => {
    setStatus({ kind: 'checking' });
    setUpdate(null);
    try {
      const u = await checkForUpdate();
      setUpdate(u);
      setStatus({ kind: u ? 'idle' : 'none' });
    } catch (e) {
      setStatus({ kind: 'error', msg: String((e as Error)?.message ?? e) });
    }
  };
  return (
    <>
      <div>
        <h1>{s('title')}</h1>
        <p className="muted">{isDesktop ? s('intro') : s('webOnly')}</p>
      </div>
      {isDesktop && (
        <section className="set-card">
          <div className="set-row">
            <span>
              <strong>{s('current')}</strong>
              <span className="muted small">{current ? `Keizu ${current}` : '…'}</span>
            </span>
            <button className="btn" onClick={runCheck} disabled={status.kind === 'checking'}>
              {status.kind === 'checking' ? s('checking') : s('check')}
            </button>
          </div>
          {status.kind === 'none' && <p className="muted small" role="status"><I.Check size={14} /> {s('upToDate')}</p>}
          {status.kind === 'error' && <p className="share-error" role="alert">{s('failed', { msg: status.msg ?? '' })}</p>}
          {update && (
            <div className="update-found">
              <strong>{s('available', { version: update.version })}</strong>
              {update.notes && <p className="update-notes muted small">{update.notes}</p>}
              <div className="row">
                <InstallButton update={update} />
              </div>
            </div>
          )}
          <div className="set-sep" />
          <label className="set-row">
            <span>
              <strong>{s('auto')}</strong>
              <span className="muted small">{s('autoHint')}</span>
            </span>
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => {
                setAuto(e.target.checked);
                setAutoCheck(e.target.checked);
              }}
            />
          </label>
        </section>
      )}
    </>
  );
}
