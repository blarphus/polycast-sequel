// ---------------------------------------------------------------------------
// youtube.js — MutationObserver on .ytp-caption-segment for YouTube subtitles
// ---------------------------------------------------------------------------

(function initYouTube() {
  let subtitleObserver = null;

  function processSubtitles() {
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

    // Process any existing subtitles
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
