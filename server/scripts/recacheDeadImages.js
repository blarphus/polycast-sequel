// ---------------------------------------------------------------------------
// scripts/recacheDeadImages.js -- Re-cache images for saved words whose
// image_url still points at an external link. Pixabay /get/ URLs expire, so
// those words show no picture. This re-runs the enrichWord image step for
// each: search candidates by image_term, let Gemini vision pick the best,
// store the bytes in cached_images, and point image_url at
// /api/dictionary/image/<id> so it never rots again.
//
// Usage: NODE_ENV=production DATABASE_URL=... GEMINI_API_KEY=... PIXABAY_API_KEY=... \
//        node --dns-result-order=ipv4first scripts/recacheDeadImages.js
// ---------------------------------------------------------------------------

import pool from '../db.js';
import { searchAllImages } from '../lib/imageSearch.js';
import { pickBestImage } from '../lib/imagePick.js';
import { storeImageBytes } from '../lib/imageCache.js';

if (process.argv.includes('--help')) {
  console.log('Usage: node server/scripts/recacheDeadImages.js [--dry-run]\nReplaces expiring external saved-word images. --dry-run searches/selects but performs no cache or saved-word writes.');
  process.exit(0);
}
const dryRun = process.argv.includes('--dry-run');

const { rows: words } = await pool.query(
  `SELECT id, word, translation, definition, example_sentence, image_term
   FROM saved_words
   WHERE image_url LIKE 'http%'
   ORDER BY created_at`,
);
console.log(`${words.length} words with external image URLs`);

let updated = 0;
let failed = 0;

for (const w of words) {
  const term = w.image_term || w.translation || w.word;
  try {
    const candidates = await searchAllImages(term, 4);
    const chosen = candidates.length
      ? await pickBestImage({
          word: w.word,
          definition: w.definition,
          sentence: w.example_sentence,
          candidates,
        })
      : null;
    if (!chosen) {
      console.log(`SKIP ${w.word} ("${term}"): no suitable image found`);
      failed++;
      continue;
    }
    if (dryRun) {
      console.log(`DRY  ${w.word} ("${term}"): selected ${chosen.url || 'candidate image'}`);
    } else {
      const id = await storeImageBytes(chosen.buffer, chosen.contentType, chosen.url ?? null);
      await pool.query(
        'UPDATE saved_words SET image_url = $1 WHERE id = $2',
        [`/api/dictionary/image/${id}`, w.id],
      );
      console.log(`OK   ${w.word} ("${term}") -> /api/dictionary/image/${id}`);
    }
    updated++;
  } catch (err) {
    console.log(`FAIL ${w.word}: ${err.message}`);
    failed++;
  }
}

console.log(`Done. Updated ${updated}, failed/skipped ${failed}.`);
await pool.end();
