// ---------------------------------------------------------------------------
// popup.js — Login, logout, status check
// ---------------------------------------------------------------------------

const loadingEl = document.getElementById('loading');
const loginView = document.getElementById('login-view');
const statusView = document.getElementById('status-view');
const loginForm = document.getElementById('login-form');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');
const displayNameEl = document.getElementById('display-name');
const usernameDisplayEl = document.getElementById('username-display');
const nativeLangEl = document.getElementById('native-lang');
const targetLangEl = document.getElementById('target-lang');
const targetLanguageSelect = document.getElementById('target-language-select');
const apiBaseInput = document.getElementById('api-base-input');
const saveApiBaseBtn = document.getElementById('save-api-base-btn');
const useLocalApiBtn = document.getElementById('use-local-api-btn');
const settingsMessage = document.getElementById('settings-message');
const wordCountEl = document.getElementById('word-count-num');
const openAppBtn = document.getElementById('open-app-btn');
const logoutBtn = document.getElementById('logout-btn');

function showView(view) {
  loadingEl.classList.add('hidden');
  loginView.classList.add('hidden');
  statusView.classList.add('hidden');
  view.classList.remove('hidden');
}

function langName(code) {
  if (!code) return '—';
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'language' });
    return names.of(code) || code;
  } catch {
    return code;
  }
}

function setSettingsMessage(text, isError = false) {
  settingsMessage.textContent = text;
  settingsMessage.classList.toggle('hidden', !text);
  settingsMessage.classList.toggle('error-message', isError);
}

function ensureLanguageOption(code) {
  if (!code || Array.from(targetLanguageSelect.options).some((option) => option.value === code)) return;

  const option = document.createElement('option');
  option.value = code;
  option.textContent = langName(code);
  targetLanguageSelect.appendChild(option);
}

// Check status on popup open
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
  if (res && res.loggedIn && res.user) {
    showStatus(res.user, res.savedWordCount || 0);
  } else {
    showView(loginView);
  }
});

chrome.runtime.sendMessage({ type: 'GET_API_BASE' }, (res) => {
  if (res && res.apiBase) {
    apiBaseInput.value = res.apiBase;
  }
});

function showStatus(user, wordCount) {
  displayNameEl.textContent = user.display_name || user.username;
  usernameDisplayEl.textContent = `@${user.username}`;
  nativeLangEl.textContent = langName(user.native_language);
  targetLangEl.textContent = langName(user.target_language);
  ensureLanguageOption(user.target_language);
  targetLanguageSelect.value = user.target_language || '';
  wordCountEl.textContent = String(wordCount);
  setSettingsMessage('');
  logoutBtn.classList.remove('hidden');
  showView(statusView);
}

// Login
loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  if (!username || !password) return;

  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in...';
  loginError.classList.add('hidden');

  chrome.runtime.sendMessage({ type: 'LOGIN', username, password }, (res) => {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign In';

    if (res && res.error) {
      loginError.textContent = res.error;
      loginError.classList.remove('hidden');
      return;
    }

    if (res && res.success && res.user) {
      // Fetch full status to get word count
      chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (statusRes) => {
        if (statusRes && statusRes.loggedIn) {
          showStatus(statusRes.user, statusRes.savedWordCount || 0);
        } else {
          showStatus(res.user, 0);
        }
      });
    }
  });
});

// Logout
logoutBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'LOGOUT' }, () => {
    showView(loginView);
  });
});

targetLanguageSelect.addEventListener('change', () => {
  const targetLanguage = targetLanguageSelect.value;
  if (!targetLanguage) return;

  targetLanguageSelect.disabled = true;
  setSettingsMessage('Saving...');

  chrome.runtime.sendMessage({ type: 'SET_TARGET_LANGUAGE', targetLanguage }, (res) => {
    targetLanguageSelect.disabled = false;

    if (chrome.runtime.lastError) {
      setSettingsMessage('Extension reloaded - reopen popup', true);
      return;
    }

    if (!res) {
      setSettingsMessage('No response - try again', true);
      return;
    }

    if (res && res.error) {
      setSettingsMessage(res.error, true);
      return;
    }

    if (res && res.success && res.user) {
      targetLangEl.textContent = langName(res.user.target_language);
      ensureLanguageOption(res.user.target_language);
      targetLanguageSelect.value = res.user.target_language || targetLanguage;
      wordCountEl.textContent = String(res.savedWordCount || 0);
      setSettingsMessage('Saved');
      window.setTimeout(() => setSettingsMessage(''), 1400);
    }
  });
});

function saveApiBase(apiBase) {
  const value = String(apiBase || '').trim();
  if (!value) return;

  saveApiBaseBtn.disabled = true;
  setSettingsMessage('Saving API...');
  chrome.runtime.sendMessage({ type: 'SET_API_BASE', apiBase: value }, (res) => {
    saveApiBaseBtn.disabled = false;

    if (chrome.runtime.lastError) {
      setSettingsMessage(chrome.runtime.lastError.message || 'Could not save API', true);
      return;
    }
    if (res && res.error) {
      setSettingsMessage(res.error, true);
      return;
    }
    if (res && res.apiBase) {
      apiBaseInput.value = res.apiBase;
      setSettingsMessage('API saved. Reload video tabs.');
      window.setTimeout(() => setSettingsMessage(''), 2200);
    }
  });
}

saveApiBaseBtn.addEventListener('click', () => saveApiBase(apiBaseInput.value));
useLocalApiBtn.addEventListener('click', () => saveApiBase('http://localhost:3001'));

openAppBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_WEB_APP' });
});
