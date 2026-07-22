// ---------------------------------------------------------------------------
// shared/wordPopupCore.js -- Framework-agnostic word-lookup popup.
//
// Single source of truth for the popup shown when a learner clicks a word,
// used by BOTH the browser extension (loaded as a content script) and the web
// app (imported by a thin React wrapper). It renders DOM and wires the buttons
// only; all I/O (lookup / explain / save) is INJECTED via `handlers`, so each
// environment supplies its own transport (chrome.runtime messages vs the web
// `/api` client).
//
// Plain script — no imports/exports, no chrome.*, no fetch, no framework.
// Exposes globalThis.PolycastWordPopup = { createWordPopup }.
// ---------------------------------------------------------------------------

(function () {
  const POPUP_WIDTH = 300;

  function logPopupDiagnostic(code, operation, message, error) {
    console.info('[polycast:diagnostic]', {
      code,
      severity: 'error',
      title: 'Word popup operation failed',
      message,
      source: 'shared.word-popup',
      operation,
      pipeline: operation,
      stage: 'failed',
      selectedAction: 'show-visible-popup-error',
      correlationId: globalThis.crypto?.randomUUID?.() || `popup-${Date.now()}`,
      occurredAt: new Date().toISOString(),
      detail: error?.message || String(error || 'unknown error'),
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function fallbackPill(label, title) {
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `<span class="pc-popup-source-pill"${titleAttr}>${escapeHtml(label)}</span>`;
  }

  function fallbackNoticePills(result) {
    const pills = [];
    const seen = new Set();
    const addPill = (label, title) => {
      const key = `${label}\n${title || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      pills.push(fallbackPill(label, title));
    };
    const notices = Array.isArray(result?.fallback_notices) ? result.fallback_notices : [];
    const hasGeminiNotice = notices.some((notice) => /gemini/i.test(notice?.title || ''));
    const hasOfflineNotice = notices.some((notice) => /offline/i.test(notice?.title || ''));
    if (result && result.definition_source === 'gemini') {
      if (!hasGeminiNotice) {
        addPill('Gemini fallback', 'Gemini supplied the definition because the dictionary path could not.');
      }
    } else if (result && result.definition_source === 'offline') {
      if (!hasOfflineNotice) {
        addPill('Offline fallback', 'This result came from local offline data.');
      }
    }
    for (const notice of notices) {
      const label = notice?.title || 'Fallback used';
      const detail = [notice?.message, notice?.detail].filter(Boolean).join(' ');
      addPill(label, detail);
    }
    if (result?.offline) {
      addPill('Offline fallback', result.warning || 'Saved locally because the online path was unavailable.');
    } else if (result?.warning) {
      addPill('Fallback warning', result.warning);
    }
    return pills.join('');
  }

  function fallbackNoticeDetails(result) {
    const notices = Array.isArray(result?.fallback_notices) ? [...result.fallback_notices] : [];
    if (result?.definition_source === 'gemini' && !notices.some((notice) => /gemini/i.test(notice?.title || ''))) {
      notices.push({ title: 'Gemini fallback', message: 'Gemini supplied the definition because the dictionary path could not.' });
    }
    if (result?.definition_source === 'offline' && !notices.some((notice) => /offline/i.test(notice?.title || ''))) {
      notices.push({ title: 'Offline fallback', message: 'This result came from local offline data.' });
    }
    if (result?.offline && !notices.some((notice) => /offline/i.test(notice?.title || ''))) {
      notices.push({ title: 'Offline fallback', message: result.warning || 'The online path was unavailable.' });
    } else if (result?.warning) {
      notices.push({ title: 'Fallback warning', message: result.warning });
    }
    if (!notices.length) return '';
    return `<div class="pc-popup-fallback-details" role="status">${notices.map((notice) => {
      const detail = [notice?.message, notice?.detail].filter(Boolean).join(' ') || 'No additional detail was provided.';
      return `<div><strong>${escapeHtml(notice?.title || 'Fallback used')}</strong><span>${escapeHtml(detail)}</span></div>`;
    }).join('')}</div>`;
  }

  function renderTildeMarkup(container, text, highlightClass) {
    container.textContent = '';
    const parts = String(text || '').split(/~([^~]+)~/g);
    parts.forEach((part, i) => {
      if (!part) return;
      const node = document.createElement(i % 2 === 1 ? 'span' : 'span');
      node.textContent = part;
      if (i % 2 === 1) node.className = highlightClass;
      container.appendChild(node);
    });
  }

  /**
   * createWordPopup(opts) -> { el, destroy }
   *
   * opts:
   *   word        - the clicked word (string)
   *   sentence    - the surrounding sentence/context (string)
   *   anchorRect  - DOMRect of the clicked word (for positioning)
   *   container   - element to append into (defaults to document.body)
   *   onClose     - called when the user clicks the popup's close (X) button
   *   initialSavedHint - optional bool: show the saved state before lookup resolves
   *   initialLookupResult - optional lookup result; skips handlers.lookup when provided
   *   autoExplain - optional bool: fetch and show the contextual explanation immediately
   *   handlers:
   *     lookup({ word, sentence })  -> Promise<{ valid, translation, definition, part_of_speech, ... }>
   *     explain({ word, sentence }) -> Promise<{ explanation }>
   *     save({ word, sentence, lookupResult }) -> Promise<void>   (optimistic; may be omitted)
   *     remove({ word, sentence, lookupResult }) -> Promise<void> (may be omitted)
   *     resolveSavedState(lookupResult) -> 'saved' | 'new-sense' | 'unsaved'
   */
  function createWordPopup(opts) {
    const {
      word,
      sentence,
      anchorRect,
      container = document.body,
      onClose,
      initialSavedHint = false,
      initialLookupResult = null,
      autoExplain = false,
      nativeMode = false,
      // Display name of the learner's target language (e.g. "Spanish"), used
      // to word the invalid-lookup message.
      languageName = null,
      labels: labelOverrides = {},
      handlers = {},
    } = opts;

    const labels = {
      playPronunciation: 'Play pronunciation', close: 'Close',
      addToDictionary: '+ Add to dictionary', addPhrase: '+ Add phrase',
      explainInContext: 'Explain in context', added: 'Added',
      inDictionary: 'In your dictionary', removing: 'Removing...',
      removeConfirm: (target) => `Remove ${target} from dictionary?`,
      word: 'Word', phrase: 'Phrase', inContext: 'In context',
      notInDictionary: 'Not in dictionary', invalidWord: (target, language) => `"${target}" isn't a ${language} word`,
      definition: 'Definition', noDefinition: 'No definition found',
      contextUnavailable: 'Context explanation unavailable', savesAs: 'Saves as',
      partOfSpeech: 'Part of speech', newDefinition: 'New definition!',
      ...labelOverrides,
    };

    let destroyed = false;

    const popup = document.createElement('div');
    popup.className = 'pc-popup';
    popup.style.position = 'fixed';
    popup.style.zIndex = '2147483647';
    const SPEAKER_SVG =
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M11 5 6 9H2v6h4l5 4z"/>' +
      '<path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
    const EXPLAIN_SVG =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

    popup.innerHTML = `
      <div class="pc-popup-header">
        <span class="pc-popup-word">${escapeHtml(word)}</span>
        <div class="pc-popup-header-actions">
          <button class="pc-popup-speak" title="${escapeHtml(labels.playPronunciation)}" aria-label="${escapeHtml(labels.playPronunciation)}" hidden>${SPEAKER_SVG}</button>
          <button class="pc-popup-close" title="${escapeHtml(labels.close)}">&times;</button>
        </div>
      </div>
      <div class="pc-popup-lemma" hidden></div>
      <div class="pc-popup-body"><div class="pc-spinner"></div></div>
      <button class="pc-popup-save" hidden>${escapeHtml(labels.addToDictionary)}</button>
      <button class="pc-popup-explain" hidden>${EXPLAIN_SVG}${escapeHtml(labels.explainInContext)}</button>
      <div class="pc-popup-explanation" hidden></div>
    `;

    container.appendChild(popup);

    const bodyEl = popup.querySelector('.pc-popup-body');
    const explainBtn = popup.querySelector('.pc-popup-explain');
    const explainBox = popup.querySelector('.pc-popup-explanation');
    const saveBtn = popup.querySelector('.pc-popup-save');

    // -- Positioning ---------------------------------------------------------
    // Choose the side with the most room once and keep the edge nearest the
    // clicked word anchored there. The old implementation reconsidered the
    // side after every async resize, so a small loading shell could start below
    // a word and jump above it when the definition arrived.
    const availableAbove = Math.max(0, anchorRect.top - 16);
    const availableBelow = Math.max(0, window.innerHeight - anchorRect.bottom - 16);
    const placement = availableAbove >= availableBelow ? 'above' : 'below';
    popup.dataset.placement = placement;
    position();
    function position() {
      const width = popup.offsetWidth || POPUP_WIDTH;
      let left = anchorRect.left + anchorRect.width / 2 - width / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      popup.style.left = `${left}px`;

      if (placement === 'above') {
        popup.style.top = '';
        popup.style.bottom = `${Math.max(8, window.innerHeight - anchorRect.top + 8)}px`;
        popup.style.setProperty('--pc-popup-available-height', `${Math.max(120, availableAbove)}px`);
        popup.style.maxHeight = `var(--pc-popup-available-height)`;
      } else {
        popup.style.top = `${Math.max(8, anchorRect.bottom + 8)}px`;
        popup.style.bottom = '';
        popup.style.setProperty('--pc-popup-available-height', `${Math.max(120, availableBelow)}px`);
        popup.style.maxHeight = `var(--pc-popup-available-height)`;
      }
    }

    const resizeObserver = new ResizeObserver(position);
    resizeObserver.observe(popup);
    window.addEventListener('resize', position);

    // -- Close (X) -----------------------------------------------------------
    popup.querySelector('.pc-popup-close').addEventListener('click', (e) => {
      e.stopPropagation();
      if (onClose) onClose();
    });

    // -- Pronounce (speaker) -------------------------------------------------
    const speakBtn = popup.querySelector('.pc-popup-speak');
    if (handlers.speak) {
      speakBtn.hidden = false;
      speakBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        speakBtn.classList.add('pc-popup-speak--playing');
        Promise.resolve(handlers.speak({ word, sentence }))
          .catch((err) => {
            logPopupDiagnostic('word_popup_speech_failed', 'speak-word', 'The selected word could not be spoken.', err);
            if (!destroyed) {
              bodyEl.querySelector('.pc-popup-speech-error')?.remove();
              bodyEl.insertAdjacentHTML('beforeend', `<div class="pc-popup-error pc-popup-speech-error">${escapeHtml(err?.message || 'Speech failed')}</div>`);
              position();
            }
          })
          .finally(() => { if (!destroyed) speakBtn.classList.remove('pc-popup-speak--playing'); });
      });
    }

    // -- Save button state machine ------------------------------------------
    let saveState = 'unsaved'; // 'unsaved' | 'new-sense' | 'saved' | 'done' | 'removing'
    let lastLookup = null;
    // 'word' = add the single clicked word; 'phrase' = add the detected phrase.
    let mode = 'word';
    // What the Add button will save — reassigned when the lookup resolves and
    // when the user toggles between word and phrase.
    let getSaveTarget = () => ({ word, sentence, lookupResult: lastLookup });
    let autoExplanationState = autoExplain && handlers.explain ? 'loading' : 'idle';
    let autoExplanation = '';

    function renderSaveButton() {
      if (!handlers.save) { saveBtn.hidden = true; return; }
      saveBtn.hidden = false;
      if (saveState === 'done') {
        saveBtn.disabled = true;
        saveBtn.classList.add('pc-popup-save--saved');
        saveBtn.innerHTML = `&#10003; ${escapeHtml(labels.added)}`;
      } else if (saveState === 'saved') {
        saveBtn.disabled = !handlers.remove;
        saveBtn.classList.add('pc-popup-save--saved');
        saveBtn.innerHTML = `&#10003; ${escapeHtml(labels.inDictionary)}`;
      } else if (saveState === 'removing') {
        saveBtn.disabled = true;
        saveBtn.classList.add('pc-popup-save--saved');
        saveBtn.textContent = labels.removing;
      } else {
        saveBtn.disabled = false;
        saveBtn.classList.remove('pc-popup-save--saved');
        saveBtn.textContent = mode === 'phrase' ? labels.addPhrase : labels.addToDictionary;
      }
    }

    if (initialSavedHint) saveState = 'saved';

    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (saveState === 'saved') {
        if (!handlers.remove || !lastLookup) return;
        const target = (mode === 'phrase' && lastLookup.phrase)
          ? lastLookup.phrase
          : (lastLookup.lemma || lastLookup.target_word || word);
        if (!window.confirm(labels.removeConfirm(target))) return;
        saveState = 'removing';
        renderSaveButton();
        Promise.resolve(handlers.remove(getSaveTarget()))
          .then(() => {
            if (destroyed) return;
            saveState = 'unsaved';
            if (lastLookup) {
              lastLookup.is_existing = false;
              lastLookup.saved_word_id = null;
            }
            renderSaveButton();
          })
          .catch((err) => {
            logPopupDiagnostic('word_popup_remove_failed', 'remove-word', 'The word could not be removed from the dictionary.', err);
            if (!destroyed) {
              saveState = 'saved';
              renderSaveButton();
              bodyEl.insertAdjacentHTML('beforeend', `<div class="pc-popup-error pc-popup-save-error">${escapeHtml(err?.message || 'Remove failed')}</div>`);
              position();
            }
          });
        return;
      }
      if (saveState === 'done' || saveState === 'removing') return;
      saveState = 'done';
      renderSaveButton();
      if (handlers.save) {
        Promise.resolve(handlers.save(getSaveTarget()))
          .then((res) => {
            if (destroyed) return;
            const details = fallbackNoticeDetails(res);
            if (!details) return;
            bodyEl.insertAdjacentHTML('beforeend', details);
            position();
          })
          .catch((err) => {
            if (destroyed) return;
            saveState = 'unsaved';
            renderSaveButton();
            bodyEl.querySelector('.pc-popup-save-error')?.remove();
            bodyEl.insertAdjacentHTML(
              'beforeend',
              `<div class="pc-popup-error pc-popup-save-error">${escapeHtml(err?.message || 'Save failed. Try again.')}</div>`,
            );
            position();
            logPopupDiagnostic('word_popup_save_failed', 'save-word', 'The word could not be saved to the dictionary.', err);
          });
      }
    });

    // -- Explain button ------------------------------------------------------
    explainBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!handlers.explain) return;
      explainBtn.disabled = true;
      explainBox.hidden = false;
      explainBox.innerHTML = '<div class="pc-spinner"></div>';
      Promise.resolve(handlers.explain({ word, sentence }))
        .then((res) => {
          if (destroyed) return;
          renderTildeMarkup(
            explainBox,
            (res && res.explanation) || 'No explanation available',
            'pc-popup-explanation-highlight',
          );
        })
        .catch((err) => {
          if (destroyed) return;
          logPopupDiagnostic('word_popup_explain_failed', 'explain-word', 'The word explanation could not be loaded.', err);
          explainBox.innerHTML = `<div class="pc-popup-error">${escapeHtml(err && err.message || 'Explain failed')}</div>`;
          explainBtn.disabled = false;
        });
    });

    // -- Lookup --------------------------------------------------------------
    function showActions() {
      explainBtn.hidden = !handlers.explain || autoExplain;
      renderSaveButton();
      position();
    }

    // Native-language word: nothing to translate or save — just show the word.
    if (nativeMode) {
      bodyEl.innerHTML = `<div class="pc-popup-native-word">${escapeHtml(word)}</div>`;
      position();
      return { el: popup, destroy };
    }

    const lookupPromise = initialLookupResult
      ? Promise.resolve(initialLookupResult)
      : Promise.resolve(handlers.lookup({ word, sentence }));

    lookupPromise
      .then((res) => {
        if (destroyed) return;
        lastLookup = res;

        if (!res || res.valid === false) {
          const invalidMsg = languageName
            ? labels.invalidWord(word, languageName)
            : labels.notInDictionary;
          bodyEl.innerHTML = `<div class="pc-popup-error">${escapeHtml(invalidMsg)}</div>`;
          explainBtn.hidden = !handlers.explain;
          saveBtn.hidden = true;
          position();
          return;
        }

        const translation = res.translation || res.definition || '';
        // `definition` is localized for the learner. `matched_gloss` retains the
        // source-language Wiktionary wording for sense identity and dedup only.
        const dictionaryDefinition = res.definition || res.matched_gloss || '';
        const definitionLabel = labels.definition;
        const definitionSourcePill = fallbackNoticePills(res);
        const fallbackDetails = fallbackNoticeDetails(res);
        if (!translation && !dictionaryDefinition && !res.part_of_speech) {
          bodyEl.innerHTML = `<div class="pc-popup-error">${escapeHtml(labels.noDefinition)}</div>`;
          return;
        }

        const newSense = handlers.resolveSavedState
          ? handlers.resolveSavedState(res) : 'unsaved';
        if (saveState !== 'done') {
          saveState = newSense === 'saved' ? 'saved'
            : newSense === 'new-sense' ? 'new-sense' : 'unsaved';
        }

        // When the clicked word is part of a fixed phrase/idiom/slang, let the
        // learner choose to add the whole phrase instead of the single word.
        const hasPhrase = !!(res.is_phrase && res.phrase && String(res.phrase).trim()
          && res.phrase.toLowerCase() !== word.toLowerCase());
        const lemmaEl = popup.querySelector('.pc-popup-lemma');

        function applyMode() {
          if (mode === 'phrase') {
            getSaveTarget = () => ({
              word: res.phrase,
              sentence,
              lookupResult: {
                ...res,
                word: res.phrase,
                target_word: res.phrase,
                lemma: null,
                sense_index: null,
                matched_gloss: null,
                translation: res.phrase_translation || res.phrase,
                definition: res.phrase_definition || '',
                is_existing: false,
              },
            });
          } else {
            getSaveTarget = () => ({ word, sentence, lookupResult: res });
          }
        }

        function autoExplanationHtml() {
          if (autoExplanationState === 'idle') return '';
          if (autoExplanationState === 'loading') {
            return `<div class="pc-popup-definition pc-popup-definition-context">
              <span class="pc-popup-definition-label">${escapeHtml(labels.inContext)}</span>
              <div class="pc-spinner pc-spinner-inline"></div>
            </div>`;
          }
          if (autoExplanationState === 'error') {
            return `<div class="pc-popup-definition pc-popup-definition-context">
              <span class="pc-popup-definition-label">${escapeHtml(labels.inContext)}</span>
              ${escapeHtml(labels.contextUnavailable)}
            </div>`;
          }
          return `<div class="pc-popup-definition pc-popup-definition-context">
            <span class="pc-popup-definition-label">${escapeHtml(labels.inContext)}</span>
            ${escapeHtml(autoExplanation)}
          </div>`;
        }

        function renderBody() {
          const toggle = hasPhrase ? `
            <div class="pc-popup-mode-toggle">
              <button type="button" class="pc-popup-mode${mode === 'word' ? ' pc-popup-mode--active' : ''}" data-mode="word">${escapeHtml(labels.word)}</button>
              <button type="button" class="pc-popup-mode${mode === 'phrase' ? ' pc-popup-mode--active' : ''}" data-mode="phrase">${escapeHtml(labels.phrase)}</button>
            </div>` : '';

          if (mode === 'phrase') {
            lemmaEl.hidden = true;
            const pt = res.phrase_translation || '';
            const pd = res.phrase_definition || '';
            bodyEl.innerHTML = `${toggle}
              <div class="pc-popup-phrase">${escapeHtml(res.phrase)}</div>
              ${pt ? `<div class="pc-popup-translation">${escapeHtml(pt)}</div>` : ''}
              <div class="pc-popup-pos">phrase</div>
              ${pd ? `<div class="pc-popup-definition">${escapeHtml(pd)}</div>` : ''}
              ${fallbackDetails}`;
          } else {
            lemmaEl.hidden = true;
            const hasLemma = res.lemma && res.lemma.trim() && res.lemma.toLowerCase() !== word.toLowerCase();
            const lemmaBlock = hasLemma
              ? `<div><span class="pc-popup-meta-label">${escapeHtml(labels.savesAs)}</span><strong>${escapeHtml(res.lemma)}</strong></div>` : '';
            const definitionBlock = dictionaryDefinition
              ? `<div class="pc-popup-definition"><span class="pc-popup-definition-label">${definitionLabel}${definitionSourcePill}</span>${escapeHtml(dictionaryDefinition)}</div>` : '';
            const posBlock = res.part_of_speech
              ? `<div><span class="pc-popup-meta-label">${escapeHtml(labels.partOfSpeech)}</span><span class="pc-popup-pos">${escapeHtml(res.part_of_speech)}</span></div>` : '';
            const metadata = lemmaBlock || definitionBlock || posBlock ? `<div class="pc-popup-meta">
              <div>${lemmaBlock}${definitionBlock}</div>
              <div>${posBlock}</div>
            </div>` : '';
            bodyEl.innerHTML = `${toggle}
              ${translation ? `<div class="pc-popup-translation">${escapeHtml(translation)}${saveState === 'new-sense' ? `<span class="pc-popup-new-def-pill">${escapeHtml(labels.newDefinition)}</span>` : ''}</div>` : ''}
              ${metadata}
              ${autoExplanationHtml()}
              ${fallbackDetails}`;
          }

          if (hasPhrase) {
            bodyEl.querySelectorAll('.pc-popup-mode').forEach((btn) => {
              btn.addEventListener('click', (e2) => {
                e2.stopPropagation();
                if (btn.dataset.mode === mode) return;
                mode = btn.dataset.mode;
                // Each form can be added independently.
                if (saveState === 'done') saveState = 'unsaved';
                applyMode();
                renderBody();
                renderSaveButton();
                position();
              });
            });
          }
        }

        applyMode();
        renderBody();
        showActions();

        if (autoExplanationState === 'loading') {
          Promise.resolve(handlers.explain({ word, sentence }))
            .then((explainRes) => {
              if (destroyed) return;
              autoExplanation = (explainRes && explainRes.explanation) || '';
              autoExplanationState = autoExplanation ? 'ready' : 'error';
              renderBody();
              showActions();
            })
            .catch((err) => {
              logPopupDiagnostic('word_popup_auto_explain_failed', 'auto-explain-word', 'The automatic word explanation could not be loaded.', err);
              if (destroyed) return;
              autoExplanationState = 'error';
              renderBody();
              showActions();
            });
        }
      })
      .catch((err) => {
        if (destroyed) return;
        logPopupDiagnostic('word_popup_lookup_failed', 'lookup-word', 'The word lookup could not be loaded.', err);
        bodyEl.innerHTML = `<div class="pc-popup-error">${escapeHtml(err && err.message || 'Lookup failed')}</div>`;
      });

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      resizeObserver.disconnect();
      window.removeEventListener('resize', position);
      popup.remove();
    }

    return { el: popup, destroy };
  }

  // Used by host environments (extension content scripts, the React wrapper) to
  // render the daily-goal flame indicator in the goal row markup they build.
  // Layered cartoon flame: gradient orange body, yellow inner flame, white-hot
  // core. Full color is baked into the SVG; setFlameLevel dims/greys it with
  // CSS filters so no per-layer scripting is needed.
  const FLAME_SVG =
    '<svg width="18" height="18" viewBox="0 0 24 24">' +
    '<defs>' +
    '<linearGradient id="pc-flame-body" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#ffb340"/><stop offset="1" stop-color="#ff5a1f"/>' +
    '</linearGradient>' +
    '<linearGradient id="pc-flame-heart" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#ffe873"/><stop offset="1" stop-color="#ffab2e"/>' +
    '</linearGradient>' +
    '</defs>' +
    '<path fill="url(#pc-flame-body)" d="M12 2.5c.5 2.7-.6 4.4-1.9 6C8.4 10.6 6.5 12.7 6.5 15.5a5.5 5.5 0 0 0 11 0c0-2.4-1.3-4.3-2.7-6-1.3-1.6-2.4-3.3-2.8-7z"/>' +
    '<path fill="url(#pc-flame-heart)" d="M12 10.5c1.6 1.5 2.7 3.1 2.7 4.9a2.7 2.7 0 1 1-5.4 0c0-1.8 1.1-3.4 2.7-4.9z"/>' +
    '<ellipse fill="#fff6cf" cx="12" cy="15.8" rx="1.1" ry="1.5"/>' +
    '</svg>';

  // Dials a flame icon element between ashy-gray (no words yet) and a bright
  // flickering burn (goal reached) based on `ratio` (0-1, added/goal clamped to
  // a max of 1). Called from the host env whenever the goal snapshot changes,
  // since the core has no direct access to that state.
  function setFlameLevel(flameEl, ratio, { burst = false } = {}) {
    if (!flameEl) return;
    const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
    flameEl.classList.toggle('pc-flame-lit', clamped > 0);
    // The fire grows with progress: small ember at 0, full blaze at the goal.
    flameEl.style.transform = `scale(${(0.75 + 0.55 * clamped).toFixed(2)})`;
    flameEl.style.filter = clamped === 0
      ? 'grayscale(1) opacity(.45)'
      : `grayscale(${((1 - clamped) * 0.8).toFixed(2)})` +
        ` brightness(${(0.75 + 0.35 * clamped).toFixed(2)})` +
        ` drop-shadow(0 0 ${(2 + 6 * clamped).toFixed(1)}px rgba(255,140,50,${(0.25 + 0.55 * clamped).toFixed(2)}))`;
    if (burst) {
      // Momentary flare-up when a word lands, like a log tossed on the fire.
      flameEl.classList.remove('pc-flame-burst');
      void flameEl.offsetWidth; // restart the animation if already bursting
      flameEl.classList.add('pc-flame-burst');
      setTimeout(() => flameEl.classList.remove('pc-flame-burst'), 900);
    }
  }

  globalThis.PolycastWordPopup = { createWordPopup, setFlameLevel, FLAME_SVG };
})();
