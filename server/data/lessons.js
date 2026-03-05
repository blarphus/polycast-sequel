import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ptCatalog = require('./pt-catalog.json');

// PT lessons are derived from the curated catalog (58 categories, 2,221 videos).
// Other languages still use keyword-based matching.
export const LESSONS_BY_LANG = {
  pt: ptCatalog.map((cat) => ({ id: cat.id, title: cat.title, level: cat.level })),
};

// Index catalog videos by category ID for fast lookup.
const ptCatalogIndex = new Map();
for (const cat of ptCatalog) {
  ptCatalogIndex.set(cat.id, cat.videos);
}

/**
 * Get pre-enriched videos for a catalog-based lesson (PT).
 * Returns the video array or null if not a catalog language/lesson.
 */
export function getCatalogVideos(lang, lessonId) {
  if (lang !== 'pt') return null;
  return ptCatalogIndex.get(lessonId) || null;
}

/**
 * Check if a video title matches a lesson based on keyword matching.
 * Used for non-catalog languages only.
 */
export function videoMatchesLesson(videoTitle, lesson) {
  const lower = videoTitle.toLowerCase();
  return lesson.keywords.some((kw) => lower.includes(kw));
}
