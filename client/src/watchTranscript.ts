import type { TranscriptSegment } from './api';

const MAX_MERGE_GAP_MS = 1200;
const MAX_MERGED_CHARS = 90;
const MAX_MERGED_WORDS = 16;

const TERMINAL_END_RE = /[.!?…](?:["')\]]+)?$/;
const SPEAKER_MARKER_RE = /^\s*(?:>>|&gt;&gt;|- )/;
const WORD_RE = /[\p{L}\p{N}'’-]+/gu;

function decodeEntities(text: string): string {
  return text
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}

function normalizeText(text: string): string {
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

function hasTerminalEnd(text: string): boolean {
  return TERMINAL_END_RE.test(text.trim());
}

function startsSpeakerMarker(text: string): boolean {
  return SPEAKER_MARKER_RE.test(text);
}

function getWords(text: string): string[] {
  return normalizeText(text).match(WORD_RE) ?? [];
}

function wordCount(text: string): number {
  return getWords(text).length;
}

function lastWord(text: string): string {
  const words = getWords(text);
  return words.length > 0 ? words[words.length - 1].toLowerCase() : '';
}

function firstWord(text: string): string {
  const words = getWords(text);
  return words.length > 0 ? words[0].toLowerCase() : '';
}

function isLikelyConnectorWord(word: string): boolean {
  return /^[\p{L}'’-]{1,5}$/u.test(word);
}

function startsLowercase(text: string): boolean {
  const trimmed = normalizeText(text);
  const match = trimmed.match(/^[("'“‘>*\s-]*([\p{L}])/u);
  if (!match) return false;
  const letter = match[1];
  return letter === letter.toLowerCase() && letter !== letter.toUpperCase();
}

function endsWithContinuationWord(text: string): boolean {
  return isLikelyConnectorWord(lastWord(text));
}

function startsWithContinuationWord(text: string): boolean {
  return isLikelyConnectorWord(firstWord(text));
}

function isShortFragment(text: string): boolean {
  return wordCount(text) > 0 && wordCount(text) <= 3;
}

function isStandaloneCue(text: string): boolean {
  const normalized = normalizeText(text).replace(/^(?:>>|-)\s*/, '').trim();
  return /^\[[^\]]+\]$/.test(normalized);
}

function shouldTightJoin(left: string, right: string): boolean {
  const leftTrimmed = left.trimEnd();
  const rightTrimmed = right.trimStart();
  return /[-'’]$/.test(leftTrimmed) || /^[)'’.,!?;:]/.test(rightTrimmed);
}

function buildMergedText(left: string, right: string): string {
  const joiner = shouldTightJoin(left, right) ? '' : ' ';
  return normalizeText(`${left}${joiner}${right}`);
}

function canMergeSegments(current: TranscriptSegment, next: TranscriptSegment): boolean {
  const gap = next.offset - (current.offset + current.duration);
  if (gap > MAX_MERGE_GAP_MS) return false;
  if (startsSpeakerMarker(next.text)) return false;
  if (isStandaloneCue(current.text) || isStandaloneCue(next.text)) return false;

  const candidateText = buildMergedText(current.text, next.text);
  if (candidateText.length > MAX_MERGED_CHARS) return false;
  if (wordCount(candidateText) > MAX_MERGED_WORDS) return false;
  if (hasTerminalEnd(current.text)) return false;

  const currentWords = wordCount(current.text);
  const nextWords = wordCount(next.text);
  const edgeWordContinuation =
    (startsLowercase(next.text) || nextWords <= 2) &&
    (
      endsWithContinuationWord(current.text) ||
      startsWithContinuationWord(next.text)
    );
  const shortContinuation =
    startsLowercase(next.text) && isShortFragment(next.text);
  const shortLeadIn =
    currentWords <= 2 && startsLowercase(next.text);
  const speakerCarryover =
    startsSpeakerMarker(current.text) &&
    currentWords <= 10 &&
    startsLowercase(next.text);
  const quickTail =
    gap <= 250 && nextWords <= 2 && currentWords <= 10;

  return (
    edgeWordContinuation ||
    shortContinuation ||
    shortLeadIn ||
    speakerCarryover ||
    quickTail ||
    shouldTightJoin(current.text, next.text)
  );
}

export function mergeTranscriptSegmentsForDisplay(
  segments: TranscriptSegment[],
): TranscriptSegment[] {
  const cleaned = segments
    .map((segment) => ({
      text: normalizeText(segment.text),
      offset: segment.offset,
      duration: segment.duration,
    }))
    .filter((segment) => segment.text);

  if (cleaned.length <= 1) return cleaned;

  const merged: TranscriptSegment[] = [];
  let current = { ...cleaned[0] };

  for (let i = 1; i < cleaned.length; i += 1) {
    const next = cleaned[i];
    if (canMergeSegments(current, next)) {
      current = {
        text: buildMergedText(current.text, next.text),
        offset: current.offset,
        duration: (next.offset + next.duration) - current.offset,
      };
      continue;
    }

    merged.push(current);
    current = { ...next };
  }

  merged.push(current);
  return merged;
}
