// ---------------------------------------------------------------------------
// youtube.js — MutationObserver on .ytp-caption-segment for YouTube subtitles
// ---------------------------------------------------------------------------

(function initYouTube() {
  let subtitleObserver = null;
  let controlsObserver = null;
  let observedPlayer = null;
  let observedCaptionRoot = null;
  let subtitleFrame = null;
  let captionLang = '';
  let captionPositionRecoveryArmed = false;
  let captionPositionRecoveryApplied = false;

  const SUBTITLE_OBSERVER_OPTIONS = {
    childList: true,
    subtree: true,
    characterData: true,
  };

  // YouTube raises native captions while its playback controls are visible.
  // Pausing to open a word popup can leave that inline offset stuck after the
  // controls hide. Recover only for that interaction, and stop overriding the
  // caption window as soon as YouTube shows its controls again.
  function controlsAreHidden(player) {
    return player.classList.contains('ytp-autohide');
  }

  function syncCaptionPositionRecovery(player) {
    if (!captionPositionRecoveryArmed) {
      if (player.classList.contains('pc-caption-position-recovery')) {
        player.classList.remove('pc-caption-position-recovery');
      }
      return;
    }

    if (controlsAreHidden(player)) {
      if (player.classList.contains('pc-caption-position-recovery')) return;
      player.classList.add('pc-caption-position-recovery');
      captionPositionRecoveryApplied = true;
      // Also nudge YouTube's own caption layout calculation so its inline
      // position is corrected before our temporary CSS fallback is removed.
      window.dispatchEvent(new Event('resize'));
    } else {
      if (player.classList.contains('pc-caption-position-recovery')) {
        player.classList.remove('pc-caption-position-recovery');
      }
      if (captionPositionRecoveryApplied) {
        captionPositionRecoveryArmed = false;
        captionPositionRecoveryApplied = false;
      }
    }
  }

  document.addEventListener('click', (event) => {
    if (!event.target.closest?.('.pc-word')) return;
    const player = document.getElementById('movie_player');
    if (!player) return;
    captionPositionRecoveryArmed = true;
    syncCaptionPositionRecovery(player);
  }, true);

  // -- Caption language detection via page-context bridge -------------------

  // YouTube doesn't populate standard video.textTracks — we must read from
  // their proprietary player API which lives in the page's JS world.
  // Content scripts can't access page objects, so we inject an extension file
  // into the page context. Keeping it in a file avoids YouTube's inline-script
  // Content Security Policy block.

  function injectPageBridge() {
    if (document.documentElement.dataset.pcCaptionBridgeInjected === 'true') return;
    document.documentElement.dataset.pcCaptionBridgeInjected = 'true';

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('content/youtube-page.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  document.addEventListener('pc-caption-lang', (e) => {
    captionLang = (e.detail || '').toLowerCase();
    document.dispatchEvent(new CustomEvent('pc-polycast-page-language', { detail: captionLang }));
    maybeSwitchTargetLanguage(captionLang);
    scheduleSubtitleProcessing();
  });

  document.addEventListener('pc-page-diagnostic', (event) => {
    const diagnostic = event.detail || {};
    showFallbackToast(diagnostic.title, diagnostic.message, diagnostic);
  });

  // -- Auto-switch learning language to the subtitle language ----------------

  // Watching subtitles in a language other than the current target switches
  // the account's learning language to match, so tokenization/saving work on
  // whatever the user is actually watching. The background guards against
  // switching to the user's native language.
  let lastRequestedLang = '';

  function maybeSwitchTargetLanguage(lang) {
    const base = (lang || '').split('-')[0];
    if (!base || base === lastRequestedLang) return;
    if (targetLanguage && targetLanguage.startsWith(base)) return;
    lastRequestedLang = base;
    chrome.runtime.sendMessage({ type: 'CAPTION_LANGUAGE_DETECTED', languageCode: base })
      .catch((err) => showFallbackToast('Caption language update failed', 'Polycast could not align the learning language with this caption track.', {
        code: 'caption_language_switch_failed',
        severity: 'error',
        source: 'extension.youtube',
        operation: 'switch-target-language',
        correlationId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        detail: err?.message || String(err),
      }));
  }

  // -- Untokenize: strip .pc-word spans back to plain text ------------------

  function untokenizeAll(root = document) {
    const segments = root.querySelectorAll('.ytp-caption-segment');
    for (const seg of segments) {
      if (seg.dataset.pcTokenized) {
        seg.textContent = seg.dataset.pcTokenized;
        delete seg.dataset.pcTokenized;
      }
    }
  }

  // -- Subtitle processing --------------------------------------------------

  function processSubtitles(root = document) {
    // Skip if caption language doesn't match target (or target not loaded yet)
    if (targetLanguage && captionLang && !captionLang.startsWith(targetLanguage)) {
      untokenizeAll(root);
      return;
    }

    const segments = root.querySelectorAll('.ytp-caption-segment');
    for (const seg of segments) {
      tokenizeElement(seg);
    }
  }

  function scheduleSubtitleProcessing() {
    if (!observedCaptionRoot || subtitleFrame !== null) return;

    subtitleFrame = requestAnimationFrame(() => {
      subtitleFrame = null;
      const root = observedCaptionRoot;
      if (!root || !root.isConnected) return;

      // Tokenization rewrites caption nodes. Disconnect while doing that work
      // so Polycast's own DOM changes cannot schedule another processing pass.
      subtitleObserver.disconnect();
      processSubtitles(root);
      if (root === observedCaptionRoot && root.isConnected) {
        subtitleObserver.observe(root, SUBTITLE_OBSERVER_OPTIONS);
      }
    });
  }

  function observeCaptionRoot(root) {
    if (subtitleObserver) subtitleObserver.disconnect();
    if (subtitleFrame !== null) {
      cancelAnimationFrame(subtitleFrame);
      subtitleFrame = null;
    }

    observedCaptionRoot = root;
    if (!root) return;

    subtitleObserver = new MutationObserver(scheduleSubtitleProcessing);
    subtitleObserver.observe(root, SUBTITLE_OBSERVER_OPTIONS);
    scheduleSubtitleProcessing();
  }

  function observePlayer(player) {
    if (controlsObserver) controlsObserver.disconnect();
    observedPlayer = player;
    if (!player) return;

    controlsObserver = new MutationObserver(() => {
      syncCaptionPositionRecovery(player);
    });
    controlsObserver.observe(player, {
      attributes: true,
      attributeFilter: ['class'],
    });

    // Start the page-context bridge. Subtitle observation is attached only to
    // YouTube's caption container by refreshBindings().
    injectPageBridge();
  }

  function refreshBindings() {
    const player = document.getElementById('movie_player');
    if (player !== observedPlayer) {
      observePlayer(player);
    }

    const captionRoot = player?.querySelector('.ytp-caption-window-container') || null;
    if (captionRoot !== observedCaptionRoot) {
      observeCaptionRoot(captionRoot);
    }
  }

  function handleNavigation() {
    refreshBindings();
    setTimeout(refreshBindings, 500);
  }

  document.addEventListener('yt-navigate-finish', handleNavigation);
  refreshBindings();
  setInterval(refreshBindings, 1000);
})();
