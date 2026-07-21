// ---------------------------------------------------------------------------
// app-bridge.js — Keeps the local web app and extension dictionary in sync
// ---------------------------------------------------------------------------

const APP_OFFLINE_WORDS_KEY = 'polycast.offline.dictionary.words.v1';

// Older bridge versions enabled the web app's sticky offline mode on every
// local-app load. The bridge only mirrors dictionary data; it must not decide
// whether authenticated web requests use the backend. Clear that legacy flag
// for the local development origins where this content script runs.
localStorage.removeItem('polycast.offline.enabled');

function writeAppWords(words) {
  localStorage.setItem(APP_OFFLINE_WORDS_KEY, JSON.stringify(Array.isArray(words) ? words : []));
  window.dispatchEvent(new CustomEvent('polycast-offline-dictionary-external-sync'));
}

chrome.runtime.sendMessage({ type: 'GET_OFFLINE_DICTIONARY_FULL' }, (res) => {
  if (chrome.runtime.lastError || !res) return;
  writeAppWords(res.words || []);
});

chrome.runtime.onMessage.addListener((msg) => {
  let serialized = '';
  try { serialized = JSON.stringify(msg); } catch (error) {
    console.info('[polycast:fallback]', {
      code: 'app_bridge_message_rejected', severity: 'error', title: 'App bridge update rejected',
      message: 'A non-serializable offline dictionary update was rejected.', source: 'extension.app-bridge',
      operation: 'validate-inbound-message', correlationId: crypto.randomUUID(), occurredAt: new Date().toISOString(),
      detail: error?.message || String(error),
    });
    return;
  }
  if (msg?.type === 'SYNC_OFFLINE_DICTIONARY_TO_APP' && serialized.length <= 2_000_000 && Array.isArray(msg.words) && msg.words.length <= 10_000) {
    writeAppWords(msg.words || []);
  } else if (msg?.type === 'SYNC_OFFLINE_DICTIONARY_TO_APP') {
    console.info('[polycast:fallback]', {
      code: 'app_bridge_message_rejected', severity: 'error', title: 'App bridge update rejected',
      message: 'An oversized or malformed offline dictionary update was rejected.', source: 'extension.app-bridge',
      operation: 'validate-inbound-message', correlationId: crypto.randomUUID(), occurredAt: new Date().toISOString(),
      detail: `bytes=${serialized.length}; entries=${Array.isArray(msg.words) ? msg.words.length : 'invalid'}`,
    });
  }
});

window.addEventListener('polycast-offline-dictionary-updated', (event) => {
  const words = event.detail?.words;
  if (!Array.isArray(words)) return;
  chrome.runtime.sendMessage({ type: 'UPDATE_OFFLINE_DICTIONARY', words }, () => {
    // Reading lastError prevents Chrome from reporting expected reload/tab-close
    // failures as uncaught extension errors.
    void chrome.runtime.lastError;
  });
});
