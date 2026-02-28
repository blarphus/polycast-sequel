// ---------------------------------------------------------------------------
// pages/Home.tsx -- Central learning hub (default landing page)
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getNewToday, SavedWord } from '../api';
import FriendRequests from '../components/FriendRequests';
import PendingClasswork from '../components/PendingClasswork';

const LEVEL_COLORS = ['#ff4d4d', '#ff944d', '#ffdd4d', '#75d147', '#4ade80'];

function FrequencyDots({ frequency }: { frequency: number | null }) {
  if (frequency == null) return null;
  const filled = Math.ceil(frequency / 2);
  const color = LEVEL_COLORS[filled - 1] || LEVEL_COLORS[0];
  return (
    <span className="freq-dots" title={`Frequency: ${frequency}/10`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className="freq-dot"
          style={{ background: color, opacity: i < filled ? 1 : 0.25 }}
        />
      ))}
    </span>
  );
}

// Placeholder data for video cards
const MOCK_VIDEOS = [
  { title: 'Street food in Mexico City', difficulty: 'A2', gradient: 'linear-gradient(135deg, #667eea, #764ba2)', words: ['comida', 'calle'] },
  { title: 'A day at the market', difficulty: 'A1', gradient: 'linear-gradient(135deg, #f093fb, #f5576c)', words: ['comprar', 'fruta'] },
  { title: 'Travel vlog: Barcelona', difficulty: 'B1', gradient: 'linear-gradient(135deg, #4facfe, #00f2fe)', words: ['ciudad', 'bonito'] },
  { title: 'Cooking with abuela', difficulty: 'A2', gradient: 'linear-gradient(135deg, #43e97b, #38f9d7)', words: ['cocinar', 'receta'] },
  { title: 'History of flamenco', difficulty: 'B2', gradient: 'linear-gradient(135deg, #fa709a, #fee140)', words: ['baile', 'tradición'] },
];

// Placeholder data for news cards
const MOCK_NEWS = [
  { source: 'El País', headline: 'Nuevas medidas para el turismo sostenible', difficulty: 'B1', words: ['turismo', 'medida'] },
  { source: 'Le Monde', headline: 'Les jeunes et la technologie en 2026', difficulty: 'B2', words: ['jeune', 'technologie'] },
  { source: 'Der Spiegel', headline: 'Klimawandel: Was können wir tun?', difficulty: 'B1', words: ['Klima', 'können'] },
  { source: 'Corriere', headline: 'Il futuro dell\'intelligenza artificiale', difficulty: 'C1', words: ['futuro', 'intelligenza'] },
  { source: 'NHK', headline: '新しい教育プログラムが開始', difficulty: 'B2', words: ['教育', '開始'] },
];

const DIFFICULTY_COLORS: Record<string, string> = {
  A1: '#22a55e', A2: '#22a55e',
  B1: '#3b82f6', B2: '#3b82f6',
  C1: '#8b5cf6', C2: '#8b5cf6',
};

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [newWords, setNewWords] = useState<SavedWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getNewToday()
      .then((words) => { if (!cancelled) setNewWords(words); })
      .catch((err) => {
        console.error('Failed to fetch new words:', err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const displayName = user?.display_name || user?.username || '';
  const firstName = displayName.split(/\s+/)[0];

  return (
    <div className="home-page">
      {/* Pending friend requests */}
      <FriendRequests />

      {/* Pending classwork (students only) */}
      {user?.account_type === 'student' && <PendingClasswork />}

      {/* Hero: greeting left, new-words card right */}
      <div className="home-hero">
        <div className="home-hero-left">
          <h1 className="home-greeting">Welcome back, {firstName}</h1>
          <p className="home-greeting-sub">Ready to learn something new?</p>
          <button className="home-start-learning-btn" onClick={() => navigate('/learn')}>
            Start learning
          </button>
        </div>

        <div className="home-hero-right">
          <div className="home-words-card">
            <div className="home-words-card-header">
              <h2 className="home-words-card-title">New words for today</h2>
              <span className="home-words-card-count">
                {loading ? '...' : newWords.length}
              </span>
            </div>

            {error && <p className="auth-error" style={{ margin: '0.5rem 0' }}>{error}</p>}

            {loading ? (
              <div className="home-words-list">
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="home-word-row home-word-row--skeleton" />
                ))}
              </div>
            ) : newWords.length === 0 ? (
              <div className="home-empty-state">
                <p>No new words — add some from a call or the dictionary!</p>
              </div>
            ) : (
              <div className="home-words-list">
                {newWords.map((w) => (
                  <div key={w.id} className="home-word-row">
                    <div className="home-word-row-left">
                      <span className="home-word-row-word">{w.word}</span>
                      {w.part_of_speech && (
                        <span className="home-word-row-pos">{w.part_of_speech}</span>
                      )}
                      {w.priority && <span className="assigned-badge">Assigned</span>}
                    </div>
                    <span className="home-word-row-translation">{w.translation}</span>
                    <FrequencyDots frequency={w.frequency} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section 2: Videos for you (placeholder) */}
      <section className="home-section">
        <h2 className="home-section-title">Videos for you</h2>
        <p className="home-section-subtitle">containing words you're practicing</p>
        <div className="home-carousel">
          {MOCK_VIDEOS.map((v, i) => (
            <div key={i} className="home-carousel-card">
              <div className="home-carousel-thumb" style={{ background: v.gradient }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="rgba(255,255,255,0.8)" stroke="none">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </div>
              <div className="home-carousel-info">
                <span className="home-carousel-title">{v.title}</span>
                <div className="home-carousel-meta">
                  <span className="home-difficulty-pill" style={{ background: DIFFICULTY_COLORS[v.difficulty] || '#3b82f6' }}>
                    {v.difficulty}
                  </span>
                  {v.words.map((word) => (
                    <span key={word} className="home-word-badge">{word}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 3: News for you (placeholder) */}
      <section className="home-section">
        <h2 className="home-section-title">News for you</h2>
        <p className="home-section-subtitle">articles with words you know</p>
        <div className="home-carousel">
          {MOCK_NEWS.map((n, i) => (
            <div key={i} className="home-carousel-card">
              <div className="home-carousel-thumb home-carousel-thumb--news">
                <span className="home-news-source">{n.source}</span>
              </div>
              <div className="home-carousel-info">
                <span className="home-carousel-title">{n.headline}</span>
                <div className="home-carousel-meta">
                  <span className="home-difficulty-pill" style={{ background: DIFFICULTY_COLORS[n.difficulty] || '#3b82f6' }}>
                    {n.difficulty}
                  </span>
                  {n.words.map((word) => (
                    <span key={word} className="home-word-badge">{word}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
