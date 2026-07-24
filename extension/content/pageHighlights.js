// ---------------------------------------------------------------------------
// pageHighlights.js — saved-word recognition on ordinary target-language pages
// ---------------------------------------------------------------------------

(function initPageHighlights() {
  const TOKEN_BATCH_SIZE = 1500;
  const MAX_UNIQUE_PAGE_TOKENS = 6000;
  const LANGUAGE_SAMPLE_LIMIT = 50000;
  const PRIMARY_LANGUAGE_THRESHOLD = 50;
  const RESCAN_DELAY_MS = 180;
  const SKIP_SELECTOR = [
    'script', 'style', 'noscript', 'template', 'textarea', 'input', 'select',
    'option', 'button', 'code', 'pre', 'kbd', 'samp', 'svg', 'canvas',
    '[contenteditable="true"]', '.pc-page-saved-word', '.pc-popup',
    '.pc-popup-pointer', '.pc-fallback-toast', '#polycast-selection-error-notice',
  ].join(',');

  let targetLanguage = null;
  let enabled = false;
  let detectionRun = 0;
  let rescanTimer = null;
  let observer = null;
  const checkedTokens = new Set();

  function helpers() {
    return globalThis.PolycastContent || {};
  }

  function normalizeLanguageCode(value) {
    return String(value || '').trim().toLocaleLowerCase().replace(/_/g, '-').split('-')[0];
  }

  function primaryDetectedLanguage(result) {
    if (!result?.isReliable || !Array.isArray(result.languages) || !result.languages.length) return null;
    return [...result.languages]
      .map((entry) => ({
        language: normalizeLanguageCode(entry?.language),
        percentage: Number(entry?.percentage) || 0,
      }))
      .filter((entry) => entry.language)
      .sort((a, b) => b.percentage - a.percentage)[0] || null;
  }

  function isPrimaryTargetLanguage(result, target) {
    const primary = primaryDetectedLanguage(result);
    return !!primary
      && primary.percentage > PRIMARY_LANGUAGE_THRESHOLD
      && primary.language === normalizeLanguageCode(target);
  }

  function pageLanguageSample(root = document.body) {
    const text = String(root?.innerText || root?.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length <= LANGUAGE_SAMPLE_LIMIT) return text;
    const half = Math.floor(LANGUAGE_SAMPLE_LIMIT / 2);
    return `${text.slice(0, half)} ${text.slice(-half)}`;
  }

  function detectLanguageWithChrome(text) {
    return new Promise((resolve, reject) => {
      if (!chrome.i18n?.detectLanguage) {
        reject(new Error('chrome.i18n.detectLanguage is unavailable'));
        return;
      }
      let settled = false;
      const complete = (result, error = null) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(result);
      };
      try {
        const maybePromise = chrome.i18n.detectLanguage(text, (result) => {
          const runtimeError = chrome.runtime?.lastError;
          complete(result, runtimeError ? new Error(runtimeError.message) : null);
        });
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then((result) => complete(result), (error) => complete(null, error));
        }
      } catch (error) {
        complete(null, error);
      }
    });
  }

  function reportDiagnostic(code, title, message, detail) {
    helpers().showFallbackToast?.(title, message, {
      code,
      severity: 'warning',
      source: 'extension.page-highlights',
      operation: 'detect-and-highlight-page',
      pipeline: 'ordinary_page_highlighting',
      stage: 'fallback',
      selectedAction: 'leave-page-unmodified',
      correlationId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      detail,
    });
  }

  function shouldSkipTextNode(node) {
    const parent = node?.parentElement;
    if (!parent || !node.nodeValue?.trim()) return true;
    if (parent.isContentEditable) return true;
    return !!parent.closest(SKIP_SELECTOR);
  }

  function textNodesUnder(root) {
    if (!root) return [];
    if (root.nodeType === Node.TEXT_NODE) return shouldSkipTextNode(root) ? [] : [root];
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return [];
    if (root.nodeType === Node.ELEMENT_NODE && root.closest?.(SKIP_SELECTOR)) return [];

    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => shouldSkipTextNode(node)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function uniqueUncheckedTokens(nodes) {
    const result = [];
    const seen = new Set();
    const tokenize = globalThis.PolycastTextTokens?.tokenize
      || ((text) => String(text || '').match(/([\p{L}\p{M}\d']+|[^\p{L}\p{M}\d']+)/gu) || []);
    const isWordToken = globalThis.PolycastTextTokens?.isWordToken
      || ((token) => /^[\p{L}\p{M}\d']+$/u.test(token));

    for (const node of nodes) {
      for (const token of tokenize(node.nodeValue)) {
        if (!isWordToken(token)) continue;
        const normalized = token.toLocaleLowerCase();
        if (checkedTokens.has(normalized) || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
        if (result.length >= MAX_UNIQUE_PAGE_TOKENS) return result;
      }
    }
    return result;
  }

  async function matchTokens(tokens) {
    const matches = new Set();
    for (let offset = 0; offset < tokens.length; offset += TOKEN_BATCH_SIZE) {
      const batch = tokens.slice(offset, offset + TOKEN_BATCH_SIZE);
      const response = await chrome.runtime.sendMessage({ type: 'MATCH_PAGE_TOKENS', tokens: batch });
      for (const entry of response?.matches || []) {
        const token = String(entry?.token || '').toLocaleLowerCase();
        if (token) matches.add(token);
      }
    }
    return matches;
  }

  function normalizeVisibleText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function sentenceContextForElement(element, word) {
    const container = element.closest([
      'p', 'li', 'blockquote', 'figcaption', 'td', 'th', 'article', 'main',
      'section', '[role="article"]', '[role="main"]',
    ].join(',')) || element.parentElement || document.body;
    const full = normalizeVisibleText(container.innerText || container.textContent || word);
    const lower = full.toLocaleLowerCase();
    const index = lower.indexOf(String(word).toLocaleLowerCase());
    if (index < 0) return { sentence: full || word, context: full || word };

    const before = full.slice(0, index);
    const after = full.slice(index + word.length);
    const left = Math.max(
      before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'),
      before.lastIndexOf('。'), before.lastIndexOf('！'), before.lastIndexOf('？'),
    );
    const rightCandidates = ['.', '!', '?', '。', '！', '？']
      .map((character) => after.indexOf(character))
      .filter((position) => position >= 0);
    const right = rightCandidates.length ? Math.min(...rightCandidates) : -1;
    const sentence = normalizeVisibleText(full.slice(
      left >= 0 ? left + 1 : 0,
      right >= 0 ? index + word.length + right + 1 : full.length,
    )) || word;
    const contextStart = Math.max(0, index - 450);
    const contextEnd = Math.min(full.length, index + word.length + 450);
    return {
      sentence,
      context: normalizeVisibleText(full.slice(contextStart, contextEnd)) || sentence,
    };
  }

  function openSavedWord(mark, word) {
    if (typeof helpers().openWordPopup !== 'function') {
      reportDiagnostic(
        'page_highlight_popup_runtime_missing',
        'Saved-word popup unavailable',
        'Polycast highlighted this saved word, but its lookup popup could not be opened.',
        `word=${word}`,
      );
      return;
    }
    const { sentence, context } = sentenceContextForElement(mark, word);
    helpers().openWordPopup({
      word,
      sentence,
      context,
      anchorRect: mark.getBoundingClientRect(),
    });
  }

  function highlightNodes(nodes, matches) {
    if (!matches.size) return;
    const tokenize = globalThis.PolycastTextTokens?.tokenize
      || ((text) => String(text || '').match(/([\p{L}\p{M}\d']+|[^\p{L}\p{M}\d']+)/gu) || []);
    const isWordToken = globalThis.PolycastTextTokens?.isWordToken
      || ((token) => /^[\p{L}\p{M}\d']+$/u.test(token));

    for (const node of nodes) {
      if (!node.isConnected || shouldSkipTextNode(node)) continue;
      const fragment = document.createDocumentFragment();
      let changed = false;
      for (const token of tokenize(node.nodeValue)) {
        const normalized = token.toLocaleLowerCase();
        if (isWordToken(token) && matches.has(normalized)) {
          const mark = document.createElement('mark');
          mark.className = 'pc-word pc-saved pc-page-saved-word';
          mark.dataset.pcSavedToken = normalized;
          mark.textContent = token;
          mark.title = 'Saved in Polycast';
          mark.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openSavedWord(mark, token);
          });
          fragment.appendChild(mark);
          changed = true;
        } else {
          fragment.appendChild(document.createTextNode(token));
        }
      }
      if (changed) node.replaceWith(fragment);
    }
  }

  async function scanRoot(root = document.body) {
    if (!enabled || !root) return;
    const nodes = textNodesUnder(root);
    const tokens = uniqueUncheckedTokens(nodes);
    if (!tokens.length) return;
    tokens.forEach((token) => checkedTokens.add(token));
    try {
      const matches = await matchTokens(tokens);
      if (!enabled) return;
      helpers().rememberSavedTokens?.(matches);
      highlightNodes(nodes, matches);
    } catch (error) {
      tokens.forEach((token) => checkedTokens.delete(token));
      reportDiagnostic(
        'page_token_match_failed',
        'Saved-word highlighting unavailable',
        'Polycast could not compare this page with your saved dictionary, so it left the page unchanged.',
        error?.message || String(error),
      );
    }
  }

  function unwrapHighlights() {
    const parents = new Set();
    document.querySelectorAll('.pc-page-saved-word').forEach((mark) => {
      if (mark.parentNode) parents.add(mark.parentNode);
      mark.replaceWith(document.createTextNode(mark.textContent || ''));
    });
    parents.forEach((parent) => parent.normalize?.());
  }

  function scheduleRescan() {
    if (!enabled || rescanTimer) return;
    rescanTimer = setTimeout(() => {
      rescanTimer = null;
      void scanRoot(document.body);
    }, RESCAN_DELAY_MS);
  }

  async function evaluatePageLanguage() {
    const run = ++detectionRun;
    enabled = false;
    checkedTokens.clear();
    unwrapHighlights();
    const sample = pageLanguageSample();
    if (!targetLanguage || !sample) return false;
    try {
      const result = await detectLanguageWithChrome(sample);
      if (run !== detectionRun) return false;
      enabled = isPrimaryTargetLanguage(result, targetLanguage);
      if (enabled) await scanRoot(document.body);
      return enabled;
    } catch (error) {
      if (run !== detectionRun) return false;
      reportDiagnostic(
        'page_language_detection_failed',
        'Page language detection unavailable',
        'Chrome could not determine whether this page uses your target language, so Polycast left it unchanged.',
        error?.message || String(error),
      );
      return false;
    }
  }

  async function boot() {
    observer = new MutationObserver(() => scheduleRescan());
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_TARGET_LANGUAGE' });
      targetLanguage = normalizeLanguageCode(response?.targetLanguage);
      helpers().setTargetLanguage?.(targetLanguage);
      await evaluatePageLanguage();
    } catch (error) {
      reportDiagnostic(
        'page_target_language_unavailable',
        'Target language unavailable',
        'Polycast could not load your target language, so it left this page unchanged.',
        error?.message || String(error),
      );
    }

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'WORDS_UPDATED') {
        checkedTokens.clear();
        unwrapHighlights();
        scheduleRescan();
      } else if (message?.type === 'TARGET_LANGUAGE_UPDATED') {
        targetLanguage = normalizeLanguageCode(message.targetLanguage);
        helpers().setTargetLanguage?.(targetLanguage);
        void evaluatePageLanguage();
      }
      return false;
    });
  }

  globalThis.PolycastPageHighlights = {
    normalizeLanguageCode,
    primaryDetectedLanguage,
    isPrimaryTargetLanguage,
    pageLanguageSample,
    sentenceContextForElement,
    scanRoot,
    evaluatePageLanguage,
    unwrapHighlights,
    boot,
  };

  if (!globalThis.__POLYCAST_PAGE_HIGHLIGHTS_TEST__) void boot();
})();
