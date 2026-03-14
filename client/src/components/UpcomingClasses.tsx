// ---------------------------------------------------------------------------
// components/UpcomingClasses.tsx — Home screen "Classes today" section
// ---------------------------------------------------------------------------

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { getClassesToday, UpcomingClass } from '../api';
import { CalendarIcon } from './classwork/ClassSessionCard';
import { formatUsTime } from '../utils/dateFormat';
import { useAsyncData } from '../hooks/useAsyncData';

export default function UpcomingClasses() {
  const navigate = useNavigate();
  const { data, loading } = useAsyncData<{ classes: UpcomingClass[] }>(
    () => getClassesToday(),
    [],
  );
  const classes = data?.classes ?? [];

  if (loading || classes.length === 0) return null;

  return (
    <section className="upcoming-classes">
      <h2 className="upcoming-classes-title">Classes today</h2>
      <div className="upcoming-classes-list">
        {classes.map((cls) => {
          const timeStr = cls.time || (cls.scheduled_at
            ? formatUsTime(cls.scheduled_at)
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
