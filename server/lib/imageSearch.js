import logger from '../logger.js';

const API_HEADERS = { 'User-Agent': 'Polycast/1.0' };

export async function searchPixabay(query, perPage = 3, onFallback = null) {
  const pixabayKey = process.env.PIXABAY_API_KEY;
  if (!pixabayKey) {
    logger.warn({
      code: 'pixabay_provider_unconfigured',
      source: 'server.image-search',
      operation: 'search-pixabay',
      alternate: 'wikimedia',
    }, 'Pixabay provider unavailable; image search will use Wikimedia');
    onFallback?.({
      code: 'pixabay_provider_unconfigured',
      title: 'Pixabay image provider unavailable',
      message: 'Pixabay is not configured, so Polycast used Wikimedia image results only.',
      source: 'server.image-search', operation: 'search-pixabay', detail: 'alternate=wikimedia',
    });
    return [];
  }
  const params = new URLSearchParams({
    key: pixabayKey,
    q: query,
    image_type: 'photo',
    per_page: String(perPage),
    safesearch: 'true',
  });
  const res = await fetch(`https://pixabay.com/api/?${params}`);
  if (!res.ok) {
    logger.warn({
      code: 'pixabay_provider_failed',
      source: 'server.image-search',
      operation: 'search-pixabay',
      status: res.status,
      alternate: 'wikimedia',
    }, 'Pixabay provider failed; image search will use Wikimedia');
    onFallback?.({
      code: 'pixabay_provider_failed',
      title: 'Pixabay image provider failed',
      message: 'Pixabay did not respond successfully, so Polycast used Wikimedia image results only.',
      source: 'server.image-search', operation: 'search-pixabay', detail: `status=${res.status}; alternate=wikimedia`,
    });
    return [];
  }
  const data = await res.json();
  return (data.hits || []).map(h => h.webformatURL);
}

async function searchWikimedia(query, limit = 5, onFallback = null) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: '640',
    format: 'json',
    origin: '*',
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: API_HEADERS,
  });
  if (!res.ok) {
    logger.warn({
      code: 'wikimedia_provider_failed',
      source: 'server.image-search',
      operation: 'search-wikimedia',
      status: res.status,
      alternate: 'pixabay',
    }, 'Wikimedia provider failed; image search will use Pixabay');
    onFallback?.({
      code: 'wikimedia_provider_failed',
      title: 'Wikimedia image provider failed',
      message: 'Wikimedia did not respond successfully, so Polycast used Pixabay image results only.',
      source: 'server.image-search', operation: 'search-wikimedia', detail: `status=${res.status}; alternate=pixabay`,
    });
    return [];
  }
  const data = await res.json();
  const pages = data.query?.pages || {};
  return Object.values(pages)
    .map(p => p.imageinfo?.[0]?.thumburl)
    .filter(Boolean);
}

export async function searchAllImages(query, perPage = 5, { onFallback = null } = {}) {
  const [pixabay, wikimedia] = await Promise.all([
    searchPixabay(query, perPage, onFallback),
    searchWikimedia(query, perPage, onFallback),
  ]);
  // Interleave results from both sources
  const images = [];
  const maxLen = Math.max(pixabay.length, wikimedia.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < pixabay.length) images.push(pixabay[i]);
    if (i < wikimedia.length) images.push(wikimedia[i]);
  }
  return images;
}

/**
 * Download an image URL and return its bytes + content type, or null on failure.
 */
export async function fetchImageBytes(url) {
  const res = await fetch(url, { headers: API_HEADERS });
  if (!res.ok) {
    logger.error('fetchImageBytes failed for "%s": status %d', url, res.status);
    return null;
  }
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

export async function fetchWordImage(searchTerm, excludeUrls = null, onFallback = null) {
  try {
    const urls = await searchAllImages(searchTerm, 5, { onFallback });
    if (excludeUrls) {
      return urls.find(u => !excludeUrls.has(u)) || null;
    }
    return urls[0] || null;
  } catch (err) {
    logger.error('fetchWordImage failed for "%s": %s', searchTerm, err.message);
    onFallback?.({
      code: 'word_image_search_failed',
      severity: 'error',
      title: 'Word image search failed',
      message: 'Image providers could not be searched, so this word will continue without a replacement image.',
      source: 'server.image-search', operation: 'fetch-word-image', detail: err.message,
    });
    return null;
  }
}
