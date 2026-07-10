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
const totalXpEl = document.getElementById('total-xp-num');
const dailyGoalCountEl = document.getElementById('daily-goal-count');
const dailyGoalProgressEl = document.getElementById('daily-goal-progress');
const dailyGoalMessageEl = document.getElementById('daily-goal-message');
const dailyGoalInputEl = document.getElementById('daily-goal-input');
const openAppBtn = document.getElementById('open-app-btn');
const logoutBtn = document.getElementById('logout-btn');

function consumeRuntimeError() {
  return chrome.runtime.lastError?.message || '';
}

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
  const runtimeError = consumeRuntimeError();
  if (runtimeError) {
    loginError.textContent = runtimeError;
    showView(loginView);
    loginError.classList.remove('hidden');
    return;
  }
  if (res && res.loggedIn && res.user) {
    showStatus(res.user, res.savedWordCount || 0, res.dailyGoal, res.progression);
  } else {
    showView(loginView);
  }
});

chrome.runtime.sendMessage({ type: 'GET_API_BASE' }, (res) => {
  if (consumeRuntimeError()) return;
  if (res && res.apiBase) {
    apiBaseInput.value = res.apiBase;
  }
});

function renderDailyGoal(snapshot = { goal: 5, added: 0, remaining: 5, complete: false }) {
  dailyGoalCountEl.textContent = `${snapshot.added} / ${snapshot.goal}`;
  dailyGoalProgressEl.style.width = `${Math.min(100, (snapshot.added / Math.max(1, snapshot.goal)) * 100)}%`;
  dailyGoalProgressEl.parentElement.classList.toggle('complete', snapshot.complete);
  dailyGoalMessageEl.textContent = snapshot.complete
    ? 'Goal complete!'
    : `${snapshot.remaining} ${snapshot.remaining === 1 ? 'word' : 'words'} left today`;
  dailyGoalInputEl.value = String(snapshot.goal);
}

function showStatus(user, wordCount, dailyGoal, progression) {
  displayNameEl.textContent = user.display_name || user.username;
  usernameDisplayEl.textContent = `@${user.username}`;
  nativeLangEl.textContent = langName(user.native_language);
  targetLangEl.textContent = langName(user.target_language);
  ensureLanguageOption(user.target_language);
  targetLanguageSelect.value = user.target_language || '';
  wordCountEl.textContent = String(wordCount);
  totalXpEl.textContent = String(progression?.totalXp || user.total_xp || 0);
  renderDailyGoal(dailyGoal);
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

    const runtimeError = consumeRuntimeError();
    if (runtimeError || (res && res.error)) {
      loginError.textContent = runtimeError || res.error;
      loginError.classList.remove('hidden');
      return;
    }

    if (res && res.success && res.user) {
      // Fetch full status to get word count
      chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (statusRes) => {
        if (consumeRuntimeError()) {
          showStatus(res.user, 0);
          return;
        }
        if (statusRes && statusRes.loggedIn) {
          showStatus(statusRes.user, statusRes.savedWordCount || 0, statusRes.dailyGoal, statusRes.progression);
        } else {
          showStatus(res.user, 0);
        }
      });
    }
  });
});

dailyGoalInputEl.addEventListener('change', () => {
  const goal = Math.min(50, Math.max(1, Number(dailyGoalInputEl.value) || 5));
  chrome.runtime.sendMessage({ type: 'SET_DAILY_GOAL', goal }, (res) => {
    if (consumeRuntimeError()) return;
    if (res?.snapshot) renderDailyGoal(res.snapshot);
  });
});

// Logout
logoutBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'LOGOUT' }, () => {
    if (consumeRuntimeError()) return;
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

    const runtimeError = consumeRuntimeError();
    if (runtimeError) {
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

    const runtimeError = consumeRuntimeError();
    if (runtimeError) {
      setSettingsMessage(runtimeError || 'Could not save API', true);
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
  chrome.runtime.sendMessage({ type: 'OPEN_WEB_APP' }, () => {
    consumeRuntimeError();
  });
});
