import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPendingClasswork, PendingWordList } from '../api';

interface Props {
  onCountChange?: (count: number) => void;
}

export default function PendingClasswork({ onCountChange }: Props) {
  const [posts, setPosts] = useState<PendingWordList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    getPendingClasswork()
      .then((data) => {
        if (cancelled) return;
        setPosts(data.posts);
        onCountChange?.(data.count);
      })
      .catch((err) => {
        console.error('Failed to load pending classwork:', err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [onCountChange]);

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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        ))}
      </div>
    </section>
  );
}
