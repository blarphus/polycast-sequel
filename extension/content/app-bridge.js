// ---------------------------------------------------------------------------
// app-bridge.js — Keeps the local web app and extension dictionary in sync
// ---------------------------------------------------------------------------

const APP_OFFLINE_ENABLED_KEY = 'polycast.offline.enabled';
const APP_OFFLINE_WORDS_KEY = 'polycast.offline.dictionary.words.v1';

function writeAppWords(words) {
  localStorage.setItem(APP_OFFLINE_ENABLED_KEY, 'true');
  localStorage.setItem(APP_OFFLINE_WORDS_KEY, JSON.stringify(Array.isArray(words) ? words : []));
  window.dispatchEvent(new CustomEvent('polycast-offline-dictionary-external-sync'));
}

chrome.runtime.sendMessage({ type: 'GET_OFFLINE_DICTIONARY_FULL' }, (res) => {
  if (chrome.runtime.lastError || !res) return;
  writeAppWords(res.words || []);
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SYNC_OFFLINE_DICTIONARY_TO_APP') {
    writeAppWords(msg.words || []);
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
