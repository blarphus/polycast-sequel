// ---------------------------------------------------------------------------
// shared.js — Tokenization, popup UI, saved-word state, message helpers
// ---------------------------------------------------------------------------

// ---- Saved words state ----------------------------------------------------

let savedWordsSet = new Set();

async function refreshCaptionSavedWords(root = document) {
  const spans = [...root.querySelectorAll('.pc-word')];
  const tokens = [...new Set(spans.map((span) => span.textContent.toLocaleLowerCase()))];
  if (!tokens.length) return;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'MATCH_PAGE_TOKENS', tokens });
    const matches = new Set((result?.matches || []).map((entry) => entry.token));
    for (const token of matches) savedWordsSet.add(token);
    spans.forEach((span) => span.classList.toggle('pc-saved', matches.has(span.textContent.toLocaleLowerCase())));
  } catch (err) {
    showFallbackToast('Caption highlight fallback used', err.message || 'Saved-word matching was unavailable.');
  }
}

// ---- Target language state ------------------------------------------------

let targetLanguage = null;
let uiLocale = 'en';
const BONUS_XP_PER_WORD = 10;
let dailyGoalSnapshot = { goal: 5, added: 0, remaining: 5, complete: false, overGoal: 0, bonusXp: 0 };

(async function initTargetLanguage() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_TARGET_LANGUAGE' });
    if (res && res.targetLanguage) {
      targetLanguage = res.targetLanguage.toLowerCase();
    }
  } catch (err) {
    showFallbackToast(
      'Target language fallback used',
      err?.message || 'The extension could not load your target language; page detection will be used until refresh.',
    );
  }
})();

(async function initUiLocale() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    uiLocale = String(res?.user?.native_language || '').toLowerCase().split(/[-_]/)[0] === 'es' ? 'es' : 'en';
  } catch (err) {
    showFallbackToast(
      'Interface language fallback used',
      'Polycast could not load the profile interface language, so page controls remain in English.',
      { code: 'content_ui_locale_fallback', operation: 'load-interface-language', detail: err?.message || String(err) },
    );
  }
})();

(async function initDailyGoal() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_DAILY_GOAL' });
    if (res?.snapshot) dailyGoalSnapshot = res.snapshot;
  } catch (err) {
    showFallbackToast(
      'Daily goal fallback used',
      err?.message || 'The extension could not load your goal; the visible default goal will be used until refresh.',
    );
  }
})();

// ---- Rolling caption context window ---------------------------------------
// YouTube removes old captions from the DOM, so to "Explain in context" with
// more than the current line we keep a rolling window of the most recent
// caption text (~50 words) as it streams by.

const CAPTION_CONTEXT_WORDS = 50;
let recentCaptions = [];

function pushCaptionContext(text) {
  const t = (text || '').trim();
  if (!t) return;
  const last = recentCaptions[recentCaptions.length - 1];
  if (t === last) return; // exact re-tokenize of the same caption
  if (last && (t.startsWith(last) || last.startsWith(t))) {
    // Same caption line growing/shrinking incrementally — keep the longer.
    recentCaptions[recentCaptions.length - 1] = t.length >= last.length ? t : last;
  } else {
    recentCaptions.push(t);
  }
  // Trim from the front so the joined window stays near the word cap.
  while (recentCaptions.length > 1 && recentCaptions.join(' ').split(/\s+/).length > CAPTION_CONTEXT_WORDS) {
    recentCaptions.shift();
  }
}

function captionContext() {
  return recentCaptions.join(' ').trim();
}

function showFallbackToast(title, message, diagnostic = {}) {
  const structuredDiagnostic = {
    code: diagnostic.code || 'extension_content_fallback_used',
    severity: diagnostic.severity || 'warning',
    title: String(title || diagnostic.title || 'Fallback used'),
    message: String(message || diagnostic.message || 'Polycast used a fallback path.'),
    source: diagnostic.source || 'extension.content',
    operation: diagnostic.operation || 'content-script-operation',
    pipeline: diagnostic.pipeline || diagnostic.operation || 'content-script-operation',
    stage: diagnostic.stage || 'fallback',
    correlationId: diagnostic.correlationId || crypto.randomUUID(),
    occurredAt: diagnostic.occurredAt || new Date().toISOString(),
    ...(diagnostic.selectedAction ? { selectedAction: diagnostic.selectedAction } : {}),
    ...(diagnostic.detail ? { detail: diagnostic.detail } : {}),
  };
  const existing = document.querySelector('.pc-fallback-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'pc-fallback-toast';
  toast.setAttribute('role', 'status');
  const heading = document.createElement('strong');
  heading.textContent = structuredDiagnostic.title;
  const detail = document.createElement('span');
  detail.textContent = structuredDiagnostic.message;
  const technical = document.createElement('small');
  technical.textContent = `${structuredDiagnostic.code} · ${structuredDiagnostic.source}/${structuredDiagnostic.operation} · ref ${structuredDiagnostic.correlationId}`;
  toast.append(heading, detail);
  if (structuredDiagnostic.detail) {
    const diagnosticDetail = document.createElement('small');
    diagnosticDetail.textContent = String(structuredDiagnostic.detail);
    toast.appendChild(diagnosticDetail);
  }
  toast.appendChild(technical);
  console.info('[polycast:fallback]', structuredDiagnostic);
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 7000);
}

function validateInboundContentMessage(msg, acceptedTypes = null) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') return false;
  if (acceptedTypes && !acceptedTypes.includes(msg.type)) return false;
  let serialized;
  try { serialized = JSON.stringify(msg); } catch { return false; }
  if (serialized.length > 1_000_000) return false;
  if (msg.type === 'WORDS_UPDATED') {
    const hasWordSnapshot = Array.isArray(msg.savedWords) && msg.savedWords.length <= 50_000;
    const hasRevision = Number.isSafeInteger(msg.revision) && msg.revision >= 0;
    if (!hasWordSnapshot && !hasRevision) return false;
  }
  if (msg.type === 'TARGET_LANGUAGE_UPDATED' && msg.targetLanguage != null && typeof msg.targetLanguage !== 'string') return false;
  if (msg.type === 'DAILY_GOAL_UPDATED' && (!msg.snapshot || typeof msg.snapshot !== 'object')) return false;
  if (msg.type === 'POLYCAST_FALLBACK_NOTICE') {
    const diagnostic = msg.diagnostic || msg;
    if (typeof diagnostic.code !== 'string' || typeof diagnostic.title !== 'string' || typeof diagnostic.message !== 'string') return false;
  }
  return true;
}

globalThis.PolycastContent = {
  ...(globalThis.PolycastContent || {}),
  showFallbackToast,
  validateInboundMessage: validateInboundContentMessage,
};

chrome.runtime.onMessage.addListener((msg) => {
  const accepted = ['WORDS_UPDATED', 'TARGET_LANGUAGE_UPDATED', 'DAILY_GOAL_UPDATED', 'POLYCAST_FALLBACK_NOTICE'];
  if (!validateInboundContentMessage(msg, accepted)) {
    if (msg?.type && accepted.includes(msg.type)) {
      showFallbackToast('Extension update rejected', 'An invalid content update was rejected before it could change this page.', {
        code: 'content_message_rejected',
        severity: 'error',
        source: 'extension.content',
        operation: 'validate-inbound-message',
        correlationId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        detail: `type=${String(msg.type)}`,
      });
    }
    return;
  }
  if (msg.type === 'WORDS_UPDATED') {
    savedWordsSet = new Set();
    void refreshCaptionSavedWords();
  } else if (msg.type === 'TARGET_LANGUAGE_UPDATED') {
    targetLanguage = msg.targetLanguage ? msg.targetLanguage.toLowerCase() : null;
  } else if (msg.type === 'DAILY_GOAL_UPDATED' && msg.snapshot) {
    applyDailyGoalSnapshot({ ...msg.snapshot, bonusXpEarned: msg.bonusXpEarned || 0 }, {
      celebrate: !!msg.justAdded,
      completed: !!msg.justCompleted,
    });
  } else if (msg.type === 'POLYCAST_FALLBACK_NOTICE') {
    const diagnostic = msg.diagnostic || msg;
    showFallbackToast(
      diagnostic.title || 'Fallback used',
      diagnostic.message || 'A local fallback was used.',
      diagnostic,
    );
  }
});

function languageName(code) {
  if (!code) return uiLocale === 'es' ? 'Detectando idioma' : 'Detecting language';
  try {
    return new Intl.DisplayNames([uiLocale], { type: 'language' }).of(code) || code.toUpperCase();
  } catch (error) {
    showFallbackToast('Language name fallback used', 'The browser could not localize this language code, so Polycast is showing the raw code.', {
      code: 'language_display_name_fallback',
      source: 'extension.content',
      operation: 'format-language-name',
      detail: error?.message || String(error),
    });
    return code.toUpperCase();
  }
}

function localizedPopupLabels() {
  if (uiLocale !== 'es') return {};
  return {
    playPronunciation: 'Reproducir pronunciación', close: 'Cerrar',
    addToDictionary: '+ Agregar al diccionario', addPhrase: '+ Agregar frase',
    explainInContext: 'Explicar en contexto', added: 'Agregada',
    inDictionary: 'En tu diccionario', removing: 'Quitando...',
    removeConfirm: (target) => `¿Quitar ${target} del diccionario?`,
    word: 'Palabra', phrase: 'Frase', inContext: 'En contexto',
    notInDictionary: 'No está en el diccionario',
    invalidWord: (target, language) => `«${target}» no es una palabra en ${language}`,
    definition: 'Definición', noDefinition: 'No se encontró una definición',
    contextUnavailable: 'La explicación contextual no está disponible',
    savesAs: 'Se guarda como', partOfSpeech: 'Categoría gramatical',
    newDefinition: '¡Nueva definición!',
  };
}

function goalMarkup(snapshot) {
  const goal = Math.max(1, Number(snapshot.goal) || 5);
  const added = Math.max(0, Number(snapshot.added) || 0);
  const stepCount = Math.min(goal, 10);
  const filledSteps = Math.round((Math.min(added, goal) / goal) * stepCount);
  const steps = Array.from({ length: stepCount }, (_, index) =>
    `<i class="${index < filledSteps ? 'pc-popup-goal-step--filled' : ''}"></i>`).join('');
  const label = snapshot.complete
    ? (uiLocale === 'es' ? 'Meta completada · límite de XP' : 'Goal complete · XP capped')
    : (uiLocale === 'es' ? `${snapshot.remaining} más hoy` : `${snapshot.remaining} more today`);
  const flameSvg = globalThis.PolycastWordPopup?.FLAME_SVG || '';
  return `<span class="pc-popup-goal-flame" aria-label="${added} of ${goal} daily words">${flameSvg}</span>` +
    `<div class="pc-popup-goal-steps">${steps}</div>` +
    `<strong>${added} of ${goal}</strong><span class="pc-popup-goal-divider"></span><span>${label}</span>`;
}

function goalFlameRatio(snapshot) {
  const goal = Math.max(1, Number(snapshot.goal) || 5);
  const added = Math.max(0, Number(snapshot.added) || 0);
  return Math.min(1, added / goal);
}

function updateActivePopupGoal(animate = false) {
  const goal = activePopup?.el?.querySelector('.pc-popup-goal');
  if (!goal) return;
  goal.innerHTML = goalMarkup(dailyGoalSnapshot);
  goal.classList.toggle('pc-popup-goal--complete', dailyGoalSnapshot.complete);
  globalThis.PolycastWordPopup?.setFlameLevel(
    goal.querySelector('.pc-popup-goal-flame'),
    goalFlameRatio(dailyGoalSnapshot),
    { burst: animate },
  );
}

function applyDailyGoalSnapshot(snapshot, { celebrate = false, completed = false } = {}) {
  if (!snapshot) return;
  const advanced = Number(snapshot.added) > Number(dailyGoalSnapshot.added);
  dailyGoalSnapshot = snapshot;
  updateActivePopupGoal(celebrate && advanced);
  if (celebrate && advanced) showGoalCelebration(snapshot, completed || !!snapshot.justCompleted);
}

function showGoalCelebration(snapshot, completed) {
  document.querySelector('.pc-goal-celebration')?.remove();
  const toast = document.createElement('div');
  const bonusXpEarned = Number(snapshot.bonusXpEarned) || 0;
  const flame = completed;
  toast.className = `pc-goal-celebration${completed ? ' pc-goal-celebration--complete' : ''}`;
  toast.setAttribute('role', 'status');
  const icon = flame
    ? '<b class="pc-celebration-flame" aria-hidden="true"><i></i><i></i></b>'
    : '<b aria-hidden="true">✓</b>';
  const title = completed ? 'Daily goal complete!' : (bonusXpEarned ? `+${bonusXpEarned} XP` : 'Word saved');
  const detail = completed
    ? `${snapshot.added} words added today · word-save XP capped`
    : `${snapshot.remaining} more to reach today's goal`;
  toast.innerHTML = `${icon}<div><strong>${title}</strong><span>${detail}</span></div>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), flame ? 3200 : 2200);
  if (completed) showConfetti();
}

// Full-screen confetti rain for the moment the daily goal is reached.
function showConfetti() {
  document.querySelector('.pc-confetti')?.remove();
  const container = document.createElement('div');
  container.className = 'pc-confetti';
  container.setAttribute('aria-hidden', 'true');
  const colors = ['#f472b6', '#a78bfa', '#2dd4bf', '#fbbf24', '#60a5fa', '#fb7185', '#a3e635'];
  const pieces = 36;
  let html = '';
  for (let i = 0; i < pieces; i += 1) {
    const left = Math.random() * 100;
    const delay = Math.random() * 0.5;
    const duration = 1.6 + Math.random() * 1.2;
    const size = 6 + Math.random() * 6;
    const color = colors[i % colors.length];
    const spin = Math.random() > 0.5 ? 1 : -1;
    html += `<i style="left:${left.toFixed(1)}vw;background:${color};width:${size.toFixed(0)}px;height:${(size * 0.45).toFixed(0)}px;` +
      `animation-delay:${delay.toFixed(2)}s;animation-duration:${duration.toFixed(2)}s;--pc-spin:${spin};"></i>`;
  }
  container.innerHTML = html;
  document.body.appendChild(container);
  setTimeout(() => container.remove(), 3400);
}

// ---- Tokenization ---------------------------------------------------------
const { tokenize, isWordToken } = globalThis.PolycastTextTokens;

// ---- Escape HTML ----------------------------------------------------------

// ---- Caption cleaning -----------------------------------------------------
// Strip YouTube's bracketed annotation cues ([Music], [música], [risadas],
// [Applause], …) so they aren't shown. A bracket is only stripped when it
// contains a letter or number; the profanity-censor marker "[ __ ]" (brackets
// around underscores) is kept so swears stay visible.
function cleanCaptionText(text) {
  return (text || '')
    .replace(/\[[^\]]*[\p{L}\p{N}][^\]]*\]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- Tokenize a subtitle element ------------------------------------------

function tokenizeElement(container) {
  const rawText = container.textContent;
  if (!rawText || !rawText.trim()) return;

  // Recovery guard: if cursor is no longer over this container but hover-pause is stuck, resume.
  if (pcPausedByHover && !activePopup && !container.matches(':hover')) {
    resumeIfWePaused();
  }

  // Skip if already tokenized with the same text
  if (container.dataset.pcTokenized === rawText) return;
  container.dataset.pcTokenized = rawText;

  const text = cleanCaptionText(rawText);
  // A cue that is entirely an annotation ([música], [Applause], …) becomes
  // empty after cleaning — hide it instead of rendering empty brackets.
  if (!text) { container.textContent = ''; return; }
  pushCaptionContext(text);

  // Attach container-level hover listeners once — survives subtitle text changes
  if (!container.dataset.pcHoverListened) {
    container.dataset.pcHoverListened = 'true';
    container.addEventListener('mouseenter', () => {
      pauseForHover();
    });
    container.addEventListener('mouseleave', () => {
      if (pcPausedByHover && !activePopup) {
        resumeIfWePaused();
      }
    });
  }

  const tokens = tokenize(text);
  const frag = document.createDocumentFragment();

  for (const token of tokens) {
    if (isWordToken(token)) {
      const span = document.createElement('span');
      span.className = 'pc-word';
      span.textContent = token;
      if (savedWordsSet.has(token.toLowerCase())) {
        span.classList.add('pc-saved');
      }
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        handleWordClick(token, text, span);
      });
      frag.appendChild(span);
    } else {
      frag.appendChild(document.createTextNode(token));
    }
  }

  container.textContent = '';
  container.appendChild(frag);
  void refreshCaptionSavedWords(container);
}

// ---- Popup UI -------------------------------------------------------------

let activePopup = null;
let pcPausedByHover = false;
let pcHoverPauseVideo = null;
let pcHoverPauseKeepAlive = null;

function keepHoverPaused() {
  if (!pcPausedByHover || !pcHoverPauseVideo) return;
  if (!pcHoverPauseVideo.paused) {
    pcHoverPauseVideo.pause();
  }
}

function pauseForHover() {
  const video = document.querySelector('video');
  if (!video || video.paused) return;

  pcHoverPauseVideo = video;
  pcPausedByHover = true;
  video.pause();

  if (!pcHoverPauseKeepAlive) {
    pcHoverPauseKeepAlive = window.setInterval(keepHoverPaused, 250);
  }
}

function resumeIfWePaused() {
  if (pcPausedByHover) {
    if (pcHoverPauseKeepAlive) {
      window.clearInterval(pcHoverPauseKeepAlive);
      pcHoverPauseKeepAlive = null;
    }
    const video = pcHoverPauseVideo || document.querySelector('video');
    if (video) {
      video.play().catch((err) => showFallbackToast(
        'Video resume fallback used',
        'The browser blocked automatic resume; press play to continue.',
        {
          code: 'video_resume_blocked',
          source: 'extension.content',
          operation: 'resume-video-after-lookup',
          correlationId: crypto.randomUUID(),
          detail: err?.message || 'play() was rejected',
        },
      ));
    }
    pcHoverPauseVideo = null;
    pcPausedByHover = false;
  }
}

function removePopup() {
  if (activePopup) {
    activePopup.destroy();
    activePopup = null;
  }
}

// Close popup on click outside
document.addEventListener('click', (e) => {
  if (activePopup && !activePopup.el.contains(e.target) && !e.target.closest('.pc-word')) {
    removePopup();
    resumeIfWePaused();
  }
});

// Close popup on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    removePopup();
    resumeIfWePaused();
  }
});

// Promise wrapper around chrome.runtime.sendMessage with an MV3-aware timeout
// (the service worker can die), surfacing errors as rejections the shared
// popup core can render.
function sendMessageAsync(message, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Lookup timed out — try again'));
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage(message, (res) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          reject(new Error('Extension reloaded — refresh this page'));
        } else if (!res) {
          reject(new Error('No response — try refreshing the page'));
        } else if (res.error) {
          reject(new Error(res.error));
        } else {
          resolve(res);
        }
      });
    } catch {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('Extension reloaded — refresh this page'));
    }
  });
}

// When a tapped word turns out to be an inflection of an already-saved word
// that we weren't highlighting (its form was missing from the saved word's
// list), persist that form so it — and this exact surface form — highlight
// from now on, both here and on every future page load.
function selfHealHighlight(word, res) {
  if (!res || !res.is_existing || !res.saved_word_id) return;
  const lower = word.toLowerCase();
  if (savedWordsSet.has(lower)) return;

  savedWordsSet.add(lower);
  document.querySelectorAll('.pc-word').forEach((el) => {
    if (el.textContent.toLowerCase() === lower) el.classList.add('pc-saved');
  });
  sendMessageAsync({ type: 'ADD_WORD_FORM', savedWordId: res.saved_word_id, form: word })
    .then((result) => {
      if (result?.warning) {
        showFallbackToast('Local form fallback', 'This form is highlighted locally, but server persistence failed.');
      }
    })
    .catch((err) => showFallbackToast(
      'Local form fallback',
      'This form is highlighted locally, but server persistence failed.',
      {
        code: 'word_form_persistence_failed',
        severity: 'warning',
        source: 'extension.content',
        operation: 'persist-word-form',
        correlationId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        detail: err?.message || String(err),
      },
    ));
}

function openWordPopup({
  word,
  sentence,
  anchorRect,
  context,
  initialLookupResult = null,
  autoExplain = false,
  onClosed,
}) {
  removePopup();

  const lower = word.toLowerCase();
  const explanationContext = (context && context.trim()) || captionContext();
  if (initialLookupResult) selfHealHighlight(word, initialLookupResult);

  activePopup = PolycastWordPopup.createWordPopup({
    word,
    sentence,
    anchorRect,
    container: document.body,
    initialSavedHint: savedWordsSet.has(lower),
    initialLookupResult,
    autoExplain,
    languageName: targetLanguage ? languageName(targetLanguage) : null,
    labels: localizedPopupLabels(),
    onClose: () => {
      removePopup();
      resumeIfWePaused();
      if (onClosed) onClosed();
    },
    handlers: {
      lookup: async ({ word, sentence }) => {
        const res = await sendMessageAsync({ type: 'LOOKUP_WORD', word, sentence });
        selfHealHighlight(word, res);
        return res;
      },
      explain: ({ word, sentence }) => sendMessageAsync({ type: 'EXPLAIN_WORD', word, sentence, context: explanationContext }),
      save: async ({ word, sentence, lookupResult }) => {
        // Save as the base form (lemma) when the lookup resolved one.
        const lemma = lookupResult && lookupResult.lemma ? lookupResult.lemma : null;
        const savedForm = (lemma || word).toLowerCase();
        // Optimistically mark the clicked form and the base form on the page immediately
        savedWordsSet.add(word.toLowerCase());
        savedWordsSet.add(savedForm);
        document.querySelectorAll('.pc-word').forEach((el) => {
          const t = el.textContent.toLowerCase();
          if (t === word.toLowerCase() || t === savedForm) {
            el.classList.add('pc-saved');
          }
        });
        const previousGoal = dailyGoalSnapshot;
        const optimisticAdded = previousGoal.added + 1;
        const optimisticGoal = {
          ...previousGoal,
          added: optimisticAdded,
          remaining: Math.max(0, previousGoal.goal - optimisticAdded),
          complete: optimisticAdded >= previousGoal.goal,
          overGoal: 0,
          bonusXp: 0,
          bonusXpEarned: optimisticAdded <= previousGoal.goal ? BONUS_XP_PER_WORD : 0,
        };
        applyDailyGoalSnapshot(optimisticGoal, {
          celebrate: true,
          completed: !previousGoal.complete && optimisticGoal.complete,
        });

        try {
          const result = await sendMessageAsync({
            type: 'SAVE_WORD',
            word,
            sentence,
            lemma,
            targetWord: lookupResult?.target_word || null,
            definition: lookupResult?.definition || lookupResult?.matched_gloss || null,
            part_of_speech: lookupResult?.part_of_speech || null,
            definition_source: lookupResult?.definition_source || null,
            matched_gloss: lookupResult?.matched_gloss || null,
            senseIndex: lookupResult?.sense_index ?? null,
          }, { timeoutMs: 90000 });
          applyDailyGoalSnapshot(result?.dailyGoal);
          return result;
        } catch (err) {
          applyDailyGoalSnapshot(previousGoal);
          throw err;
        }
      },
      remove: async ({ word, lookupResult }) => {
        await sendMessageAsync({
          type: 'REMOVE_WORD',
          word,
          savedWordId: lookupResult && lookupResult.saved_word_id,
        });
      },
      // Sense-level: server reports is_existing for this exact sense; otherwise
      // a word we already have some sense of is a "new definition".
      resolveSavedState: (res) =>
        res.is_existing ? 'saved' : (savedWordsSet.has(lower) ? 'new-sense' : 'unsaved'),
    },
  });

  const languageChip = document.createElement('span');
  languageChip.className = 'pc-popup-language';
  languageChip.textContent = languageName(targetLanguage);
  activePopup.el.querySelector('.pc-popup-word')?.after(languageChip);

  const goal = document.createElement('div');
  goal.className = `pc-popup-goal${dailyGoalSnapshot.complete ? ' pc-popup-goal--complete' : ''}`;
  goal.innerHTML = goalMarkup(dailyGoalSnapshot);
  activePopup.el.querySelector('.pc-popup-header')?.after(goal);
  globalThis.PolycastWordPopup?.setFlameLevel(goal.querySelector('.pc-popup-goal-flame'), goalFlameRatio(dailyGoalSnapshot));
}

function handleWordClick(word, sentence, anchorEl) {
  openWordPopup({
    word,
    sentence,
    anchorRect: anchorEl.getBoundingClientRect(),
  });
}

globalThis.PolycastContent = {
  ...(globalThis.PolycastContent || {}),
  cleanCaptionText,
  isWordToken,
  openWordPopup,
  rememberSavedTokens: (tokens) => {
    for (const token of tokens || []) {
      const normalized = String(token || '').trim().toLocaleLowerCase();
      if (normalized) savedWordsSet.add(normalized);
    }
  },
  setTargetLanguage: (value) => {
    targetLanguage = value ? String(value).toLocaleLowerCase() : null;
  },
  sendMessageAsync,
};
