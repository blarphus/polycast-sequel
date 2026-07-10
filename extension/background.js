// ---------------------------------------------------------------------------
// background.js — Service worker: auth token storage & API proxy
// ---------------------------------------------------------------------------

const DEFAULT_API_BASE = 'https://polycast-sequel.onrender.com';
const DEFAULT_DAILY_WORD_GOAL = 5;
const DAILY_GOAL_KEY = 'dailyWordGoal';
const DAILY_PROGRESS_KEY = 'dailyWordProgress';
const OFFLINE_MODE_KEY = 'offlineMode';
const OFFLINE_WORDS_KEY = 'offlineDictionaryWords';
const SELECTION_CONTEXT_MENU_ID = 'polycast-lookup-selection';
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

let contextMenuInstallPromise = null;

function installContextMenus() {
  if (!chrome.contextMenus) return Promise.resolve();
  if (contextMenuInstallPromise) return contextMenuInstallPromise;

  contextMenuInstallPromise = new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      const removeError = chrome.runtime.lastError;
      if (removeError) {
        console.warn('[Polycast] Could not clear context menus:', removeError.message);
      }

      chrome.contextMenus.create({
        id: SELECTION_CONTEXT_MENU_ID,
        title: 'Look up "%s" with Polycast',
        contexts: ['selection'],
      }, () => {
        const createError = chrome.runtime.lastError;
        if (createError) {
          console.warn('[Polycast] Could not create context menu:', createError.message);
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

chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== SELECTION_CONTEXT_MENU_ID || !tab?.id) return;

  const message = {
    type: 'POLYCAST_LOOKUP_SELECTION',
    selectionText: info.selectionText || '',
  };
  const options = Number.isInteger(info.frameId) ? { frameId: info.frameId } : undefined;
  chrome.tabs.sendMessage(tab.id, message, options)
    .catch(() => {
      if (!options) return;
      // Chrome's PDF viewer reports selections from its internal extension
      // frame, where our content script cannot run. Retry in the top page
      // with the selectionText supplied by contextMenus.
      return chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    });
});

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

async function getDailyGoalSnapshot() {
  const stored = await chrome.storage.local.get([DAILY_GOAL_KEY, DAILY_PROGRESS_KEY]);
  const goal = Number(stored[DAILY_GOAL_KEY]) > 0 ? Math.round(Number(stored[DAILY_GOAL_KEY])) : DEFAULT_DAILY_WORD_GOAL;
  const progress = stored[DAILY_PROGRESS_KEY];
  const added = progress?.date === localDateKey() ? Math.max(0, Number(progress.count) || 0) : 0;
  return { goal, added, remaining: Math.max(0, goal - added), complete: added >= goal };
}

async function broadcastDailyGoalUpdated(snapshot, extra = {}) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: 'DAILY_GOAL_UPDATED', snapshot, ...extra }).catch(() => {});
  }
}

async function seedDailyGoalProgress(count) {
  const normalized = Math.max(0, Math.round(Number(count) || 0));
  await chrome.storage.local.set({ [DAILY_PROGRESS_KEY]: { date: localDateKey(), count: normalized } });
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
    const dashboard = await apiFetch(`/api/home/student-dashboard?timeZone=${encodeURIComponent(zone)}`);
    return seedDailyGoalProgress(dashboard.wordsAddedToday || 0);
  } catch {
    return getDailyGoalSnapshot();
  }
}

async function recordDailyGoalWord() {
  const before = await getDailyGoalSnapshot();
  await chrome.storage.local.set({ [DAILY_PROGRESS_KEY]: { date: localDateKey(), count: before.added + 1 } });
  const after = await getDailyGoalSnapshot();
  await broadcastDailyGoalUpdated(after, { justAdded: true, justCompleted: !before.complete && after.complete });
  return { ...after, justAdded: true, justCompleted: !before.complete && after.complete };
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

  if (res.status === 401) {
    await chrome.storage.local.remove(['authToken', 'user', 'savedWords']);
    throw new Error('Session expired — please log in again');
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
    } catch { /* fall through to comma split */ }
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
  await chrome.storage.local.set({ savedWords: wordList });
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
    chrome.tabs.sendMessage(tab.id, { type: 'SYNC_OFFLINE_DICTIONARY_TO_APP', words }).catch(() => {});
  }
}

async function broadcastWordsUpdated(savedWords) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: 'WORDS_UPDATED', savedWords }).catch(() => {});
  }
}

async function broadcastTargetLanguageUpdated(targetLanguage) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: 'TARGET_LANGUAGE_UPDATED', targetLanguage }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch((err) => {
    sendResponse({ error: err.message });
  });
  return true; // keep channel open for async response
});

async function handleMessage(msg) {
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
      } catch {
        const user = await startOfflineMode(msg.username);
        return { success: true, user, offline: true };
      }

      if (!res.ok) {
        const text = await res.text();
        let payload = {};
        try { payload = JSON.parse(text); } catch { /* non-JSON response */ }
        throw new Error(payload.error || `Login failed (${res.status})`);
      }

      const data = await res.json();
      const { token, id, username, display_name, native_language, target_language } = data;

      await chrome.storage.local.set({
        authToken: token,
        user: { id, username, display_name, native_language, target_language },
      });
      await chrome.storage.local.remove(OFFLINE_MODE_KEY);

      const savedWords = await fetchSavedWords();
      await broadcastWordsUpdated(savedWords);

      return { success: true, user: { id, username, display_name, native_language, target_language } };
    }

    case 'REMOTE_LOGIN': {
      const apiBase = await getApiBase();
      const res = await fetch(`${apiBase}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: msg.username, password: msg.password }),
      });

      if (!res.ok) {
        const text = await res.text();
        let payload = {};
        try { payload = JSON.parse(text); } catch { /* non-JSON response */ }
        console.error('Login failed:', res.status, text.slice(0, 300));
        throw new Error(payload.error || `Login failed (${res.status})`);
      }

      const data = await res.json();
      const { token, id, username, display_name, native_language, target_language } = data;

      await chrome.storage.local.set({
        authToken: token,
        user: { id, username, display_name, native_language, target_language },
      });
      await chrome.storage.local.remove(OFFLINE_MODE_KEY);

      const savedWords = await fetchSavedWords();
      await broadcastWordsUpdated(savedWords);

      return { success: true, user: { id, username, display_name, native_language, target_language } };
    }

    case 'LOGOUT': {
      await chrome.storage.local.remove(['authToken', 'user', 'savedWords', OFFLINE_MODE_KEY]);
      await broadcastWordsUpdated([]);
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
        return { loggedIn: true, user, savedWordCount: words.length, dailyGoal: await syncDailyGoalFromServer(), offline: true };
      }

      try {
        const user = await apiFetch('/api/me');
        await chrome.storage.local.set({ user });
        const { savedWords } = await chrome.storage.local.get('savedWords');
        return { loggedIn: true, user, savedWordCount: (savedWords || []).length, dailyGoal: await syncDailyGoalFromServer() };
      } catch (err) {
        const { user = DEFAULT_OFFLINE_USER } = await chrome.storage.local.get('user');
        const words = await getOfflineWords();
        return { loggedIn: true, user: { ...user, offline: true }, savedWordCount: words.length, dailyGoal: await getDailyGoalSnapshot(), offline: true, error: err.message };
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
          },
        });

        // Update local saved words list — include the lemma, every inflected form, and the
        // exact tapped form so all conjugations highlight immediately, not just the surface word.
        const { savedWords: current } = await chrome.storage.local.get('savedWords');
        const updated = [...new Set([...(current || []), ...savedWordTokens([enriched]), String(msg.word).toLowerCase()])];
        await chrome.storage.local.set({ savedWords: updated });
        await broadcastWordsUpdated(updated);

        const dailyGoal = saved._created ? await recordDailyGoalWord() : await getDailyGoalSnapshot();
        return { success: true, saved, dailyGoal, fallback_notices: enriched.fallback_notices || [] };
      } catch (err) {
        if (String(err.message || '').includes('Session expired')) throw err;
        const saved = await saveOfflineWord(msg.word, msg.sentence);
        const dailyGoal = saved._created ? await recordDailyGoalWord() : await getDailyGoalSnapshot();
        return { success: true, saved, dailyGoal, offline: true, warning: err.message };
      }
    }

    case 'GET_DAILY_GOAL': {
      return { snapshot: await syncDailyGoalFromServer() };
    }

    case 'SET_DAILY_GOAL': {
      const goal = Math.min(50, Math.max(1, Math.round(Number(msg.goal) || DEFAULT_DAILY_WORD_GOAL)));
      await chrome.storage.local.set({ [DAILY_GOAL_KEY]: goal });
      const snapshot = await getDailyGoalSnapshot();
      await broadcastDailyGoalUpdated(snapshot);
      return { snapshot };
    }

    // Self-heal highlighting: a tapped inflection of an already-saved word is
    // persisted onto that word so it (and this exact form) highlight everywhere.
    case 'ADD_WORD_FORM': {
      const form = String(msg.form || '').trim().toLowerCase();
      if (!form) return { success: false };

      const { savedWords: current } = await chrome.storage.local.get('savedWords');
      const updated = [...new Set([...(current || []), form])];
      await chrome.storage.local.set({ savedWords: updated });
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

    case 'GET_SAVED_WORDS': {
      const { savedWords } = await chrome.storage.local.get('savedWords');
      return { savedWords: savedWords || [] };
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
      return { success: true, user: updatedUser, savedWordCount: savedWords.length };
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
