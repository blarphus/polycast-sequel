// ---------------------------------------------------------------------------
// components/UpcomingClasses.tsx — Home screen "Classes today" section
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getClassesToday, UpcomingClass } from '../api';
import { CalendarIcon } from './classwork/ClassSessionCard';

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
                <CalendarIcon size={20} />
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
