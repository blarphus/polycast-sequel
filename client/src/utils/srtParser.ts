// ---------------------------------------------------------------------------
// utils/srtParser.ts — Parse SRT subtitle files into TranscriptSegment[]
// ---------------------------------------------------------------------------

import type { TranscriptSegment } from '../api';

/**
 * Parse an SRT timestamp (HH:MM:SS,mmm) into milliseconds.
 */
function parseTimestamp(ts: string): number {
  const [time, ms] = ts.split(',');
  const [h, m, s] = time.split(':').map(Number);
  return h * 3600000 + m * 60000 + s * 1000 + Number(ms);
}

/**
 * Parse SRT file content into an array of TranscriptSegments.
 */
export function parseSrt(content: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  // Normalize line endings and split into blocks
  const blocks = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;

    // Line 0: sequence number (skip)
    // Line 1: timestamp range
    const timeMatch = lines[1].match(
      /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/,
    );
    if (!timeMatch) continue;

    const start = parseTimestamp(timeMatch[1]);
    const end = parseTimestamp(timeMatch[2]);
    // Lines 2+: subtitle text
    const text = lines.slice(2).join(' ').replace(/<[^>]+>/g, '').trim();
    if (!text) continue;

    segments.push({
      text,
      offset: start,
      duration: end - start,
    });
  }

  return segments;
}
