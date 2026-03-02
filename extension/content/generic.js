// ---------------------------------------------------------------------------
// generic.js — Subtitle detection for any video player (JWPlayer, Video.js,
// Plyr, MediaElement.js, Flowplayer, Dailymotion, Vidstack, and TextTrack API)
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

    // Strategy B: TextTrack API (renders our own overlay from track cues)
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

  // --- Strategy B: TextTrack API --------------------------------------------

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

        setupCueOverlay(video, track);
        return true;
      }
    }
    return false;
  }

  function setupCueOverlay(video, track) {
    // Create overlay positioned over the video
    const overlay = document.createElement('div');
    overlay.className = 'pc-cue-overlay';
    overlay.style.cssText = [
      'position:absolute',
      'bottom:10%',
      'left:50%',
      'transform:translateX(-50%)',
      'text-align:center',
      'pointer-events:auto',
      'z-index:999999',
      'max-width:80%',
      'color:white',
      'font-size:clamp(16px, 2.5vw, 28px)',
      'text-shadow:0 0 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.7)',
      'line-height:1.4',
    ].join(';');

    let wrapper = video.parentElement;
    if (!wrapper) return;
    if (getComputedStyle(wrapper).position === 'static') {
      wrapper.style.position = 'relative';
    }
    wrapper.appendChild(overlay);

    // Hide native subtitle rendering to prevent double display
    track.mode = 'hidden';

    function renderCues() {
      overlay.textContent = '';
      const cues = track.activeCues;
      if (!cues || cues.length === 0) return;

      for (const cue of cues) {
        const line = document.createElement('div');
        line.style.cssText =
          'background:rgba(0,0,0,0.7);padding:2px 8px;margin:2px 0;display:inline-block;border-radius:3px;';
        // VTTCue text may contain HTML-like tags — strip them
        line.textContent = cue.text.replace(/<[^>]*>/g, '');
        overlay.appendChild(line);
        tokenizeElement(line);
      }
    }

    track.addEventListener('cuechange', renderCues);

    // Handle user switching subtitle tracks
    video.textTracks.addEventListener('change', () => {
      for (const t of video.textTracks) {
        if (t === track) continue;
        if (
          (t.kind === 'subtitles' || t.kind === 'captions') &&
          t.mode === 'showing'
        ) {
          // Swap to the newly-enabled track
          track.removeEventListener('cuechange', renderCues);
          track = t;
          track.mode = 'hidden';
          track.addEventListener('cuechange', renderCues);
          renderCues();
          return;
        }
      }
    });

    // Render any cues that are already active
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

  // --- Phase 3: Subtitle observation (for known selector containers) --------

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
