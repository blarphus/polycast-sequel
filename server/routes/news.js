import { Router } from 'express';
import { XMLParser } from 'fast-xml-parser';
import { extract } from '@extractus/article-extractor';
import redisClient from '../redis.js';
import pool from '../db.js';
import { authMiddleware } from '../auth.js';
import { callGemini } from '../enrichWord.js';
import { estimateCefrLevel } from '../lib/cefrDifficulty.js';
import { validate } from '../lib/validate.js';

const rssParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => name === 'item',
  processEntities: true,
  cdataPropName: '__cdata',
});

import { z } from 'zod';

const router = Router();

const newsQuery = z.object({
  lang: z.string().min(1, 'lang query parameter is required'),
});

const articleQuery = z.object({
  lang: z.string().min(1, 'lang is required'),
  index: z.coerce.number().int().min(0).max(9, 'index must be 0-9'),
  level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).optional(),
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
 * Extract an image URL from a parsed RSS item object.
 * Checks dwsyn:imageURL, media:content, media:thumbnail, enclosure, then <img> in description.
 */
function extractImage(item) {
  // DW RDF: <dwsyn:imageURL>
  const dwImage = item['dwsyn:imageURL'];
  if (dwImage) return typeof dwImage === 'object' ? dwImage.__cdata || dwImage['#text'] : String(dwImage).trim();

  // <media:content url="...">
  const mediaContent = item['media:content'];
  if (mediaContent) {
    const url = Array.isArray(mediaContent) ? mediaContent[0]?.['@_url'] : mediaContent['@_url'];
    if (url) return url;
  }

  // <media:thumbnail url="...">
  const mediaThumbnail = item['media:thumbnail'];
  if (mediaThumbnail) {
    const url = Array.isArray(mediaThumbnail) ? mediaThumbnail[0]?.['@_url'] : mediaThumbnail['@_url'];
    if (url) return url;
  }

  // <enclosure url="..." type="image/...">
  const enclosure = item.enclosure;
  if (enclosure) {
    const enc = Array.isArray(enclosure) ? enclosure[0] : enclosure;
    if (enc?.['@_type']?.startsWith('image/') && enc['@_url']) return enc['@_url'];
  }

  // <img src="..."> inside <description> HTML (embedded HTML string, not XML structure)
  const desc = typeof item.description === 'object' ? item.description.__cdata || item.description['#text'] || '' : String(item.description || '');
  const imgMatch = desc.match(/<img[^>]+src=["']([^"']+)["']/)?.[1]
    || desc.match(/&lt;img[^&]*src=(?:&quot;|&#34;)([^&]+)(?:&quot;|&#34;)/)?.[1];
  if (imgMatch) return imgMatch;

  return null;
}

/**
 * Upscale known broadcaster thumbnail URLs to higher resolution.
 * BBC: /240/ → /800/   DW: _302.jpg → _804.jpg
 */
function upscaleImage(url) {
  if (!url) return null;
  // BBC: replace /240/ with /800/ in ichef URLs
  if (url.includes('ichef.bbci.co.uk')) {
    return url.replace(/\/240\//, '/800/');
  }
  // DW: replace _302. with _804.
  if (url.includes('static.dw.com')) {
    return url.replace(/_302\./, '_804.');
  }
  return url;
}

/**
 * Unwrap a parsed text node that may be a CDATA object or plain string.
 */
function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'object') return (node.__cdata || node['#text'] || '').toString().trim();
  return String(node).trim();
}

/**
 * Parse RSS XML into an array of article objects.
 * feedSource is the broadcaster name (e.g. 'DW', 'BBC') since these aren't aggregators.
 */
function parseRssItems(xml, feedSource) {
  const parsed = rssParser.parse(xml);

  // Standard RSS 2.0: rss.channel.item
  // RDF (DW): rdf:RDF.item
  const rawItems = parsed?.rss?.channel?.item || parsed?.['rdf:RDF']?.item || [];

  return rawItems
    .map((item) => {
      const title = textOf(item.title);
      if (!title) return null;
      const link = textOf(item.link);
      const pubDate = textOf(item.pubDate) || textOf(item['dc:date']);
      const image = upscaleImage(extractImage(item));
      return { title, link, source: feedSource, pubDate, image };
    })
    .filter(Boolean);
}

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

    const cacheKey = `news3:${lang}`;

    // Try Redis cache first
    let cached = null;
    try {
      if (redisClient.isReady) {
        cached = await redisClient.get(cacheKey);
      }
    } catch (cacheErr) {
      req.log.warn('Redis read failed for news cache: %s', cacheErr.message);
    }

    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Cache miss — fetch all RSS feeds for this language in parallel
    const feedResults = await Promise.all(
      feeds.map(async (feed) => {
        try {
          const rssRes = await fetch(feed.url, {
            headers: { 'User-Agent': 'Polycast/1.0' },
          });
          if (!rssRes.ok) {
            req.log.error('RSS fetch error for %s (%s): %d', feed.source, feed.url, rssRes.status);
            return [];
          }
          // Decode using the feed's declared charset (some feeds use ISO-8859-1)
          const buf = Buffer.from(await rssRes.arrayBuffer());
          const ctCharset = rssRes.headers.get('content-type')?.match(/charset=([^\s;]+)/i)?.[1];
          const xmlCharset = buf.toString('ascii').match(/<\?xml[^>]+encoding=["']([^"']+)["']/i)?.[1];
          const charset = (ctCharset || xmlCharset || 'utf-8').toLowerCase();
          const decoder = new TextDecoder(charset === 'iso-8859-1' || charset === 'latin1' ? 'windows-1252' : charset);
          const rssXml = decoder.decode(buf);
          return parseRssItems(rssXml, feed.source);
        } catch (fetchErr) {
          req.log.error('RSS fetch failed for %s (%s): %s', feed.source, feed.url, fetchErr.message);
          return [];
        }
      }),
    );

    // Merge all items, sort by pubDate descending, take first 10
    const allItems = feedResults.flat().sort((a, b) => {
      const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return db - da;
    });

    if (allItems.length === 0) {
      return res.json([]);
    }

    const items = allItems.slice(0, 10);

    // Build response with offline CEFR estimation (no Gemini)
    const result = items.map((item) => ({
      original_title: item.title,
      simplified_title: item.title,
      difficulty: estimateCefrLevel([{ text: item.title }], lang),
      words: [],
      source: item.source,
      link: item.link,
      image: item.image,
    }));

    // Cache in Redis for 6 hours
    if (result.length > 0) {
      try {
        if (redisClient.isReady) {
          await redisClient.set(cacheKey, JSON.stringify(result), { EX: 21600 });
        }
      } catch (cacheErr) {
        req.log.warn('Redis write failed for news cache: %s', cacheErr.message);
      }
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

/**
 * Truncate text at ~3000 chars on the last sentence boundary.
 */
function truncateAtSentence(text, maxChars = 3000) {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastPeriod = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  if (lastPeriod > maxChars * 0.5) return cut.slice(0, lastPeriod + 1);
  return cut;
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

    // Look up user's native language
    const { rows: userRows } = await pool.query(
      'SELECT native_language, cefr_level FROM users WHERE id = $1',
      [req.userId],
    );
    const nativeLang = userRows[0]?.native_language || 'en';

    // Find the cached news list — try new key first, then legacy patterns
    let newsListJson = null;
    const cachePatterns = [
      `news3:${lang}`,
      `news:${lang}`,
      `news2:${lang}:${userRows[0]?.cefr_level || 'raw'}:${nativeLang}`,
      `news2:${lang}:raw:${nativeLang}`,
    ];
    for (const key of cachePatterns) {
      try {
        if (redisClient.isReady) {
          newsListJson = await redisClient.get(key);
          if (newsListJson) break;
        }
      } catch (cacheErr) {
        req.log.warn('Redis read failed for news list: %s', cacheErr.message);
      }
    }

    if (!newsListJson) {
      return res.status(404).json({ error: 'News list not cached. Go back to Home to load news first.' });
    }

    const newsList = JSON.parse(newsListJson);
    if (index >= newsList.length) {
      return res.status(404).json({ error: 'Article index out of range' });
    }

    const article = newsList[index];
    const title = article.simplified_title || article.original_title || article.title || '';
    const source = article.source || '';
    const link = article.link || '';
    const image = article.image || null;

    // Step 1: Extract raw article text (cached 6h)
    const rawCacheKey = `article3:raw:${lang}:${index}`;
    let rawBody = null;

    try {
      if (redisClient.isReady) {
        rawBody = await redisClient.get(rawCacheKey);
      }
    } catch (cacheErr) {
      req.log.warn('Redis read failed for raw article: %s', cacheErr.message);
    }

    let extractionFailed = false;

    if (rawBody === null) {
      try {
        const extracted = await extract(link, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Polycast/1.0)' },
        });
        if (extracted && extracted.content) {
          // Clean extracted HTML into formatted plain text
          rawBody = extracted.content
            // Remove figure blocks (images + captions — hero image shown separately)
            .replace(/<figure[\s\S]*?<\/figure>/gi, '')
            // Remove BBC metadata section (author, reading time)
            .replace(/<section[\s\S]*?<\/section>/gi, '')
            // Convert headings to ## markers before stripping tags
            .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n\n## $1\n\n')
            // Mark bold/strong lead text
            .replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, '**$2**')
            // Convert block-level HTML to newlines
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n\n')
            .replace(/<\/div>/gi, '\n\n')
            .replace(/<\/li>/gi, '\n')
            // Strip remaining tags
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\n{3,}/g, '\n\n')
            .trim();
          rawBody = truncateAtSentence(rawBody);

          try {
            if (redisClient.isReady) {
              await redisClient.set(rawCacheKey, rawBody, { EX: 21600 });
            }
          } catch (cacheErr) {
            req.log.warn('Redis write failed for raw article: %s', cacheErr.message);
          }
        } else {
          extractionFailed = true;
        }
      } catch (extractErr) {
        req.log.error('Article extraction failed: %s', extractErr.message);
        extractionFailed = true;
      }
    }

    if (extractionFailed || !rawBody) {
      return res.json({ title, source, link, image, body: null, level: null, extractionFailed: true });
    }

    // Step 2: If a CEFR level is requested, rewrite via Gemini (cached 6h)
    if (level) {
      const levelCacheKey = `article3:${lang}:${level}:${index}`;
      let rewrittenBody = null;

      try {
        if (redisClient.isReady) {
          rewrittenBody = await redisClient.get(levelCacheKey);
        }
      } catch (cacheErr) {
        req.log.warn('Redis read failed for rewritten article: %s', cacheErr.message);
      }

      if (rewrittenBody) {
        return res.json({ title, source, link, image, body: rewrittenBody, level });
      }

      // Gemini rewrite
      const langName = LANG_NAMES[lang] || lang;
      const prompt = `You are a language teacher. Rewrite the following ${langName} article at CEFR ${level} level.

Rules:
- Keep the article in ${langName} (do NOT translate to another language)
- Adapt vocabulary and grammar complexity to ${level} level
- Keep the same meaning and key information
- Preserve paragraph breaks (use double newlines between paragraphs)
- Do NOT add any commentary, headers, or labels — return ONLY the rewritten article text

Article:
${rawBody}`;

      try {
        const rewritten = await callGemini(prompt);
        rewrittenBody = rewritten.trim();

        try {
          if (redisClient.isReady) {
            await redisClient.set(levelCacheKey, rewrittenBody, { EX: 21600 });
          }
        } catch (cacheErr) {
          req.log.warn('Redis write failed for rewritten article: %s', cacheErr.message);
        }

        return res.json({ title, source, link, image, body: rewrittenBody, level });
      } catch (geminiErr) {
        req.log.error('Gemini rewrite failed: %s', geminiErr.message);
        return res.json({ title, source, link, image, body: rawBody, level: null, rewriteFailed: true });
      }
    }

    // No level requested — return original
    return res.json({ title, source, link, image, body: rawBody, level: null });
  } catch (err) {
    req.log.error({ err }, 'GET /api/news/article failed');
    res.status(500).json({ error: 'Failed to fetch article' });
  }
});

export default router;
