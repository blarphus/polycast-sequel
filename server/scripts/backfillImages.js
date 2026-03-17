// ---------------------------------------------------------------------------
// scripts/backfillImages.js -- Re-enrich ALL saved_words via Gemini for
// correct IMAGE_TERM, then search for a new image using that term.
// Usage: node scripts/backfillImages.js
// Connects through the local API (localhost:3001)
// ---------------------------------------------------------------------------

const BASE = 'http://localhost:3001';

async function login() {
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'joshbenja', password: 'Shreck35822!' }),
  });
  const data = await res.json();
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
        await fetch(`${BASE}/api/dictionary/words/${word.id}/image`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ image_url: imageUrl, image_term: imageTerm }),
        });

        process.stdout.write(`  new image_url:  ${imageUrl}\n`);
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
