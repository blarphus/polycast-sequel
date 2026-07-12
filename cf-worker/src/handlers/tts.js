import { failureResponse, jsonResponse, readJsonBody } from '../http.js';

function baseLanguage(languageCode) {
  return String(languageCode || 'en').trim().toLowerCase().split(/[-_]/)[0] || 'en';
}

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function handleTts({ request, env, cors, correlationId }) {
  let body;
  try { body = await readJsonBody(request, 16_384); } catch (error) {
    return jsonResponse({ success: false, error: error.message }, 400, cors);
  }
  const text = String(body?.text || '').trim();
  if (!text || text.length > 4_000) return jsonResponse({ success: false, error: 'text must contain 1 to 4000 characters' }, 400, cors);
  const language = baseLanguage(body?.languageCode);
  if (!['en', 'es'].includes(language)) return jsonResponse({ success: false, error: `Cloudflare TTS does not support language: ${language}` }, 422, cors);
  try {
    if (language === 'es') {
      const audio = await env.AI.run('@cf/deepgram/aura-2-es', { text, speaker: 'aquila', encoding: 'mp3' });
      return new Response(audio, { status: 200, headers: { ...(cors || {}), 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
    }
    const result = await env.AI.run('@cf/myshell-ai/melotts', { prompt: text, lang: 'en' });
    const encodedAudio = typeof result === 'string' ? result : result?.audio;
    if (!encodedAudio) throw new Error('MeloTTS returned no audio');
    return new Response(decodeBase64(encodedAudio), { status: 200, headers: { ...(cors || {}), 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' } });
  } catch (error) {
    return failureResponse({
      code: 'tts_provider_failed', title: 'Speech synthesis unavailable',
      message: 'The Cloudflare speech provider failed, so the server may use its explicitly logged alternate provider.',
      operation: 'tts', detail: `language=${language}; reason=${error?.message || String(error)}`,
      correlationId, cors,
    });
  }
}
