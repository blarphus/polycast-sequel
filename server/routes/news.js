import { Router } from 'express';
import { z } from 'zod';
import redisClient from '../redis.js';
import pool from '../db.js';
import { authMiddleware } from '../auth.js';
import { callGemini, streamGemini } from '../lib/gemini.js';
import { getUserLanguagePrefs } from '../lib/userQueries.js';
import { estimateCefrLevel } from '../lib/cefrDifficulty.js';
import { validate } from '../lib/validate.js';
import { parseRssItems } from '../lib/rssParser.js';
import { extractAndCacheRawArticle, buildArticlePreview } from '../lib/articleCache.js';

const router = Router();

const newsQuery = z.object({
  lang: z.string().min(1, 'lang query parameter is required'),
});

const articleQuery = z.object({
  lang: z.string().min(1, 'lang is required'),
  index: z.coerce.number().int().min(0).max(9, 'index must be 0-9'),
  level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).optional(),
});

const articleStreamQuery = z.object({
  lang: z.string().min(1, 'lang is required'),
  index: z.coerce.number().int().min(0).max(9, 'index must be 0-9'),
  level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']),
});

const LANG_FEEDS = {
  en: [
    { url: 'https://rss.dw.com/rdf/rss-en-all', source: 'DW' },
    { url: 'https://feeds.bbci.co.uk/news/rss.xml', source: 'BBC' },
  ],
  es: [
    { url: 'https://feeds.bbci.co.uk/mundo/rss.xml', source: 'BBC Mundo' },
    { url: 'https://www.france24.com/es/rss', source: 'France 24' },
  ],
  pt: [
    { url: 'https://feeds.folha.uol.com.br/emcimadahora/rss091.xml', source: 'Folha' },
    { url: 'https://g1.globo.com/rss/g1/', source: 'G1' },
  ],
  fr: [
    { url: 'https://www.france24.com/fr/rss', source: 'France 24' },
    { url: 'https://www.lemonde.fr/rss/une.xml', source: 'Le Monde' },
  ],
  ja: [{ url: 'https://www3.nhk.or.jp/rss/news/cat0.xml', source: 'NHK' }],
  de: [{ url: 'https://rss.dw.com/rdf/rss-de-all', source: 'DW' }],
};

/**
 * GET /api/news
 * Fetch news headlines for a language with offline CEFR difficulty estimation.
 * Cached in Redis for 6 hours.
 */
router.get('/api/news', authMiddleware, validate({ query: newsQuery }), async (req, res) => {
  try {
    const lang = req.query.lang.toLowerCase();

    const feeds = LANG_FEEDS[lang];
    if (!feeds) {
      return res.status(400).json({ error: `Unsupported language: ${lang}` });
    }

    const cacheKey = `news8:${lang}`;

    if (!redisClient.isReady) {
      throw new Error('Redis is not ready for news cache access');
    }

    const cached = await redisClient.get(cacheKey);

    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const feedResults = await Promise.all(
      feeds.map(async (feed) => {
        const rssRes = await fetch(feed.url, {
          headers: { 'User-Agent': 'Polycast/1.0' },
        });
        if (!rssRes.ok) {
          throw new Error(`RSS fetch failed for ${feed.source} with status ${rssRes.status}`);
        }

        const buf = Buffer.from(await rssRes.arrayBuffer());
        const ctCharset = rssRes.headers.get('content-type')?.match(/charset=([^\s;]+)/i)?.[1];
        const xmlCharset = buf.toString('ascii').match(/<\?xml[^>]+encoding=["']([^"']+)["']/i)?.[1];
        const charset = (ctCharset || xmlCharset || 'utf-8').toLowerCase();
        const decoder = new TextDecoder(charset === 'iso-8859-1' || charset === 'latin1' ? 'windows-1252' : charset);
        const rssXml = decoder.decode(buf);
        return parseRssItems(rssXml, feed.source);
      }),
    );

    // Merge all items, keep only those with images, drop spam, sort by pubDate descending
    const SPAM_PATTERNS = [
      /lotof[aá]cil/i,
      /mega.?sena/i,
      /quina\s+de/i,
      /resultado.*loterias/i,
    ];
    const allItems = feedResults.flat()
      .filter((item) => item.image)
      .filter((item) => !SPAM_PATTERNS.some((re) => re.test(item.title)))
      .sort((a, b) => {
        const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
        const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
        return db - da;
      });

    if (allItems.length === 0) {
      return res.json([]);
    }

    const items = allItems.slice(0, 10);

    const extractedItems = await Promise.all(
      items.map((item, index) =>
        extractAndCacheRawArticle({ lang, index, link: item.link })
          .catch((err) => {
            req.log.error('Article extraction failed for %s: %s', item.link, err.message);
            return '';
          }),
      ),
    );

    // Build response with offline CEFR estimation (no Gemini)
    const result = items.map((item, index) => ({
      original_title: item.title,
      simplified_title: item.title,
      difficulty: estimateCefrLevel([{ text: item.title }], lang),
      words: [],
      source: item.source,
      link: item.link,
      image: item.image,
      preview: buildArticlePreview(extractedItems[index] || '') || item.preview,
    }));

    if (result.length > 0) {
      await redisClient.set(cacheKey, JSON.stringify(result), { EX: 21600 });
    }

    res.json(result);
  } catch (err) {
    req.log.error({ err }, 'GET /api/news failed');
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

const LANG_NAMES = {
  en: 'English', es: 'Spanish', pt: 'Portuguese',
  fr: 'French', ja: 'Japanese', de: 'German',
};

function buildRewritePrompt(lang, level, rawBody) {
  const langName = LANG_NAMES[lang] || lang;
  return `You are a language teacher. Rewrite the following ${langName} article at CEFR ${level} level.

Rules:
- Keep the article in ${langName} (do NOT translate to another language)
- Adapt vocabulary and grammar complexity to ${level} level
- Keep the same meaning and key information
- Preserve paragraph breaks (use double newlines between paragraphs)
- Do NOT add any commentary, headers, or labels — return ONLY the rewritten article text

Article:
${rawBody}`;
}

function splitTextIntoStreamChunks(text, batchSize = 4) {
  const tokens = text.match(/\S+\s*|\s+/g) || [];
  const chunks = [];
  for (let i = 0; i < tokens.length; i += batchSize) {
    chunks.push(tokens.slice(i, i + batchSize).join(''));
  }
  return chunks;
}

function sendSseEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function streamExistingText(res, text) {
  for (const chunk of splitTextIntoStreamChunks(text)) {
    sendSseEvent(res, 'chunk', { text: chunk });
  }
}

async function getCachedNewsContext(req, lang, index) {
  const userPrefs = await getUserLanguagePrefs(req.userId);
  const nativeLang = userPrefs?.native_language || 'en';

  if (!redisClient.isReady) {
    return { error: 'Redis is not ready for news lookups.' };
  }

  const newsListJson = await redisClient.get(`news8:${lang}`);

  if (!newsListJson) {
    return { error: 'News list not cached. Reload the news feed first.' };
  }

  const newsList = JSON.parse(newsListJson);
  if (index >= newsList.length) {
    return { error: 'Article index out of range' };
  }

  const article = newsList[index];
  return {
    title: article.simplified_title || article.original_title || article.title || '',
    source: article.source || '',
    link: article.link || '',
    image: article.image || null,
  };
}

/**
 * GET /api/news/article
 * Extract full article text and optionally rewrite at a CEFR level.
 */
router.get('/api/news/article', authMiddleware, validate({ query: articleQuery }), async (req, res) => {
  try {
    const lang = req.query.lang.toLowerCase();
    const index = req.query.index;
    const level = req.query.level || null;
    const context = await getCachedNewsContext(req, lang, index);
    if ('error' in context) {
      return res.status(404).json({ error: context.error });
    }
    const { title, source, link, image } = context;

    const rawBody = await extractAndCacheRawArticle({
      lang,
      index,
      link,
    });

    if (level) {
      const levelCacheKey = `article3:${lang}:${level}:${index}`;
      if (!redisClient.isReady) {
        throw new Error('Redis is not ready for rewritten article cache access');
      }
      let rewrittenBody = await redisClient.get(levelCacheKey);

      if (rewrittenBody) {
        return res.json({ title, source, link, image, body: rewrittenBody, level });
      }

      const prompt = buildRewritePrompt(lang, level, rawBody);
      const rewritten = await callGemini(prompt);
      rewrittenBody = rewritten.trim();
      if (!rewrittenBody) {
        throw new Error('Gemini returned no rewritten article text');
      }
      await redisClient.set(levelCacheKey, rewrittenBody, { EX: 21600 });
      return res.json({ title, source, link, image, body: rewrittenBody, level });
    }

    return res.json({ title, source, link, image, body: rawBody, level: null });
  } catch (err) {
    req.log.error({ err }, 'GET /api/news/article failed');
    res.status(500).json({ error: err.message || 'Failed to fetch article' });
  }
});

router.get('/api/news/article/stream', authMiddleware, validate({ query: articleStreamQuery }), async (req, res) => {
  const lang = req.query.lang.toLowerCase();
  const index = req.query.index;
  const level = req.query.level;
  const abortController = new AbortController();
  let clientClosed = false;

  req.on('close', () => {
    clientClosed = true;
    abortController.abort();
  });

  try {
    const context = await getCachedNewsContext(req, lang, index);
    if ('error' in context) {
      return res.status(404).json({ error: context.error });
    }
    const { title, source, link, image } = context;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    sendSseEvent(res, 'meta', { title, source, link, image, level });

    const rawBody = await extractAndCacheRawArticle({
      lang,
      index,
      link,
    });

    if (clientClosed) return res.end();

    const levelCacheKey = `article3:${lang}:${level}:${index}`;
    let rewrittenBody = null;

    if (!redisClient.isReady) {
      throw new Error('Redis is not ready for rewritten article cache access');
    }
    rewrittenBody = await redisClient.get(levelCacheKey);

    if (rewrittenBody) {
      await streamExistingText(res, rewrittenBody);
      sendSseEvent(res, 'done', {
        title,
        source,
        link,
        image,
        body: rewrittenBody,
        level,
      });
      return res.end();
    }

    const prompt = buildRewritePrompt(lang, level, rawBody);
    let streamedBody = '';

    try {
      streamedBody = (await streamGemini(prompt, {
        signal: abortController.signal,
        onText: (text) => {
          if (clientClosed || !text) return;
          sendSseEvent(res, 'chunk', { text });
        },
      })).trim();

      if (clientClosed) return res.end();

      if (!streamedBody) {
        throw new Error('Gemini returned no streamed text content');
      }

      await redisClient.set(levelCacheKey, streamedBody, { EX: 21600 });

      sendSseEvent(res, 'done', {
        title,
        source,
        link,
        image,
        body: streamedBody,
        level,
      });
      return res.end();
    } catch (geminiErr) {
      if (clientClosed) return res.end();
      req.log.error('Gemini streaming rewrite failed: %s', geminiErr.message);
      sendSseEvent(res, 'error', { error: geminiErr.message || 'Failed to rewrite article' });
      return res.end();
    }
  } catch (err) {
    req.log.error({ err }, 'GET /api/news/article/stream failed');
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to stream article rewrite' });
    }
    sendSseEvent(res, 'error', { error: 'Failed to stream article rewrite' });
    return res.end();
  }
});

export default router;
