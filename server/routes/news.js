import { Router } from 'express';
import redisClient from '../redis.js';
import pool from '../db.js';
import { authMiddleware } from '../auth.js';
import { callGemini } from '../enrichWord.js';

const router = Router();

const LANG_TO_NEWS = {
  es: { hl: 'es', gl: 'ES', ceid: 'ES:es' },
  pt: { hl: 'pt-BR', gl: 'BR', ceid: 'BR:pt-419' },
  fr: { hl: 'fr', gl: 'FR', ceid: 'FR:fr' },
  de: { hl: 'de', gl: 'DE', ceid: 'DE:de' },
  it: { hl: 'it', gl: 'IT', ceid: 'IT:it' },
  ja: { hl: 'ja', gl: 'JP', ceid: 'JP:ja' },
  ko: { hl: 'ko', gl: 'KR', ceid: 'KR:ko' },
  zh: { hl: 'zh-CN', gl: 'CN', ceid: 'CN:zh-Hans' },
  en: { hl: 'en', gl: 'US', ceid: 'US:en' },
  ru: { hl: 'ru', gl: 'RU', ceid: 'RU:ru' },
  ar: { hl: 'ar', gl: 'EG', ceid: 'EG:ar' },
  hi: { hl: 'hi', gl: 'IN', ceid: 'IN:hi' },
  tr: { hl: 'tr', gl: 'TR', ceid: 'TR:tr' },
  pl: { hl: 'pl', gl: 'PL', ceid: 'PL:pl' },
  nl: { hl: 'nl', gl: 'NL', ceid: 'NL:nl' },
  sv: { hl: 'sv', gl: 'SE', ceid: 'SE:sv' },
  da: { hl: 'da', gl: 'DK', ceid: 'DK:da' },
  fi: { hl: 'fi', gl: 'FI', ceid: 'FI:fi' },
  uk: { hl: 'uk', gl: 'UA', ceid: 'UA:uk' },
  vi: { hl: 'vi', gl: 'VN', ceid: 'VN:vi' },
};

/**
 * Parse Google News RSS XML into an array of article objects.
 * Uses simple regex — RSS structure is predictable.
 */
function parseRssItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() || '';
    const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || '';
    const source = block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]?.trim() || '';
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || '';
    if (title) {
      items.push({ title, link, source, pubDate });
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

    const newsParams = LANG_TO_NEWS[lang];
    if (!newsParams) {
      return res.status(400).json({ error: `Unsupported language: ${lang}` });
    }

    const level = (req.query.level || '').toString().toUpperCase() || null;

    // Look up the user's native language for translations
    const { rows: userRows } = await pool.query(
      'SELECT native_language FROM users WHERE id = $1',
      [req.userId],
    );
    const nativeLang = userRows[0]?.native_language || 'en';

    const cacheKey = `news:${lang}:${level || 'raw'}:${nativeLang}`;

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

    // Cache miss — fetch Google News RSS
    const rssUrl = `https://news.google.com/rss?hl=${newsParams.hl}&gl=${newsParams.gl}&ceid=${newsParams.ceid}`;
    const rssRes = await fetch(rssUrl, {
      headers: { 'User-Agent': 'Polycast/1.0' },
    });

    if (!rssRes.ok) {
      console.error('Google News RSS error:', rssRes.status, await rssRes.text().catch(() => ''));
      return res.status(502).json({ error: 'Failed to fetch news from Google News' });
    }

    const rssXml = await rssRes.text();
    const allItems = parseRssItems(rssXml);

    if (allItems.length === 0) {
      return res.json([]);
    }

    // Take first 10 articles
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

export default router;
