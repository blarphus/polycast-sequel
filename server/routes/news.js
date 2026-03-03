import { Router } from 'express';
import { extract } from '@extractus/article-extractor';
import redisClient from '../redis.js';
import pool from '../db.js';
import { authMiddleware } from '../auth.js';
import { callGemini } from '../enrichWord.js';

const router = Router();

const LANG_FEEDS = {
  es: [
    { url: 'https://rss.dw.com/rdf/rss-es-all', source: 'DW' },
    { url: 'https://feeds.bbci.co.uk/mundo/rss.xml', source: 'BBC Mundo' },
  ],
  pt: [{ url: 'https://rss.dw.com/rdf/rss-pt-all', source: 'DW' }],
  fr: [{ url: 'https://rss.dw.com/rdf/rss-fr-all', source: 'DW' }],
  de: [{ url: 'https://rss.dw.com/rdf/rss-de-all', source: 'DW' }],
  it: [{ url: 'https://www.ansa.it/sito/ansait_rss.xml', source: 'ANSA' }],
  ja: [{ url: 'https://www3.nhk.or.jp/rss/news/cat0.xml', source: 'NHK' }],
  ko: [{ url: 'https://feeds.bbci.co.uk/korean/rss.xml', source: 'BBC Korean' }],
  zh: [{ url: 'https://rss.dw.com/rdf/rss-zh-all', source: 'DW' }],
  en: [
    { url: 'https://rss.dw.com/rdf/rss-en-all', source: 'DW' },
    { url: 'https://feeds.bbci.co.uk/news/rss.xml', source: 'BBC' },
  ],
  ru: [
    { url: 'https://rss.dw.com/rdf/rss-ru-all', source: 'DW' },
    { url: 'https://feeds.bbci.co.uk/russian/rss.xml', source: 'BBC Russian' },
  ],
  ar: [
    { url: 'https://rss.dw.com/rdf/rss-ar-all', source: 'DW' },
    { url: 'https://feeds.bbci.co.uk/arabic/rss.xml', source: 'BBC Arabic' },
  ],
  hi: [{ url: 'https://rss.dw.com/rdf/rss-hi-all', source: 'DW' }],
  tr: [{ url: 'https://rss.dw.com/rdf/rss-tr-all', source: 'DW' }],
  pl: [{ url: 'https://rss.dw.com/rdf/rss-pl-all', source: 'DW' }],
  nl: [{ url: 'https://feeds.nos.nl/nosnieuwsalgemeen', source: 'NOS' }],
  sv: [{ url: 'https://www.svt.se/nyheter/rss.xml', source: 'SVT' }],
  da: [{ url: 'https://www.dr.dk/nyheder/service/feeds/senestenyt', source: 'DR' }],
  fi: [{ url: 'https://feeds.yle.fi/uutiset/v1/majorHeadlines/YLE_UUTISET.rss', source: 'YLE' }],
  uk: [{ url: 'https://rss.dw.com/rdf/rss-uk-all', source: 'DW' }],
  vi: [{ url: 'https://vnexpress.net/rss/thoi-su.rss', source: 'VnExpress' }],
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
 * Fetch simplified news headlines for a language + CEFR level.
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

    const level = (req.query.level || '').toString().toUpperCase() || null;

    // Look up the user's native language for translations
    const { rows: userRows } = await pool.query(
      'SELECT native_language FROM users WHERE id = $1',
      [req.userId],
    );
    const nativeLang = userRows[0]?.native_language || 'en';

    const cacheKey = `news2:${lang}:${level || 'raw'}:${nativeLang}`;

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
          const rssXml = await rssRes.text();
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
    const headlines = items.map((item) => item.title);

    // Call Gemini to simplify headlines and extract vocabulary
    const prompt = `You are a language learning assistant. I have ${headlines.length} news headlines in ${lang}.
The learner's native language is ${nativeLang} and their CEFR level is ${level || 'unknown'}.

For each headline, return a JSON array with objects containing:
- "original_title": the original headline unchanged
- "simplified_title": rewrite the headline at ${level || 'B1'} level (simpler vocabulary/grammar), same language
- "difficulty": estimated CEFR level of the ORIGINAL headline (A1/A2/B1/B2/C1/C2)
- "words": array of 2 key vocabulary words from the headline, each as { "word": "...", "translation": "..." } translated to ${nativeLang}

Headlines:
${headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}

Return ONLY the JSON array, no other text.`;

    const geminiRaw = await callGemini(prompt, { responseMimeType: 'application/json' });

    let articles;
    try {
      // Strip markdown code fences if present
      const cleaned = geminiRaw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      articles = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('Failed to parse Gemini news response:', parseErr, geminiRaw.slice(0, 500));
      return res.status(502).json({ error: 'Failed to process news articles' });
    }

    if (!Array.isArray(articles)) {
      console.error('Gemini news response is not an array:', typeof articles);
      return res.status(502).json({ error: 'Failed to process news articles' });
    }

    // Merge Gemini output with RSS metadata (source, link)
    const result = articles.map((article, i) => ({
      original_title: article.original_title || items[i]?.title || '',
      simplified_title: article.simplified_title || article.original_title || items[i]?.title || '',
      difficulty: article.difficulty || 'B1',
      words: Array.isArray(article.words) ? article.words.slice(0, 2) : [],
      source: items[i]?.source || '',
      link: items[i]?.link || '',
      image: items[i]?.image || null,
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
  es: 'Spanish', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian',
  ja: 'Japanese', ko: 'Korean', zh: 'Chinese', en: 'English', ru: 'Russian',
  ar: 'Arabic', hi: 'Hindi', tr: 'Turkish', pl: 'Polish', nl: 'Dutch',
  sv: 'Swedish', da: 'Danish', fi: 'Finnish', uk: 'Ukrainian', vi: 'Vietnamese',
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

    // Find the cached news list — try with user's cefr_level, then raw
    let newsListJson = null;
    const cachePatterns = [
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
    const title = article.simplified_title || article.original_title || '';
    const source = article.source || '';
    const link = article.link || '';
    const image = article.image || null;

    // Step 1: Extract raw article text (cached 6h)
    const rawCacheKey = `article2:raw:${lang}:${index}`;
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
          // Convert block-level HTML to newlines, then strip remaining tags
          rawBody = extracted.content
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n\n')
            .replace(/<\/div>/gi, '\n\n')
            .replace(/<\/h[1-6]>/gi, '\n\n')
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
      const levelCacheKey = `article2:${lang}:${level}:${index}`;
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
