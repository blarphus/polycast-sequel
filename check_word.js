
import pool from './server/db.js';

async function check() {
  try {
    const res = await pool.query("SELECT word, image_url FROM saved_words WHERE word = 'medio' LIMIT 1;");
    console.log(JSON.stringify(res.rows[0], null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

check();
