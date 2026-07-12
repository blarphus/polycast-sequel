// Saved-word highlights for ordinary page text. Matching stays in the service
// worker so large dictionaries are not copied into every tab.
(function initPageHighlights() {
  if (document.documentElement.dataset.pcPageHighlightsInjected === 'true') return;
  document.documentElement.dataset.pcPageHighlightsInjected = 'true';

  const MAX_HIGHLIGHT_RANGES = 750;
  const FALLBACK_SPAN_LIMIT = 250;
  const TOKEN_CHUNK = 1200;
  const BLOCK_SELECTOR = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,figcaption,td,th,[role="article"],[role="main"]';
  const SKIP_SELECTOR = [
    'script', 'style', 'noscript', 'textarea', 'input', 'select', 'option',
    'code', 'pre', '[contenteditable="true"]', '.pc-word', '.pc-popup',
    '.pc-goal-celebration', '.pc-fallback-toast', '.pc-page-saved-word',
  ].join(',');
  const supportsCssHighlights = typeof Highlight === 'function' && !!globalThis.CSS?.highlights;
  const savedHighlight = supportsCssHighlights ? new Highlight() : null;
  const highlightEntries = [];
  let processedNodes = new WeakSet();
  let observedBlocks = new WeakSet();
  const pendingNodes = [];
  let enabled = false;
  let targetLanguage = '';
  let override = 'auto';
  let detectedLanguage = '';
  let detectionSource = '';
  let mediaLanguage = '';
  let observer = null;
  let blockObserver = null;
  let drainScheduled = false;
  let recallChallenge = null;
  let recallEntry = null;
  let recallIndicator = null;
  let recallRequestStarted = false;
  let matchedRangeCapShown = false;
  let domMutationFallbackShown = false;
  let rangeLookupFallbackShown = false;
  const recallSampledForPage = Math.random() < 0.15;

  function baseLanguage(value) {
    return String(value || '').toLocaleLowerCase().split(/[-_]/)[0];
  }

  function showDiagnostic(title, message, metadata = {}) {
    if (!message) return;
    document.querySelector('.pc-fallback-toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'pc-fallback-toast';
    const heading = document.createElement('strong');
    heading.textContent = title;
    const detail = document.createElement('span');
    detail.textContent = message;
    const reference = document.createElement('small');
    reference.textContent = [
      metadata.code || 'extension_fallback_used',
      metadata.source || 'extension.page-highlights',
      metadata.operation || 'highlight-page',
      metadata.correlationId || crypto.randomUUID(),
      metadata.detail || '',
    ].filter(Boolean).join(' · ');
    toast.append(heading, detail, reference);
    document.body.append(toast);
    window.setTimeout(() => toast.remove(), 8000);
    console.warn('[polycast:fallback]', {
      code: metadata.code || 'extension_fallback_used',
      severity: metadata.severity || 'warning',
      title,
      message,
      source: metadata.source || 'extension.page-highlights',
      operation: metadata.operation || 'highlight-page',
      correlationId: metadata.correlationId || crypto.randomUUID(),
      occurredAt: metadata.occurredAt || new Date().toISOString(),
      ...(metadata.detail ? { detail: metadata.detail } : {}),
    });
  }

  function samplePageText() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let sample = '';
    while (walker.nextNode() && sample.length < 12000) {
      const node = walker.currentNode;
      if (!node.parentElement || node.parentElement.closest(SKIP_SELECTOR)) continue;
      const value = String(node.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (value) sample += `${value} `;
    }
    return sample.slice(0, 12000);
  }

  function unwrapFallbackSpans() {
    document.querySelectorAll('.pc-page-saved-word').forEach((span) => {
      span.replaceWith(document.createTextNode(span.textContent || ''));
    });
  }

  function clearHighlights() {
    if (supportsCssHighlights) {
      savedHighlight.clear();
      CSS.highlights.delete('polycast-saved');
    }
    highlightEntries.splice(0);
    unwrapFallbackSpans();
    recallEntry = null;
    recallIndicator?.remove();
    recallIndicator = null;
  }

  function updateRecallIndicator() {
    const connected = recallEntry?.span?.isConnected || recallEntry?.range?.startContainer?.isConnected;
    if (!recallEntry || !connected) {
      recallIndicator?.remove();
      recallIndicator = null;
      return;
    }
    if (!recallIndicator) {
      recallIndicator = document.createElement('i');
      recallIndicator.className = 'pc-page-recall-indicator';
      recallIndicator.setAttribute('aria-hidden', 'true');
      document.body.append(recallIndicator);
    }
    const rect = recallEntry.span?.getBoundingClientRect() || recallEntry.range.getBoundingClientRect();
    recallIndicator.style.left = `${rect.left + window.scrollX}px`;
    recallIndicator.style.top = `${rect.top + window.scrollY}px`;
    recallIndicator.style.width = `${Math.max(1, rect.width)}px`;
    recallIndicator.style.height = `${Math.max(1, rect.height)}px`;
  }

  function challengeTokens(challenge) {
    const values = [challenge?.word, challenge?.lemma];
    try {
      const parsed = String(challenge?.forms || '').trim().startsWith('[')
        ? JSON.parse(challenge.forms)
        : String(challenge?.forms || '').split(',');
      if (Array.isArray(parsed)) values.push(...parsed);
    } catch (error) {
      showDiagnostic(
        'Saved forms fallback used',
        'Challenge forms were malformed, so recall matching is limited to the saved word and lemma.',
        {
          code: 'recall_forms_parser_fallback',
          operation: 'build-recall-tokens',
          detail: error?.message || String(error),
        },
      );
    }
    return new Set(values.map((value) => String(value || '').trim().toLocaleLowerCase()).filter(Boolean));
  }

  function selectRecallRange() {
    recallEntry = null;
    if (!recallChallenge) {
      updateRecallIndicator();
      return;
    }
    const tokens = challengeTokens(recallChallenge);
    recallEntry = highlightEntries.find((entry) => tokens.has(entry.token)) || null;
    updateRecallIndicator();
  }

  async function maybeArmRecall(candidateIds) {
    if (!recallSampledForPage || recallRequestStarted || recallChallenge || !candidateIds.length) return;
    recallRequestStarted = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'MAYBE_ARM_WILD_RECALL', wordIds: candidateIds });
      recallChallenge = result?.challenge || null;
      selectRecallRange();
      if (result?.diagnostic || result?.unavailable) {
        const diagnostic = result.diagnostic || result.unavailable;
        showDiagnostic(
          diagnostic.title || 'Wild Recall fallback',
          diagnostic.message || String(diagnostic),
          diagnostic,
        );
      }
    } catch (err) {
      showDiagnostic('Wild Recall fallback', `Wild Recall preparation fallback used: ${err.message}`);
    }
  }

  function addCssRanges(occurrences, matchMap) {
    const candidateIds = new Set();
    for (const occurrence of occurrences) {
      const match = matchMap.get(occurrence.token);
      if (!match) continue;
      if (highlightEntries.length >= MAX_HIGHLIGHT_RANGES) {
        if (!matchedRangeCapShown) {
          matchedRangeCapShown = true;
          showDiagnostic('Highlight limit used', `Highlighting stopped at ${MAX_HIGHLIGHT_RANGES} matches to protect page memory.`);
        }
        break;
      }
      const range = document.createRange();
      range.setStart(occurrence.node, occurrence.start);
      range.setEnd(occurrence.node, occurrence.end);
      savedHighlight.add(range);
      highlightEntries.push({ range, token: occurrence.token, wordId: match.wordId });
      if (match.reviewed && match.wordId) candidateIds.add(match.wordId);
    }
    CSS.highlights.set('polycast-saved', savedHighlight);
    selectRecallRange();
    void maybeArmRecall([...candidateIds]);
  }

  function addFallbackSpans(occurrences, matchMap) {
    if (!document.documentElement.dataset.pcSpanHighlightFallbackShown) {
      document.documentElement.dataset.pcSpanHighlightFallbackShown = 'true';
      showDiagnostic('Highlight fallback used', 'CSS Highlights are unavailable, so Polycast is using a lower-memory-capped span fallback.');
    }
    const matching = occurrences.filter((item) => matchMap.has(item.token)).slice(0, Math.max(0, FALLBACK_SPAN_LIMIT - highlightEntries.length));
    for (const occurrence of [...matching].reverse()) {
      if (!occurrence.node.isConnected) continue;
      const range = document.createRange();
      range.setStart(occurrence.node, occurrence.start);
      range.setEnd(occurrence.node, occurrence.end);
      const span = document.createElement('span');
      span.className = 'pc-page-saved-word';
      span.dataset.pcWord = occurrence.token;
      try {
        range.surroundContents(span);
        highlightEntries.push({ range: document.createRange(), token: occurrence.token, wordId: matchMap.get(occurrence.token).wordId, span });
      } catch (error) {
        if (!domMutationFallbackShown) {
          domMutationFallbackShown = true;
          showDiagnostic(
            'Highlight mutation fallback used',
            'The page changed during highlighting, so affected matches were skipped and will be retried on the next scan.',
            {
              code: 'highlight_dom_mutation_fallback',
              operation: 'wrap-highlight-range',
              detail: error?.message || String(error),
            },
          );
        }
      }
    }
  }

  async function processNodes(nodes) {
    const occurrences = [];
    const tokens = new Set();
    for (const node of nodes) {
      if (!node.isConnected || !node.parentElement || node.parentElement.closest(SKIP_SELECTOR)) continue;
      const text = node.nodeValue || '';
      const pattern = /[\p{L}\p{M}\d']+/gu;
      let match;
      while ((match = pattern.exec(text)) && tokens.size < TOKEN_CHUNK) {
        const token = match[0].toLocaleLowerCase();
        tokens.add(token);
        occurrences.push({ node, start: match.index, end: match.index + match[0].length, token });
      }
    }
    if (!tokens.size) return;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'MATCH_PAGE_TOKENS', tokens: [...tokens] });
      const matchMap = new Map((result?.matches || []).map((entry) => [entry.token, entry]));
      if (!matchMap.size) return;
      if (supportsCssHighlights) addCssRanges(occurrences, matchMap);
      else addFallbackSpans(occurrences, matchMap);
    } catch (err) {
      showDiagnostic('Page highlight fallback', `Saved-word matching fallback used: ${err.message}`);
    }
  }

  function drain(deadline) {
    drainScheduled = false;
    const nodes = [];
    const started = performance.now();
    while (pendingNodes.length && nodes.length < 120 && performance.now() - started < 8 && (!deadline || deadline.timeRemaining() > 1)) {
      nodes.push(pendingNodes.shift());
    }
    if (nodes.length) void processNodes(nodes);
    if (pendingNodes.length) scheduleDrain();
  }

  function scheduleDrain() {
    if (!enabled || drainScheduled || !pendingNodes.length || document.hidden) return;
    drainScheduled = true;
    if (typeof requestIdleCallback === 'function') requestIdleCallback(drain, { timeout: 120 });
    else window.setTimeout(() => drain({ timeRemaining: () => 8 }), 0);
  }

  function enqueueBlock(block) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (processedNodes.has(node)) continue;
      processedNodes.add(node);
      pendingNodes.push(node);
    }
    scheduleDrain();
  }

  function observeBlocks(root) {
    if (!enabled || !root) return;
    const blocks = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.matches?.(BLOCK_SELECTOR)) blocks.push(root);
    if (root.querySelectorAll) blocks.push(...root.querySelectorAll(BLOCK_SELECTOR));
    if (!blocks.length && root === document.body) blocks.push(root);
    for (const block of blocks) {
      if (observedBlocks.has(block)) continue;
      observedBlocks.add(block);
      blockObserver.observe(block);
    }
  }

  function startObservers() {
    if (observer) return;
    blockObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) enqueueBlock(entry.target);
    }, { rootMargin: '150% 0px' });
    observeBlocks(document.body);
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) mutation.addedNodes.forEach(observeBlocks);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('visibilitychange', scheduleDrain);
  }

  function stopObservers() {
    observer?.disconnect();
    blockObserver?.disconnect();
    observer = null;
    blockObserver = null;
    pendingNodes.splice(0);
    clearHighlights();
    processedNodes = new WeakSet();
    observedBlocks = new WeakSet();
  }

  async function resolveLanguageGate(forcedOverride = null) {
    stopObservers();
    const config = await chrome.runtime.sendMessage({ type: 'GET_PAGE_HIGHLIGHT_CONFIG', hostname: location.hostname });
    targetLanguage = baseLanguage(config?.targetLanguage);
    override = forcedOverride || config?.override || 'auto';
    let detection;
    if (mediaLanguage) {
      detection = { language: mediaLanguage, reliable: true, source: 'captions' };
    } else {
      detection = await chrome.runtime.sendMessage({
        type: 'DETECT_PAGE_LANGUAGE',
        sample: samplePageText(),
        declaredLanguage: document.documentElement.lang,
      });
    }
    detectedLanguage = baseLanguage(detection?.language);
    detectionSource = detection?.source || '';
    enabled = override === 'on' || (override === 'auto' && !!targetLanguage && detectedLanguage === targetLanguage);
    if (override === 'off') enabled = false;
    if (detection?.diagnostic) {
      showDiagnostic(
        detection.diagnostic.title || 'Language detection fallback',
        detection.diagnostic.message || String(detection.diagnostic),
        detection.diagnostic,
      );
    }
    if (enabled) {
      startObservers();
      const cue = await chrome.runtime.sendMessage({ type: 'CLAIM_PAGE_CUE' });
      if (cue?.show) showDiagnostic('Polycast is active here', cue.remaining ? `${cue.remaining} words left today.` : 'Daily word goal complete.');
    }
  }

  function entryAtPoint(x, y) {
    if (!supportsCssHighlights) return null;
    const position = document.caretPositionFromPoint?.(x, y);
    if (!position) return null;
    return highlightEntries.find((entry) => {
      try {
        return entry.range.isPointInRange(position.offsetNode, position.offset);
      } catch (error) {
        if (!rangeLookupFallbackShown) {
          rangeLookupFallbackShown = true;
          showDiagnostic(
            'Highlight lookup fallback used',
            'The page changed during click lookup, so this stale highlight was ignored.',
            {
              code: 'highlight_range_lookup_fallback',
              operation: 'resolve-highlight-click',
              detail: error?.message || String(error),
            },
          );
        }
        return false;
      }
    }) || null;
  }

  document.addEventListener('click', (event) => {
    if (!enabled || event.button !== 0 || event.target.closest?.('.pc-popup, input, textarea, button, select')) return;
    const fallbackSpan = event.target.closest?.('.pc-page-saved-word');
    const entry = fallbackSpan
      ? { token: fallbackSpan.dataset.pcWord, range: { getBoundingClientRect: () => fallbackSpan.getBoundingClientRect() } }
      : entryAtPoint(event.clientX, event.clientY);
    if (!entry) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    event.preventDefault();
    event.stopPropagation();
    const anchorRect = entry.range.getBoundingClientRect();
    const sentence = String((fallbackSpan || entry.range.startContainer?.parentElement)?.closest?.('p,li,blockquote,figcaption,td,th')?.textContent
      || entry.range.startContainer?.parentElement?.textContent || entry.token).replace(/\s+/g, ' ').trim();
    const helpers = globalThis.PolycastContent || {};
    const popupStartedAt = performance.now();
    if (recallChallenge && recallEntry === entry && typeof helpers.openRecallWordPopup === 'function') {
      helpers.openRecallWordPopup({ challenge: recallChallenge, word: entry.token, sentence, anchorRect });
    } else if (typeof helpers.openWordPopup === 'function') {
      helpers.openWordPopup({ word: entry.token, sentence, context: sentence, anchorRect });
    }
    document.documentElement.dataset.pcLastPopupShellMs = (performance.now() - popupStartedAt).toFixed(2);
  }, true);

  window.addEventListener('scroll', updateRecallIndicator, { passive: true });
  window.addEventListener('resize', updateRecallIndicator);
  document.addEventListener('pc-polycast-page-language', (event) => {
    mediaLanguage = baseLanguage(event.detail);
    void resolveLanguageGate();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const acceptedTypes = ['WORDS_UPDATED', 'WILD_RECALL_UPDATED', 'POLYCAST_FALLBACK_NOTICE', 'SITE_HIGHLIGHT_OVERRIDE_UPDATED', 'GET_PAGE_HIGHLIGHT_STATUS'];
    const validateMessage = globalThis.PolycastContent?.validateInboundMessage;
    if (typeof validateMessage === 'function' && !validateMessage(msg, acceptedTypes)) {
      if (msg?.type && acceptedTypes.includes(msg.type)) showDiagnostic(
        'Page update rejected',
        'An invalid page-highlight update was rejected before it could change the page.',
        { code: 'page_highlight_message_rejected', severity: 'error', operation: 'validate-inbound-message', detail: `type=${String(msg.type)}` },
      );
      return false;
    }
    if (msg.type === 'WORDS_UPDATED') void resolveLanguageGate();
    if (msg.type === 'WILD_RECALL_UPDATED') {
      recallChallenge = msg.challenge || null;
      selectRecallRange();
      if (msg.diagnostic) showDiagnostic(
        msg.diagnostic.title || 'Wild Recall fallback',
        msg.diagnostic.message || String(msg.diagnostic),
        msg.diagnostic,
      );
    }
    if (msg.type === 'POLYCAST_FALLBACK_NOTICE') {
      const diagnostic = msg.diagnostic || msg;
      showDiagnostic(diagnostic.title || 'Fallback used', diagnostic.message || 'An alternate path was used.', diagnostic);
    }
    if (msg.type === 'SITE_HIGHLIGHT_OVERRIDE_UPDATED') void resolveLanguageGate(msg.override);
    if (msg.type === 'GET_PAGE_HIGHLIGHT_STATUS') {
      sendResponse({ hostname: location.hostname, enabled, override, detectedLanguage, detectionSource, targetLanguage });
    }
    return false;
  });

  globalThis.PolycastContent = {
    ...(globalThis.PolycastContent || {}),
    addPageHighlights() { void resolveLanguageGate(); },
  };

  if (supportsCssHighlights) CSS.highlights.set('polycast-saved', savedHighlight);
  void resolveLanguageGate().catch((err) => showDiagnostic('Page highlight fallback', `Highlight initialization fallback used: ${err.message}`));
})();
