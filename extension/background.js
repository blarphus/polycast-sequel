// ---------------------------------------------------------------------------
// background.js — Service worker: auth token storage & API proxy
// ---------------------------------------------------------------------------

const DEFAULT_API_BASE = 'https://polycast-sequel.onrender.com';
const DEFAULT_DAILY_WORD_GOAL = 5;
const BONUS_XP_PER_WORD = 10;
const DAILY_GOAL_KEY = 'dailyWordGoal';
const DAILY_PROGRESS_KEY = 'dailyWordProgress';
const RECALL_CATALOG_KEY = 'wildRecallCatalog';
const RECALL_CHALLENGE_KEY = 'wildRecallChallenge';
const OFFLINE_MODE_KEY = 'offlineMode';
const OFFLINE_WORDS_KEY = 'offlineDictionaryWords';
const SELECTION_CONTEXT_MENU_ID = 'polycast-lookup-selection';
const SITE_HIGHLIGHT_OVERRIDES_KEY = 'siteHighlightOverrides';
const SITE_CONTENT_SCRIPTS_KEY = 'siteContentScriptIds';
const PAGE_CONTENT_TAB_PATTERNS = ['*://*.youtube.com/*', 'https://*.netflix.com/*'];
const PAGE_CUE_DATE_KEY = 'pageCueDate';
const DEFAULT_OFFLINE_USER = {
  id: 'offline-local-user',
  username: 'offline',
  display_name: 'Offline Mode',
  native_language: 'en',
  target_language: 'es',
  daily_new_limit: 20,
  account_type: 'student',
  cefr_level: null,
  offline: true,
};
const SESSION_SCOPED_STORAGE_KEYS = [
  'authToken', 'user', 'savedWords', RECALL_CATALOG_KEY,
  RECALL_CHALLENGE_KEY, 'progression', OFFLINE_MODE_KEY,
];

if (typeof importScripts === 'function') importScripts('generated/messageContract.js', 'background/messageRouter.js', 'background/activation.js');
const MESSAGE_CONTRACT = globalThis.PolycastExtensionMessageContract;
if (!MESSAGE_CONTRACT) throw new Error('Generated extension message contract is unavailable');
const validateRuntimeMessage = globalThis.PolycastExtensionMessageRouter.createMessageValidator(MESSAGE_CONTRACT);
globalThis.validateRuntimeMessage = validateRuntimeMessage;


let contextMenuInstallPromise = null;
let savedTokenIndex = new Map();
let savedTokenRevision = 0;
let sessionExpirationPromise = null;

function rebuildSavedTokenIndex(words) {
  const next = new Map();
  for (const word of words || []) {
    const tokens = [word.word, word.lemma, ...parseWordForms(word.forms)]
      .map((value) => String(value || '').trim().toLocaleLowerCase())
      .filter(Boolean);
    for (const token of tokens) {
      if (!next.has(token)) {
        next.set(token, { wordId: word.id || null, reviewed: !!word.last_reviewed_at });
      }
    }
  }
  savedTokenIndex = next;
  savedTokenRevision += 1;
}

function indexSavedWord(word) {
  const tokens = [word.word, word.lemma, ...parseWordForms(word.forms)]
    .map((value) => String(value || '').trim().toLocaleLowerCase())
    .filter(Boolean);
  for (const token of tokens) {
    savedTokenIndex.set(token, { wordId: word.id || null, reviewed: !!word.last_reviewed_at });
  }
  savedTokenRevision += 1;
}

async function ensureSavedTokenIndex() {
  if (savedTokenIndex.size) return;
  const stored = await chrome.storage.local.get([RECALL_CATALOG_KEY, OFFLINE_WORDS_KEY]);
  const catalog = stored[RECALL_CATALOG_KEY];
  if (Array.isArray(catalog) && catalog.length) {
    rebuildSavedTokenIndex(catalog);
    return;
  }
  if (Array.isArray(stored[OFFLINE_WORDS_KEY])) rebuildSavedTokenIndex(stored[OFFLINE_WORDS_KEY]);
}

function installContextMenus() {
  if (!chrome.contextMenus) return Promise.resolve();
  if (contextMenuInstallPromise) return contextMenuInstallPromise;

  contextMenuInstallPromise = new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      const removeError = chrome.runtime.lastError;
      if (removeError) {
        void broadcastFallbackNotice(
          'Context menu reset failed',
          'Polycast could not clear the previous selection menu and will retry at the next browser startup.',
          { code: 'context_menu_reset_failed', operation: 'install-context-menu', detail: removeError.message },
        );
      }

      chrome.contextMenus.create({
        id: SELECTION_CONTEXT_MENU_ID,
        title: 'Look up "%s" with Polycast',
        contexts: ['selection'],
      }, () => {
        const createError = chrome.runtime.lastError;
        if (createError) {
          void broadcastFallbackNotice(
            'Selection menu unavailable',
            'Polycast could not create the browser selection menu. Popup and in-page word lookup remain available.',
            { code: 'context_menu_create_failed', operation: 'install-context-menu', detail: createError.message },
          );
        }
        contextMenuInstallPromise = null;
        resolve();
      });
    });
  });

  return contextMenuInstallPromise;
}

chrome.runtime.onInstalled.addListener(installContextMenus);
chrome.runtime.onStartup.addListener(installContextMenus);

function makeFallbackDiagnostic({ code, title, message, source = 'extension.background', operation, pipeline, stage, language, selectedAction, detail, severity = 'warning', correlationId, occurredAt }) {
  return {
    code,
    severity,
    title,
    message,
    source,
    operation,
    pipeline: pipeline || operation,
    stage: stage || 'fallback',
    ...(language ? { language } : {}),
    ...(selectedAction ? { selectedAction } : {}),
    correlationId: correlationId || crypto.randomUUID(),
    occurredAt: occurredAt || new Date().toISOString(),
    ...(detail ? { detail } : {}),
  };
}

async function surfaceBackgroundDiagnostic(diagnostic) {
  await chrome.storage.local.set({ lastFallbackDiagnostic: diagnostic });
  if (chrome.action) {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#b45309' });
    await chrome.action.setTitle({ title: `${diagnostic.title}: ${diagnostic.message} · ${diagnostic.code} · ref ${diagnostic.correlationId}` });
  }
}

async function sendTabMessageSafe(tabId, payload, operation) {
  if (!Number.isInteger(tabId)) return undefined;
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (err) {
    const diagnostic = makeFallbackDiagnostic({
      code: 'extension_ui_delivery_failed',
      title: 'Extension notice delivery failed',
      message: 'The target tab could not receive an extension update.',
      operation,
      detail: `tabId=${tabId}; reason=${err?.message || 'unknown error'}`,
      severity: 'error',
    });
    console.info('[polycast:fallback-delivery-failed]', diagnostic);
    await surfaceBackgroundDiagnostic(diagnostic);
    return undefined;
  }
}

async function getPageContentTabs() {
  const stored = await chrome.storage.local.get(SITE_CONTENT_SCRIPTS_KEY);
  const optionalPatterns = Object.keys(stored[SITE_CONTENT_SCRIPTS_KEY] || {})
    .map((origin) => `${origin}/*`);
  return chrome.tabs.query({ url: [...PAGE_CONTENT_TAB_PATTERNS, ...optionalPatterns] });
}



const { activateOptionalSite, deactivateOptionalSite } = globalThis.PolycastActivationHandlers.create({
  makeFallbackDiagnostic,
  sendTabMessageSafe,
  surfaceBackgroundDiagnostic,
  SITE_HIGHLIGHT_OVERRIDES_KEY,
  SITE_CONTENT_SCRIPTS_KEY,
});
globalThis.activateOptionalSite = activateOptionalSite;
globalThis.deactivateOptionalSite = deactivateOptionalSite;

async function getApiBase() {
  const { apiBase } = await chrome.storage.local.get('apiBase');
  return apiBase || DEFAULT_API_BASE;
}

async function getAuthToken() {
  const { authToken } = await chrome.storage.local.get('authToken');
  return authToken;
}

function localDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function buildDailyGoalSnapshot(goal, added) {
  const overGoal = Math.max(0, added - goal);
  return {
    goal,
    added,
    remaining: Math.max(0, goal - added),
    complete: added >= goal,
    overGoal,
    bonusXp: 0,
  };
}

async function getDailyGoalSnapshot() {
  const stored = await chrome.storage.local.get([DAILY_GOAL_KEY, DAILY_PROGRESS_KEY]);
  const goal = Number(stored[DAILY_GOAL_KEY]) > 0 ? Math.round(Number(stored[DAILY_GOAL_KEY])) : DEFAULT_DAILY_WORD_GOAL;
  const progress = stored[DAILY_PROGRESS_KEY];
  const added = progress?.date === localDateKey() ? Math.max(0, Number(progress.count) || 0) : 0;
  return buildDailyGoalSnapshot(goal, added);
}

async function broadcastDailyGoalUpdated(snapshot, extra = {}) {
  const tabs = await getPageContentTabs();
  for (const tab of tabs) {
    await sendTabMessageSafe(tab.id, { type: 'DAILY_GOAL_UPDATED', snapshot, ...extra }, 'broadcast-daily-goal');
  }
}

async function seedDailyGoalProgress(count, serverGoal = null) {
  const normalized = Math.max(0, Math.round(Number(count) || 0));
  const next = { [DAILY_PROGRESS_KEY]: { date: localDateKey(), count: normalized } };
  if (serverGoal) next[DAILY_GOAL_KEY] = Math.max(1, Math.round(Number(serverGoal) || DEFAULT_DAILY_WORD_GOAL));
  await chrome.storage.local.set(next);
  const snapshot = await getDailyGoalSnapshot();
  await broadcastDailyGoalUpdated(snapshot);
  return snapshot;
}

async function syncDailyGoalFromServer() {
  const token = await getAuthToken();
  if (!token) {
    const words = await getOfflineWords();
    const now = new Date();
    return seedDailyGoalProgress(words.filter((word) => {
      const created = new Date(word.created_at || 0);
      return created.getFullYear() === now.getFullYear()
        && created.getMonth() === now.getMonth()
        && created.getDate() === now.getDate();
    }).length);
  }
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const progression = await apiFetch(`/api/progression?timeZone=${encodeURIComponent(zone)}`);
    await chrome.storage.local.set({ progression });
    return seedDailyGoalProgress(progression.dailyGoal?.added || 0, progression.dailyGoal?.goal);
  } catch (err) {
    if (isSessionExpiredError(err)) throw err;
    await broadcastFallbackNotice('Daily goal fallback', `Using cached goal progress because the account sync failed: ${err.message}`);
    return getDailyGoalSnapshot();
  }
}

async function recordDailyGoalWord() {
  const before = await getDailyGoalSnapshot();
  await chrome.storage.local.set({ [DAILY_PROGRESS_KEY]: { date: localDateKey(), count: before.added + 1 } });
  const after = await getDailyGoalSnapshot();
  const justCompleted = !before.complete && after.complete;
  // Offline saves cannot earn account XP. The visible offline diagnostic names
  // this fallback, and the optimistic UI must never imply that XP was synced.
  const bonusXpEarned = 0;
  await broadcastDailyGoalUpdated(after, { justAdded: true, justCompleted, bonusXpEarned });
  return { ...after, justAdded: true, justCompleted, bonusXpEarned };
}

function isSessionExpiredError(error) {
  return error?.code === 'extension_session_expired';
}

async function invalidateExpiredExtensionSession(path) {
  if (sessionExpirationPromise) return sessionExpirationPromise;
  sessionExpirationPromise = (async () => {
    await chrome.storage.local.remove(SESSION_SCOPED_STORAGE_KEYS);
    savedTokenIndex = new Map();
    savedTokenRevision += 1;
    await broadcastWordsUpdated([]);
    return broadcastFallbackNotice(
      'Extension session expired',
      'The saved Polycast session is no longer valid. The extension cleared account data and requires you to sign in again.',
      {
        code: 'extension_session_expired',
        operation: 'invalidate-session',
        severity: 'error',
        detail: `status=401; path=${path}`,
      },
    );
  })();
  return sessionExpirationPromise;
}

async function apiFetch(path, opts = {}) {
  const apiBase = await getApiBase();
  const token = await getAuthToken();

  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${apiBase}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && token) {
    const diagnostic = await invalidateExpiredExtensionSession(path);
    const error = new Error('Session expired — please log in again');
    error.code = diagnostic.code;
    error.diagnostic = diagnostic;
    throw error;
  }

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed (${res.status})`);
  }

  if (res.status === 204) return undefined;
  return res.json();
}

// Parse a saved word's inflected forms — JSON array (current) or comma-separated (legacy),
// mirroring the web app's useSavedWords helper.
function parseWordForms(rawForms) {
  if (!rawForms) return [];
  if (typeof rawForms === 'string' && rawForms.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(rawForms);
      if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === 'string');
    } catch (error) {
      void broadcastFallbackNotice(
        'Legacy word forms parser used',
        'A saved word had malformed structured forms, so the extension used its legacy comma-separated representation.',
        {
          code: 'legacy_word_forms_parser_used',
          operation: 'parse-word-forms',
          detail: error?.message || String(error),
        },
      );
    }
  }
  return String(rawForms).split(',').map((s) => s.trim()).filter(Boolean);
}

// Every lowercased token that should highlight for a set of saved words: the word itself, its
// lemma, and all inflected forms — so e.g. "encaja" highlights for the saved lemma "encajar".
function savedWordTokens(words) {
  const set = new Set();
  for (const w of words || []) {
    if (w.word) set.add(String(w.word).toLowerCase());
    if (w.lemma) set.add(String(w.lemma).toLowerCase());
    for (const form of parseWordForms(w.forms)) set.add(form.toLowerCase());
  }
  return [...set];
}

async function fetchSavedWords() {
  const words = await apiFetch('/api/dictionary/words');
  const wordList = savedWordTokens(words);
  const catalog = words.map((word) => ({
    id: word.id, word: word.word, lemma: word.lemma, forms: word.forms,
    translation: word.translation, target_language: word.target_language,
    last_reviewed_at: word.last_reviewed_at,
  }));
  await chrome.storage.local.set({ savedWords: wordList, [RECALL_CATALOG_KEY]: catalog });
  rebuildSavedTokenIndex(catalog);
  return wordList;
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `offline-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function basicDefinition(word, sentence) {
  const context = sentence && sentence.trim();
  return context ? `Saved offline from: ${context}` : `Saved offline: ${word}`;
}

async function getOfflineWords() {
  const { [OFFLINE_WORDS_KEY]: words } = await chrome.storage.local.get(OFFLINE_WORDS_KEY);
  return Array.isArray(words) ? words : [];
}

async function setOfflineWords(words) {
  const tokens = savedWordTokens(words);
  await chrome.storage.local.set({
    [OFFLINE_WORDS_KEY]: words,
    savedWords: tokens,
  });
  rebuildSavedTokenIndex(words);
  await broadcastWordsUpdated(tokens);
  await syncOfflineWordsToAppTabs(words);
}

function makeOfflineSavedWord({ word, sentence, user, definition, translation }) {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    word,
    translation: translation || '',
    definition: definition || basicDefinition(word, sentence),
    target_language: user.target_language || null,
    sentence_context: sentence || null,
    created_at: now,
    frequency: null,
    frequency_count: null,
    rank_version_id: null,
    lemma_frequency_rank: null,
    sense_rank: null,
    lemma_occurrences_per_billion: null,
    frequency_confidence: 'unavailable',
    frequency_sources: [],
    example_sentence: sentence || null,
    sentence_translation: null,
    part_of_speech: null,
    srs_interval: 0,
    due_at: null,
    last_reviewed_at: null,
    correct_count: 0,
    incorrect_count: 0,
    ease_factor: 2.5,
    learning_step: null,
    image_url: null,
    lemma: null,
    forms: null,
    prompt_stage: 0,
    priority: false,
    image_term: null,
    queue_position: null,
    introduced_date: null,
  };
}

function makeOfflineLookup(word, sentence) {
  return {
    word,
    target_word: word,
    valid: true,
    translation: '',
    definition: basicDefinition(word, sentence),
    gemini_definition: null,
    part_of_speech: null,
    sense_index: null,
    matched_gloss: null,
    lemma: null,
    is_native: false,
    definition_source: 'offline',
    example: sentence || null,
    example_translation: null,
    sentence_translation: null,
  };
}

async function saveOfflineWord(word, sentence) {
  const { user = DEFAULT_OFFLINE_USER } = await chrome.storage.local.get('user');
  const words = await getOfflineWords();
  const existing = words.find((entry) =>
    String(entry.word || '').toLowerCase() === word.toLowerCase() &&
    entry.target_language === (user.target_language || null));
  if (existing) return { ...existing, _created: false };

  const saved = makeOfflineSavedWord({ word, sentence, user });
  await setOfflineWords([saved, ...words]);
  return { ...saved, _created: true };
}

async function startOfflineMode(username) {
  const user = {
    ...DEFAULT_OFFLINE_USER,
    username: username || 'offline',
    display_name: username || 'Offline Mode',
  };
  await chrome.storage.local.set({ [OFFLINE_MODE_KEY]: true, user });
  await setOfflineWords(await getOfflineWords());
  return user;
}

async function syncOfflineWordsToAppTabs(words) {
  const tabs = await chrome.tabs.query({
    url: [
      'http://localhost:5173/*',
      'http://127.0.0.1:5173/*',
      'http://localhost:3000/*',
      'http://127.0.0.1:3000/*',
    ],
  });
  for (const tab of tabs) {
    await sendTabMessageSafe(tab.id, { type: 'SYNC_OFFLINE_DICTIONARY_TO_APP', words }, 'sync-offline-dictionary');
  }
}

async function broadcastWordsUpdated(savedWords) {
  const tabs = await getPageContentTabs();
  for (const tab of tabs) {
    await sendTabMessageSafe(tab.id, { type: 'WORDS_UPDATED', revision: savedTokenRevision }, 'broadcast-words-updated');
  }
}

async function broadcastFallbackNotice(title, message, options = {}) {
  const diagnostic = makeFallbackDiagnostic({
    code: options.code || 'extension_fallback_used',
    title,
    message,
    operation: options.operation || 'unknown',
    detail: options.detail,
    severity: options.severity || 'warning',
  });
  console.info('[polycast:fallback]', diagnostic);
  await surfaceBackgroundDiagnostic(diagnostic);
  const tabs = await getPageContentTabs();
  for (const tab of tabs) {
    await sendTabMessageSafe(tab.id, { type: 'POLYCAST_FALLBACK_NOTICE', diagnostic }, 'broadcast-fallback-notice');
  }
  return diagnostic;
}

async function broadcastWildRecallUpdated(challenge, progression = null, diagnostic = null) {
  const tabs = await getPageContentTabs();
  for (const tab of tabs) {
    await sendTabMessageSafe(tab.id, {
      type: 'WILD_RECALL_UPDATED', challenge, progression, diagnostic,
    }, 'broadcast-wild-recall');
  }
}

async function storeProgression(progression, { justAdded = false, awardedXp = 0 } = {}) {
  if (!progression) return null;
  await chrome.storage.local.set({ progression });
  const snapshot = await seedDailyGoalProgress(progression.dailyGoal?.added || 0, progression.dailyGoal?.goal);
  await broadcastDailyGoalUpdated(snapshot, {
    justAdded,
    justCompleted: !!(justAdded && snapshot.complete),
    bonusXpEarned: awardedXp,
  });
  const remaining = Number(progression.dailyGoal?.remaining) || 0;
  await chrome.action.setBadgeBackgroundColor({ color: progression.dailyGoal?.complete ? '#15803d' : '#5752df' });
  await chrome.action.setBadgeText({ text: progression.dailyGoal?.complete ? '✓' : String(Math.min(99, remaining)) });
  return snapshot;
}

async function broadcastTargetLanguageUpdated(targetLanguage) {
  const tabs = await getPageContentTabs();
  for (const tab of tabs) {
    await sendTabMessageSafe(tab.id, { type: 'TARGET_LANGUAGE_UPDATED', targetLanguage }, 'broadcast-target-language');
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  let validated;
  try {
    validated = validateRuntimeMessage(msg, sender);
  } catch (error) {
    const diagnostic = makeFallbackDiagnostic({
      code: 'extension_message_rejected',
      severity: 'error',
      title: 'Extension message rejected',
      message: 'Polycast rejected an invalid or unauthorized extension message before it reached application logic.',
      operation: 'validate-runtime-message',
      detail: error?.message || String(error),
    });
    console.info('[polycast:fallback]', diagnostic);
    sendResponse({ error: diagnostic.message, diagnostic, fallback_notices: [diagnostic] });
    return false;
  }
  handleMessage(validated, sender).then(async (result) => {
    if (result?.diagnostic) {
      console.info('[polycast:fallback]', result.diagnostic);
      await surfaceBackgroundDiagnostic(result.diagnostic);
    }
    sendResponse(result && typeof result === 'object'
      ? { ...result, correlationId: validated.correlationId, occurredAt: validated.occurredAt }
      : result);
  }).catch((err) => {
    const diagnostic = err?.diagnostic || makeFallbackDiagnostic({
      code: 'extension_message_handler_failed',
      severity: 'error',
      title: 'Extension request failed',
      message: `The ${validated.type} extension request could not be completed.`,
      operation: validated.type.toLocaleLowerCase().replaceAll('_', '-'),
      detail: err?.message || String(err),
      correlationId: validated.correlationId,
      occurredAt: validated.occurredAt,
    });
    console.info('[polycast:fallback]', diagnostic);
    sendResponse({ error: err?.message || diagnostic.message, diagnostic, fallback_notices: [diagnostic], correlationId: validated.correlationId, occurredAt: validated.occurredAt });
  });
  return true; // keep channel open for async response
});

async function handleMessage(msg, sender = {}) {
  switch (msg.type) {
    case 'LOGIN': {
      const apiBase = await getApiBase();
      let res;
      try {
        res = await fetch(`${apiBase}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: msg.username, password: msg.password }),
        });
      } catch (error) {
        const diagnostic = await broadcastFallbackNotice(
          'Offline sign-in fallback used',
          'The Polycast server could not be reached, so the extension entered local offline mode. Account XP and synchronization are unavailable.',
          {
            code: 'extension_offline_login_used',
            operation: 'login',
            detail: error?.message || String(error),
          },
        );
        const user = await startOfflineMode(msg.username);
        return { success: true, user, offline: true, fallback_notices: [diagnostic] };
      }

      if (!res.ok) {
        const text = await res.text();
        let payload = {};
        try {
          payload = JSON.parse(text);
        } catch (error) {
          console.info('[polycast:diagnostic]', makeFallbackDiagnostic({
            code: 'login_error_payload_fallback',
            title: 'Login error details unavailable',
            message: 'The server returned a non-JSON login error, so the HTTP status will be shown.',
            operation: 'parse-login-error',
            detail: `status=${res.status}; responseLength=${text.length}; reason=${error?.message || String(error)}`,
          }));
        }
        throw new Error(payload.error || `Login failed (${res.status})`);
      }

      const data = await res.json();
      const { token, id, username, display_name, native_language, target_language, daily_word_goal, total_xp } = data;

      await chrome.storage.local.set({
        authToken: token,
        user: { id, username, display_name, native_language, target_language, daily_word_goal, total_xp },
      });
      await chrome.storage.local.remove(OFFLINE_MODE_KEY);
      sessionExpirationPromise = null;

      const savedWords = await fetchSavedWords();
      await broadcastWordsUpdated(savedWords);

      return { success: true, user: { id, username, display_name, native_language, target_language, daily_word_goal, total_xp } };
    }

    case 'LOGOUT': {
      await chrome.storage.local.remove(SESSION_SCOPED_STORAGE_KEYS);
      sessionExpirationPromise = null;
      await broadcastWordsUpdated([]);
      savedTokenIndex = new Map();
      savedTokenRevision += 1;
      return { success: true };
    }

    case 'GET_STATUS': {
      const token = await getAuthToken();
      if (!token) {
        const { user = DEFAULT_OFFLINE_USER, [OFFLINE_MODE_KEY]: offlineMode } =
          await chrome.storage.local.get(['user', OFFLINE_MODE_KEY]);
        if (!offlineMode) {
          return { loggedIn: false };
        }
        const words = await getOfflineWords();
        await chrome.storage.local.set({ user, savedWords: savedWordTokens(words) });
        const diagnostic = makeFallbackDiagnostic({
          code: 'extension_offline_status_used',
          title: 'Offline account status used',
          message: 'The extension is using local status. Account XP and cross-device synchronization are unavailable.',
          operation: 'get-status',
        });
        return { loggedIn: true, user, savedWordCount: words.length, dailyGoal: await syncDailyGoalFromServer(), offline: true, diagnostic };
      }

      try {
        const user = await apiFetch('/api/me');
        await chrome.storage.local.set({ user });
        const { [RECALL_CATALOG_KEY]: catalog = [] } = await chrome.storage.local.get(RECALL_CATALOG_KEY);
        const dailyGoal = await syncDailyGoalFromServer();
        const { progression = null } = await chrome.storage.local.get('progression');
        return { loggedIn: true, user, savedWordCount: catalog.length, dailyGoal, progression };
      } catch (err) {
        if (isSessionExpiredError(err)) {
          return { loggedIn: false, error: err.message, diagnostic: err.diagnostic, fallback_notices: [err.diagnostic] };
        }
        const { user = DEFAULT_OFFLINE_USER } = await chrome.storage.local.get('user');
        const words = await getOfflineWords();
        const diagnostic = await broadcastFallbackNotice(
          'Cached extension status used',
          'The live account status could not be loaded, so the extension is showing cached local status.',
          {
            code: 'extension_cached_status_used',
            operation: 'get-status',
            detail: err?.message || String(err),
          },
        );
        return { loggedIn: true, user: { ...user, offline: true }, savedWordCount: words.length, dailyGoal: await getDailyGoalSnapshot(), offline: true, diagnostic };
      }
    }

    case 'LOOKUP_WORD': {
      const { user = DEFAULT_OFFLINE_USER, [OFFLINE_MODE_KEY]: offlineMode } =
        await chrome.storage.local.get(['user', OFFLINE_MODE_KEY]);
      const token = await getAuthToken();
      if (!token) {
        if (offlineMode) return makeOfflineLookup(msg.word, msg.sentence);
        throw new Error('Sign in to Polycast to use AI lookup');
      }

      const nativeLang = user.native_language || 'en';
      const targetLang = user.target_language;

      const params = new URLSearchParams({
        word: msg.word,
        sentence: msg.sentence,
        nativeLang,
      });
      if (targetLang) params.set('targetLang', targetLang);

      // A logged-in lookup must reflect the server's answer. If the request fails (e.g. a
      // server cold-start timeout or transient error), surface that error so the popup shows
      // it and the user can retry — never fabricate a "Saved offline from …" definition. The
      // genuinely-offline case is handled by the no-token branch above.
      return await apiFetch(`/api/dictionary/lookup?${params}`);
    }

    case 'EXPLAIN_WORD': {
      const { user = DEFAULT_OFFLINE_USER } = await chrome.storage.local.get(['user']);
      const token = await getAuthToken();
      if (!token) throw new Error('Sign in to Polycast to use AI explanations');

      const nativeLang = user.native_language || 'en';
      const targetLang = user.target_language;

      const params = new URLSearchParams({
        word: msg.word,
        sentence: msg.sentence,
        nativeLang,
      });
      if (targetLang) params.set('targetLang', targetLang);
      // Wider rolling caption window (recent ~50 words) for better context.
      if (msg.context && msg.context.trim() && msg.context.trim() !== msg.sentence) {
        params.set('context', msg.context.trim());
      }

      return await apiFetch(`/api/dictionary/explain?${params}`);
    }

    case 'SAVE_WORD': {
      const { user = DEFAULT_OFFLINE_USER, [OFFLINE_MODE_KEY]: offlineMode } =
        await chrome.storage.local.get(['user', OFFLINE_MODE_KEY]);
      const token = await getAuthToken();
      if (!token) {
        if (!offlineMode) throw new Error('Sign in to Polycast to save words');
        const saved = await saveOfflineWord(msg.word, msg.sentence);
        const dailyGoal = saved._created ? await recordDailyGoalWord() : await getDailyGoalSnapshot();
        return { success: true, saved, dailyGoal, offline: true };
      }

      try {
        // Enrich first
        const enriched = await apiFetch('/api/dictionary/enrich', {
          method: 'POST',
          body: {
            word: msg.lemma || msg.targetWord || msg.word,
            sentence: msg.sentence,
            nativeLang: user.native_language || 'en',
            targetLang: user.target_language || undefined,
            senseIndex: msg.senseIndex ?? undefined,
            definition: msg.definition || undefined,
            part_of_speech: msg.part_of_speech || undefined,
            definition_source: msg.definition_source || undefined,
            matched_gloss: msg.matched_gloss || undefined,
          },
        });

        // Save to dictionary
        const saved = await apiFetch('/api/dictionary/words', {
          method: 'POST',
          body: {
            word: enriched.word,
            translation: enriched.translation,
            definition: enriched.definition,
            target_language: user.target_language || null,
            sentence_context: msg.sentence,
            frequency: enriched.frequency,
            frequency_count: enriched.frequency_count,
            example_sentence: enriched.example_sentence,
            sentence_translation: enriched.sentence_translation,
            part_of_speech: enriched.part_of_speech,
            image_url: enriched.image_url || null,
            lemma: enriched.lemma || null,
            forms: enriched.forms || null,
            // The literal tapped form must always be a stored form, even when the
            // inflection table omitted it — the server merges it into `forms`.
            surface_form: msg.word,
            image_term: enriched.image_term,
            shared_entry_id: enriched.shared_entry_id || null,
            rank_version_id: enriched.rank_version_id || null,
            lemma_frequency_rank: enriched.lemma_frequency_rank ?? null,
            sense_rank: enriched.sense_rank ?? null,
            lemma_occurrences_per_billion: enriched.lemma_occurrences_per_billion ?? null,
            frequency_confidence: enriched.frequency_confidence || null,
            frequency_sources: enriched.frequency_sources || [],
          },
        });

        // Update local saved words list — include the lemma, every inflected form, and the
        // exact tapped form so all conjugations highlight immediately, not just the surface word.
        const { savedWords: current } = await chrome.storage.local.get('savedWords');
        const updated = [...new Set([...(current || []), ...savedWordTokens([enriched]), String(msg.word).toLowerCase()])];
        await chrome.storage.local.set({ savedWords: updated });
        indexSavedWord({ ...enriched, id: saved.id });
        await broadcastWordsUpdated(updated);

        const dailyGoal = saved._created
          ? await storeProgression(saved.progression, { justAdded: true, awardedXp: saved.awardedXp || 0 })
          : await getDailyGoalSnapshot();
        return {
          success: true, saved, dailyGoal, awardedXp: saved.awardedXp || 0,
          progression: saved.progression || null,
          fallback_notices: [...(enriched.fallback_notices || []), ...(saved.fallback_notices || [])],
        };
      } catch (err) {
        if (isSessionExpiredError(err)) throw err;
        const diagnostic = await broadcastFallbackNotice(
          'Offline dictionary save fallback used',
          'The server save failed, so the word was stored locally without a catalog rank. This remains visible until synchronization succeeds.',
          {
            code: 'extension_offline_dictionary_save_used',
            operation: 'save-word',
            detail: `language=${user.target_language || 'unknown'}; word=${msg.word}; reason=${err?.message || String(err)}`,
          },
        );
        const saved = await saveOfflineWord(msg.word, msg.sentence);
        const dailyGoal = saved._created ? await recordDailyGoalWord() : await getDailyGoalSnapshot();
        return { success: true, saved, dailyGoal, offline: true, warning: err.message, diagnostic, fallback_notices: [diagnostic] };
      }
    }

    case 'GET_DAILY_GOAL': {
      return { snapshot: await syncDailyGoalFromServer() };
    }

    case 'SET_DAILY_GOAL': {
      const goal = Math.min(50, Math.max(1, Math.round(Number(msg.goal) || DEFAULT_DAILY_WORD_GOAL)));
      const { user = DEFAULT_OFFLINE_USER, [OFFLINE_MODE_KEY]: offlineMode } =
        await chrome.storage.local.get(['user', OFFLINE_MODE_KEY]);
      const token = await getAuthToken();
      if (!token || offlineMode) {
        await chrome.storage.local.set({ [DAILY_GOAL_KEY]: goal });
        const snapshot = await getDailyGoalSnapshot();
        await broadcastDailyGoalUpdated(snapshot);
        const diagnostic = makeFallbackDiagnostic({
          code: 'offline_daily_goal_used',
          title: 'Local daily goal used',
          message: 'The daily goal was saved locally because account XP cannot synchronize in offline mode.',
          operation: 'set-daily-goal',
        });
        return { snapshot, offline: true, diagnostic };
      }
      const updatedUser = await apiFetch('/api/me/settings', {
        method: 'PATCH',
        body: { native_language: user.native_language || null, target_language: user.target_language || null, daily_word_goal: goal },
      });
      await chrome.storage.local.set({ user: updatedUser, [DAILY_GOAL_KEY]: goal });
      const progression = await apiFetch(`/api/progression?timeZone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`);
      const snapshot = await storeProgression(progression);
      return { snapshot, progression };
    }

    // Self-heal highlighting: a tapped inflection of an already-saved word is
    // persisted onto that word so it (and this exact form) highlight everywhere.
    case 'ADD_WORD_FORM': {
      const form = String(msg.form || '').trim().toLowerCase();
      if (!form) return { success: false };

      const { savedWords: current } = await chrome.storage.local.get('savedWords');
      const updated = [...new Set([...(current || []), form])];
      await chrome.storage.local.set({ savedWords: updated });
      savedTokenIndex.set(form, { wordId: msg.savedWordId || null, reviewed: false });
      savedTokenRevision += 1;
      await broadcastWordsUpdated(updated);

      // Persist server-side when signed in and the word is a real (non-offline) save.
      const token = await getAuthToken();
      if (token && msg.savedWordId && !String(msg.savedWordId).startsWith('offline-')) {
        try {
          await apiFetch(`/api/dictionary/words/${msg.savedWordId}/forms`, {
            method: 'POST',
            body: { form },
          });
        } catch (err) {
          if (isSessionExpiredError(err)) throw err;
          // Local highlight already applied; persistence will retry next tap.
          return { success: true, persisted: false, warning: err.message };
        }
      }
      return { success: true, persisted: true };
    }

    case 'REMOVE_WORD': {
      const token = await getAuthToken();
      const savedWordId = msg.savedWordId ? String(msg.savedWordId) : '';

      if (token && savedWordId && !savedWordId.startsWith('offline-')) {
        await apiFetch(`/api/dictionary/words/${savedWordId}`, { method: 'DELETE' });
        const savedWords = await fetchSavedWords();
        await broadcastWordsUpdated(savedWords);
        return { success: true };
      }

      const lower = String(msg.word || '').trim().toLowerCase();
      if (!lower && !savedWordId) throw new Error('No saved dictionary entry to remove');
      const words = await getOfflineWords();
      const next = words.filter((entry) => {
        if (savedWordId && entry.id === savedWordId) return false;
        return String(entry.word || '').toLowerCase() !== lower;
      });
      if (next.length === words.length) throw new Error('No saved dictionary entry to remove');
      await setOfflineWords(next);
      return { success: true, offline: true };
    }

    case 'MATCH_PAGE_TOKENS': {
      await ensureSavedTokenIndex();
      const input = Array.isArray(msg.tokens) ? msg.tokens.slice(0, 1500) : [];
      const matches = [];
      for (const raw of input) {
        const token = String(raw || '').toLocaleLowerCase();
        const entry = savedTokenIndex.get(token);
        if (entry) matches.push({ token, wordId: entry.wordId, reviewed: entry.reviewed });
      }
      return { matches, revision: savedTokenRevision };
    }

    case 'GET_PAGE_HIGHLIGHT_CONFIG': {
      const hostname = String(msg.hostname || '').toLocaleLowerCase();
      const stored = await chrome.storage.local.get(['user', SITE_HIGHLIGHT_OVERRIDES_KEY]);
      return {
        targetLanguage: stored.user?.target_language || null,
        override: stored[SITE_HIGHLIGHT_OVERRIDES_KEY]?.[hostname] || 'auto',
      };
    }

    case 'SET_SITE_HIGHLIGHT_OVERRIDE': {
      const hostname = String(msg.hostname || '').toLocaleLowerCase();
      if (!['auto', 'on', 'off'].includes(msg.override)) throw new Error('Page highlight mode must be auto, on, or off');
      const override = msg.override;
      if (!hostname) throw new Error('No active site');
      const optionalSite = msg.pageUrl && !/(^|\.)youtube\.com$|(^|\.)netflix\.com$/.test(hostname);
      if (optionalSite && override !== 'off') await activateOptionalSite({ pageUrl: msg.pageUrl, hostname, tabId: Number(msg.tabId) });
      if (optionalSite && override === 'off') await deactivateOptionalSite(msg.pageUrl, hostname);
      const stored = await chrome.storage.local.get(SITE_HIGHLIGHT_OVERRIDES_KEY);
      const overrides = { ...(stored[SITE_HIGHLIGHT_OVERRIDES_KEY] || {}), [hostname]: override };
      if (override === 'auto') delete overrides[hostname];
      await chrome.storage.local.set({ [SITE_HIGHLIGHT_OVERRIDES_KEY]: overrides });
      const tabId = Number(msg.tabId) || sender.tab?.id;
      if (tabId) await sendTabMessageSafe(tabId, { type: 'SITE_HIGHLIGHT_OVERRIDE_UPDATED', override }, 'update-site-highlight-override');
      return { hostname, override };
    }

    case 'CLAIM_PAGE_CUE': {
      const stored = await chrome.storage.local.get([PAGE_CUE_DATE_KEY, 'progression']);
      const today = localDateKey();
      if (stored[PAGE_CUE_DATE_KEY] === today) return { show: false };
      await chrome.storage.local.set({ [PAGE_CUE_DATE_KEY]: today });
      return { show: true, remaining: Number(stored.progression?.dailyGoal?.remaining) || 0 };
    }

    case 'GET_SAVED_WORDS': {
      const { savedWords } = await chrome.storage.local.get('savedWords');
      return { savedWords: savedWords || [] };
    }

    case 'GET_WILD_RECALL_STATE': {
      const token = await getAuthToken();
      const { [OFFLINE_MODE_KEY]: offlineMode, [RECALL_CHALLENGE_KEY]: cachedChallenge, progression } =
        await chrome.storage.local.get([OFFLINE_MODE_KEY, RECALL_CHALLENGE_KEY, 'progression']);
      if (!token || offlineMode) {
        const diagnostic = makeFallbackDiagnostic({
          code: 'wild_recall_offline_unavailable',
          title: 'Wild Recall unavailable offline',
          message: 'Wild Recall requires the account-backed XP service, so no challenge is available in offline mode.',
          operation: 'get-wild-recall-state',
        });
        return {
          challenge: null,
          progression: progression || null,
          diagnostic,
        };
      }
      try {
        await fetchSavedWords();
        const remote = await apiFetch(`/api/progression?timeZone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`);
        const challenge = remote.activeChallenge || null;
        await chrome.storage.local.set({ [RECALL_CHALLENGE_KEY]: challenge, progression: remote });
        const { [RECALL_CATALOG_KEY]: catalog = [] } = await chrome.storage.local.get(RECALL_CATALOG_KEY);
        return { challenge, progression: remote, catalog };
      } catch (err) {
        if (isSessionExpiredError(err)) throw err;
        const diagnostic = await broadcastFallbackNotice(
          'Wild Recall catalog fallback used',
          'The live recall catalog could not be loaded, so the extension kept the last cached challenge and progression.',
          {
            code: 'wild_recall_catalog_fallback',
            operation: 'get-wild-recall-state',
            detail: err?.message || String(err),
          },
        );
        return {
          challenge: cachedChallenge || null,
          progression: progression || null,
          diagnostic,
        };
      }
    }

    case 'MAYBE_ARM_WILD_RECALL': {
      const token = await getAuthToken();
      if (!token) return {
        challenge: null,
        diagnostic: makeFallbackDiagnostic({
          code: 'wild_recall_signin_required',
          title: 'Wild Recall unavailable',
          message: 'Wild Recall is unavailable until you sign in.',
          operation: 'arm-wild-recall',
        }),
      };
      const { [RECALL_CHALLENGE_KEY]: existing } = await chrome.storage.local.get(RECALL_CHALLENGE_KEY);
      if (existing) return { challenge: existing };
      const { [RECALL_CATALOG_KEY]: catalog = [] } = await chrome.storage.local.get(RECALL_CATALOG_KEY);
      const candidateIds = new Set(Array.isArray(msg.wordIds) ? msg.wordIds : []);
      const choices = catalog.filter((word) => word.last_reviewed_at && candidateIds.has(word.id));
      if (!choices.length) return { challenge: null };
      const choice = choices[Math.floor(Math.random() * choices.length)];
      try {
        const result = await apiFetch('/api/progression/wild-recall/arm', {
          method: 'POST',
          body: { wordId: choice.id, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        });
        await chrome.storage.local.set({ [RECALL_CHALLENGE_KEY]: result.challenge || null, progression: result.progression || null });
        await broadcastWildRecallUpdated(result.challenge || null, result.progression || null, result.unavailable || null);
        return result;
      } catch (err) {
        if (isSessionExpiredError(err)) throw err;
        const diagnostic = makeFallbackDiagnostic({
          code: 'wild_recall_preparation_fallback',
          title: 'Wild Recall preparation fallback used',
          message: 'The recall challenge could not be prepared, so this page will continue without one.',
          operation: 'arm-wild-recall',
          detail: err?.message || String(err),
        });
        await broadcastWildRecallUpdated(null, null, diagnostic);
        return { challenge: null, diagnostic };
      }
    }

    case 'ANSWER_WILD_RECALL': {
      const result = await apiFetch('/api/progression/wild-recall/answer', {
        method: 'POST',
        body: {
          challengeId: msg.challengeId,
          optionId: msg.optionId,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
      await chrome.storage.local.set({ [RECALL_CHALLENGE_KEY]: null, progression: result.progression || null });
      await storeProgression(result.progression, { awardedXp: result.awardedXp || 0 });
      await broadcastWildRecallUpdated(null, result.progression || null);
      return result;
    }

    case 'CLICK_WILD_RECALL': {
      const result = await apiFetch('/api/progression/wild-recall/click', {
        method: 'POST',
        body: {
          challengeId: msg.challengeId,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
      if (result.progression) await chrome.storage.local.set({ progression: result.progression });
      return result;
    }

    case 'GET_OFFLINE_DICTIONARY_FULL': {
      return { words: await getOfflineWords() };
    }

    case 'UPDATE_OFFLINE_DICTIONARY': {
      const words = Array.isArray(msg.words) ? msg.words : [];
      await setOfflineWords(words);
      return { success: true };
    }

    case 'GET_TARGET_LANGUAGE': {
      const { user = DEFAULT_OFFLINE_USER } = await chrome.storage.local.get('user');
      return { targetLanguage: user?.target_language || null };
    }

    case 'SET_TARGET_LANGUAGE': {
      const targetLanguage = String(msg.targetLanguage || '').trim();
      if (!targetLanguage) throw new Error('Choose a language');

      const { user = DEFAULT_OFFLINE_USER, [OFFLINE_MODE_KEY]: offlineMode } =
        await chrome.storage.local.get(['user', OFFLINE_MODE_KEY]);
      const token = await getAuthToken();
      const storeLocally = offlineMode || !token;
      let updatedUser;

      if (storeLocally) {
        updatedUser = { ...user, target_language: targetLanguage };
        await chrome.storage.local.set({ user: updatedUser });
      } else {
        updatedUser = await apiFetch('/api/me/settings', {
          method: 'PATCH',
          body: {
            native_language: user.native_language || null,
            target_language: targetLanguage,
          },
        });
        await chrome.storage.local.set({ user: updatedUser });
      }

      const savedWords = storeLocally
        ? (await getOfflineWords()).map((word) => String(word.word || '').toLowerCase()).filter(Boolean)
        : await fetchSavedWords().catch(async () => {
          const { savedWords: current = [] } = await chrome.storage.local.get('savedWords');
          return current;
        });
      await broadcastWordsUpdated(savedWords);
      await broadcastTargetLanguageUpdated(targetLanguage);
      const storedCatalog = await chrome.storage.local.get(RECALL_CATALOG_KEY);
      const savedWordCount = storeLocally
        ? (await getOfflineWords()).length
        : (storedCatalog[RECALL_CATALOG_KEY] || []).length;
      return { success: true, user: updatedUser, savedWordCount };
    }

    case 'CAPTION_LANGUAGE_DETECTED': {
      // Subtitles are playing in a language other than the current target —
      // switch the learning language to match. Never switch to the user's
      // native language (e.g. watching an English video shouldn't make
      // English the learning language).
      const lang = String(msg.languageCode || '').trim().toLowerCase();
      if (!lang) return { success: true, switched: false };

      const { user = DEFAULT_OFFLINE_USER } = await chrome.storage.local.get('user');
      const native = (user?.native_language || '').toLowerCase();
      const target = (user?.target_language || '').toLowerCase();
      if (lang === native || lang === target) return { success: true, switched: false };

      const result = await handleMessage({ type: 'SET_TARGET_LANGUAGE', targetLanguage: lang });
      return { ...result, switched: true };
    }

    case 'OPEN_WEB_APP': {
      const apiBase = await getApiBase();
      await chrome.tabs.create({ url: apiBase });
      return { success: true };
    }

    case 'GET_API_BASE': {
      const apiBase = await getApiBase();
      return { apiBase, isDefault: apiBase === DEFAULT_API_BASE };
    }

    case 'SET_API_BASE': {
      const nextApiBase = String(msg.apiBase || '').trim().replace(/\/+$/, '');
      if (!/^https?:\/\/[^/]+/.test(nextApiBase)) {
        throw new Error('Enter a valid API URL, like http://localhost:3001');
      }
      await chrome.storage.local.set({ apiBase: nextApiBase });
      return { success: true, apiBase: nextApiBase };
    }

    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}
