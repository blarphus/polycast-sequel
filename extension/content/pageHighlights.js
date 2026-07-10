// ---------------------------------------------------------------------------
// pageHighlights.js -- Recolor saved dictionary words in ordinary page text.
// ---------------------------------------------------------------------------

(function initPageHighlights() {
  if (document.documentElement.dataset.pcPageHighlightsInjected === 'true') return;
  document.documentElement.dataset.pcPageHighlightsInjected = 'true';

  const SKIP_SELECTOR = [
    'script', 'style', 'noscript', 'textarea', 'input', 'select', 'option',
    'code', 'pre', '[contenteditable="true"]',
    '.pc-page-saved-word', '.pc-word', '.pc-popup', '.pc-goal-celebration',
    '.pc-fallback-toast',
  ].join(',');
  const pendingNodes = [];
  const queuedNodes = new WeakSet();
  let savedWords = new Set();
  let drainScheduled = false;

  function shouldSkip(node) {
    const parent = node?.parentElement;
    return !parent || !!parent.closest(SKIP_SELECTOR);
  }

  function enqueueTextNode(node) {
    if (!node?.isConnected || shouldSkip(node) || queuedNodes.has(node)) return;
    queuedNodes.add(node);
    pendingNodes.push(node);
  }

  function enqueueSubtree(root) {
    if (!root || savedWords.size === 0) return;
    if (root.nodeType === Node.TEXT_NODE) {
      enqueueTextNode(root);
    } else if (root.nodeType === Node.ELEMENT_NODE && !root.matches(SKIP_SELECTOR)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) enqueueTextNode(walker.currentNode);
    }
    scheduleDrain();
  }

  function highlightTextNode(node) {
    if (!node.isConnected || shouldSkip(node)) return;
    const text = node.nodeValue || '';
    const tokenPattern = /[\p{L}\p{M}\d']+/gu;
    let match;
    let lastIndex = 0;
    let found = false;
    const fragment = document.createDocumentFragment();

    while ((match = tokenPattern.exec(text))) {
      if (!savedWords.has(match[0].toLocaleLowerCase())) continue;
      found = true;
      if (match.index > lastIndex) fragment.append(text.slice(lastIndex, match.index));
      const span = document.createElement('span');
      span.className = 'pc-page-saved-word';
      span.dataset.pcWord = match[0].toLocaleLowerCase();
      span.textContent = match[0];
      fragment.append(span);
      lastIndex = match.index + match[0].length;
    }

    if (!found) return;
    if (lastIndex < text.length) fragment.append(text.slice(lastIndex));
    node.replaceWith(fragment);
  }

  function drain(deadline) {
    drainScheduled = false;
    let processed = 0;
    while (pendingNodes.length && processed < 250 && (!deadline || deadline.timeRemaining() > 1)) {
      const node = pendingNodes.shift();
      queuedNodes.delete(node);
      highlightTextNode(node);
      processed += 1;
    }
    if (pendingNodes.length) scheduleDrain();
  }

  function scheduleDrain() {
    if (drainScheduled || pendingNodes.length === 0) return;
    drainScheduled = true;
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(drain, { timeout: 120 });
    } else {
      setTimeout(() => drain({ timeRemaining: () => 8 }), 0);
    }
  }

  function refreshHighlights(words) {
    savedWords = new Set((words || []).map((word) => String(word).toLocaleLowerCase()));
    document.querySelectorAll('.pc-page-saved-word').forEach((span) => {
      if (savedWords.has(span.dataset.pcWord || '')) return;
      span.replaceWith(document.createTextNode(span.textContent || ''));
    });
    enqueueSubtree(document.body);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'WORDS_UPDATED') refreshHighlights(msg.savedWords);
  });

  // Optimistic path: the popup save handler calls this the moment the user
  // clicks "+ Add to dictionary", so page highlights appear immediately
  // instead of waiting for the server-confirmed WORDS_UPDATED broadcast.
  globalThis.PolycastContent = {
    ...(globalThis.PolycastContent || {}),
    addPageHighlights(words) {
      for (const word of words || []) {
        if (word) savedWords.add(String(word).toLocaleLowerCase());
      }
      enqueueSubtree(document.body);
    },
  };

  chrome.runtime.sendMessage({ type: 'GET_SAVED_WORDS' })
    .then((res) => refreshHighlights(res?.savedWords))
    .catch(() => {});

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(enqueueSubtree);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
