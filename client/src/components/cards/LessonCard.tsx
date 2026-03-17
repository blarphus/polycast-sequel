import type { LessonSummary } from '../../api';
import ThumbnailStack from './ThumbnailStack';

interface LessonCardProps {
  lesson: LessonSummary;
  onClick: () => void;
}

export default function LessonCard({ lesson, onClick }: LessonCardProps) {
  return (
    <div
      className="home-carousel-card lesson-card home-carousel-card--clickable"
      onClick={onClick}
    >
      <ThumbnailStack thumbnails={lesson.thumbnails} />
      <div className="home-carousel-info">
        <span className="home-carousel-title">{lesson.title}</span>
        <span className="lesson-card-count">
          {lesson.videoCount} video{lesson.videoCount !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}
