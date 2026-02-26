// ---------------------------------------------------------------------------
// shared.js — Tokenization, popup UI, saved-word state, message helpers
// ---------------------------------------------------------------------------

// ---- Saved words state ----------------------------------------------------

let savedWordsSet = new Set();

(async function initSavedWords() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_SAVED_WORDS' });
    if (res && res.savedWords) {
      savedWordsSet = new Set(res.savedWords);
    }
  } catch {
    // Extension context invalidated — will work after page refresh
  }
})();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'WORDS_UPDATED') {
    savedWordsSet = new Set(msg.savedWords || []);
    // Re-mark all tokenized words on the page
    document.querySelectorAll('.pc-word').forEach((el) => {
      const word = el.textContent.toLowerCase();
      el.classList.toggle('pc-saved', savedWordsSet.has(word));
    });
  }
});

// ---- Tokenization ---------------------------------------------------------

function tokenize(text) {
  return text.match(/([\p{L}\p{M}\d']+|[.,!?;:]+|\s+)/gu) || [];
}

function isWordToken(token) {
  return /^[\p{L}\p{M}\d']+$/u.test(token);
}

// ---- Escape HTML ----------------------------------------------------------

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Tokenize a subtitle element ------------------------------------------

function tokenizeElement(container) {
  const text = container.textContent;
  if (!text || !text.trim()) return;

  // Skip if already tokenized with the same text
  if (container.dataset.pcTokenized === text) return;
  container.dataset.pcTokenized = text;

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
}

// ---- Popup UI -------------------------------------------------------------

let activePopup = null;

function removePopup() {
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }
}

// Close popup on click outside
document.addEventListener('click', (e) => {
  if (activePopup && !activePopup.contains(e.target) && !e.target.closest('.pc-word')) {
    removePopup();
  }
});

// Close popup on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') removePopup();
});

function handleWordClick(word, sentence, anchorEl) {
  removePopup();

  const rect = anchorEl.getBoundingClientRect();
  const popup = document.createElement('div');
  popup.className = 'pc-popup';

  // Position near the clicked word
  popup.style.position = 'fixed';
  popup.style.left = `${Math.min(rect.left, window.innerWidth - 300)}px`;
  popup.style.top = `${rect.top - 10}px`;
  popup.style.transform = 'translateY(-100%)';
  popup.style.zIndex = '2147483647';

  const isSaved = savedWordsSet.has(word.toLowerCase());

  popup.innerHTML = `
    <div class="pc-popup-header">
      <span class="pc-popup-word">${escapeHtml(word)}</span>
      <button class="pc-popup-save" title="${isSaved ? 'Already saved' : 'Save word'}"
        ${isSaved ? 'disabled' : ''}>
        ${isSaved ? '&#10003;' : '+'}
      </button>
    </div>
    <div class="pc-popup-body">
      <div class="pc-spinner"></div>
    </div>
  `;

  document.body.appendChild(popup);
  activePopup = popup;

  // Adjust if popup goes off-screen top
  requestAnimationFrame(() => {
    const popupRect = popup.getBoundingClientRect();
    if (popupRect.top < 8) {
      popup.style.transform = 'none';
      popup.style.top = `${rect.bottom + 10}px`;
    }
  });

  // Dual pipeline: Google Translate (fast) + Gemini lookup (definition/POS)
  const body = popup.querySelector('.pc-popup-body');

  // 1) Google Translate — fast translation
  try {
    chrome.runtime.sendMessage(
      { type: 'TRANSLATE_WORD', word },
      (res) => {
        if (chrome.runtime.lastError) {
          console.error('Polycast translate error:', chrome.runtime.lastError.message);
          if (!activePopup || activePopup !== popup) return;
          body.innerHTML = `<div class="pc-popup-error">Extension reloaded — refresh this page</div>`;
          return;
        }

        if (!activePopup || activePopup !== popup) return;

        if (res && res.error) {
          body.innerHTML = `<div class="pc-popup-error">${escapeHtml(res.error)}</div>`;
          return;
        }

        if (!res || !res.translation) {
          body.innerHTML = `<div class="pc-popup-error">No translation found</div>`;
          return;
        }

        // Show translation, keep spinner for details
        body.innerHTML = `
          <div class="pc-popup-translation">${escapeHtml(res.translation)}</div>
          <div class="pc-popup-details"><div class="pc-spinner"></div></div>
        `;
      },
    );
  } catch {
    body.innerHTML = `<div class="pc-popup-error">Extension reloaded — refresh this page</div>`;
  }

  // 2) Gemini lookup — definition + POS (fires in parallel)
  try {
    chrome.runtime.sendMessage(
      { type: 'LOOKUP_WORD', word, sentence },
      (res) => {
        if (chrome.runtime.lastError) {
          console.error('Polycast lookup error:', chrome.runtime.lastError.message);
          if (!activePopup || activePopup !== popup) return;
          const details = popup.querySelector('.pc-popup-details');
          if (details) details.innerHTML = `<div class="pc-popup-error">Extension reloaded — refresh this page</div>`;
          return;
        }

        if (!activePopup || activePopup !== popup) return;

        if (res && res.error) {
          const details = popup.querySelector('.pc-popup-details');
          if (details) {
            details.innerHTML = `<div class="pc-popup-error">${escapeHtml(res.error)}</div>`;
          }
          return;
        }

        // Fill in POS + definition (translation may or may not be rendered yet)
        const details = popup.querySelector('.pc-popup-details');
        if (details) {
          details.innerHTML = `
            ${res && res.part_of_speech ? `<div class="pc-popup-pos">${escapeHtml(res.part_of_speech)}</div>` : ''}
            ${res && res.definition ? `<div class="pc-popup-definition">${escapeHtml(res.definition)}</div>` : ''}
          `;
        } else {
          // Translation hasn't rendered yet — spinner is still showing, append after it resolves
          const observer = new MutationObserver(() => {
            const d = popup.querySelector('.pc-popup-details');
            if (d) {
              observer.disconnect();
              d.innerHTML = `
                ${res && res.part_of_speech ? `<div class="pc-popup-pos">${escapeHtml(res.part_of_speech)}</div>` : ''}
                ${res && res.definition ? `<div class="pc-popup-definition">${escapeHtml(res.definition)}</div>` : ''}
              `;
            }
          });
          observer.observe(body, { childList: true, subtree: true });
        }
      },
    );
  } catch {
    const details = popup.querySelector('.pc-popup-details');
    if (details) details.innerHTML = `<div class="pc-popup-error">Extension reloaded — refresh this page</div>`;
  }

  // Save button
  const saveBtn = popup.querySelector('.pc-popup-save');
  if (!isSaved) {
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      saveBtn.disabled = true;
      saveBtn.textContent = '...';

      try {
        chrome.runtime.sendMessage(
          { type: 'SAVE_WORD', word, sentence },
          (res) => {
            if (chrome.runtime.lastError) {
              saveBtn.disabled = false;
              saveBtn.textContent = '!';
              saveBtn.title = 'Extension reloaded — refresh this page';
              return;
            }
            if (res && res.error) {
              saveBtn.disabled = false;
              saveBtn.textContent = '!';
              saveBtn.title = res.error;
              console.error('Polycast save error:', res.error);
              return;
            }
            saveBtn.innerHTML = '&#10003;';
            saveBtn.title = 'Saved';
            saveBtn.classList.add('pc-popup-save--saved');
          },
        );
      } catch {
        saveBtn.disabled = false;
        saveBtn.textContent = '!';
        saveBtn.title = 'Extension reloaded — refresh this page';
      }
    });
  }
}
