import { emitFallbackDiagnostic } from './fallbackDiagnostics';

let activeAudio: HTMLAudioElement | null = null;
let activeUrl: string | null = null;
let silenceAnalysisContext: AudioContext | null = null;

export interface PreloadedSpeech {
  url: string;
  usedFallback: boolean;
  startOffsetSeconds: number;
}

const SILENCE_FRAME_MS = 10;
const MIN_ACTIVE_FRAMES = 3;
const MAX_SILENCE_SCAN_SECONDS = 3;
const RMS_ACTIVITY_THRESHOLD = 0.004;
const PEAK_ACTIVITY_THRESHOLD = 0.012;
let silenceAnalysisFallbackReported = false;

function warnAboutFallback(languageCode?: string) {
  window.dispatchEvent(new CustomEvent('polycast:tts-fallback', {
    detail: { languageCode },
  }));
}

function cleanup() {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.src = '';
    activeAudio = null;
  }
  if (activeUrl) {
    URL.revokeObjectURL(activeUrl);
    activeUrl = null;
  }
}

export function stopAiSpeech() {
  cleanup();
}

/**
 * Find the first sustained audible frame in decoded PCM. Short isolated clicks
 * do not count as speech. The returned value is the amount of leading silence,
 * not the playback offset.
 */
export function detectLeadingSilenceSeconds(
  channels: Float32Array[],
  sampleRate: number,
): number {
  if (channels.length === 0 || sampleRate <= 0) return 0;
  const sampleCount = Math.min(...channels.map((channel) => channel.length));
  const frameSize = Math.max(1, Math.round(sampleRate * SILENCE_FRAME_MS / 1000));
  const scanSamples = Math.min(sampleCount, Math.round(sampleRate * MAX_SILENCE_SCAN_SECONDS));
  let activeFrames = 0;
  let firstActiveFrame = 0;

  for (let frameStart = 0; frameStart < scanSamples; frameStart += frameSize) {
    const frameEnd = Math.min(frameStart + frameSize, scanSamples);
    let sumSquares = 0;
    let peak = 0;
    let values = 0;

    for (const channel of channels) {
      for (let index = frameStart; index < frameEnd; index += 1) {
        const amplitude = Math.abs(channel[index] || 0);
        sumSquares += amplitude * amplitude;
        peak = Math.max(peak, amplitude);
        values += 1;
      }
    }

    const rms = values > 0 ? Math.sqrt(sumSquares / values) : 0;
    const active = rms >= RMS_ACTIVITY_THRESHOLD || peak >= PEAK_ACTIVITY_THRESHOLD;
    if (active) {
      if (activeFrames === 0) firstActiveFrame = frameStart;
      activeFrames += 1;
      if (activeFrames >= MIN_ACTIVE_FRAMES) return firstActiveFrame / sampleRate;
    } else {
      activeFrames = 0;
    }
  }

  return 0;
}

export function getSilenceTrimOffsetSeconds(
  channels: Float32Array[],
  sampleRate: number,
) {
  return detectLeadingSilenceSeconds(channels, sampleRate) / 2;
}

function reportSilenceAnalysisFallback(error: unknown) {
  if (silenceAnalysisFallbackReported) return;
  silenceAnalysisFallbackReported = true;
  emitFallbackDiagnostic({
    code: 'speech_silence_analysis_fallback',
    severity: 'warning',
    title: 'Audio silence trimming unavailable',
    message: 'Polycast could not analyze this browser audio, so the pronunciation will play without shortening its opening silence.',
    detail: error instanceof Error ? error.message : String(error),
  }, { source: 'web.speech', operation: 'analyze-leading-silence' });
}

async function prepareSpeechBlob(blob: Blob, usedFallback: boolean): Promise<PreloadedSpeech> {
  let startOffsetSeconds = 0;
  try {
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) throw new Error('Web Audio decoding is unavailable in this browser.');
    if (!silenceAnalysisContext || silenceAnalysisContext.state === 'closed') {
      silenceAnalysisContext = new AudioContextClass();
    }
    const decoded = await silenceAnalysisContext.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from(
      { length: decoded.numberOfChannels },
      (_, index) => decoded.getChannelData(index),
    );
    startOffsetSeconds = getSilenceTrimOffsetSeconds(channels, decoded.sampleRate);
  } catch (error) {
    reportSilenceAnalysisFallback(error);
  }

  return {
    url: URL.createObjectURL(blob),
    usedFallback,
    startOffsetSeconds,
  };
}

async function playPreparedSpeech(
  speech: PreloadedSpeech,
  languageCode?: string,
  revokeWhenFinished = false,
) {
  if (speech.usedFallback) warnAboutFallback(languageCode);
  const audio = new Audio(speech.url);
  activeAudio = audio;
  activeUrl = revokeWhenFinished ? speech.url : null;
  audio.onended = revokeWhenFinished ? cleanup : () => { activeAudio = null; };
  if (speech.startOffsetSeconds > 0) {
    if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise<void>((resolve, reject) => {
        audio.addEventListener('loadedmetadata', () => resolve(), { once: true });
        audio.addEventListener('error', () => reject(new Error('Prepared speech metadata could not load.')), { once: true });
        audio.load();
      });
    }
    audio.currentTime = Math.min(speech.startOffsetSeconds, Number.isFinite(audio.duration) ? audio.duration : speech.startOffsetSeconds);
  }
  await audio.play();
}

/**
 * Play TTS audio. If a preloaded object URL is provided, play it directly.
 * Otherwise, call the /speak endpoint to generate audio on-the-fly.
 */
export async function playAiSpeech(text: string, languageCode?: string, preloaded?: PreloadedSpeech) {
  cleanup();

  if (typeof window !== 'undefined' && window.localStorage.getItem('polycast.offline.enabled') === 'true') {
    return;
  }

  if (preloaded?.url) {
    // Don't revoke preloaded URLs — they're managed by the caller
    await playPreparedSpeech(preloaded, languageCode);
    return;
  }

  const trimmed = String(text || '').trim();
  if (!trimmed) return;

  const res = await fetch('/api/practice/voice/speak', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: trimmed,
      languageCode,
    }),
  });

  if (!res.ok) {
    let message = 'Failed to synthesize speech';
    try {
      const payload = await res.json();
      message = payload.error || payload.message || message;
    } catch (error) {
      emitFallbackDiagnostic({
        code: 'speech_error_payload_fallback',
        severity: 'warning',
        title: 'Speech error details unavailable',
        message: 'The speech service returned a non-JSON error, so Polycast is showing its default failure message.',
        detail: `status=${res.status}; reason=${error instanceof Error ? error.message : String(error)}`,
      }, { source: 'web.speech', operation: 'parse-speech-error' });
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const speech = await prepareSpeechBlob(blob, Boolean(res.headers.get('X-Polycast-TTS-Fallback')));
  await playPreparedSpeech(speech, languageCode, true);
}

/**
 * Preload TTS audio for a saved word via the caching endpoint.
 * Returns an object URL that can be passed to playAiSpeech.
 */
export async function preloadCardAudio(wordId: string): Promise<PreloadedSpeech> {
  if (typeof window !== 'undefined' && window.localStorage.getItem('polycast.offline.enabled') === 'true') {
    return { url: '', usedFallback: false, startOffsetSeconds: 0 };
  }

  const res = await fetch(`/api/dictionary/words/${wordId}/audio`, {
    credentials: 'include',
  });

  if (!res.ok) {
    throw new Error(`Failed to preload audio for word ${wordId}`);
  }

  const blob = await res.blob();
  return prepareSpeechBlob(blob, Boolean(res.headers.get('X-Polycast-TTS-Fallback')));
}

/**
 * Preload the exact text a flashcard side will speak. This includes example
 * sentences, which are not covered by the saved word's cached audio endpoint.
 */
export async function preloadAiSpeech(text: string, languageCode?: string): Promise<PreloadedSpeech> {
  if (typeof window !== 'undefined' && window.localStorage.getItem('polycast.offline.enabled') === 'true') {
    return { url: '', usedFallback: false, startOffsetSeconds: 0 };
  }

  const trimmed = String(text || '').trim();
  if (!trimmed) return { url: '', usedFallback: false, startOffsetSeconds: 0 };

  const res = await fetch('/api/practice/voice/speak', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: trimmed, languageCode }),
  });

  if (!res.ok) {
    throw new Error(`Failed to preload speech (${res.status})`);
  }

  return prepareSpeechBlob(
    await res.blob(),
    Boolean(res.headers.get('X-Polycast-TTS-Fallback')),
  );
}
