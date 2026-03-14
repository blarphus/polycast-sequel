import logger from '../logger.js';

export async function callGemini(prompt, generationConfig = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
      }),
    },
  );

  if (!response.ok) {
    const errBody = await response.text();
    logger.error('Gemini API error: %s', errBody);
    throw new Error('Gemini request failed');
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    logger.error('Gemini API returned no text content: %s', JSON.stringify(data).slice(0, 500));
    throw new Error('Gemini returned no text content');
  }
  return text;
}

export async function streamGemini(
  prompt,
  {
    generationConfig = {},
    signal,
    onText,
  } = {},
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:streamGenerateContent?alt=sse',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
      }),
      signal,
    },
  );

  if (!response.ok) {
    const errBody = await response.text();
    logger.error('Gemini streaming API error: %s', errBody);
    throw new Error('Gemini streaming request failed');
  }

  if (!response.body) {
    throw new Error('Gemini streaming response had no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  const flushEvents = () => {
    let boundaryMatch = buffer.match(/\r?\n\r?\n/);
    while (boundaryMatch) {
      const boundaryIndex = boundaryMatch.index ?? -1;
      const eventBlock = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + boundaryMatch[0].length);

      const dataLines = eventBlock
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart());

      if (!dataLines.length) continue;

      const payload = JSON.parse(dataLines.join('\n'));
      const text = payload.candidates?.[0]?.content?.parts
        ?.map((part) => part?.text || '')
        .join('') || '';

      if (!text) continue;
      fullText += text;
      if (onText) {
        onText(text);
      }

      boundaryMatch = buffer.match(/\r?\n\r?\n/);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    flushEvents();
    if (done) break;
  }

  if (buffer.trim()) {
    flushEvents();
  }

  return fullText;
}

export function parseGeminiJson(raw, context) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    const error = new Error(`${context} returned invalid JSON`);
    error.cause = err;
    throw error;
  }
}

export function ensureGeminiKeys(parsed, keys, context) {
  for (const key of keys) {
    if (!(key in parsed)) {
      const error = new Error(`${context} omitted required field "${key}"`);
      error.context = { parsed };
      throw error;
    }
  }
}
