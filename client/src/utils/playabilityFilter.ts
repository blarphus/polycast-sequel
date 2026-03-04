import { checkVideoPlayability, TrendingVideo } from '../api';

export function filterUnplayableVideos(
  videos: TrendingVideo[],
  setVideos: (fn: (prev: TrendingVideo[]) => TrendingVideo[]) => void,
): void {
  const ids = videos.map((v) => v.youtube_id);
  if (ids.length === 0) return;

  checkVideoPlayability(ids)
    .then((blocked) => {
      if (blocked.size > 0) {
        setVideos((prev) => prev.filter((v) => !blocked.has(v.youtube_id)));
      }
    })
    .catch((err) => console.error('Playability check failed:', err));
}
