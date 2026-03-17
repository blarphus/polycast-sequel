import type { ChannelSummary } from '../../api';
import ThumbnailStack from './ThumbnailStack';

interface ChannelCardProps {
  channel: ChannelSummary;
  onClick: () => void;
}

export default function ChannelCard({ channel, onClick }: ChannelCardProps) {
  return (
    <div
      className="home-carousel-card home-channel-card home-carousel-card--clickable"
      onClick={onClick}
    >
      <ThumbnailStack thumbnails={channel.thumbnails} />
      <div className="home-carousel-info">
        <span className="home-carousel-title">{channel.name}</span>
      </div>
    </div>
  );
}
