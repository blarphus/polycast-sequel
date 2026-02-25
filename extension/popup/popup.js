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
const wordCountEl = document.getElementById('word-count-num');
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

// Check status on popup open
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
  if (res && res.loggedIn && res.user) {
    showStatus(res.user, res.savedWordCount || 0);
  } else {
    showView(loginView);
  }
});

function showStatus(user, wordCount) {
  displayNameEl.textContent = user.display_name || user.username;
  usernameDisplayEl.textContent = `@${user.username}`;
  nativeLangEl.textContent = langName(user.native_language);
  targetLangEl.textContent = langName(user.target_language);
  wordCountEl.textContent = String(wordCount);
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
