import logger from '../logger.js';

const API_HEADERS = { 'User-Agent': 'Polycast/1.0' };

export async function searchPixabay(query, perPage = 3) {
  const pixabayKey = process.env.PIXABAY_API_KEY;
  if (!pixabayKey) {
    console.error('PIXABAY_API_KEY is not configured — skipping Pixabay search');
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
    console.error(`Pixabay search failed with status ${res.status}`);
    return [];
  }
  const data = await res.json();
  return (data.hits || []).map(h => h.webformatURL);
}

async function searchWikimedia(query, limit = 5) {
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
    console.error(`Wikimedia search failed with status ${res.status}`);
    return [];
  }
  const data = await res.json();
  const pages = data.query?.pages || {};
  return Object.values(pages)
    .map(p => p.imageinfo?.[0]?.thumburl)
    .filter(Boolean);
}

export async function searchAllImages(query, perPage = 5) {
  const [pixabay, wikimedia] = await Promise.all([
    searchPixabay(query, perPage),
    searchWikimedia(query, perPage),
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

export async function fetchWordImage(searchTerm, excludeUrls = null) {
  try {
    const urls = await searchAllImages(searchTerm, 5);
    if (excludeUrls) {
      return urls.find(u => !excludeUrls.has(u)) || null;
    }
    return urls[0] || null;
  } catch (err) {
    logger.error('fetchWordImage failed for "%s": %s', searchTerm, err.message);
    return null;
  }
}
