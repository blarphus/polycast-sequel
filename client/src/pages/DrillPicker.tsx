// ---------------------------------------------------------------------------
// pages/DrillPicker.tsx -- Tense picker + leaderboard for conjugation drills
// ---------------------------------------------------------------------------

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getDrillSessions, saveDrillSession, type DrillSession } from '../api';
import { generateProblems, getLanguageConfig, type ConjugationProblem } from '../data/conjugations';
import { ChevronLeftIcon, BoltIcon, CloseIcon } from '../components/icons';
import ConjugationDrill from '../components/ConjugationDrill';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type VerbFilter = 'regular' | 'irregular' | 'all';

interface SelectedDrill {
  tenseKey: string;
  tenseLabel: string;
  verbFilter: VerbFilter;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DrillPicker() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [sessions, setSessions] = useState<DrillSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<SelectedDrill | null>(null);
  const [drillProblems, setDrillProblems] = useState<ConjugationProblem[] | null>(null);

  const langConfig = getLanguageConfig(user?.target_language ?? '');

  // Fetch drill history
  useEffect(() => {
    getDrillSessions()
      .then((data) => setSessions(data.sessions))
      .catch((err) => {
        console.error('Failed to fetch drill sessions:', err);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, []);

  // Get best score for a tense+filter combo
  const getBestScore = useCallback((tenseKey: string, verbFilter: VerbFilter) => {
    const matching = sessions.filter(
      (s) => s.tense_key === tenseKey && s.verb_filter === verbFilter,
    );
    if (matching.length === 0) return null;
    let best = matching[0];
    for (const s of matching) {
      if (s.correct_count > best.correct_count) best = s;
    }
    return best;
  }, [sessions]);

  // Get sessions for a tense+filter combo (most recent first, already sorted)
  const getSessionsFor = useCallback((tenseKey: string, verbFilter: VerbFilter) => {
    return sessions.filter(
      (s) => s.tense_key === tenseKey && s.verb_filter === verbFilter,
    );
  }, [sessions]);

  // Start drill
  const handleStartDrill = () => {
    if (!selected) return;
    const problems = generateProblems(user?.target_language ?? '', 20, {
      tenses: [selected.tenseKey],
      irregulars: selected.verbFilter,
    });
    if (problems.length === 0) {
      setError('No conjugation problems match these filters');
      return;
    }
    setError('');
    setDrillProblems(problems);
  };

  // Drill complete callback
  const handleDrillComplete = async (result: { correctCount: number; total: number; duration: number }) => {
    if (!selected) return;
    try {
      await saveDrillSession({
        tense_key: selected.tenseKey,
        verb_filter: selected.verbFilter,
        question_count: result.total,
        correct_count: result.correctCount,
        duration_seconds: result.duration,
      });
      const data = await getDrillSessions();
      setSessions(data.sessions);
    } catch (err: any) {
      console.error('Failed to save drill session:', err);
    }
    setDrillProblems(null);
  };

  // ---------------------------------------------------------------------------
  // Render: Active drill
  // ---------------------------------------------------------------------------

  if (drillProblems) {
    return (
      <ConjugationDrill
        problems={drillProblems}
        onExit={() => setDrillProblems(null)}
        onComplete={handleDrillComplete}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Tense picker
  // ---------------------------------------------------------------------------

  const verbFilters: { key: VerbFilter; label: string }[] = [
    { key: 'regular', label: 'Regular' },
    { key: 'irregular', label: 'Irregular' },
    { key: 'all', label: 'Combined' },
  ];

  const leaderboardSessions = selected ? getSessionsFor(selected.tenseKey, selected.verbFilter) : [];

  return (
    <div className="drill-picker-page">
      {/* Header */}
      <div className="drill-picker-header">
        <button className="drill-picker-back" onClick={() => navigate('/practice')}>
          <ChevronLeftIcon size={20} />
        </button>
        <div className="drill-picker-header-content">
          <BoltIcon size={24} strokeWidth={1.5} />
          <h1>Conjugation Drill</h1>
        </div>
      </div>

      {error && <p className="practice-error" style={{ textAlign: 'center' }}>{error}</p>}

      {loading ? (
        <div className="practice-generating">
          <div className="loading-spinner" />
        </div>
      ) : !langConfig ? (
        <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
          No conjugation data for your target language.
        </p>
      ) : (
        <div className="drill-picker-sections">
          {langConfig.tenses.map((tense) => (
            <div key={tense.key} className="drill-picker-tense-section">
              <h2 className="drill-picker-tense-label">{tense.label}</h2>
              <div className="drill-picker-cards">
                {verbFilters.map((vf) => {
                  const best = getBestScore(tense.key, vf.key);
                  return (
                    <button
                      key={vf.key}
                      className="drill-picker-card"
                      onClick={() => setSelected({ tenseKey: tense.key, tenseLabel: tense.label, verbFilter: vf.key })}
                    >
                      <span className="drill-picker-card-label">{vf.label}</span>
                      {best && (
                        <>
                          <div className="drill-picker-card-progress">
                            <div
                              className="drill-picker-card-progress-fill"
                              style={{ width: `${Math.round((best.correct_count / best.question_count) * 100)}%` }}
                            />
                          </div>
                          <span className="drill-picker-card-progress-label">
                            {Math.round((best.correct_count / best.question_count) * 100)}%
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Leaderboard overlay */}
      {selected && (
        <div className="drill-leaderboard-overlay" onClick={() => setSelected(null)}>
          <div className="drill-leaderboard-modal" onClick={(e) => e.stopPropagation()}>
            <div className="drill-leaderboard-header">
              <div>
                <h2>{selected.tenseLabel}</h2>
                <span className="drill-leaderboard-filter">
                  {selected.verbFilter === 'all' ? 'Combined' : selected.verbFilter === 'regular' ? 'Regular' : 'Irregular'}
                </span>
              </div>
              <button className="drill-leaderboard-close" onClick={() => setSelected(null)}>
                <CloseIcon size={18} />
              </button>
            </div>

            {leaderboardSessions.length === 0 ? (
              <p className="drill-leaderboard-empty">No attempts yet. Start your first drill!</p>
            ) : (
              <div className="drill-leaderboard-list">
                {leaderboardSessions.map((s) => {
                  const accuracy = s.question_count > 0
                    ? Math.round((s.correct_count / s.question_count) * 100)
                    : 0;
                  const mins = Math.floor(s.duration_seconds / 60);
                  const secs = s.duration_seconds % 60;
                  const date = new Date(s.created_at);
                  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

                  return (
                    <div key={s.id} className="drill-leaderboard-row">
                      <span className="drill-leaderboard-score">{s.correct_count}/{s.question_count}</span>
                      <span className="drill-leaderboard-accuracy">{accuracy}%</span>
                      <span className="drill-leaderboard-time">
                        {mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}
                      </span>
                      <span className="drill-leaderboard-date">{dateStr}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <button className="btn btn-primary drill-leaderboard-start" onClick={handleStartDrill}>
              Start Drill
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
