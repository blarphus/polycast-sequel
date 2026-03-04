import { Router } from 'express';
import { extract } from '@extractus/article-extractor';
import redisClient from '../redis.js';
import pool from '../db.js';
import { authMiddleware } from '../auth.js';
import { callGemini } from '../enrichWord.js';
import { estimateCefrLevel } from '../lib/cefrDifficulty.js';

const router = Router();

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
 * Extract an image URL from an RSS item block.
 * Checks dwsyn:imageURL, media:content, media:thumbnail, enclosure, then <img> in description.
 */
function extractImage(block) {
  // DW RDF: <dwsyn:imageURL>...</dwsyn:imageURL>
  const dwImage = block.match(/<dwsyn:imageURL>([\s\S]*?)<\/dwsyn:imageURL>/)?.[1]?.trim();
  if (dwImage) return dwImage;

  // <media:content url="...">
  const mediaContent = block.match(/<media:content[^>]+url=["']([^"']+)["']/)?.[1];
  if (mediaContent) return mediaContent;

  // <media:thumbnail url="...">
  const mediaThumbnail = block.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/)?.[1];
  if (mediaThumbnail) return mediaThumbnail;

  // <enclosure url="..." type="image/...">
  const enclosure = block.match(/<enclosure[^>]+type=["']image\/[^"']+["'][^>]+url=["']([^"']+)["']/)?.[1]
    || block.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']image\/[^"']+["']/)?.[1];
  if (enclosure) return enclosure;

  // <img src="..."> inside <description> HTML
  const descBlock = block.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '';
  const imgSrc = descBlock.match(/<img[^>]+src=["']([^"']+)["']/)?.[1]
    || descBlock.match(/&lt;img[^&]*src=(?:&quot;|&#34;)([^&]+)(?:&quot;|&#34;)/)?.[1];
  if (imgSrc) return imgSrc;

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
 * Parse RSS XML into an array of article objects.
 * feedSource is the broadcaster name (e.g. 'DW', 'BBC') since these aren't aggregators.
 */
function parseRssItems(xml, feedSource) {
  const items = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1')?.trim() || '';
    const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || '';
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim()
      || block.match(/<dc:date>([\s\S]*?)<\/dc:date>/)?.[1]?.trim()
      || '';
    const image = upscaleImage(extractImage(block));
    if (title) {
      items.push({ title, link, source: feedSource, pubDate, image });
    }
  }
  return items;
}

/**
 * GET /api/news
 * Fetch news headlines for a language with offline CEFR difficulty estimation.
 * Cached in Redis for 6 hours.
 */
router.get('/api/news', authMiddleware, async (req, res) => {
  try {
    const lang = (req.query.lang || '').toString().toLowerCase();
    if (!lang) {
      return res.status(400).json({ error: 'lang query parameter is required' });
    }

    const feeds = LANG_FEEDS[lang];
    if (!feeds) {
      return res.status(400).json({ error: `Unsupported language: ${lang}` });
    }

    const cacheKey = `news:${lang}`;

    // Try Redis cache first
    let cached = null;
    try {
      if (redisClient.isReady) {
        cached = await redisClient.get(cacheKey);
      }
    } catch (cacheErr) {
      console.warn('Redis read failed for news cache:', cacheErr.message);
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
            console.error(`RSS fetch error for ${feed.source} (${feed.url}):`, rssRes.status);
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
          console.error(`RSS fetch failed for ${feed.source} (${feed.url}):`, fetchErr.message);
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
        console.warn('Redis write failed for news cache:', cacheErr.message);
      }
    }

    res.json(result);
  } catch (err) {
    console.error('GET /api/news failed:', err);
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
router.get('/api/news/article', authMiddleware, async (req, res) => {
  try {
    const lang = (req.query.lang || '').toString().toLowerCase();
    const index = parseInt(req.query.index, 10);
    const level = (req.query.level || '').toString().toUpperCase() || null;

    if (!lang || isNaN(index) || index < 0 || index > 9) {
      return res.status(400).json({ error: 'lang and index (0-9) are required' });
    }

    // Look up user's native language
    const { rows: userRows } = await pool.query(
      'SELECT native_language, cefr_level FROM users WHERE id = $1',
      [req.userId],
    );
    const nativeLang = userRows[0]?.native_language || 'en';

    // Find the cached news list — try new key first, then legacy patterns
    let newsListJson = null;
    const cachePatterns = [
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
        console.warn('Redis read failed for news list:', cacheErr.message);
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
      console.warn('Redis read failed for raw article:', cacheErr.message);
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
            console.warn('Redis write failed for raw article:', cacheErr.message);
          }
        } else {
          extractionFailed = true;
        }
      } catch (extractErr) {
        console.error('Article extraction failed:', extractErr.message);
        extractionFailed = true;
      }
    }

    if (extractionFailed || !rawBody) {
      return res.json({ title, source, link, image, body: null, level: null, extractionFailed: true });
    }

    // Step 2: If a CEFR level is requested, rewrite via Gemini (cached 6h)
    if (level && ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(level)) {
      const levelCacheKey = `article3:${lang}:${level}:${index}`;
      let rewrittenBody = null;

      try {
        if (redisClient.isReady) {
          rewrittenBody = await redisClient.get(levelCacheKey);
        }
      } catch (cacheErr) {
        console.warn('Redis read failed for rewritten article:', cacheErr.message);
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
          console.warn('Redis write failed for rewritten article:', cacheErr.message);
        }

        return res.json({ title, source, link, image, body: rewrittenBody, level });
      } catch (geminiErr) {
        console.error('Gemini rewrite failed:', geminiErr.message);
        return res.json({ title, source, link, image, body: rawBody, level: null, rewriteFailed: true });
      }
    }

    // No level requested — return original
    return res.json({ title, source, link, image, body: rawBody, level: null });
  } catch (err) {
    console.error('GET /api/news/article failed:', err);
    res.status(500).json({ error: 'Failed to fetch article' });
  }
});

export default router;
