// ---------------------------------------------------------------------------
// netflix.js — MutationObserver on .player-timedtext for Netflix subtitles
// ---------------------------------------------------------------------------

(function initNetflix() {
  let subtitleObserver = null;
  let lastUrl = location.href;

  function processSubtitles() {
    const container = document.querySelector('.player-timedtext');
    if (!container) return;

    // Find leaf spans (no child elements, has text content)
    const spans = container.querySelectorAll('span');
    for (const span of spans) {
      if (span.children.length === 0 && span.textContent.trim()) {
        tokenizeElement(span);
      }
    }
  }

  function observeTimedText(timedText) {
    if (subtitleObserver) subtitleObserver.disconnect();

    subtitleObserver = new MutationObserver(() => {
      processSubtitles();
    });

    subtitleObserver.observe(timedText, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    processSubtitles();
  }

  function waitForTimedText() {
    const timedText = document.querySelector('.player-timedtext');
    if (timedText) {
      observeTimedText(timedText);
      return;
    }

    const bodyObserver = new MutationObserver(() => {
      const timedText = document.querySelector('.player-timedtext');
      if (timedText) {
        bodyObserver.disconnect();
        observeTimedText(timedText);
      }
    });

    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  // Handle Netflix SPA navigation (switching episodes)
  const navObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (subtitleObserver) subtitleObserver.disconnect();
      waitForTimedText();
    }
  });

  navObserver.observe(document.body, { childList: true, subtree: true });

  waitForTimedText();
})();
