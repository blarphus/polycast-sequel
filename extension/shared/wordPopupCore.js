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
  const POPUP_WIDTH = 280;

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
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
   *   handlers:
   *     lookup({ word, sentence })  -> Promise<{ valid, translation, definition, part_of_speech, ... }>
   *     explain({ word, sentence }) -> Promise<{ explanation }>
   *     save({ word, sentence, lookupResult }) -> Promise<void>   (optimistic; may be omitted)
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
      nativeMode = false,
      handlers = {},
    } = opts;

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

    popup.innerHTML = `
      <div class="pc-popup-header">
        <span class="pc-popup-word">${escapeHtml(word)}</span>
        <div class="pc-popup-header-actions">
          <button class="pc-popup-speak" title="Play pronunciation" aria-label="Play pronunciation" hidden>${SPEAKER_SVG}</button>
          <button class="pc-popup-close" title="Close">&times;</button>
        </div>
      </div>
      <div class="pc-popup-lemma" hidden></div>
      <div class="pc-popup-body"><div class="pc-spinner"></div></div>
      <button class="pc-popup-explain" hidden>Explain in context</button>
      <div class="pc-popup-explanation" hidden></div>
      <button class="pc-popup-save" hidden>+ Add to dictionary</button>
    `;

    container.appendChild(popup);

    const bodyEl = popup.querySelector('.pc-popup-body');
    const explainBtn = popup.querySelector('.pc-popup-explain');
    const explainBox = popup.querySelector('.pc-popup-explanation');
    const saveBtn = popup.querySelector('.pc-popup-save');

    // -- Positioning: prefer above, use below only when above does not fit, and
    // never leave an expanding popup below when it would overflow the viewport.
    // Re-run as async content changes its height.
    position();
    function position() {
      const width = popup.offsetWidth || POPUP_WIDTH;
      let left = anchorRect.left + anchorRect.width / 2 - width / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      popup.style.left = `${left}px`;

      const height = popup.offsetHeight;
      const belowTop = anchorRect.bottom + 8;
      const aboveTop = anchorRect.top - height - 8;
      const fitsBelow = belowTop + height <= window.innerHeight - 8;
      const fitsAbove = aboveTop >= 8;
      const top = !fitsAbove && fitsBelow ? belowTop : Math.max(8, aboveTop);
      popup.style.top = `${top}px`;
      popup.style.bottom = '';
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
          .catch((err) => console.error('[word-popup] speak failed:', err))
          .finally(() => { if (!destroyed) speakBtn.classList.remove('pc-popup-speak--playing'); });
      });
    }

    // -- Save button state machine ------------------------------------------
    let saveState = 'unsaved'; // 'unsaved' | 'new-sense' | 'saved' | 'done'
    let lastLookup = null;

    function renderSaveButton() {
      if (!handlers.save) { saveBtn.hidden = true; return; }
      saveBtn.hidden = false;
      if (saveState === 'done') {
        saveBtn.disabled = true;
        saveBtn.classList.add('pc-popup-save--saved');
        saveBtn.innerHTML = '&#10003; Added';
      } else if (saveState === 'saved') {
        saveBtn.disabled = true;
        saveBtn.classList.add('pc-popup-save--saved');
        saveBtn.innerHTML = '&#10003; In your dictionary';
      } else {
        saveBtn.disabled = false;
        saveBtn.classList.remove('pc-popup-save--saved');
        saveBtn.textContent = '+ Add to dictionary';
      }
    }

    if (initialSavedHint) saveState = 'saved';

    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (saveState === 'saved' || saveState === 'done') return;
      saveState = 'done';
      renderSaveButton();
      if (handlers.save) {
        Promise.resolve(handlers.save({ word, sentence, lookupResult: lastLookup }))
          .catch((err) => console.error('[word-popup] save failed:', err));
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
          explainBox.textContent = (res && res.explanation) || 'No explanation available';
        })
        .catch((err) => {
          if (destroyed) return;
          console.error('[word-popup] explain failed:', err);
          explainBox.innerHTML = `<div class="pc-popup-error">${escapeHtml(err && err.message || 'Explain failed')}</div>`;
          explainBtn.disabled = false;
        });
    });

    // -- Lookup --------------------------------------------------------------
    function showActions() {
      explainBtn.hidden = !handlers.explain;
      renderSaveButton();
      position();
    }

    // Native-language word: nothing to translate or save — just show the word.
    if (nativeMode) {
      bodyEl.innerHTML = `<div class="pc-popup-native-word">${escapeHtml(word)}</div>`;
      position();
      return { el: popup, destroy };
    }

    Promise.resolve(handlers.lookup({ word, sentence }))
      .then((res) => {
        if (destroyed) return;
        lastLookup = res;

        if (!res || res.valid === false) {
          bodyEl.innerHTML = `<div class="pc-popup-error">Not in dictionary</div>`;
          explainBtn.hidden = !handlers.explain;
          saveBtn.hidden = true;
          position();
          return;
        }

        const translation = res.translation || res.definition || '';
        const definition = res.definition || '';
        const showDef = definition && definition !== translation;

        if (!translation && !definition && !res.part_of_speech) {
          bodyEl.innerHTML = `<div class="pc-popup-error">No definition found</div>`;
          return;
        }

        const newSense = handlers.resolveSavedState
          ? handlers.resolveSavedState(res) : 'unsaved';
        if (saveState !== 'done') {
          saveState = newSense === 'saved' ? 'saved'
            : newSense === 'new-sense' ? 'new-sense' : 'unsaved';
        }

        // Show the base form (lemma) under the clicked word — this is the form the card saves as.
        if (res.lemma && res.lemma.trim() && res.lemma.toLowerCase() !== word.toLowerCase()) {
          const lemmaEl = popup.querySelector('.pc-popup-lemma');
          lemmaEl.innerHTML = `<span class="pc-popup-lemma-label">saves as</span>${escapeHtml(res.lemma)}`;
          lemmaEl.hidden = false;
        }

        bodyEl.innerHTML = `
          ${translation ? `<div class="pc-popup-translation">${escapeHtml(translation)}${saveState === 'new-sense' ? '<span class="pc-popup-new-def-pill">New definition!</span>' : ''}</div>` : ''}
          ${res.part_of_speech ? `<div class="pc-popup-pos">${escapeHtml(res.part_of_speech)}</div>` : ''}
          ${showDef ? `<div class="pc-popup-definition">${escapeHtml(definition)}</div>` : ''}
        `;
        showActions();
      })
      .catch((err) => {
        if (destroyed) return;
        console.error('[word-popup] lookup failed:', err);
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

  globalThis.PolycastWordPopup = { createWordPopup };
})();
