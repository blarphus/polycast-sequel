import { fallbackDiagnostic } from '../diagnostics.js';
import { failureResponse, jsonResponse, providerFetch } from '../http.js';
import { parseJson3 } from '../youtubePayload.js';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export async function handleTranscript({ url, apiKey, cors, correlationId }) {
  const videoId = url.searchParams.get('videoId') || '';
  const lang = String(url.searchParams.get('lang') || 'en').slice(0, 20);
  if (!VIDEO_ID.test(videoId)) return jsonResponse({ success: false, error: 'videoId must be an 11-character YouTube ID' }, 400, cors);
  let playerData;
  try {
    const response = await providerFetch(
      `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: { client: { clientName: 'IOS', clientVersion: '20.10.4' } }, videoId }),
      },
    );
    if (!response.ok) return failureResponse({
      code: 'transcript_player_http_error', title: 'Transcript provider unavailable',
      message: 'The video provider did not return caption metadata.', operation: 'transcript',
      detail: `videoId=${videoId}; status=${response.status}`, status: response.status === 429 ? 429 : 502,
      correlationId, cors,
    });
    playerData = await response.json();
  } catch (error) {
    return failureResponse({
      code: error?.name === 'TimeoutError' ? 'transcript_player_timeout' : 'transcript_player_failed',
      title: 'Transcript provider unavailable', message: 'The caption metadata request failed.', operation: 'transcript',
      detail: `videoId=${videoId}; reason=${error?.message || String(error)}`, correlationId, cors,
    });
  }
  const playability = playerData?.playabilityStatus?.status;
  if (playability === 'LOGIN_REQUIRED' || playability === 'ERROR') return failureResponse({
    code: 'transcript_video_blocked', title: 'Transcript request blocked',
    message: 'The video provider blocked caption access for this video.', operation: 'transcript',
    detail: `videoId=${videoId}; playability=${playability}; reason=${playerData?.playabilityStatus?.reason || 'none'}`,
    status: 503, correlationId, cors,
  });
  const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!tracks.length) return jsonResponse({ success: false, error: 'No captions available for this video' }, 404, cors);
  const exactTrack = tracks.find((track) => track.languageCode === lang);
  const track = exactTrack || tracks[0];
  const fallbackNotices = exactTrack ? [] : [fallbackDiagnostic({
    code: 'caption_language_track_fallback', title: 'Caption language fallback used',
    message: `Captions in ${lang} were unavailable, so Polycast selected ${track.languageCode || 'the first available language'}.`,
    operation: 'transcript', correlationId,
    detail: `requestedLanguage=${lang}; selectedLanguage=${track.languageCode || 'unknown'}; videoId=${videoId}`,
  })];
  try {
    const timedTextUrl = track.baseUrl.replace(/&fmt=[^&]*/, '') + '&fmt=json3';
    const response = await providerFetch(timedTextUrl);
    if (!response.ok) return failureResponse({
      code: 'transcript_timedtext_http_error', title: 'Caption download failed',
      message: 'The selected caption track could not be downloaded.', operation: 'transcript',
      detail: `videoId=${videoId}; status=${response.status}`, status: response.status === 429 ? 429 : 502,
      correlationId, cors,
    });
    const segments = parseJson3(await response.json());
    if (!segments.length) return jsonResponse({ success: false, error: 'No captions available for this video/language' }, 404, cors);
    return jsonResponse({ success: true, kind: track.kind === 'asr' ? 'automatic' : 'human', selectedLanguage: track.languageCode || null, segments, fallback_notices: fallbackNotices }, 200, cors);
  } catch (error) {
    return failureResponse({
      code: error?.name === 'TimeoutError' ? 'transcript_timedtext_timeout' : 'transcript_timedtext_failed',
      title: 'Caption download failed', message: 'The selected caption track request failed.', operation: 'transcript',
      detail: `videoId=${videoId}; reason=${error?.message || String(error)}`, correlationId, cors,
    });
  }
}
