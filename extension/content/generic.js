// ---------------------------------------------------------------------------
// generic.js — Subtitle detection for any video player (JWPlayer, Video.js,
// Plyr, MediaElement.js, Flowplayer, Dailymotion, Vidstack, and TextTrack API)
//
// Non-invasive: never modifies track.mode, never modifies existing element
// styles, never appends children to the player container.
// ---------------------------------------------------------------------------

(function initGeneric() {
  const DETECTION_TIMEOUT = 60000; // 60s

  // Known subtitle container selectors for popular players
  const KNOWN_SELECTORS = [
    '.jw-captions',              // JWPlayer
    '.jw-text-track-cue',        // JWPlayer (cue-level)
    '.vjs-text-track-display',   // Video.js / Brightcove
    '.plyr__captions',           // Plyr
    '.mejs__captions-layer',     // MediaElement.js
    '.fp-subtitle',              // Flowplayer
    '.dmp_SubtitleText',         // Dailymotion
    '[data-media-captions]',     // Vidstack
    '.shaka-text-container',     // Shaka Player
  ];

  let subtitleObserver = null;
  let removalObserver = null;
  let processing = false;

  // --- Phase 1: Video detection ---------------------------------------------

  function start() {
    const video = findLargestVideo();
    if (video) {
      phase2();
      return;
    }

    // Watch for a <video> to appear
    const timeout = setTimeout(() => videoWatcher.disconnect(), DETECTION_TIMEOUT);

    const videoWatcher = new MutationObserver(() => {
      if (findLargestVideo()) {
        videoWatcher.disconnect();
        clearTimeout(timeout);
        phase2();
      }
    });

    videoWatcher.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function findLargestVideo() {
    const videos = document.querySelectorAll('video');
    if (videos.length === 0) return null;
    if (videos.length === 1) return videos[0];

    let largest = null;
    let maxArea = 0;
    for (const v of videos) {
      const area = v.offsetWidth * v.offsetHeight;
      if (area > maxArea) {
        maxArea = area;
        largest = v;
      }
    }
    return largest;
  }

  // --- Phase 2: Subtitle source discovery -----------------------------------

  function phase2() {
    // Strategy A: Known CSS selectors
    const known = findKnownContainer();
    if (known) {
      phase3(known);
      return;
    }

    // Strategy B: TextTrack API — use cue timing to find the player's own
    // subtitle DOM elements, without modifying the track or player in any way
    const video = findLargestVideo();
    if (video && tryTextTracks(video)) return;

    // Strategy C: Wait for selectors or text tracks to appear
    waitForSubtitles();
  }

  function findKnownContainer() {
    for (const sel of KNOWN_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // --- Strategy B: TextTrack-guided DOM identification ----------------------
  //
  // Listen for cuechange events (read-only — never modify track.mode).
  // When a cue fires, search the DOM for an element whose text matches the
  // cue text. That element is what the player rendered — observe it (Phase 3).
  // If after several cues no DOM match is found, the player uses native
  // ::cue rendering, so we create our own fixed-position overlay.

  function tryTextTracks(video) {
    const tracks = video.textTracks;
    if (!tracks || tracks.length === 0) return false;

    for (const track of tracks) {
      if (
        (track.kind === 'subtitles' || track.kind === 'captions') &&
        track.mode !== 'disabled'
      ) {
        // Verify we can access cues (cross-origin tracks block access)
        try {
          if (track.cues === null) continue;
        } catch {
          continue;
        }

        listenForCues(video, track);
        return true;
      }
    }
    return false;
  }

  function listenForCues(video, track) {
    let domSearchAttempts = 0;
    const MAX_DOM_ATTEMPTS = 6;
    let resolved = false;

    function onCueChange() {
      if (resolved) return;

      let cues;
      try {
        cues = track.activeCues;
      } catch {
        return;
      }
      if (!cues || cues.length === 0) return;

      const cueText = cues[0].text.replace(/<[^>]*>/g, '').trim();
      if (!cueText) return;

      // Wait a frame for the player to render the cue in the DOM
      requestAnimationFrame(() => {
        if (resolved) return;

        // Re-check known selectors (player may add them when subtitles activate)
        const known = findKnownContainer();
        if (known) {
          resolved = true;
          track.removeEventListener('cuechange', onCueChange);
          phase3(known);
          return;
        }

        // Search the DOM for an element displaying this cue text
        const match = findMatchingElement(cueText, video);
        if (match) {
          resolved = true;
          track.removeEventListener('cuechange', onCueChange);
          // Walk up to find the subtitle container (highest ancestor whose
          // text still matches, then one more level for the wrapper)
          let container = match;
          while (
            container.parentElement &&
            container.parentElement !== document.body &&
            container.parentElement.textContent.trim() === cueText
          ) {
            container = container.parentElement;
          }
          phase3(container.parentElement || container);
          return;
        }

        domSearchAttempts++;
        if (domSearchAttempts >= MAX_DOM_ATTEMPTS) {
          // No DOM match — player uses native ::cue rendering.
          // Create our own overlay as a last resort.
          resolved = true;
          track.removeEventListener('cuechange', onCueChange);
          createCueOverlay(video, track);
        }
      });
    }

    track.addEventListener('cuechange', onCueChange);
    // Check immediately for already-active cues
    onCueChange();
  }

  function findMatchingElement(text, video) {
    const skip = new Set([
      'SCRIPT', 'STYLE', 'NOSCRIPT', 'VIDEO', 'AUDIO', 'CANVAS', 'SVG',
    ]);
    const normalized = text.replace(/\s+/g, ' ').trim();

    // Pass 1: leaf element (no children) with matching text — most precise
    const all = document.body.querySelectorAll('*');
    for (const el of all) {
      if (el === video || skip.has(el.tagName)) continue;
      if (
        el.children.length === 0 &&
        el.textContent.replace(/\s+/g, ' ').trim() === normalized
      ) {
        return el;
      }
    }

    // Pass 2: container element whose full text matches (subtitle split across
    // multiple child spans)
    for (const el of all) {
      if (el === video || el === document.body || skip.has(el.tagName)) continue;
      if (
        el.children.length > 0 &&
        el.textContent.replace(/\s+/g, ' ').trim() === normalized
      ) {
        return el;
      }
    }

    return null;
  }

  // --- Last-resort overlay (native ::cue rendering) -------------------------
  //
  // Appended to document.body with position:fixed. Never modifies existing
  // elements. Hides native cues with an injected CSS rule only.

  function createCueOverlay(video, track) {
    // Hide native ::cue rendering via CSS (does not affect DOM-rendered subs)
    const style = document.createElement('style');
    style.textContent = 'video::cue { visibility: hidden !important; }';
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'pc-cue-overlay';
    document.body.appendChild(overlay);

    function positionOverlay() {
      const rect = video.getBoundingClientRect();
      overlay.style.cssText = [
        'position:fixed',
        'left:' + (rect.left + rect.width * 0.1) + 'px',
        'width:' + (rect.width * 0.8) + 'px',
        'bottom:' + (window.innerHeight - rect.bottom + rect.height * 0.1) + 'px',
        'text-align:center',
        'pointer-events:auto',
        'z-index:2147483647',
        'color:white',
        'font-size:clamp(16px, 2.5vw, 28px)',
        'text-shadow:0 0 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.7)',
        'line-height:1.4',
      ].join(';');
    }

    function renderCues() {
      positionOverlay();
      overlay.textContent = '';

      let cues;
      try {
        cues = track.activeCues;
      } catch {
        return;
      }
      if (!cues || cues.length === 0) return;

      for (const cue of cues) {
        const line = document.createElement('div');
        line.style.cssText =
          'background:rgba(0,0,0,0.7);padding:2px 8px;margin:2px 0;display:inline-block;border-radius:3px;';
        line.textContent = cue.text.replace(/<[^>]*>/g, '');
        overlay.appendChild(line);
        tokenizeElement(line);
      }
    }

    track.addEventListener('cuechange', renderCues);
    window.addEventListener('resize', positionOverlay);
    renderCues();
  }

  // --- Strategy C: Wait for selectors or tracks to appear -------------------

  function waitForSubtitles() {
    const video = findLargestVideo();
    let settled = false;

    function cleanup() {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(poll);
      domWatcher.disconnect();
      if (video && video.textTracks) {
        video.textTracks.removeEventListener('addtrack', onAddTrack);
      }
    }

    const timeout = setTimeout(cleanup, DETECTION_TIMEOUT);

    // Periodically check known selectors and text tracks
    const poll = setInterval(() => {
      const known = findKnownContainer();
      if (known) {
        cleanup();
        phase3(known);
        return;
      }
      if (video && tryTextTracks(video)) {
        cleanup();
      }
    }, 2000);

    // Watch DOM for known selector containers appearing
    const domWatcher = new MutationObserver(() => {
      const known = findKnownContainer();
      if (known) {
        cleanup();
        phase3(known);
      }
    });
    domWatcher.observe(document.documentElement, { childList: true, subtree: true });

    // Listen for text tracks being added dynamically
    function onAddTrack() {
      if (video && tryTextTracks(video)) {
        cleanup();
      }
    }
    if (video && video.textTracks) {
      video.textTracks.addEventListener('addtrack', onAddTrack);
    }
  }

  // --- Phase 3: Subtitle observation ----------------------------------------

  function phase3(container) {
    if (subtitleObserver) subtitleObserver.disconnect();
    if (removalObserver) removalObserver.disconnect();

    function processSubtitles() {
      if (processing) return;
      processing = true;

      // Find leaf text elements (no child elements, has text content)
      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_ELEMENT,
        {
          acceptNode(node) {
            if (node.children.length === 0 && node.textContent.trim()) {
              return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_SKIP;
          },
        },
      );

      let node;
      while ((node = walker.nextNode())) {
        tokenizeElement(node);
      }

      processing = false;
    }

    subtitleObserver = new MutationObserver(() => {
      processSubtitles();
    });

    subtitleObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Process any existing subtitles immediately
    processSubtitles();

    // Watch for container removal (player destroyed on SPA navigation)
    watchForRemoval(container);
  }

  function watchForRemoval(container) {
    removalObserver = new MutationObserver(() => {
      if (!document.contains(container)) {
        if (subtitleObserver) subtitleObserver.disconnect();
        removalObserver.disconnect();
        // Restart detection from Phase 2
        phase2();
      }
    });

    removalObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // --- Kick off --------------------------------------------------------------
  start();
})();
