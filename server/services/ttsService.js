/**
 * Shared OpenAI TTS synthesis service.
 * Used by voice practice (/speak) and dictionary audio caching.
 */
export async function synthesizeVoiceFeedback({ text, languageCode }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

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

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  return audioBuffer;
}
