// ---------------------------------------------------------------------------
// utils/speakerColor.ts -- Deterministic per-user color for transcript names
// (palette mirrored in the iOS app's TranscriptComponents.speakerColor)
// ---------------------------------------------------------------------------

const PALETTE = [
  '#a78bfa', // purple
  '#34d399', // green
  '#f472b6', // pink
  '#fbbf24', // amber
  '#60a5fa', // blue
  '#f87171', // red
  '#2dd4da', // cyan
  '#fb923c', // orange
];

export function speakerColor(userId: string): string {
  let hash = 5381;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash * 33) + userId.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}
