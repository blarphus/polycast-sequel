// ---------------------------------------------------------------------------
// lib/rssParser.js -- RSS XML parsing utilities
// ---------------------------------------------------------------------------

import { XMLParser } from 'fast-xml-parser';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => name === 'item',
  processEntities: true,
  cdataPropName: '__cdata',
});

/**
 * Extract an image URL from a parsed RSS item object.
 * Checks dwsyn:imageURL, media:content, media:thumbnail, enclosure, then <img> in description.
 */
export function extractImage(item) {
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
 * BBC: /240/ -> /800/   DW: _302.jpg -> _804.jpg
 */
export function upscaleImage(url) {
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
export function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'object') return (node.__cdata || node['#text'] || '').toString().trim();
  return String(node).trim();
}

/**
 * Parse RSS XML into an array of article objects.
 * feedSource is the broadcaster name (e.g. 'DW', 'BBC') since these aren't aggregators.
 */
export function parseRssItems(xml, feedSource) {
  const parsed = xmlParser.parse(xml);

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
 * Truncate text at ~maxChars chars on the last sentence boundary.
 */
export function truncateAtSentence(text, maxChars = 3000) {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastPeriod = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  if (lastPeriod > maxChars * 0.5) return cut.slice(0, lastPeriod + 1);
  return cut;
}
