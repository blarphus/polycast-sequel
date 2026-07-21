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
const loginApiBaseInput = document.getElementById('login-api-base-input');
const saveApiBaseBtn = document.getElementById('save-api-base-btn');
const loginSaveApiBaseBtn = document.getElementById('login-save-api-base-btn');
const useLocalApiBtn = document.getElementById('use-local-api-btn');
const loginUseLocalApiBtn = document.getElementById('login-use-local-api-btn');
const settingsMessage = document.getElementById('settings-message');
const loginSettingsMessage = document.getElementById('login-settings-message');
const wordCountEl = document.getElementById('word-count-num');
const totalXpEl = document.getElementById('total-xp-num');
const dailyActivityCountEl = document.getElementById('daily-activity-count');
const dailyActivityProgressEl = document.getElementById('daily-activity-progress');
const activityWeekEl = document.getElementById('activity-week');
const levelLabelEl = document.getElementById('level-label');
const sessionXpLabelEl = document.getElementById('session-xp-label');
const dailyGoalCountEl = document.getElementById('daily-goal-count');
const dailyGoalProgressEl = document.getElementById('daily-goal-progress');
const dailyGoalMessageEl = document.getElementById('daily-goal-message');
const dailyGoalInputEl = document.getElementById('daily-goal-input');
const openAppBtn = document.getElementById('open-app-btn');
const logoutBtn = document.getElementById('logout-btn');
const siteHighlightDetailEl = document.getElementById('site-highlight-detail');
const siteHighlightButtons = [...document.querySelectorAll('[data-highlight-override]')];
let activePageStatus = null;

const POPUP_MESSAGES = {
  en: {
    username: 'Username', password: 'Password', signIn: 'Sign In', signingIn: 'Signing in...',
    apiServer: 'API server', saveApi: 'Save API', useLocal: 'Use local', native: 'Native', learning: 'Learning',
    savedWords: 'saved words', dailyActivity: 'Daily activity', dailyWordGoal: 'Daily word goal', goal: 'Goal',
    pageHighlights: 'Page highlights', auto: 'Auto', on: 'On', off: 'Off', learningLanguage: 'Learning language',
    hint: 'Click words in video subtitles to look them up.', openWebApp: 'Open Web App', signOut: 'Sign Out',
    goalComplete: 'Goal complete!', leftToday: (count) => `${count} ${count === 1 ? 'word' : 'words'} left today`,
    level: (number) => `Level ${number}`, rewards: (count) => `${count} session reward${count === 1 ? '' : 's'} left`,
    pageChecking: 'Checking this page...', pageOff: 'Highlights off for this site',
    pageOn: 'Highlights on · language checked in context when clicked', pageUnavailable: 'Page status unavailable',
    browserPageUnavailable: 'Page status unavailable on this browser page',
    grantAccess: (host) => `Not active on ${host} · choose Auto or On to grant access`,
    saving: 'Saving...', saved: 'Saved', extensionReloaded: 'Extension reloaded - reopen popup',
    noResponse: 'No response - try again', savingApi: 'Saving API...', couldNotSaveApi: 'Could not save API',
    apiSaved: 'API saved. Sign in to continue.', details: 'Diagnostic details', attention: 'Polycast needs your attention',
  },
  es: {
    username: 'Usuario', password: 'Contraseña', signIn: 'Iniciar sesión', signingIn: 'Iniciando sesión...',
    apiServer: 'Servidor API', saveApi: 'Guardar API', useLocal: 'Usar local', native: 'Nativo', learning: 'Aprendiendo',
    savedWords: 'palabras guardadas', dailyActivity: 'Actividad diaria', dailyWordGoal: 'Meta diaria de palabras', goal: 'Meta',
    pageHighlights: 'Resaltados de página', auto: 'Auto', on: 'Activados', off: 'Desactivados', learningLanguage: 'Idioma que aprendes',
    hint: 'Haz clic en palabras de los subtítulos para buscarlas.', openWebApp: 'Abrir aplicación web', signOut: 'Cerrar sesión',
    goalComplete: '¡Meta completada!', leftToday: (count) => `${count} ${count === 1 ? 'palabra pendiente' : 'palabras pendientes'} hoy`,
    level: (number) => `Nivel ${number}`, rewards: (count) => `${count} recompensa${count === 1 ? '' : 's'} de sesión pendiente${count === 1 ? '' : 's'}`,
    pageChecking: 'Comprobando esta página...', pageOff: 'Resaltados desactivados en este sitio',
    pageOn: 'Resaltados activados · el idioma se comprueba en contexto al hacer clic', pageUnavailable: 'Estado de página no disponible',
    browserPageUnavailable: 'Estado no disponible en esta página del navegador',
    grantAccess: (host) => `No está activo en ${host} · elige Auto o Activados para conceder acceso`,
    saving: 'Guardando...', saved: 'Guardado', extensionReloaded: 'La extensión se recargó; vuelve a abrirla',
    noResponse: 'Sin respuesta; inténtalo de nuevo', savingApi: 'Guardando API...', couldNotSaveApi: 'No se pudo guardar la API',
    apiSaved: 'API guardada. Inicia sesión para continuar.', details: 'Detalles del diagnóstico', attention: 'Polycast necesita tu atención',
  },
};
let popupLocale = String(navigator.language || '').toLowerCase().startsWith('es') ? 'es' : 'en';
const tr = (key, ...args) => {
  const value = POPUP_MESSAGES[popupLocale][key] ?? POPUP_MESSAGES.en[key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
};

function populateLanguageOptions() {
  const selected = targetLanguageSelect.value;
  targetLanguageSelect.replaceChildren();
  for (const language of globalThis.PolycastLanguageContract?.languages || []) {
    if (!['en', 'es'].includes(language.code)) continue;
    const option = document.createElement('option');
    option.value = language.code;
    option.textContent = langName(language.code);
    targetLanguageSelect.appendChild(option);
  }
  targetLanguageSelect.value = selected;
}

function applyPopupLocale(nativeLanguage) {
  popupLocale = String(nativeLanguage || '').toLowerCase().split(/[-_]/)[0] === 'es' ? 'es' : 'en';
  document.documentElement.lang = popupLocale;
  document.querySelectorAll('[data-i18n]').forEach((element) => { element.textContent = tr(element.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => { element.placeholder = tr(element.dataset.i18nPlaceholder); });
  populateLanguageOptions();
}

applyPopupLocale(popupLocale);
siteHighlightDetailEl.textContent = tr('pageChecking');

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
    const names = new Intl.DisplayNames([popupLocale], { type: 'language' });
    return names.of(code) || code;
  } catch (error) {
    console.info('[polycast:fallback]', {
      code: 'popup_language_name_fallback',
      severity: 'warning',
      title: 'Language name fallback used',
      message: 'The browser could not localize this language code, so the popup is showing the raw code.',
      source: 'extension.popup',
      operation: 'format-language-name',
      correlationId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      detail: error?.message || String(error),
    });
    setSettingsMessage(`Language name fallback used (${code}): ${error?.message || String(error)}`, true);
    return code;
  }
}

function setSettingsMessage(text, isError = false) {
  settingsMessage.textContent = text;
  settingsMessage.classList.toggle('hidden', !text);
  settingsMessage.classList.toggle('error-message', isError);
}

function setLoginSettingsMessage(text, isError = false) {
  loginSettingsMessage.textContent = text;
  loginSettingsMessage.classList.toggle('hidden', !text);
  loginSettingsMessage.classList.toggle('error-message', isError);
}

function showLoginError(message, diagnostic = null) {
  loginError.replaceChildren();

  if (!diagnostic) {
    loginError.textContent = message;
    loginError.classList.remove('hidden');
    return;
  }

  const title = document.createElement('strong');
  title.textContent = diagnostic.title || tr('attention');
  const summary = document.createElement('span');
  summary.textContent = diagnostic.message || message;
  const details = document.createElement('details');
  const detailsSummary = document.createElement('summary');
  detailsSummary.textContent = tr('details');
  const metadata = document.createElement('small');
  metadata.textContent = `${diagnostic.code || 'extension_fallback_used'} · ${diagnostic.source || 'extension.background'}/${diagnostic.operation || 'unknown'} · ref ${diagnostic.correlationId || 'unavailable'}${diagnostic.detail ? ` · ${diagnostic.detail}` : ''}`;
  details.append(detailsSummary, metadata);
  loginError.append(title, summary, details);
  loginError.classList.remove('hidden');
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
    showView(loginView);
    showLoginError(runtimeError);
    return;
  }
  if (res && res.loggedIn && res.user) {
    showStatus(res.user, res.savedWordCount || 0, res.dailyGoal, res.progression);
    if (res.diagnostic || res.error) {
      const diagnostic = res.diagnostic;
      setSettingsMessage(
        diagnostic
          ? `${diagnostic.title}: ${diagnostic.message} · ${diagnostic.code} · ${diagnostic.correlationId}${diagnostic.detail ? ` · ${diagnostic.detail}` : ''}`
          : `Status fallback used: ${res.error}`,
        true,
      );
    }
    loadPageHighlightStatus();
  } else {
    showView(loginView);
    if (res?.diagnostic) {
      const diagnostic = res.diagnostic;
      showLoginError(diagnostic.message, diagnostic);
    }
  }
});

chrome.storage.local.get('lastFallbackDiagnostic', ({ lastFallbackDiagnostic: diagnostic }) => {
  if (!diagnostic) return;
  const text = `${diagnostic.title}: ${diagnostic.message} · ${diagnostic.code} · ${diagnostic.source}/${diagnostic.operation} · ref ${diagnostic.correlationId}${diagnostic.detail ? ` · ${diagnostic.detail}` : ''}`;
  if (!statusView.classList.contains('hidden')) setSettingsMessage(text, true);
  else showLoginError(diagnostic.message, diagnostic);
  chrome.action?.setBadgeText({ text: '' });
});

chrome.runtime.sendMessage({ type: 'GET_API_BASE' }, (res) => {
  if (consumeRuntimeError()) return;
  if (res && res.apiBase) {
    apiBaseInput.value = res.apiBase;
    loginApiBaseInput.value = res.apiBase;
  }
});

function renderDailyGoal(snapshot = { goal: 5, added: 0, remaining: 5, complete: false }) {
  dailyGoalCountEl.textContent = `${snapshot.added} / ${snapshot.goal}`;
  dailyGoalProgressEl.style.width = `${Math.min(100, (snapshot.added / Math.max(1, snapshot.goal)) * 100)}%`;
  dailyGoalProgressEl.parentElement.classList.toggle('complete', snapshot.complete);
  dailyGoalMessageEl.textContent = snapshot.complete
    ? tr('goalComplete')
    : tr('leftToday', snapshot.remaining);
  dailyGoalInputEl.value = String(snapshot.goal);
}

function renderProgression(progression) {
  const activity = progression?.dailyActivity || { earnedXp: 0, targetXp: 50 };
  dailyActivityCountEl.textContent = `${activity.earnedXp} / ${activity.targetXp} XP`;
  dailyActivityProgressEl.style.width = `${Math.min(100, (activity.earnedXp / Math.max(1, activity.targetXp)) * 100)}%`;
  activityWeekEl.innerHTML = '';
  for (const day of progression?.week || []) {
    const item = document.createElement('span');
    const dot = document.createElement('i');
    dot.className = day.complete ? 'complete' : day.xp > 0 ? 'active' : '';
    const label = document.createElement('small');
    label.textContent = new Date(`${day.date}T12:00:00`).toLocaleDateString(popupLocale === 'es' ? 'es' : 'en-US', { weekday: 'narrow' });
    item.title = `${day.date}: ${day.xp} XP`;
    item.append(dot, label);
    activityWeekEl.append(item);
  }
  levelLabelEl.textContent = tr('level', progression?.level?.number || 1);
  const rewards = progression?.sessionRewards?.remaining ?? 2;
  sessionXpLabelEl.textContent = tr('rewards', rewards);
}

function showStatus(user, wordCount, dailyGoal, progression) {
  applyPopupLocale(user.native_language);
  displayNameEl.textContent = user.display_name || user.username;
  usernameDisplayEl.textContent = `@${user.username}`;
  nativeLangEl.textContent = langName(user.native_language);
  targetLangEl.textContent = langName(user.target_language);
  ensureLanguageOption(user.target_language);
  targetLanguageSelect.value = user.target_language || '';
  wordCountEl.textContent = String(wordCount);
  totalXpEl.textContent = String(progression?.totalXp || user.total_xp || 0);
  renderDailyGoal(dailyGoal);
  renderProgression(progression);
  setSettingsMessage('');
  logoutBtn.classList.remove('hidden');
  showView(statusView);
}

function renderPageHighlightStatus(status) {
  activePageStatus = status;
  siteHighlightButtons.forEach((button) => button.classList.toggle('selected', button.dataset.highlightOverride === status.override));
  if (status.activationRequired) {
    siteHighlightDetailEl.textContent = tr('grantAccess', status.hostname);
    return;
  }
  if (!status.enabled) {
    siteHighlightDetailEl.textContent = tr('pageOff');
    return;
  }
  siteHighlightDetailEl.textContent = tr('pageOn');
}

function loadPageHighlightStatus() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (consumeRuntimeError() || !tabs[0]?.id) {
      siteHighlightDetailEl.textContent = tr('pageUnavailable');
      return;
    }
    const activeTab = tabs[0];
    chrome.tabs.sendMessage(activeTab.id, { type: 'GET_PAGE_HIGHLIGHT_STATUS' }, (status) => {
      const error = consumeRuntimeError();
      if (error || !status) {
        try {
          const url = new URL(activeTab.url || '');
          if (['http:', 'https:'].includes(url.protocol)) {
            renderPageHighlightStatus({
              hostname: url.hostname,
              pageUrl: url.href,
              tabId: activeTab.id,
              override: 'off',
              enabled: false,
              targetLanguage: null,
              validationMode: 'click-context',
              activationRequired: true,
            });
            return;
          }
        } catch (parseError) {
          setSettingsMessage(`Page activation diagnostic · popup_page_url_invalid · ${crypto.randomUUID()} · ${parseError?.message || String(parseError)}`, true);
        }
        siteHighlightDetailEl.textContent = tr('browserPageUnavailable');
        return;
      }
      renderPageHighlightStatus({ ...status, pageUrl: activeTab.url || '', tabId: activeTab.id });
    });
  });
}

// Login
loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  if (!username || !password) return;

  loginBtn.disabled = true;
  loginBtn.textContent = tr('signingIn');
  loginError.classList.add('hidden');
  loginError.replaceChildren();

  chrome.runtime.sendMessage({ type: 'LOGIN', username, password }, (res) => {
    loginBtn.disabled = false;
    loginBtn.textContent = tr('signIn');

    const runtimeError = consumeRuntimeError();
    if (runtimeError || (res && res.error)) {
      showLoginError(runtimeError || res.error, res?.diagnostic || null);
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

siteHighlightButtons.forEach((button) => button.addEventListener('click', () => {
  if (!activePageStatus?.hostname || !activePageStatus?.tabId) return;
  siteHighlightButtons.forEach((item) => { item.disabled = true; });
  const applyOverride = () => chrome.runtime.sendMessage({
      type: 'SET_SITE_HIGHLIGHT_OVERRIDE',
      hostname: activePageStatus.hostname,
      pageUrl: activePageStatus.pageUrl || '',
      tabId: activePageStatus.tabId,
      override: button.dataset.highlightOverride,
    }, (result) => {
    siteHighlightButtons.forEach((item) => { item.disabled = false; });
    const error = consumeRuntimeError();
    if (error || result?.error) {
      const diagnostic = result?.diagnostic;
      setSettingsMessage(diagnostic
        ? `${diagnostic.title}: ${diagnostic.message} · ${diagnostic.code} · ${diagnostic.correlationId}${diagnostic.detail ? ` · ${diagnostic.detail}` : ''}`
        : `Highlight setting fallback used: ${error || result.error}`, true);
      return;
    }
    renderPageHighlightStatus({ ...activePageStatus, activationRequired: false, override: result.override, enabled: result.override !== 'off', validationMode: 'click-context' });
  });

  if (!activePageStatus.activationRequired || button.dataset.highlightOverride === 'off') {
    applyOverride();
    return;
  }
  let pattern;
  try {
    pattern = `${new URL(activePageStatus.pageUrl).origin}/*`;
  } catch (error) {
    siteHighlightButtons.forEach((item) => { item.disabled = false; });
    setSettingsMessage(`Site permission request rejected · popup_site_url_invalid · ${crypto.randomUUID()} · ${error?.message || String(error)}`, true);
    return;
  }
  chrome.permissions.request({ origins: [pattern] }, (granted) => {
    const error = consumeRuntimeError();
    if (!granted || error) {
      siteHighlightButtons.forEach((item) => { item.disabled = false; });
      const correlationId = crypto.randomUUID();
      console.info('[polycast:fallback]', {
        code: 'site_activation_permission_denied', severity: 'warning',
        title: 'Site activation permission not granted',
        message: `Polycast remains inactive on ${activePageStatus.hostname} because site access was not granted.`,
        source: 'extension.popup', operation: 'request-site-permission', correlationId,
        occurredAt: new Date().toISOString(), detail: error || `origin=${pattern}`,
      });
      setSettingsMessage(`Site activation permission not granted · site_activation_permission_denied · ${correlationId} · ${error || pattern}`, true);
      return;
    }
    applyOverride();
  });
}));

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
  setSettingsMessage(tr('saving'));

  chrome.runtime.sendMessage({ type: 'SET_TARGET_LANGUAGE', targetLanguage }, (res) => {
    targetLanguageSelect.disabled = false;

    const runtimeError = consumeRuntimeError();
    if (runtimeError) {
      setSettingsMessage(tr('extensionReloaded'), true);
      return;
    }

    if (!res) {
      setSettingsMessage(tr('noResponse'), true);
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
      setSettingsMessage(tr('saved'));
      window.setTimeout(() => setSettingsMessage(''), 1400);
    }
  });
});

function saveApiBase(apiBase, { button = saveApiBaseBtn, message = setSettingsMessage } = {}) {
  const value = String(apiBase || '').trim();
  if (!value) return;

  button.disabled = true;
  message(tr('savingApi'));
  chrome.runtime.sendMessage({ type: 'SET_API_BASE', apiBase: value }, (res) => {
    button.disabled = false;

    const runtimeError = consumeRuntimeError();
    if (runtimeError) {
      message(runtimeError || tr('couldNotSaveApi'), true);
      return;
    }
    if (res && res.error) {
      message(res.error, true);
      return;
    }
    if (res && res.apiBase) {
      apiBaseInput.value = res.apiBase;
      loginApiBaseInput.value = res.apiBase;
      message(tr('apiSaved'));
      window.setTimeout(() => message(''), 2200);
    }
  });
}

saveApiBaseBtn.addEventListener('click', () => saveApiBase(apiBaseInput.value));
useLocalApiBtn.addEventListener('click', () => saveApiBase('http://localhost:3001'));
loginSaveApiBaseBtn.addEventListener('click', () => saveApiBase(loginApiBaseInput.value, {
  button: loginSaveApiBaseBtn,
  message: setLoginSettingsMessage,
}));
loginUseLocalApiBtn.addEventListener('click', () => saveApiBase('http://localhost:3001', {
  button: loginUseLocalApiBtn,
  message: setLoginSettingsMessage,
}));

openAppBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_WEB_APP' }, () => {
    consumeRuntimeError();
  });
});
