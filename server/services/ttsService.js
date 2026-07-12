import { synthesizeWorkerSpeech } from './mediaWorkerService.js';

async function synthesizeWithOpenAi({ text, languageCode }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('No TTS provider supports this language');

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      response_format: 'mp3',
      input: text,
      instructions: [
        'You are a concise language tutor.',
        languageCode ? `Speak naturally in ${languageCode}.` : null,
        'Keep the delivery short, clear, and encouraging.',
      ].filter(Boolean).join(' '),
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(errBody || 'OpenAI speech synthesis failed');
  }

  return {
    audioBuffer: Buffer.from(await response.arrayBuffer()),
    usedFallback: true,
  };
}

export function audioContentType(audioBuffer) {
  const isWave = audioBuffer.length >= 12
    && audioBuffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && audioBuffer.subarray(8, 12).toString('ascii') === 'WAVE';
  return isWave ? 'audio/wav' : 'audio/mpeg';
}

/** Shared TTS service. Cloudflare handles English and Spanish. */
export async function synthesizeVoiceFeedback({ text, languageCode, userId, correlationId }) {
  try {
    return {
      audioBuffer: await synthesizeWorkerSpeech(text, languageCode, { userId, correlationId }),
      usedFallback: false,
    };
  } catch (error) {
    if (error.upstreamStatus !== 422) throw error;
    return synthesizeWithOpenAi({ text, languageCode });
  }
}
