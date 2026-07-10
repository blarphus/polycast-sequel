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
  let recallChallenge = null;
  let recallCatalog = [];
  let recallTokenToWordId = new Map();
  const pageCandidateIds = new Set();
  let armScheduled = false;
  let drainScheduled = false;

  function formsFor(entry) {
    const forms = [entry.word, entry.lemma];
    try {
      const parsed = String(entry.forms || '').trim().startsWith('[') ? JSON.parse(entry.forms) : String(entry.forms || '').split(',');
      if (Array.isArray(parsed)) forms.push(...parsed);
    } catch { forms.push(...String(entry.forms || '').split(',')); }
    return forms.map((value) => String(value || '').trim().toLocaleLowerCase()).filter(Boolean);
  }

  function rebuildRecallIndex(catalog) {
    recallCatalog = Array.isArray(catalog) ? catalog : [];
    recallTokenToWordId = new Map();
    for (const entry of recallCatalog) {
      for (const token of formsFor(entry)) {
        if (!recallTokenToWordId.has(token)) recallTokenToWordId.set(token, entry.id);
      }
    }
  }

  function isRecallToken(token) {
    if (!recallChallenge) return false;
    return formsFor(recallChallenge).includes(token);
  }

  function showDiagnostic(message) {
    if (!message) return;
    const existing = document.querySelector('.pc-fallback-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'pc-fallback-toast';
    const title = document.createElement('strong');
    title.textContent = 'Wild Recall fallback';
    const detail = document.createElement('span');
    detail.textContent = message;
    toast.append(title, detail);
    document.body.append(toast);
    setTimeout(() => toast.remove(), 8000);
  }

  function refreshRecallClasses() {
    document.querySelectorAll('.pc-page-saved-word').forEach((span) => {
      span.classList.toggle('pc-page-recall-word', isRecallToken(span.dataset.pcWord || ''));
    });
  }

  function maybeArmRecall() {
    if (armScheduled || recallChallenge || pageCandidateIds.size === 0) return;
    armScheduled = true;
    setTimeout(() => {
      armScheduled = false;
      chrome.runtime.sendMessage({ type: 'MAYBE_ARM_WILD_RECALL', wordIds: [...pageCandidateIds] })
        .then((result) => {
          if (result?.challenge) {
            recallChallenge = result.challenge;
            refreshRecallClasses();
          }
          if (result?.diagnostic || result?.unavailable) showDiagnostic(result.diagnostic || result.unavailable);
        })
        .catch((err) => showDiagnostic(`Could not prepare a recall challenge: ${err.message}`));
    }, 0);
  }

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
      const token = match[0].toLocaleLowerCase();
      span.dataset.pcWord = token;
      if (isRecallToken(token)) span.classList.add('pc-page-recall-word');
      const candidateId = recallTokenToWordId.get(token);
      if (candidateId) pageCandidateIds.add(candidateId);
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
    if (pageCandidateIds.size) maybeArmRecall();
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
    maybeArmRecall();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'WORDS_UPDATED') refreshHighlights(msg.savedWords);
    if (msg.type === 'WILD_RECALL_UPDATED') {
      recallChallenge = msg.challenge || null;
      refreshRecallClasses();
      if (msg.diagnostic) showDiagnostic(msg.diagnostic);
    }
    if (msg.type === 'POLYCAST_FALLBACK_NOTICE') showDiagnostic(msg.message);
  });

  function escapeHtml(value) {
    const el = document.createElement('div');
    el.textContent = String(value || '');
    return el.innerHTML;
  }

  function closeRecallPopup() {
    document.querySelector('.pc-recall-popup')?.remove();
  }

  function openRecallPopup(anchor) {
    if (!recallChallenge) return;
    closeRecallPopup();
    const popup = document.createElement('div');
    popup.className = 'pc-recall-popup';
    popup.setAttribute('role', 'dialog');
    const rect = anchor.getBoundingClientRect();
    popup.style.left = `${Math.min(window.innerWidth - 340, Math.max(12, rect.left))}px`;
    popup.style.top = `${Math.min(window.innerHeight - 270, Math.max(12, rect.bottom + 10))}px`;
    popup.innerHTML = `
      <button class="pc-recall-close" aria-label="Close recall question">&times;</button>
      <div class="pc-recall-kicker">WILD RECALL</div>
      <strong>What does <em>${escapeHtml(recallChallenge.word)}</em> mean?</strong>
      <div class="pc-recall-options">${(recallChallenge.options || []).map((option) =>
        `<button type="button" data-option-id="${escapeHtml(option.id)}">${escapeHtml(option.text)}</button>`).join('')}</div>
      <div class="pc-recall-feedback" aria-live="polite"></div>`;
    document.body.append(popup);
    popup.querySelector('.pc-recall-close').addEventListener('click', closeRecallPopup);
    popup.querySelectorAll('[data-option-id]').forEach((button) => button.addEventListener('click', async () => {
      const optionId = button.dataset.optionId;
      popup.querySelectorAll('[data-option-id]').forEach((item) => { item.disabled = true; });
      const feedback = popup.querySelector('.pc-recall-feedback');
      feedback.textContent = 'Checking...';
      try {
        const result = await chrome.runtime.sendMessage({
          type: 'ANSWER_WILD_RECALL', challengeId: recallChallenge.id, optionId,
        });
        if (result?.capped) {
          feedback.textContent = 'Three recall attempts completed today.';
        } else if (result?.correct) {
          feedback.innerHTML = '<strong>Correct. +15 Recall XP</strong>';
          popup.classList.add('pc-recall-popup--correct');
        } else {
          feedback.innerHTML = `Correct answer: <strong>${escapeHtml(result?.correctAnswer || '')}</strong>. Try this word again tomorrow.`;
          popup.classList.add('pc-recall-popup--incorrect');
        }
        setTimeout(closeRecallPopup, 2100);
      } catch (err) {
        feedback.textContent = `Recall fallback: ${err.message}`;
      }
    }));
  }

  document.addEventListener('click', (event) => {
    const target = event.target.closest?.('.pc-page-recall-word');
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    openRecallPopup(target);
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

  Promise.all([
    chrome.runtime.sendMessage({ type: 'GET_SAVED_WORDS' }),
    chrome.runtime.sendMessage({ type: 'GET_WILD_RECALL_STATE' }),
  ])
    .then(([words, recall]) => {
      recallChallenge = recall?.challenge || null;
      rebuildRecallIndex(recall?.catalog || []);
      refreshHighlights(words?.savedWords);
      if (recall?.diagnostic) showDiagnostic(recall.diagnostic);
    })
    .catch((err) => showDiagnostic(`Wild Recall initialization fallback: ${err.message}`));

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(enqueueSubtree);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
