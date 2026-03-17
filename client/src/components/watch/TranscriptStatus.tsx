import type { VideoDetail } from '../../api';

interface TranscriptStatusProps {
  video: VideoDetail;
  hasTranscript: boolean;
  retryingTranscript: boolean;
  onRetryTranscript: () => void;
}

export default function TranscriptStatus({
  video,
  hasTranscript,
  retryingTranscript,
  onRetryTranscript,
}: TranscriptStatusProps) {
  if (hasTranscript) return null;

  if (video.transcript_status === 'processing') {
    return (
      <div className="watch-transcript-progress">
        <div className="watch-transcript-progress-bar">
          <div
            className="watch-transcript-progress-fill"
            style={{ width: `${video.transcript_progress}%` }}
          />
        </div>
        <p className="watch-transcript-progress-text">
          Fetching captions… {video.transcript_progress}%
        </p>
      </div>
    );
  }

  if (video.transcript_status === 'failed') {
    return (
      <div className="watch-transcript-error-wrap">
        <p className="watch-transcript-error">{video.transcript_error || 'Transcript temporarily unavailable'}</p>
        <button className="btn-primary" onClick={onRetryTranscript} disabled={retryingTranscript}>
          {retryingTranscript ? 'Retrying...' : 'Retry transcript fetch'}
        </button>
      </div>
    );
  }

  if (video.transcript_status === 'missing') {
    return (
      <div className="watch-transcript-progress">
        <div className="watch-transcript-progress-bar">
          <div
            className="watch-transcript-progress-fill"
            style={{ width: '0%' }}
          />
        </div>
        <p className="watch-transcript-progress-text">
          Fetching captions...
        </p>
      </div>
    );
  }

  return null;
}
