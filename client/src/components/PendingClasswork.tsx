import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStudentDashboard, PendingWordList, StudentDashboard } from '../api';
import { ChevronRightIcon } from './icons';
import { useAsyncData } from '../hooks/useAsyncData';

interface Props {
  onCountChange?: (count: number) => void;
}

export default function PendingClasswork({ onCountChange }: Props) {
  const navigate = useNavigate();
  const { data, loading, error } = useAsyncData<StudentDashboard>(
    () => getStudentDashboard(),
    [],
  );
  const posts = data?.pendingClasswork.posts ?? [];

  useEffect(() => {
    if (data) onCountChange?.(data.pendingClasswork.count);
  }, [data, onCountChange]);

  if (loading) return null;
  if (posts.length === 0) return null;

  return (
    <section className="home-section">
      <h2 className="home-pending-header">Pending classwork</h2>
      {error && <p className="auth-error">{error}</p>}
      <div className="home-pending-list">
        {posts.map((p) => (
          <button
            key={p.id}
            className="home-pending-item"
            onClick={() => navigate('/classwork')}
          >
            <div className="home-pending-item-left">
              <span className="home-pending-item-title">{p.title}</span>
              <span className="home-pending-item-meta">
                {p.word_count} {p.word_count === 1 ? 'word' : 'words'} &middot; {p.teacher_name}
              </span>
            </div>
            <ChevronRightIcon size={16} />
          </button>
        ))}
      </div>
    </section>
  );
}
