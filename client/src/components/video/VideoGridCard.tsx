import type { TrendingVideo } from '../../api';
import { formatVideoDuration } from '../../utils/videoFormat';

interface VideoGridCardProps {
  video: TrendingVideo;
  loading?: boolean;
  showCaptions?: boolean;
  onClick: () => void;
}

export function VideoGridCard({ video, loading, showCaptions = false, onClick }: VideoGridCardProps) {
  return (
    <div
      className={`browse-card${loading ? ' browse-card--loading' : ''}`}
      onClick={onClick}
    >
      <div className="browse-card-thumb">
        <img src={video.thumbnail} alt={video.title} className="browse-card-thumb-img" />
        {video.duration_seconds != null && (
          <span className="browse-card-duration">{formatVideoDuration(video.duration_seconds)}</span>
        )}
      </div>
      <div className="browse-card-info">
        <span className="browse-card-title">{video.title}</span>
        <span className="browse-card-channel">{video.channel}</span>
        {showCaptions && (
          <span className={`browse-card-captions${video.has_captions ? ' browse-card-captions--human' : ''}`}>
            {video.has_captions ? 'Human captions' : 'Auto captions'}
          </span>
        )}
      </div>
    </div>
  );
}

export function VideoGridSkeleton() {
  return (
    <div className="browse-card browse-card--skeleton">
      <div className="browse-card-thumb browse-card-thumb--skeleton" />
      <div className="browse-card-info">
        <div className="home-skeleton-line" style={{ width: '85%' }} />
        <div className="home-skeleton-line" style={{ width: '55%' }} />
      </div>
    </div>
  );
}
