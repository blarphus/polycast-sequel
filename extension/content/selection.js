// ---------------------------------------------------------------------------
// selection.js -- Right-click lookup for a selected word on regular pages.
// ---------------------------------------------------------------------------

(function initSelectionLookup() {
  if (document.documentElement.dataset.pcSelectionLookupInjected === 'true') return;
  document.documentElement.dataset.pcSelectionLookupInjected = 'true';

  const CONTEXT_CHARS_BEFORE = 300;
  const CONTEXT_CHARS_AFTER = 300;
  const SHORT_CONTEXT_LIMIT = 700;

  function helpers() {
    return globalThis.PolycastContent || {};
  }

  function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function selectedSingleWord(selection) {
    const raw = normalizeText(selection && selection.toString());
    if (!raw) return null;

    const match = raw.match(/^[^\p{L}\p{M}\d']*([\p{L}\p{M}\d'][\p{L}\p{M}\d']*)[^\p{L}\p{M}\d']*$/u);
    if (!match) return null;

    const word = match[1];
    const isWordToken = helpers().isWordToken || ((token) => /^[\p{L}\p{M}\d']+$/u.test(token));
    return isWordToken(word) ? word : null;
  }

  function elementFromNode(node) {
    if (!node) return null;
    return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  }

  function contextContainer(range) {
    const startEl = elementFromNode(range.commonAncestorContainer);
    if (!startEl) return document.body;

    const block = startEl.closest([
      'p',
      'li',
      'blockquote',
      'figcaption',
      'td',
      'th',
      'article',
      'main',
      'section',
      '[role="article"]',
      '[role="main"]',
    ].join(','));

    return block || startEl.closest('div') || document.body;
  }

  function textIndex(fullText, selectedText) {
    const full = fullText.toLocaleLowerCase();
    const selected = selectedText.toLocaleLowerCase();
    return full.indexOf(selected);
  }

  function trimToNearestWordBoundary(text, clippedStart, clippedEnd) {
    let next = text;
    if (clippedStart) {
      const boundary = next.search(/\s/);
      if (boundary >= 0) next = next.slice(boundary + 1);
    }
    if (clippedEnd) {
      const boundary = next.lastIndexOf(' ');
      if (boundary >= 0) next = next.slice(0, boundary);
    }
    return normalizeText(next);
  }

  function selectionContext(range, word) {
    const container = contextContainer(range);
    const selectedText = normalizeText(range.toString()) || word;
    const fullText = normalizeText(container.innerText || container.textContent || selectedText);

    if (!fullText) {
      return { sentence: selectedText, context: selectedText };
    }

    if (fullText.length <= SHORT_CONTEXT_LIMIT) {
      return { sentence: sentenceAround(fullText, selectedText), context: fullText };
    }

    const idx = textIndex(fullText, selectedText);
    if (idx < 0) {
      const context = trimToNearestWordBoundary(fullText.slice(0, SHORT_CONTEXT_LIMIT), false, fullText.length > SHORT_CONTEXT_LIMIT);
      return { sentence: sentenceAround(context, selectedText), context };
    }

    const start = Math.max(0, idx - CONTEXT_CHARS_BEFORE);
    const end = Math.min(fullText.length, idx + selectedText.length + CONTEXT_CHARS_AFTER);
    const context = trimToNearestWordBoundary(fullText.slice(start, end), start > 0, end < fullText.length);
    return { sentence: sentenceAround(context, selectedText), context };
  }

  function sentenceAround(context, selectedText) {
    const idx = textIndex(context, selectedText);
    if (idx < 0) return context;

    const before = context.slice(0, idx);
    const after = context.slice(idx + selectedText.length);
    const leftBoundary = Math.max(
      before.lastIndexOf('.'),
      before.lastIndexOf('!'),
      before.lastIndexOf('?'),
      before.lastIndexOf('。'),
      before.lastIndexOf('！'),
      before.lastIndexOf('？'),
    );
    const rightCandidates = ['.', '!', '?', '。', '！', '？']
      .map((char) => after.indexOf(char))
      .filter((pos) => pos >= 0);
    const rightBoundary = rightCandidates.length ? Math.min(...rightCandidates) : -1;

    const start = leftBoundary >= 0 ? leftBoundary + 1 : 0;
    const end = rightBoundary >= 0
      ? idx + selectedText.length + rightBoundary + 1
      : context.length;

    return normalizeText(context.slice(start, end)) || context;
  }

  function anchorRectForRange(range, event) {
    const rect = range.getBoundingClientRect();
    if (rect && (rect.width || rect.height)) return rect;

    const firstRect = Array.from(range.getClientRects()).find((item) => item.width || item.height);
    if (firstRect) return firstRect;

    const x = event?.clientX ?? Math.round(window.innerWidth / 2);
    const y = event?.clientY ?? Math.round(window.innerHeight / 2);
    return {
      left: x,
      right: x,
      top: y,
      bottom: y,
      width: 0,
      height: 0,
    };
  }

  function lookupSelectedWord(selectionText = '') {
    const selection = window.getSelection();
    const hasDomSelection = selection && selection.rangeCount > 0 && !selection.isCollapsed;

    const word = hasDomSelection
      ? selectedSingleWord(selection)
      : selectedSingleWord({ toString: () => selectionText });
    if (!word) {
      helpers().showFallbackToast?.(
        'Select one word',
        'Polycast can look up one word at a time. Select a single word and try again.',
        {
          code: 'selection_not_single_word',
          severity: 'error',
          source: 'extension.selection',
          operation: 'open-selection-popup',
          detail: `selectionLength=${normalizeText(selectionText || selection?.toString()).length}`,
        },
      );
      return false;
    }

    const range = hasDomSelection ? selection.getRangeAt(0).cloneRange() : null;
    const { sentence, context } = range
      ? selectionContext(range, word)
      : { sentence: word, context: word };
    const anchorRect = range
      ? anchorRectForRange(range)
      : anchorRectForRange({ getBoundingClientRect: () => null, getClientRects: () => [] });
    const cleanCaptionText = helpers().cleanCaptionText || ((text) => text);
    const cleanSentence = cleanCaptionText(sentence) || word;
    const cleanContext = cleanCaptionText(context) || cleanSentence;

    if (typeof helpers().openWordPopup !== 'function') {
      helpers().showFallbackToast?.(
        'Selection lookup unavailable',
        'Polycast loaded on this page but its word popup could not be opened.',
        {
          code: 'selection_popup_runtime_missing',
          severity: 'error',
          source: 'extension.selection',
          operation: 'open-selection-popup',
        },
      );
      return false;
    }

    // Mount the shell before starting network-backed lookup. The shared popup
    // renders its loading state immediately, then fills in the result or error.
    helpers().openWordPopup({
      word,
      sentence: cleanSentence,
      context: cleanContext,
      anchorRect,
    });
    return true;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'POLYCAST_LOOKUP_SELECTION') return false;
    if (typeof helpers().validateInboundMessage === 'function' && !helpers().validateInboundMessage(msg, ['POLYCAST_LOOKUP_SELECTION'])) {
      sendResponse({
        error: 'Invalid selection lookup request',
        diagnostic: {
          code: 'selection_message_rejected', severity: 'error',
          title: 'Selection request rejected', message: 'An invalid selection lookup request was rejected.',
          source: 'extension.selection', operation: 'validate-inbound-message',
          correlationId: crypto.randomUUID(), occurredAt: new Date().toISOString(),
        },
      });
      return false;
    }
    if (typeof msg.selectionText !== 'string' || msg.selectionText.length > 20_000 || !Number.isFinite(Number(msg.requestedAt))) {
      sendResponse({ error: 'Selection lookup request fields are invalid' });
      return false;
    }
    try {
      const opened = lookupSelectedWord(msg.selectionText);
      const requestedAt = Number(msg.requestedAt);
      sendResponse({
        success: opened,
        shellLatencyMs: Number.isFinite(requestedAt) ? Math.max(0, Date.now() - requestedAt) : null,
      });
    } catch (err) {
      helpers().showFallbackToast?.(
        'Selection lookup failed',
        err && err.message ? err.message : 'Polycast could not open this word lookup.',
        {
          code: 'selection_popup_open_failed',
          severity: 'error',
          source: 'extension.selection',
          operation: 'open-selection-popup',
        },
      );
      sendResponse({ error: err && err.message ? err.message : 'Selection lookup failed' });
    }
    return false;
  });
})();
