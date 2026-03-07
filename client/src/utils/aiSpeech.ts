let activeAudio: HTMLAudioElement | null = null;
let activeUrl: string | null = null;

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
 * Play TTS audio. If a preloaded object URL is provided, play it directly.
 * Otherwise, call the /speak endpoint to generate audio on-the-fly.
 */
export async function playAiSpeech(text: string, languageCode?: string, preloadedUrl?: string) {
  cleanup();

  if (preloadedUrl) {
    const audio = new Audio(preloadedUrl);
    activeAudio = audio;
    // Don't revoke preloaded URLs — they're managed by the caller
    activeUrl = null;
    audio.onended = () => { activeAudio = null; };
    await audio.play();
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
    } catch {
      // keep default
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  activeAudio = audio;
  activeUrl = url;
  audio.onended = cleanup;
  await audio.play();
}

/**
 * Preload TTS audio for a saved word via the caching endpoint.
 * Returns an object URL that can be passed to playAiSpeech.
 */
export async function preloadCardAudio(wordId: string): Promise<string> {
  const res = await fetch(`/api/dictionary/words/${wordId}/audio`, {
    credentials: 'include',
  });

  if (!res.ok) {
    throw new Error(`Failed to preload audio for word ${wordId}`);
  }

  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
