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
const BONUS_XP_PER_WORD = 10;
let dailyGoalSnapshot = { goal: 5, added: 0, remaining: 5, complete: false, overGoal: 0, bonusXp: 0 };

(async function initTargetLanguage() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_TARGET_LANGUAGE' });
    if (res && res.targetLanguage) {
      targetLanguage = res.targetLanguage.toLowerCase();
    }
  } catch {
    // Extension context invalidated — will work after page refresh
  }
})();

(async function initDailyGoal() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_DAILY_GOAL' });
    if (res?.snapshot) dailyGoalSnapshot = res.snapshot;
  } catch {
    // Extension context invalidated — will work after page refresh
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

function showFallbackToast(title, message) {
  const existing = document.querySelector('.pc-fallback-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'pc-fallback-toast';
  toast.setAttribute('role', 'status');
  toast.innerHTML = `<strong>${title}</strong><span>${message}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 7000);
}

chrome.runtime.onMessage.addListener((msg) => {
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
    showFallbackToast(msg.title || 'Fallback used', msg.message || 'A local fallback was used.');
  }
});

function languageName(code) {
  if (!code) return 'Detecting language';
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

function goalMarkup(snapshot) {
  const goal = Math.max(1, Number(snapshot.goal) || 5);
  const added = Math.max(0, Number(snapshot.added) || 0);
  const stepCount = Math.min(goal, 10);
  const filledSteps = Math.round((Math.min(added, goal) / goal) * stepCount);
  const steps = Array.from({ length: stepCount }, (_, index) =>
    `<i class="${index < filledSteps ? 'pc-popup-goal-step--filled' : ''}"></i>`).join('');
  const label = snapshot.complete
    ? 'Goal complete · XP capped'
    : `${snapshot.remaining} more today`;
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

function tokenize(text) {
  return text.match(/([\p{L}\p{M}\d']+|[.,!?;:]+|\s+)/gu) || [];
}

function isWordToken(token) {
  return /^[\p{L}\p{M}\d']+$/u.test(token);
}

// ---- Escape HTML ----------------------------------------------------------

// UNUSED since the popup moved to shared/wordPopupCore.js (which has its own
// escapeHtml). FLAGGED FOR DELETION in a future audit.
// function escapeHtml(str) {
//   const div = document.createElement('div');
//   div.textContent = str;
//   return div.innerHTML;
// }

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
      video.play().catch(() => {});
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
    .catch((err) => console.debug('[Polycast] could not persist form:', err.message));
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
        // Recolor plain page text right away too (not just caption spans).
        globalThis.PolycastContent?.addPageHighlights?.([word.toLowerCase(), savedForm]);
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

function openRecallWordPopup({ challenge, word, sentence, anchorRect }) {
  removePopup();
  const popup = document.createElement('div');
  popup.className = 'pc-popup pc-popup-recall-mode';
  popup.style.position = 'fixed';
  popup.style.zIndex = '2147483647';

  const header = document.createElement('div');
  header.className = 'pc-popup-header';
  const wordEl = document.createElement('span');
  wordEl.className = 'pc-popup-word';
  wordEl.textContent = word;
  const languageChip = document.createElement('span');
  languageChip.className = 'pc-popup-language';
  languageChip.textContent = languageName(targetLanguage);
  const close = document.createElement('button');
  close.className = 'pc-popup-close';
  close.title = 'Close';
  close.textContent = '×';
  const actions = document.createElement('div');
  actions.className = 'pc-popup-header-actions';
  actions.append(close);
  header.append(wordEl, languageChip, actions);

  const goal = document.createElement('div');
  goal.className = `pc-popup-goal${dailyGoalSnapshot.complete ? ' pc-popup-goal--complete' : ''}`;
  goal.innerHTML = goalMarkup(dailyGoalSnapshot);

  const body = document.createElement('div');
  body.className = 'pc-popup-body pc-popup-recall-body';
  const prompt = document.createElement('strong');
  prompt.textContent = `What does ${word} mean?`;
  const options = document.createElement('div');
  options.className = 'pc-popup-recall-options';
  const feedback = document.createElement('div');
  feedback.className = 'pc-popup-recall-feedback';
  feedback.setAttribute('aria-live', 'polite');
  body.append(prompt, options, feedback);
  popup.append(header, goal, body);
  document.body.append(popup);
  const clickPromise = sendMessageAsync({ type: 'CLICK_WILD_RECALL', challengeId: challenge.id })
    .then((result) => {
      if (result?.capped) {
        feedback.textContent = 'Three recall words completed today.';
        options.querySelectorAll('button').forEach((item) => { item.disabled = true; });
      }
      return result;
    })
    .catch((err) => {
      feedback.textContent = `Wild Recall fallback used: ${err.message}`;
      options.querySelectorAll('button').forEach((item) => { item.disabled = true; });
      return { capped: true };
    });

  function position() {
    const width = popup.offsetWidth || 320;
    const height = popup.offsetHeight || 260;
    const left = Math.max(8, Math.min(anchorRect.left + anchorRect.width / 2 - width / 2, window.innerWidth - width - 8));
    const below = anchorRect.bottom + 8;
    const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, anchorRect.top - height - 8);
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }
  position();
  const resizeObserver = new ResizeObserver(position);
  resizeObserver.observe(popup);
  const destroy = () => {
    resizeObserver.disconnect();
    window.removeEventListener('resize', position);
    popup.remove();
  };
  activePopup = { el: popup, destroy };
  close.addEventListener('click', (event) => { event.stopPropagation(); removePopup(); });
  window.addEventListener('resize', position);

  for (const option of challenge.options || []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = option.text;
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const clickResult = await clickPromise;
      if (clickResult?.capped) return;
      options.querySelectorAll('button').forEach((item) => { item.disabled = true; });
      feedback.textContent = 'Checking...';
      try {
        const result = await sendMessageAsync({
          type: 'ANSWER_WILD_RECALL', challengeId: challenge.id, optionId: option.id,
        });
        if (result?.capped) {
          feedback.textContent = 'Three recall words completed today.';
        } else if (result?.correct) {
          feedback.textContent = result.awardedXp ? `Correct · +${result.awardedXp} XP` : 'Correct';
          popup.classList.add('pc-popup-recall-mode--correct');
        } else {
          feedback.textContent = `Answer: ${result?.correctAnswer || ''}`;
          popup.classList.add('pc-popup-recall-mode--incorrect');
        }
      } catch (err) {
        feedback.textContent = `Wild Recall fallback used: ${err.message}`;
      }
      window.setTimeout(() => {
        if (activePopup?.el !== popup) return;
        removePopup();
        openWordPopup({ word, sentence, anchorRect });
      }, 1200);
    });
    options.append(button);
  }
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
  openRecallWordPopup,
  sendMessageAsync,
};
