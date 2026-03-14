import { extract } from '@extractus/article-extractor';
import redisClient from '../redis.js';
import { truncateAtSentence } from './rssParser.js';

export function cleanExtractedArticleContent(content) {
  return content
    .replace(/<figure[\s\S]*?<\/figure>/gi, '')
    .replace(/<section[\s\S]*?<\/section>/gi, '')
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n\n## $1\n\n')
    .replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildArticlePreview(rawBody, maxChars = 900) {
  const normalized = rawBody
    .replace(/^##\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return null;
  if (normalized.length <= maxChars) return normalized;

  const snippet = normalized.slice(0, maxChars);
  const sentenceBoundary = Math.max(
    snippet.lastIndexOf('. '),
    snippet.lastIndexOf('! '),
    snippet.lastIndexOf('? '),
  );
  if (sentenceBoundary > maxChars * 0.45) {
    return snippet.slice(0, sentenceBoundary + 1).trim();
  }

  const clauseBoundary = Math.max(
    snippet.lastIndexOf('; '),
    snippet.lastIndexOf(': '),
    snippet.lastIndexOf(', '),
  );
  if (clauseBoundary > maxChars * 0.55) {
    return snippet.slice(0, clauseBoundary + 1).trim();
  }

  const wordBoundary = snippet.lastIndexOf(' ');
  const cutAt = wordBoundary > maxChars * 0.65 ? wordBoundary : maxChars;
  return `${snippet.slice(0, cutAt).trim()}...`;
}

async function readCachedArticleBody(rawCacheKey) {
  if (!redisClient.isReady) {
    throw new Error('Redis is not ready for article cache access');
  }
  return redisClient.get(rawCacheKey);
}

async function writeCachedArticleBody(rawCacheKey, rawBody) {
  if (!redisClient.isReady) {
    throw new Error('Redis is not ready for article cache writes');
  }
  await redisClient.set(rawCacheKey, rawBody, { EX: 21600 });
}

export async function extractAndCacheRawArticle({ lang, index, link }) {
  const rawCacheKey = `article3:raw:${lang}:${index}`;
  const cachedBody = await readCachedArticleBody(rawCacheKey);
  if (cachedBody) {
    return cachedBody;
  }

  if (!link) {
    throw new Error('Article link is missing');
  }

  const extracted = await extract(link, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Polycast/1.0)' },
  });
  if (!extracted?.content) {
    throw new Error(`Article extraction returned no content for ${link}`);
  }

  const rawBody = truncateAtSentence(cleanExtractedArticleContent(extracted.content));
  if (!rawBody) {
    throw new Error(`Article extraction returned empty body for ${link}`);
  }

  await writeCachedArticleBody(rawCacheKey, rawBody);
  return rawBody;
}
