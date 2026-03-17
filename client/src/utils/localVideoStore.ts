// ---------------------------------------------------------------------------
// utils/localVideoStore.ts — Module-level store for local video/SRT files
// ---------------------------------------------------------------------------

export interface LocalVideoEntry {
  videoFile: File;
  srtFile: File | null;
  name: string;
}

let entries: LocalVideoEntry[] = [];

export function setLocalVideos(videos: LocalVideoEntry[]) {
  entries = videos;
}

export function getLocalVideos(): LocalVideoEntry[] {
  return entries;
}

export function getLocalVideo(name: string): LocalVideoEntry | undefined {
  return entries.find((e) => e.name === name);
}
