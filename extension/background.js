// ---------------------------------------------------------------------------
// background.js — Service worker: auth token storage & API proxy
// ---------------------------------------------------------------------------

const DEFAULT_API_BASE = 'https://polycast-sequel.onrender.com';

async function getApiBase() {
  const { apiBase } = await chrome.storage.local.get('apiBase');
  return apiBase || DEFAULT_API_BASE;
}

async function getAuthToken() {
  const { authToken } = await chrome.storage.local.get('authToken');
  return authToken;
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

async function fetchSavedWords() {
  const words = await apiFetch('/api/dictionary/words');
  const wordList = words.map((w) => w.word.toLowerCase());
  await chrome.storage.local.set({ savedWords: wordList });
  return wordList;
}

async function broadcastWordsUpdated(savedWords) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: 'WORDS_UPDATED', savedWords }).catch(() => {});
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

      const savedWords = await fetchSavedWords();
      await broadcastWordsUpdated(savedWords);

      return { success: true, user: { id, username, display_name, native_language, target_language } };
    }

    case 'LOGOUT': {
      await chrome.storage.local.remove(['authToken', 'user', 'savedWords']);
      await broadcastWordsUpdated([]);
      return { success: true };
    }

    case 'GET_STATUS': {
      const token = await getAuthToken();
      if (!token) return { loggedIn: false };

      try {
        const user = await apiFetch('/api/me');
        await chrome.storage.local.set({ user });
        const { savedWords } = await chrome.storage.local.get('savedWords');
        return { loggedIn: true, user, savedWordCount: (savedWords || []).length };
      } catch (err) {
        return { loggedIn: false, error: err.message };
      }
    }

    case 'LOOKUP_WORD': {
      const { user } = await chrome.storage.local.get('user');
      if (!user) throw new Error('Not logged in');

      const nativeLang = user.native_language || 'en';
      const targetLang = user.target_language;

      const lookupParams = new URLSearchParams({
        word: msg.word,
        sentence: msg.sentence,
        nativeLang,
      });
      if (targetLang) lookupParams.set('targetLang', targetLang);

      const translateParams = new URLSearchParams({
        word: msg.word,
        nativeLang,
      });
      if (targetLang) translateParams.set('targetLang', targetLang);

      const [lookup, translate] = await Promise.all([
        apiFetch(`/api/dictionary/lookup?${lookupParams}`),
        apiFetch(`/api/dictionary/translate-word?${translateParams}`),
      ]);

      return { ...lookup, translation: translate.translation };
    }

    case 'SAVE_WORD': {
      const { user } = await chrome.storage.local.get('user');
      if (!user) throw new Error('Not logged in');

      // Enrich first
      const enriched = await apiFetch('/api/dictionary/enrich', {
        method: 'POST',
        body: {
          word: msg.word,
          sentence: msg.sentence,
          nativeLang: user.native_language || 'en',
          targetLang: user.target_language || undefined,
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
          example_sentence: enriched.example_sentence,
          part_of_speech: enriched.part_of_speech,
          image_url: enriched.image_url || null,
        },
      });

      // Update local saved words list
      const { savedWords: current } = await chrome.storage.local.get('savedWords');
      const updated = [...(current || []), enriched.word.toLowerCase()];
      await chrome.storage.local.set({ savedWords: updated });
      await broadcastWordsUpdated(updated);

      return { success: true, saved };
    }

    case 'GET_SAVED_WORDS': {
      const { savedWords } = await chrome.storage.local.get('savedWords');
      return { savedWords: savedWords || [] };
    }

    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}
