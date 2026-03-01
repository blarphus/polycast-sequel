// ---------------------------------------------------------------------------
// components/UpcomingClasses.tsx — Home screen "Classes today" section
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getClassesToday, UpcomingClass } from '../api';

export default function UpcomingClasses() {
  const navigate = useNavigate();
  const [classes, setClasses] = useState<UpcomingClass[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getClassesToday()
      .then(({ classes: c }) => { if (!cancelled) setClasses(c); })
      .catch((err) => console.error('Failed to fetch today\'s classes:', err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading || classes.length === 0) return null;

  return (
    <section className="upcoming-classes">
      <h2 className="upcoming-classes-title">Classes today</h2>
      <div className="upcoming-classes-list">
        {classes.map((cls) => {
          const timeStr = cls.time || (cls.scheduled_at
            ? new Date(cls.scheduled_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
            : '');

          return (
            <div
              key={cls.id}
              className="upcoming-class-card"
              onClick={() => navigate(`/group-call/${cls.id}`)}
            >
              <div className="upcoming-class-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <div className="upcoming-class-info">
                <span className="upcoming-class-name">{cls.title || 'Class Session'}</span>
                <span className="upcoming-class-meta">
                  {timeStr}{cls.duration_minutes ? ` · ${cls.duration_minutes} min` : ''}
                  {cls.teacher_name ? ` · ${cls.teacher_name}` : ''}
                </span>
              </div>
              <span className="upcoming-class-join">Join</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
