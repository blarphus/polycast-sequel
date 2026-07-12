import pool from '../db.js';
import { getImageBytes } from '../lib/imageCache.js';
import { searchAllImages } from '../lib/imageSearch.js';
import { NotFoundError, UpstreamError } from '../lib/httpErrors.js';
import { audioContentType, synthesizeVoiceFeedback } from './ttsService.js';

function usesTtsFallback(languageCode) {
  const language = String(languageCode || 'en').trim().toLowerCase().split(/[-_]/)[0];
  return language !== 'en' && language !== 'es';
}

export function createDictionaryMediaService({
  db = pool,
  fetchImpl = fetch,
  readImage = getImageBytes,
  searchImages = searchAllImages,
  synthesize = synthesizeVoiceFeedback,
} = {}) {
  return {
    async proxyImage(url) {
      let upstream;
      try {
        upstream = await fetchImpl(url);
      } catch (cause) {
        throw new UpstreamError('Image provider could not be reached', { code: 'image_proxy_unreachable', cause });
      }
      if (!upstream.ok) {
        throw new UpstreamError(`Image provider returned HTTP ${upstream.status}`, {
          code: 'image_proxy_upstream_failed',
        });
      }
      return {
        contentType: upstream.headers.get('content-type') || 'image/jpeg',
        data: Buffer.from(await upstream.arrayBuffer()),
      };
    },

    async cachedImage(id) {
      const image = await readImage(id);
      if (!image) throw new NotFoundError('Image not found', { code: 'dictionary_image_not_found' });
      return { contentType: image.content_type, data: image.data };
    },

    async search(term, { correlationId } = {}) {
      const fallbackNotices = [];
      const images = await searchImages(term, 12, {
        onFallback: (diagnostic) => fallbackNotices.push({ ...diagnostic, correlationId }),
      });
      return { images, fallbackNotices };
    },

    async updateWordImage(userId, id, { image_url, image_term }) {
      const { rows } = await db.query(
        `UPDATE saved_words SET image_url = $1, image_term = COALESCE($4, image_term)
         WHERE id = $2 AND user_id = $3 RETURNING *`,
        [image_url, id, userId, image_term ?? null],
      );
      if (!rows.length) throw new NotFoundError('Word not found', { code: 'dictionary_word_not_found' });
      return rows[0];
    },

    async wordAudio(userId, id) {
      const { rows } = await db.query(
        'SELECT tts_audio, word, target_language FROM saved_words WHERE id = $1 AND user_id = $2',
        [id, userId],
      );
      if (!rows.length) throw new NotFoundError('Word not found', { code: 'dictionary_word_not_found' });
      const row = rows[0];
      if (row.tts_audio) {
        return {
          audioBuffer: row.tts_audio,
          contentType: audioContentType(row.tts_audio),
          usedFallback: usesTtsFallback(row.target_language),
          source: 'cache',
          languageCode: row.target_language,
        };
      }
      const generated = await synthesize({ text: row.word, languageCode: row.target_language });
      await db.query('UPDATE saved_words SET tts_audio = $1 WHERE id = $2 AND user_id = $3', [
        generated.audioBuffer, id, userId,
      ]);
      return {
        audioBuffer: generated.audioBuffer,
        contentType: audioContentType(generated.audioBuffer),
        usedFallback: generated.usedFallback,
        source: 'generated',
        languageCode: row.target_language,
      };
    },
  };
}

export const dictionaryMediaService = createDictionaryMediaService();
