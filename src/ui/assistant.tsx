// AI assistant: settings, the desktop bridge and the side panel. The desktop
// app runs an AI command-line tool that the user installed and signed in to
// with their own subscription (Claude Code → Claude Pro/Max, Gemini CLI →
// Google account). No API keys; Keizu never sees a password. The web app
// can't start programs on the computer, so there it only explains this.
// The prompt and reply format live in src/core/ai.ts.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  AiReplyError,
  applySuggestions,
  REPLY_SCHEMA,
  applyText,
  buildPrompt,
  countSuggestions,
  parseReply,
  suggestionKey,
  type AiAction,
  type AiAddition,
  type AiReply,
  type AiTopic,
  type ChatTurn,
} from '../core/ai';
import { today } from '../core/tasks';
import { findTopic, type MindMap } from '../core/model';
import { getLang, useLang } from '../i18n';
import * as I from './Icons';
import { isDesktop } from './platform';

// ---------- strings (kept here so the feature stays in one place) ----------

const STRINGS = {
  tr: {
    title: 'Yapay zekâ asistanı',
    intro: 'Keizu, bilgisayarına kurduğun ve kendi aboneliğinle giriş yaptığın yapay zekâ aracını kullanır. API anahtarı gerekmez, ek ücret çıkmaz; kullanım aboneliğinin kotasından düşer. Keizu şifreni hiç görmez.',
    webOnly: 'Asistan yalnızca masaüstü uygulamasında çalışır: web sayfası bilgisayarındaki programları başlatamaz.',
    enabled: 'Asistanı göster',
    enabledHint: 'Kapalıyken menülerde ve araç çubuğunda görünmez.',
    provider: 'Kullanılacak araç',
    lang: 'Yanıt dili',
    langAuto: 'Haritanın dili',
    langTr: 'Türkçe',
    langEn: 'İngilizce',
    timeout: 'Zaman aşımı',
    seconds: '{n} sn',
    claude: 'Claude',
    claudeSub: 'Claude Pro veya Max aboneliği (Claude Code ile)',
    gemini: 'Gemini',
    geminiSub: 'Google, Haziran 2026\'dan beri Gemini CLI\'ye kişisel Google hesabıyla girişi kapattı. Yalnızca ücretli API anahtarı ya da kurumsal lisansla çalışır.',
    checking: 'Denetleniyor…',
    ready: 'Hazır',
    needsLogin: 'Giriş gerekli',
    unknownLogin: 'Kurulu (girişi denemek için "Dene"ye bas)',
    missing: 'Kurulu değil',
    recheck: 'Tekrar denetle',
    login: 'Giriş yap',
    loginHint: 'Bir terminal penceresi açılır. Oradaki adımlarla aboneliğinle giriş yap, sonra pencereyi kapatıp "Tekrar denetle"ye bas.',
    test: 'Dene',
    testing: 'Deneniyor…',
    testOk: 'Çalışıyor: {ms} sn içinde yanıt geldi.',
    install: 'Kurmak için bir terminalde şunu çalıştır:',
    installNode: 'Node.js 20 veya üstü gerekir (nodejs.org).',
    copy: 'Kopyala',
    copied: 'Kopyalandı',
    advanced: 'Gelişmiş: aracın yolu',
    pathHint: 'Boş bırakırsan Keizu kendisi bulur.',
    privacy: 'Asistanı kullandığında bu haritanın metni (notlar ve görevler dahil) seçtiğin araca gönderilir. Başka haritalar gönderilmez.',
    // panel
    panelTitle: 'Asistan',
    pick: 'Önce haritada bir konu seç.',
    on: 'Odak: {name}',
    ideas: 'Fikir üret',
    expand: 'Dalı genişlet',
    summarize: 'Özetle',
    rewrite: 'Yeniden yaz',
    translateTr: 'Türkçeye çevir',
    translateEn: 'İngilizceye çevir',
    fromNote: 'Nottan dallar',
    nextSteps: 'Sıradaki adımlar',
    nextStepsHint: 'Tüm haritaya, görevlere ve tarihlere bakıp eksikleri ve sıradaki adımları önerir.',
    ask: 'Sor',
    askPlaceholder: 'Haritaya bir şey sor… (ör. "Sıradaki adım ne?")',
    you: 'Sen',
    newChat: 'Yeni sohbet',
    taskTag: 'görev',
    thinking: '{who} düşünüyor…',
    cancel: 'İptal',
    suggestions: '{n} öneri',
    ghostHint: 'Haritada soluk görünenler öneridir; "Ekle"ye basana kadar haritaya yazılmaz. İstemediklerinin işaretini kaldır.',
    toBranches: 'Dallara dönüştür',
    toBranchesHint: 'Bu yanıt haritaya bir şey eklemedi. Dal olarak önerilmesini istersen "Dallara dönüştür"e bas.',
    add: 'Ekle ({n})',
    discard: 'At',
    applyTopic: 'Konuya uygula',
    addNote: 'Nota ekle',
    retry: 'Yeniden dene',
    settingsHint: 'Ana sayfa → Ayarlar → Yapay zekâ asistanı',
    errNotInstalled: '{who} bu bilgisayarda bulunamadı. Kurulum ve giriş için: {where}.',
    errTimeout: 'Yanıt zamanında gelmedi. Yeniden dene ya da Ayarlar\'dan zaman aşımını uzat.',
    errUnreadable: 'Yanıt anlaşılamadı. Yeniden denemek çoğu zaman yeter.',
    errTool: '{who} hata verdi: {msg}',
    errLoginHint: 'Giriş yapılmamış olabilir: {where}.',
    added: '{n} konu eklendi',
    noNote: 'Bu konunun notu yok.',
  },
  en: {
    title: 'AI assistant',
    intro: 'Keizu uses an AI tool you installed on this computer and signed in to with your own subscription. No API key, no extra cost: usage comes out of your subscription. Keizu never sees your password.',
    webOnly: "The assistant only works in the desktop app: a web page can't start programs on your computer.",
    enabled: 'Show the assistant',
    enabledHint: "When off, it isn't in menus or the toolbar.",
    provider: 'Tool to use',
    lang: 'Answer language',
    langAuto: "The map's language",
    langTr: 'Turkish',
    langEn: 'English',
    timeout: 'Timeout',
    seconds: '{n} s',
    claude: 'Claude',
    claudeSub: 'Claude Pro or Max subscription (via Claude Code)',
    gemini: 'Gemini',
    geminiSub: 'Since June 2026 Google no longer lets personal Google accounts sign in to Gemini CLI. It only works with a paid API key or an enterprise licence.',
    checking: 'Checking…',
    ready: 'Ready',
    needsLogin: 'Sign-in needed',
    unknownLogin: 'Installed (press "Try" to check the sign-in)',
    missing: 'Not installed',
    recheck: 'Check again',
    login: 'Sign in',
    loginHint: 'A terminal window opens. Sign in there with your subscription, then close it and press "Check again".',
    test: 'Try',
    testing: 'Trying…',
    testOk: 'Working: answered in {ms} s.',
    install: 'To install, run this in a terminal:',
    installNode: 'Needs Node.js 20 or later (nodejs.org).',
    copy: 'Copy',
    copied: 'Copied',
    advanced: "Advanced: the tool's path",
    pathHint: 'Leave empty and Keizu finds it.',
    privacy: "When you use the assistant, this map's text (notes and tasks included) goes to the tool you chose. Other maps are not sent.",
    panelTitle: 'Assistant',
    pick: 'Select a topic on the map first.',
    on: 'Focus: {name}',
    ideas: 'Brainstorm',
    expand: 'Expand branch',
    summarize: 'Summarize',
    rewrite: 'Rewrite',
    translateTr: 'Translate to Turkish',
    translateEn: 'Translate to English',
    fromNote: 'Branches from note',
    nextSteps: 'Next steps',
    nextStepsHint: 'Looks at the whole map, its tasks and dates, and suggests what is missing and what to do next.',
    ask: 'Ask',
    askPlaceholder: 'Ask about this map… (e.g. "What\'s the next step?")',
    you: 'You',
    newChat: 'New chat',
    taskTag: 'task',
    thinking: '{who} is thinking…',
    cancel: 'Cancel',
    suggestions: '{n} suggestions',
    ghostHint: 'Faded topics on the map are suggestions; nothing is written to the map until you press "Add". Untick the ones you don\'t want.',
    toBranches: 'Turn into branches',
    toBranchesHint: 'This answer didn\'t add anything to the map. Press "Turn into branches" to get it as suggested branches.',
    add: 'Add ({n})',
    discard: 'Discard',
    applyTopic: 'Apply to topic',
    addNote: 'Add to note',
    retry: 'Try again',
    settingsHint: 'Home → Settings → AI assistant',
    errNotInstalled: "{who} wasn't found on this computer. To install and sign in: {where}.",
    errTimeout: 'No answer in time. Try again, or raise the timeout in Settings.',
    errUnreadable: "Couldn't read the answer. Trying again usually works.",
    errTool: '{who} reported an error: {msg}',
    errLoginHint: 'You may not be signed in: {where}.',
    added: '{n} topics added',
    noNote: 'This topic has no note.',
  },
} satisfies Record<'tr' | 'en', Record<string, string>>;

type Key = keyof (typeof STRINGS)['tr'];
const s = (key: Key, vars: Record<string, string | number> = {}) =>
  STRINGS[getLang()][key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

export const assistantTitle = () => s('title');

// ---------- preferences ----------

export type Provider = 'claude' | 'gemini';
export const PROVIDERS: Provider[] = ['claude', 'gemini'];

export interface AiPrefs {
  enabled: boolean;
  provider: Provider;
  lang: 'auto' | 'tr' | 'en';
  timeout: number;
  /** Tool paths set by hand (empty: found automatically). */
  paths: Partial<Record<Provider, string>>;
}

const PREFS_KEY = 'keizu:ai';
const DEFAULTS: AiPrefs = { enabled: true, provider: 'claude', lang: 'auto', timeout: 120, paths: {} };

function loadPrefs(): AiPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

let prefs = loadPrefs();
const listeners = new Set<() => void>();

export function setAiPrefs(patch: Partial<AiPrefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* lasts for this session only */
  }
  listeners.forEach((l) => l());
}

export const getAiPrefs = () => prefs;

export function useAiPrefs(): AiPrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => prefs,
  );
}

/** The assistant shows in menus: desktop app, switched on. */
export const useAiAvailable = () => useAiPrefs().enabled && isDesktop;

// ---------- desktop bridge ----------

export interface CliStatus {
  provider: Provider;
  path?: string | null;
  version?: string | null;
  signedIn?: boolean | null;
}

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

const cleanPaths = (p: AiPrefs['paths']) => Object.fromEntries(Object.entries(p).filter(([, v]) => v?.trim())) as Record<string, string>;

export const detectTools = () => invoke<CliStatus[]>('ai_detect', { paths: cleanPaths(prefs.paths) });
export const openLogin = (provider: Provider) => invoke<void>('ai_login', { provider, path: prefs.paths[provider] || null });

let jobCounter = 0;

/** Sends a prompt; `onJob` gets an id that `cancelJob` stops. */
export function runPrompt(provider: Provider, prompt: string, onJob?: (job: string) => void, schema?: string): Promise<string> {
  const job = `job-${Date.now()}-${++jobCounter}`;
  onJob?.(job);
  return invoke<string>('ai_run', { provider, prompt, job, path: prefs.paths[provider] || null, timeoutSecs: prefs.timeout, schema: schema ?? null });
}

export const cancelJob = (job: string) => invoke<void>('ai_cancel', { job }).catch(() => {});

const providerName = (p: Provider) => s(p);

/** A short, readable message for a failed run. */
function errorText(e: unknown, provider: Provider): string {
  const msg = String((e as Error)?.message ?? e).trim();
  const who = providerName(provider);
  const where = s('settingsHint');
  if (e instanceof AiReplyError) return s('errUnreadable');
  if (msg === 'not-installed') return s('errNotInstalled', { who, where });
  if (msg === 'timeout') return s('errTimeout');
  const login = /log ?in|sign ?in|auth|credential|oauth|unauthori[sz]ed|401/i.test(msg);
  return s('errTool', { who, msg: msg.slice(0, 400) }) + (login ? ` ${s('errLoginHint', { where })}` : '');
}

// ---------- the assistant's state in the editor ----------

export type AiState =
  | { status: 'idle' }
  | { status: 'running'; action: AiAction; topicId: string; provider: Provider; question?: string }
  | { status: 'done'; action: AiAction; topicId: string; reply: AiReply; skip: Set<string> }
  | { status: 'error'; action: AiAction; topicId: string; message: string; question?: string };

export interface Assistant {
  state: AiState;
  run(action: AiAction, topicId: string, question?: string): void;
  cancel(): void;
  discard(): void;
  toggle(key: string): void;
  /** Suggestions shown faded on the map, or null. */
  preview(map: MindMap): { map: MindMap; ids: Set<string> } | null;
  accept(): void;
  applyAnswer(): void;
  /** Questions and answers so far (kept while the map is open). */
  chat: ChatTurn[];
  clearChat(): void;
}

const CHAT_ACTIONS: AiAction[] = ['ask', 'nextSteps'];

/** What a reply adds to the conversation, as text. */
function replyText(reply: AiReply): string {
  const topics = reply.additions.flatMap((a) => a.topics.map((t) => `- ${t.text}`));
  return [reply.text ?? '', topics.join('\n')].filter(Boolean).join('\n');
}

/**
 * Runs actions and keeps the answer until it is added or discarded.
 * `getMap` is the map being edited (the view), `commit` saves a change.
 */
export function useAssistant(getMap: () => MindMap, commit: (next: MindMap, select?: string | null) => void, toast: (msg: string) => void): Assistant {
  const [state, setState] = useState<AiState>({ status: 'idle' });
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const job = useRef<string | null>(null);
  const runId = useRef(0);

  const run = useCallback((action: AiAction, topicId: string, question?: string) => {
    const provider = prefs.provider;
    const map = getMap();
    if (!findTopic(map, topicId)) return;
    if (job.current) void cancelJob(job.current);
    const id = ++runId.current;
    const { prompt, refs } = buildPrompt(map, topicId, action, { question, lang: prefs.lang, history: chatRef.current, today: today() });
    setState({ status: 'running', action, topicId, provider, question });
    runPrompt(provider, prompt, (j) => (job.current = j), REPLY_SCHEMA)
      .then((raw) => {
        if (id !== runId.current) return;
        const reply = parseReply(raw, refs, topicId, action);
        if (CHAT_ACTIONS.includes(action)) setChat((c) => [...c, { question: question ?? s(action), answer: replyText(reply) }]);
        setState({ status: 'done', action, topicId, reply, skip: new Set() });
      })
      .catch((e: unknown) => {
        if (id !== runId.current) return;
        if (String((e as Error)?.message ?? e) === 'cancelled') return setState({ status: 'idle' });
        setState({ status: 'error', action, topicId, message: errorText(e, provider), question });
      })
      .finally(() => {
        if (id === runId.current) job.current = null;
      });
  }, [getMap]);

  const cancel = useCallback(() => {
    runId.current++;
    if (job.current) void cancelJob(job.current);
    job.current = null;
    setState({ status: 'idle' });
  }, []);

  const discard = useCallback(() => setState({ status: 'idle' }), []);

  const toggle = useCallback((key: string) => {
    setState((st) => {
      if (st.status !== 'done') return st;
      const skip = new Set(st.skip);
      if (skip.has(key)) skip.delete(key);
      else skip.add(key);
      return { ...st, skip };
    });
  }, []);

  const preview = useCallback(
    (map: MindMap) => {
      if (state.status !== 'done' || !state.reply.additions.length) return null;
      const r = applySuggestions(map, state.reply.additions, state.skip);
      return r.allIds.length ? { map: r.map, ids: new Set(r.allIds) } : null;
    },
    [state],
  );

  const accept = useCallback(() => {
    if (state.status !== 'done') return;
    const r = applySuggestions(getMap(), state.reply.additions, state.skip);
    if (r.ids.length) {
      commit(r.map, r.ids[0]);
      toast(s('added', { n: r.allIds.length }));
    }
    setState({ status: 'idle' });
  }, [state, getMap, commit, toast]);

  const applyAnswer = useCallback(() => {
    if (state.status !== 'done' || !state.reply.text) return;
    const action = state.action === 'ask' ? 'summarize' : state.action;
    commit(applyText(getMap(), state.topicId, action, state.reply.text));
    if (!state.reply.additions.length) setState({ status: 'idle' });
  }, [state, getMap, commit]);

  // Leaving the map stops a running job.
  useEffect(() => () => void (job.current && cancelJob(job.current)), []);

  const clearChat = useCallback(() => setChat([]), []);

  return { state, run, cancel, discard, toggle, preview, accept, applyAnswer, chat, clearChat };
}

// ---------- side panel ----------

const PANEL_ACTIONS: AiAction[] = ['ideas', 'expand', 'summarize', 'rewrite', 'fromNote', 'translateTr', 'translateEn'];

export const actionLabel = (a: AiAction) => s(a);

function SuggestionTree({ topics }: { topics: AiTopic[] }) {
  if (!topics.length) return null;
  return (
    <ul className="ai-sub">
      {topics.map((t, i) => (
        <li key={i}>
          {t.text}
          <SuggestionTree topics={t.children} />
        </li>
      ))}
    </ul>
  );
}

function Suggestions({ additions, map, skip, onToggle }: { additions: AiAddition[]; map: MindMap; skip: Set<string>; onToggle(key: string): void }) {
  return (
    <div className="ai-list">
      {additions.map((a, ai) => (
        <div key={ai} className="ai-group">
          {additions.length > 1 && <span className="muted small">{findTopic(map, a.parentId)?.text.split('\n')[0]}</span>}
          {a.topics.map((tp, ti) => {
            const key = suggestionKey(ai, ti);
            return (
              <label key={key} className="ai-item">
                <input type="checkbox" checked={!skip.has(key)} onChange={() => onToggle(key)} />
                <span>
                  {tp.text}
                  {tp.task && <span className="ai-tag">{s('taskTag')}{tp.due ? ` · ${tp.due}` : ''}</span>}
                  <SuggestionTree topics={tp.children} />
                </span>
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}

interface PanelProps {
  map: MindMap;
  topicId: string | null;
  assistant: Assistant;
  onClose(): void;
}

export function AssistantPanel({ map, topicId, assistant, onClose }: PanelProps) {
  useLang();
  const p = useAiPrefs();
  const [question, setQuestion] = useState('');
  const { state } = assistant;
  const topic = topicId ? findTopic(map, topicId) : undefined;
  const busy = state.status === 'running';
  const runOn = (a: AiAction, q?: string) => topic && assistant.run(a, topic.id, q);
  const ask = () => {
    if (!question.trim() || busy) return;
    runOn('ask', question.trim());
    setQuestion('');
  };
  // The newest answer shows below with its buttons, not in the history too.
  const inChat = state.status === 'done' && (state.action === 'ask' || state.action === 'nextSteps');
  const shownChat = inChat ? assistant.chat.slice(0, -1) : assistant.chat;

  let body: JSX.Element | null = null;
  if (state.status === 'running') {
    body = (
      <div className="ai-status" role="status">
        <span className="ai-spinner" aria-hidden="true" />
        <span>{state.question ? <><strong>{s('you')}:</strong> {state.question}<br /></> : null}{s('thinking', { who: providerName(state.provider) })}</span>
        <button className="btn sm" onClick={assistant.cancel}>{s('cancel')}</button>
      </div>
    );
  } else if (state.status === 'error') {
    body = (
      <div className="ai-result">
        <p className="share-error" role="alert">{state.message}</p>
        <div className="row">
          <button className="btn sm" onClick={() => assistant.run(state.action, state.topicId, state.question)}>{s('retry')}</button>
          <button className="btn sm" onClick={assistant.discard}>{s('discard')}</button>
        </div>
      </div>
    );
  } else if (state.status === 'done') {
    const { reply } = state;
    const n = reply.additions.length ? countSuggestions(reply.additions) : 0;
    const kept = reply.additions.reduce((sum, a, ai) => sum + a.topics.filter((_, ti) => !state.skip.has(suggestionKey(ai, ti))).length, 0);
    const textToTopic = state.action === 'rewrite' || state.action === 'translateTr' || state.action === 'translateEn';
    body = (
      <div className="ai-result">
        {inChat && <p className="ai-q"><strong>{s('you')}:</strong> {assistant.chat[assistant.chat.length - 1]?.question}</p>}
        {reply.text && (
          <>
            <p className="ai-answer">{reply.text}</p>
            {inChat && !n && <p className="muted small">{s('toBranchesHint')}</p>}
            <div className="row">
              {inChat && !n && (
                <button className="btn sm primary" onClick={() => assistant.run('toBranches', state.topicId)}>{s('toBranches')}</button>
              )}
              <button className={`btn sm ${inChat && !n ? '' : 'primary'}`} onClick={assistant.applyAnswer}>{textToTopic ? s('applyTopic') : s('addNote')}</button>
              <button className="btn sm" onClick={() => void navigator.clipboard?.writeText(reply.text!)}>{s('copy')}</button>
              {!n && <button className="btn sm" onClick={assistant.discard}>{s('discard')}</button>}
            </div>
          </>
        )}
        {n > 0 && (
          <>
            <strong className="small">{s('suggestions', { n })}</strong>
            <p className="muted small">{s('ghostHint')}</p>
            <Suggestions additions={reply.additions} map={map} skip={state.skip} onToggle={assistant.toggle} />
            <div className="row">
              <button className="btn sm primary" disabled={!kept} onClick={assistant.accept}>{s('add', { n: kept })}</button>
              <button className="btn sm" onClick={assistant.discard}>{s('discard')}</button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <aside className="panel ai-panel" aria-label={s('panelTitle')}>
      <div className="sc-head">
        <strong><I.Sparkle size={16} /> {s('panelTitle')}</strong>
        <button className="ib" aria-label={s('cancel')} onClick={onClose}>×</button>
      </div>
      {!isDesktop ? (
        <p className="muted small">{s('webOnly')}</p>
      ) : (
        <>
          <div className="seg-tabs ai-provider" role="group" aria-label={s('provider')}>
            {PROVIDERS.map((pr) => (
              <button key={pr} className={p.provider === pr ? 'on' : ''} aria-pressed={p.provider === pr} disabled={busy} onClick={() => setAiPrefs({ provider: pr })}>
                {providerName(pr)}
              </button>
            ))}
          </div>
          {!topic ? (
            <p className="muted small">{s('pick')}</p>
          ) : (
            <>
              <p className="muted small ai-on">{s('on', { name: topic.text.split('\n')[0] || '…' })}</p>
              <button className="btn primary ai-next" disabled={busy} title={s('nextStepsHint')} onClick={() => runOn('nextSteps')}>
                <I.TaskIcon size={16} /> {s('nextSteps')}
              </button>
              <div className="ai-actions">
                {PANEL_ACTIONS.map((a) => (
                  <button
                    key={a}
                    className="btn sm"
                    disabled={busy || (a === 'fromNote' && !topic.note?.trim())}
                    title={a === 'fromNote' && !topic.note?.trim() ? s('noNote') : undefined}
                    onClick={() => runOn(a)}
                  >
                    {s(a)}
                  </button>
                ))}
              </div>
              {shownChat.length > 0 && (
                <div className="ai-chat">
                  {shownChat.map((c, i) => (
                    <div key={i} className="ai-turn">
                      <p className="ai-q"><strong>{s('you')}:</strong> {c.question}</p>
                      <p className="ai-answer">{c.answer}</p>
                    </div>
                  ))}
                </div>
              )}
              {body}
              <form className="ai-ask" onSubmit={(e) => (e.preventDefault(), ask())}>
                <textarea
                  className="fld"
                  rows={3}
                  value={question}
                  placeholder={s('askPlaceholder')}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      ask();
                    }
                  }}
                />
                <div className="row">
                  {assistant.chat.length > 0 && (
                    <button className="btn sm" type="button" disabled={busy} onClick={assistant.clearChat}>{s('newChat')}</button>
                  )}
                  <button className="btn sm primary" type="submit" disabled={busy || !question.trim()}>{s('ask')}</button>
                </div>
              </form>
            </>
          )}
          {!topic && body}
          <p className="muted small">{s('privacy')}</p>
        </>
      )}
    </aside>
  );
}

// ---------- Settings → AI assistant ----------

const INSTALL: Record<Provider, { cmd: () => string; node?: boolean }> = {
  claude: {
    cmd: () => (navigator.userAgent.includes('Windows') ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash'),
  },
  gemini: { cmd: () => 'npm install -g @google/gemini-cli', node: true },
};

function CopyLine({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="fld-row">
      <code className="ai-cmd">{text}</code>
      <button
        className="btn sm"
        onClick={() => {
          void navigator.clipboard?.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
      >
        {done ? s('copied') : s('copy')}
      </button>
    </div>
  );
}

function ProviderCard({ provider, status, chosen, onRecheck }: { provider: Provider; status?: CliStatus; chosen: boolean; onRecheck(): void }) {
  const p = useAiPrefs();
  const [test, setTest] = useState<{ kind: 'running' | 'ok' | 'error'; msg?: string } | null>(null);
  const [loginNote, setLoginNote] = useState(false);
  const installed = !!status?.path;
  const label = !status ? s('checking') : !installed ? s('missing') : status.signedIn === false ? s('needsLogin') : status.signedIn ? s('ready') : s('unknownLogin');
  const tone = !status ? '' : !installed ? 'bad' : status.signedIn === false ? 'warn' : status.signedIn ? 'ok' : '';
  const runTest = () => {
    setTest({ kind: 'running' });
    const started = Date.now();
    runPrompt(provider, 'Reply with exactly this JSON and nothing else: {"text":"ok"}')
      .then(() => setTest({ kind: 'ok', msg: s('testOk', { ms: Math.round((Date.now() - started) / 100) / 10 }) }))
      .catch((e: unknown) => setTest({ kind: 'error', msg: errorText(e, provider) }));
  };
  return (
    <section className={`set-card ai-card ${chosen ? 'on' : ''}`}>
      <label className="set-row">
        <span>
          <strong>{providerName(provider)}</strong>
          <span className="muted small">{s(provider === 'claude' ? 'claudeSub' : 'geminiSub')}</span>
        </span>
        <input type="radio" name="ai-provider" checked={chosen} onChange={() => setAiPrefs({ provider })} />
      </label>
      <div className="ai-state">
        <span className={`ai-dot ${tone}`} aria-hidden="true" />
        <span>{label}</span>
        {status?.version && <span className="muted small">{status.version}</span>}
      </div>
      {status && !installed && (
        <div className="fld-label">
          <span className="small">{s('install')}</span>
          <CopyLine text={INSTALL[provider].cmd()} />
          {INSTALL[provider].node && <span className="muted small">{s('installNode')}</span>}
        </div>
      )}
      {installed && (
        <div className="row">
          <button
            className="btn sm"
            onClick={() => {
              setLoginNote(true);
              openLogin(provider).catch((e: unknown) => setTest({ kind: 'error', msg: errorText(e, provider) }));
            }}
          >
            {s('login')}
          </button>
          <button className="btn sm" disabled={test?.kind === 'running'} onClick={runTest}>{test?.kind === 'running' ? s('testing') : s('test')}</button>
          <button className="btn sm" onClick={onRecheck}>{s('recheck')}</button>
        </div>
      )}
      {loginNote && <p className="muted small">{s('loginHint')}</p>}
      {test?.msg && <p className={test.kind === 'error' ? 'share-error' : 'muted small'} role="status">{test.msg}</p>}
      <details className="small">
        <summary>{s('advanced')}</summary>
        <label className="fld-label">
          <input
            className="fld"
            value={p.paths[provider] ?? ''}
            placeholder={status?.path ?? ''}
            onChange={(e) => setAiPrefs({ paths: { ...p.paths, [provider]: e.target.value } })}
          />
          <span className="muted small">{s('pathHint')}</span>
        </label>
      </details>
    </section>
  );
}

export function AssistantSettings() {
  useLang();
  const p = useAiPrefs();
  const [statuses, setStatuses] = useState<CliStatus[] | null>(null);
  const recheck = useCallback(() => {
    if (!isDesktop) return;
    setStatuses(null);
    detectTools().then(setStatuses, () => setStatuses([]));
  }, []);
  useEffect(recheck, [recheck]);
  return (
    <>
      <div>
        <h1>{s('title')}</h1>
        <p className="muted">{s('intro')}</p>
      </div>
      {!isDesktop ? (
        <section className="set-card">
          <p className="muted">{s('webOnly')}</p>
        </section>
      ) : (
        <>
          <section className="set-card">
            <label className="set-row">
              <span>
                <strong>{s('enabled')}</strong>
                <span className="muted small">{s('enabledHint')}</span>
              </span>
              <input type="checkbox" checked={p.enabled} onChange={(e) => setAiPrefs({ enabled: e.target.checked })} />
            </label>
            <label className="set-row">
              <span><strong>{s('lang')}</strong></span>
              <select className="fld" style={{ width: 200 }} value={p.lang} onChange={(e) => setAiPrefs({ lang: e.target.value as AiPrefs['lang'] })}>
                <option value="auto">{s('langAuto')}</option>
                <option value="tr">{s('langTr')}</option>
                <option value="en">{s('langEn')}</option>
              </select>
            </label>
            <label className="set-row">
              <span><strong>{s('timeout')}</strong></span>
              <select className="fld" style={{ width: 200 }} value={p.timeout} onChange={(e) => setAiPrefs({ timeout: Number(e.target.value) })}>
                {[60, 120, 240, 600].map((n) => (
                  <option key={n} value={n}>{s('seconds', { n })}</option>
                ))}
              </select>
            </label>
          </section>
          <strong>{s('provider')}</strong>
          {PROVIDERS.map((pr) => (
            <ProviderCard key={pr} provider={pr} chosen={p.provider === pr} status={statuses ? statuses.find((x) => x.provider === pr) ?? { provider: pr } : undefined} onRecheck={recheck} />
          ))}
          <p className="muted small">{s('privacy')}</p>
        </>
      )}
    </>
  );
}

