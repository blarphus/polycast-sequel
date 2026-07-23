import logger from '../logger.js';

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const GEMINI_MAX_ATTEMPTS = 3;

export const GEMINI_GENERAL_MODEL = 'gemini-3.6-flash';
export const GEMINI_DICTIONARY_MODEL = 'gemini-3.5-flash';
export const GEMINI_FLASH_LITE_MODEL = 'gemini-3.5-flash-lite';
export const GEMINI_GENERAL_THINKING_LEVEL = 'LOW';
export const GEMINI_DICTIONARY_THINKING_LEVEL = 'MINIMAL';
export const GEMINI_FLASH_LITE_THINKING_LEVEL = 'MINIMAL';

function withDefaultThinkingLevel(generationConfig, defaultThinkingLevel) {
  const thinkingConfig = generationConfig.thinkingConfig || {};
  if (Object.hasOwn(thinkingConfig, 'thinkingBudget')) {
    throw new Error('Gemini thinkingBudget is unsupported; use thinkingLevel instead');
  }
  return {
    ...generationConfig,
    thinkingConfig: {
      ...thinkingConfig,
      thinkingLevel: thinkingConfig.thinkingLevel || defaultThinkingLevel,
    },
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function responseErrorMessage(body, status) {
  try {
    const parsed = JSON.parse(body);
    const detail = parsed?.error?.message;
    return detail ? `Gemini request failed (${status}): ${detail}` : `Gemini request failed (${status})`;
  } catch (error) {
    logger.warn({
      event: 'gemini_error_payload_fallback',
      status,
      responseLength: body.length,
      err: error,
    }, 'Gemini returned a non-JSON error; using the HTTP status message');
    return `Gemini request failed (${status})`;
  }
}

async function requestGemini(url, options, label) {
  let lastError;
  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;

      const errBody = await response.text();
      const error = new Error(responseErrorMessage(errBody, response.status));
      error.retryable = RETRYABLE_STATUS_CODES.has(response.status);
      lastError = error;
      logger.warn('%s API attempt %d/%d failed: %s', label, attempt, GEMINI_MAX_ATTEMPTS, error.message);
      if (!error.retryable || attempt === GEMINI_MAX_ATTEMPTS) throw error;
    } catch (err) {
      lastError = err;
      if (err.retryable === false || attempt === GEMINI_MAX_ATTEMPTS) throw err;
      logger.warn('%s API attempt %d/%d failed: %s', label, attempt, GEMINI_MAX_ATTEMPTS, err.message);
    }
    await wait(250 * (2 ** (attempt - 1)));
  }
  throw lastError;
}

export async function callGemini(prompt, generationConfig = {}, model = GEMINI_GENERAL_MODEL) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const resolvedGenerationConfig = withDefaultThinkingLevel(
    generationConfig,
    GEMINI_GENERAL_THINKING_LEVEL,
  );

  const response = await requestGemini(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: resolvedGenerationConfig,
      }),
    },
    'Gemini',
  );

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    logger.error('Gemini API returned no text content: %s', JSON.stringify(data).slice(0, 500));
    throw new Error('Gemini returned no text content');
  }
  return text;
}

/**
 * Multimodal Gemini call. `parts` is a ready-built array of content parts, e.g.
 * [{ text }, { inlineData: { mimeType, data: base64 } }, ...]. Returns the
 * model's text response. Used to have the model look at candidate images and
 * pick the best flashcard illustration.
 */
export async function callGeminiVision(parts, generationConfig = {}, model = GEMINI_GENERAL_MODEL) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const resolvedGenerationConfig = withDefaultThinkingLevel(
    generationConfig,
    GEMINI_GENERAL_THINKING_LEVEL,
  );

  const response = await requestGemini(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: resolvedGenerationConfig,
      }),
    },
    'Gemini vision',
  );

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    logger.error('Gemini vision API returned no text content: %s', JSON.stringify(data).slice(0, 500));
    throw new Error('Gemini vision returned no text content');
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

  const resolvedGenerationConfig = withDefaultThinkingLevel(
    generationConfig,
    GEMINI_GENERAL_THINKING_LEVEL,
  );

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_GENERAL_MODEL}:streamGenerateContent?alt=sse`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: resolvedGenerationConfig,
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
  // Gemini occasionally wraps JSON in markdown fences or pads it with prose
  // even when responseMimeType is application/json. Try progressively more
  // aggressive salvage before failing: raw → fence-stripped → outermost {...}.
  const text = String(raw);
  const candidates = [text];
  const unfenced = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  if (unfenced !== text) candidates.push(unfenced);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));

  let firstErr;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      firstErr = firstErr || err;
    }
  }
  logger.error('%s returned invalid JSON: %s', context, text.slice(0, 300));
  const error = new Error(`${context} returned invalid JSON`);
  error.cause = firstErr;
  throw error;
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
