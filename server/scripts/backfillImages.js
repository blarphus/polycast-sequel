// ---------------------------------------------------------------------------
// scripts/backfillImages.js -- Re-enrich ALL saved_words via Gemini for
// correct IMAGE_TERM, then search for a new image using that term.
// Usage: POLYCAST_AUTH_TOKEN=... node server/scripts/backfillImages.js --dry-run
// Connects through the local API (localhost:3001)
// ---------------------------------------------------------------------------

if (process.argv.includes('--help')) {
  console.log(`Usage: node server/scripts/backfillImages.js [--dry-run] [--base URL]

Re-enrich saved-word image terms and replace their images through the Polycast API.
Authentication: POLYCAST_AUTH_TOKEN, or POLYCAST_USERNAME plus POLYCAST_PASSWORD.
--dry-run performs enrichment/search reads but does not PATCH any saved word.`);
  process.exit(0);
}

const baseIndex = process.argv.indexOf('--base');
const BASE = baseIndex >= 0 ? process.argv[baseIndex + 1] : (process.env.POLYCAST_API_BASE || 'http://localhost:3001');
const DRY_RUN = process.argv.includes('--dry-run');

async function login() {
  if (process.env.POLYCAST_AUTH_TOKEN) return process.env.POLYCAST_AUTH_TOKEN;
  if (!process.env.POLYCAST_USERNAME || !process.env.POLYCAST_PASSWORD) {
    throw new Error('Set POLYCAST_AUTH_TOKEN or both POLYCAST_USERNAME and POLYCAST_PASSWORD');
  }
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.POLYCAST_USERNAME, password: process.env.POLYCAST_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed (${res.status})`);
  const data = await res.json();
  if (!data.token) throw new Error('Login response did not contain a token');
  return data.token;
}

async function backfill() {
  const token = await login();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Get all saved words
  const wordsRes = await fetch(`${BASE}/api/dictionary/words`, { headers });
  const words = await wordsRes.json();

  console.log(`Total words: ${words.length}\n`);

  let updated = 0;
  let failed = 0;

  for (const word of words) {
    process.stdout.write(`${word.word} (${word.translation})\n`);
    process.stdout.write(`  old image_term: ${word.image_term || '(none)'}\n`);
    process.stdout.write(`  old image_url:  ${word.image_url || '(none)'}\n`);

    try {
      // Step 1: Re-enrich via Gemini to get a fresh IMAGE_TERM
      const enrichRes = await fetch(`${BASE}/api/dictionary/enrich`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          word: word.word,
          sentence: word.example_sentence || word.word,
          nativeLang: 'en',
          targetLang: word.target_language || 'pt',
        }),
      });
      const enriched = await enrichRes.json();
      const imageTerm = enriched.image_term || word.translation || word.word;

      process.stdout.write(`  new image_term: ${imageTerm}\n`);

      // Step 2: Search for image using the enriched IMAGE_TERM
      const searchRes = await fetch(
        `${BASE}/api/dictionary/image-search?q=${encodeURIComponent(imageTerm)}`,
        { headers },
      );
      const { images } = await searchRes.json();
      const imageUrl = images?.[0];

      if (imageUrl) {
        // Step 3: PATCH the card with the new image_url and image_term
        if (!DRY_RUN) {
          const update = await fetch(`${BASE}/api/dictionary/words/${word.id}/image`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ image_url: imageUrl, image_term: imageTerm }),
          });
          if (!update.ok) throw new Error(`Image update failed (${update.status})`);
        }

        process.stdout.write(`  new image_url:  ${imageUrl}${DRY_RUN ? ' (dry run; not saved)' : ''}\n`);
        updated++;
      } else {
        process.stdout.write(`  new image_url:  NO RESULTS\n`);
        failed++;
      }
    } catch (err) {
      process.stdout.write(`  ERROR: ${err.message}\n`);
      failed++;
    }

    console.log('');
  }

  console.log(`Done. Updated: ${updated}, Failed/no results: ${failed}`);
}

backfill();
