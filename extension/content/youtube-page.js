// ---------------------------------------------------------------------------
// youtube-page.js — Page-world bridge for YouTube caption language detection
// ---------------------------------------------------------------------------

(function initPolycastYouTubePageBridge() {
  if (window.__polycastCaptionLangBridgeInstalled) return;
  window.__polycastCaptionLangBridgeInstalled = true;

  // YouTube remembers the last translation language across videos, so after a
  // Spanish video the next Portuguese video comes up auto-translated to
  // Spanish. Once per video, if the active track is a translation (or not in
  // the audio language), reset it to the video's own language. The audio
  // language is read from the ASR (auto-generated) track, whose vss_id is
  // "a.<lang>". Only done once per video so a manual change afterwards sticks.
  let enforcedVideoId = '';

  function enforceAudioLanguageTrack(player) {
    if (
      typeof player.getOption !== 'function' ||
      typeof player.setOption !== 'function' ||
      typeof player.getPlayerResponse !== 'function'
    ) return;

    const videoId = (typeof player.getVideoData === 'function' && player.getVideoData()?.video_id) || '';
    if (!videoId || videoId === enforcedVideoId) return;

    const track = player.getOption('captions', 'track');
    // Captions off — nothing active to correct. Don't mark the video as
    // handled, so captions the user turns on later still get corrected once.
    if (!track || !track.languageCode) return;

    // getOption('captions', 'tracklist') is often empty, so read the track
    // list from the player response instead. The ASR (auto-generated) track
    // is always in the video's own audio language.
    const captionTracks =
      player.getPlayerResponse()?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const asrTrack = captionTracks.find((t) => t.kind === 'asr');
    const audioLang = asrTrack ? asrTrack.languageCode : '';

    enforcedVideoId = videoId;
    if (!audioLang) return;

    const isTranslating = !!track.translationLanguage;
    if (isTranslating || track.languageCode !== audioLang) {
      player.setOption('captions', 'track', { languageCode: audioLang });
    }
  }

  function publishCaptionLanguage() {
    try {
      const player = document.getElementById('movie_player');
      if (!player || typeof player.getOption !== 'function') return;

      enforceAudioLanguageTrack(player);

      const track = player.getOption('captions', 'track');
      const lang = track ? track.languageCode : '';
      document.dispatchEvent(new CustomEvent('pc-caption-lang', { detail: lang }));
    } catch (err) {
      // YouTube's player object changes shape during navigation; the guard above
      // catches the common not-ready case, so anything reaching here is worth
      // surfacing. We still retry on the next poll.
      document.dispatchEvent(new CustomEvent('pc-page-diagnostic', { detail: {
        code: 'youtube_caption_bridge_retry',
        severity: 'warning',
        title: 'YouTube caption bridge retrying',
        message: 'YouTube changed its player state while Polycast was reading the active caption language. Polycast will retry on the next poll.',
        source: 'extension.youtube-page',
        operation: 'read-caption-language',
        correlationId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        detail: err?.message || String(err),
      } }));
    }
  }

  publishCaptionLanguage();
  window.setInterval(publishCaptionLanguage, 2500);
})();
