// ---------------------------------------------------------------------------
// pages/Lessons.tsx -- Full-page grid of all lesson playlists
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getLessons, LessonSummary } from '../api';
import { ChevronLeftIcon } from '../components/icons';


export default function Lessons() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const targetLang = user?.target_language;

  useEffect(() => {
    if (!targetLang) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    getLessons(targetLang)
      .then((data) => {
        if (!cancelled) setLessons(data.filter((l) => l.videoCount > 0));
      })
      .catch((err) => console.error('Failed to fetch lessons:', err))
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [targetLang]);

  return (
    <div className="browse-page">
      <button className="channel-back-btn" onClick={() => navigate(-1)}>
        <ChevronLeftIcon size={18} />
        Back
      </button>

      <h2 className="browse-section-title">Lesson Playlists</h2>

      {loading ? (
        <div className="lessons-grid">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="home-carousel-card lesson-card home-carousel-card--skeleton">
              <div className="home-channel-stack home-carousel-thumb--skeleton" />
              <div className="home-carousel-info">
                <div className="home-skeleton-line" style={{ width: '70%' }} />
                <div className="home-skeleton-line" style={{ width: '40%' }} />
              </div>
            </div>
          ))}
        </div>
      ) : lessons.length === 0 ? (
        <div className="home-empty-state">
          <p>No lessons available.</p>
        </div>
      ) : (
        <div className="lessons-grid">
          {lessons.map((lesson) => (
            <div
              key={lesson.id}
              className="home-carousel-card lesson-card home-carousel-card--clickable"
              onClick={() => navigate(`/lesson/${lesson.id}`)}
            >
              <div className="home-channel-stack">
                {lesson.thumbnails.slice(0, 3).reverse().map((thumb, i, arr) => (
                  <img
                    key={i}
                    src={thumb}
                    alt=""
                    className={`home-channel-stack-img home-channel-stack-img--${arr.length - 1 - i}`}
                  />
                ))}
              </div>
              <div className="home-carousel-info">
                <span className="home-carousel-title">{lesson.title}</span>
                <span className="lesson-card-count">
                  {lesson.videoCount} video{lesson.videoCount !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
