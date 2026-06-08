import logger from '../logger.js';

/**
 * Generate an image with OpenAI's GPT Image 2 (the /v1/images/generations API).
 * Returns { buffer, contentType } for the generated image, or throws.
 *
 * Uses OPENAI_IMAGE_API_KEY when set, else falls back to OPENAI_API_KEY — so the
 * image key can be separated from the shared OpenAI key (TTS) later without code
 * changes. Defaults to the cheapest "low" quality tier (~$0.006 per 1024x1024).
 */
export async function generateOpenAiImage(prompt, {
  model = 'gpt-image-2',
  size = '1024x1024',
  quality = 'low',
  outputFormat = 'webp',   // webp/jpeg compress to ~100-200KB vs ~1-2MB for png
  outputCompression = 80,  // 0-100; lower = smaller file
} = {}) {
  const apiKey = process.env.OPENAI_IMAGE_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_IMAGE_API_KEY / OPENAI_API_KEY is not configured');

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, prompt, size, quality, n: 1,
      output_format: outputFormat,
      output_compression: outputCompression,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    logger.error('OpenAI image API error: %s', errBody);
    throw new Error('OpenAI image request failed');
  }

  const data = await response.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) {
    logger.error('OpenAI image API returned no image: %s', JSON.stringify(data).slice(0, 500));
    throw new Error('OpenAI image returned no image content');
  }
  return { buffer: Buffer.from(b64, 'base64'), contentType: `image/${outputFormat}` };
}
