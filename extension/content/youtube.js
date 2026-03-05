// ---------------------------------------------------------------------------
// youtube.js — MutationObserver on .ytp-caption-segment for YouTube subtitles
// ---------------------------------------------------------------------------

(function initYouTube() {
  let subtitleObserver = null;
  let captionLang = '';
  let langPollInterval = null;

  // -- Caption language detection via page-context injection ----------------

  // YouTube doesn't populate standard video.textTracks — we must read from
  // their proprietary player API which lives in the page's JS world.
  // Content scripts can't access page objects, so we inject a <script> that
  // reads the caption track and posts the language back via a CustomEvent.

  const INJECTED_SCRIPT = `
    (function() {
      var player = document.getElementById('movie_player');
      if (!player || !player.getOption) return;
      var track = player.getOption('captions', 'track');
      var lang = track ? track.languageCode : '';
      document.dispatchEvent(new CustomEvent('pc-caption-lang', { detail: lang }));
    })();
  `;

  function injectLangCheck() {
    const script = document.createElement('script');
    script.textContent = INJECTED_SCRIPT;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  document.addEventListener('pc-caption-lang', (e) => {
    captionLang = (e.detail || '').toLowerCase();
  });

  function startLangPolling() {
    if (langPollInterval) return;
    // Check immediately, then every 2.5 seconds
    injectLangCheck();
    langPollInterval = setInterval(injectLangCheck, 2500);
  }

  // -- Untokenize: strip .pc-word spans back to plain text ------------------

  function untokenizeAll() {
    const segments = document.querySelectorAll('.ytp-caption-segment');
    for (const seg of segments) {
      if (seg.dataset.pcTokenized) {
        seg.textContent = seg.dataset.pcTokenized;
        delete seg.dataset.pcTokenized;
      }
    }
  }

  // -- Subtitle processing --------------------------------------------------

  function processSubtitles() {
    // Skip if caption language doesn't match target (or target not loaded yet)
    if (targetLanguage && captionLang && !captionLang.startsWith(targetLanguage)) {
      untokenizeAll();
      return;
    }

    const segments = document.querySelectorAll('.ytp-caption-segment');
    for (const seg of segments) {
      tokenizeElement(seg);
    }
  }

  function observePlayer(player) {
    if (subtitleObserver) subtitleObserver.disconnect();

    subtitleObserver = new MutationObserver((mutations) => {
      let hasSubtitleChange = false;
      for (const m of mutations) {
        if (m.type === 'characterData') {
          hasSubtitleChange = true;
          break;
        }
        if (m.type === 'childList') {
          const target = m.target;
          if (
            target.classList?.contains('caption-window') ||
            target.classList?.contains('ytp-caption-segment') ||
            target.querySelector?.('.ytp-caption-segment') ||
            target.closest?.('.caption-window')
          ) {
            hasSubtitleChange = true;
            break;
          }
          // Check added nodes
          for (const node of m.addedNodes) {
            if (node.nodeType === 1 && (
              node.classList?.contains('caption-window') ||
              node.classList?.contains('ytp-caption-segment') ||
              node.querySelector?.('.ytp-caption-segment')
            )) {
              hasSubtitleChange = true;
              break;
            }
          }
          if (hasSubtitleChange) break;
        }
      }
      if (hasSubtitleChange) processSubtitles();
    });

    subtitleObserver.observe(player, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Start polling for caption language and process any existing subtitles
    startLangPolling();
    processSubtitles();
  }

  // Wait for #movie_player to appear
  function waitForPlayer() {
    const player = document.getElementById('movie_player');
    if (player) {
      observePlayer(player);
      return;
    }

    const bodyObserver = new MutationObserver(() => {
      const player = document.getElementById('movie_player');
      if (player) {
        bodyObserver.disconnect();
        observePlayer(player);
      }
    });

    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  waitForPlayer();
})();
