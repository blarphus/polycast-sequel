// ---------------------------------------------------------------------------
// generic.js — Subtitle detection for any video player (JWPlayer, Video.js,
// Plyr, MediaElement.js, Flowplayer, Dailymotion, Vidstack, and heuristic)
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
  ];

  // Elements that are never subtitles
  const IGNORE_TAGS = new Set([
    'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'NAV',
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO',
  ]);

  let subtitleObserver = null;
  let removalObserver = null;

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

  // --- Phase 2: Subtitle container discovery --------------------------------

  function phase2() {
    // Strategy A: check known selectors
    const known = findKnownContainer();
    if (known) {
      phase3(known);
      return;
    }

    // Strategy B: heuristic detection
    heuristicDetection();
  }

  function findKnownContainer() {
    for (const sel of KNOWN_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function heuristicDetection() {
    const video = findLargestVideo();
    if (!video) return;

    // Walk up to find the player container (first positioned ancestor)
    let container = video.parentElement;
    for (let i = 0; i < 5 && container && container !== document.body; i++) {
      const pos = getComputedStyle(container).position;
      if (pos === 'relative' || pos === 'absolute' || pos === 'fixed') break;
      container = container.parentElement;
    }
    if (!container || container === document.body) {
      container = video.parentElement;
    }

    // Track text-change counts per element to identify subtitle containers
    const changeCounts = new WeakMap();
    const timeout = setTimeout(() => {
      heuristicWatcher.disconnect();
    }, DETECTION_TIMEOUT);

    // Periodically re-check known selectors (some players add them lazily)
    const selectorCheck = setInterval(() => {
      const known = findKnownContainer();
      if (known) {
        clearInterval(selectorCheck);
        clearTimeout(timeout);
        heuristicWatcher.disconnect();
        phase3(known);
      }
    }, 2000);

    const heuristicWatcher = new MutationObserver((mutations) => {
      // Check known selectors on each batch of mutations
      const known = findKnownContainer();
      if (known) {
        clearInterval(selectorCheck);
        clearTimeout(timeout);
        heuristicWatcher.disconnect();
        phase3(known);
        return;
      }

      for (const m of mutations) {
        const targets = [];

        if (m.type === 'characterData' && m.target.parentElement) {
          targets.push(m.target.parentElement);
        } else if (m.type === 'childList') {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1) targets.push(node);
          }
          if (targets.length === 0 && m.target.nodeType === 1) {
            targets.push(m.target);
          }
        }

        for (const el of targets) {
          if (IGNORE_TAGS.has(el.tagName)) continue;
          const text = el.textContent;
          if (!text || text.length > 300 || !text.trim()) continue;

          // Walk up to find the nearest container that holds this text
          let candidate = el;
          while (
            candidate.parentElement &&
            candidate.parentElement !== container &&
            candidate.parentElement.children.length === 1
          ) {
            candidate = candidate.parentElement;
          }

          const count = (changeCounts.get(candidate) || 0) + 1;
          changeCounts.set(candidate, count);

          if (count >= 2) {
            clearInterval(selectorCheck);
            clearTimeout(timeout);
            heuristicWatcher.disconnect();
            // Use the parent as the observation target for broader coverage
            const observeTarget = candidate.parentElement || candidate;
            phase3(observeTarget);
            return;
          }
        }
      }
    });

    heuristicWatcher.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // --- Phase 3: Subtitle observation ----------------------------------------

  function phase3(container) {
    if (subtitleObserver) subtitleObserver.disconnect();
    if (removalObserver) removalObserver.disconnect();

    function processSubtitles() {
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
