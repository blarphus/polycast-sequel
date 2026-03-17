// ---------------------------------------------------------------------------
// pages/Onboarding.tsx -- Post-signup language selection (required)
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { LANGUAGES } from '../components/classwork/languages';
import PlacementTest from '../components/PlacementTest';
import { toErrorMessage } from '../utils/errors';

const PLACEMENT_LANGUAGES = ['en', 'es', 'pt'];

export default function Onboarding() {
  const { user, updateSettings } = useAuth();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<'setup' | 'placement'>('setup');
  const [nativeLang, setNativeLang] = useState(user?.native_language || '');
  const [targetLang, setTargetLang] = useState(user?.target_language || '');
  const [accountType, setAccountType] = useState<'student' | 'teacher'>(user?.account_type || 'student');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // If user already has languages set, send them home
  if (user?.native_language && user?.target_language) {
    navigate('/', { replace: true });
    return null;
  }

  const handleSubmit = async () => {
    setError('');

    if (!nativeLang || !targetLang) {
      setError('Please select both languages.');
      return;
    }
    if (nativeLang === targetLang) {
      setError('Native and target languages must be different.');
      return;
    }

    setSaving(true);
    try {
      await updateSettings(nativeLang, targetLang, undefined, accountType);

      if (PLACEMENT_LANGUAGES.includes(targetLang)) {
        setPhase('placement');
      } else {
        navigate('/', { replace: true });
      }
    } catch (err: unknown) {
      console.error('Onboarding: save failed:', err);
      setError(toErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handlePlacementComplete = async (level: string) => {
    try {
      await updateSettings(nativeLang, targetLang, undefined, undefined, level);
    } catch (err) {
      console.error('Onboarding: save cefr_level failed:', err);
    }
    navigate('/', { replace: true });
  };

  if (phase === 'placement') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1 className="auth-title">Placement Test</h1>
          <p className="auth-subtitle">Let's assess your vocabulary level</p>
          <PlacementTest language={targetLang} onComplete={handlePlacementComplete} />
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">Welcome to Polycast</h1>
        <p className="auth-subtitle">Let's set up your languages</p>

        {error && <div className="auth-error">{error}</div>}

        <div className="theme-toggle-row">
          <span className="form-label" style={{ marginBottom: 0 }}>Account type</span>
          <div className="theme-toggle">
            <button
              className={`theme-toggle-option${accountType === 'student' ? ' active' : ''}`}
              onClick={() => setAccountType('student')}
              type="button"
            >
              Student
            </button>
            <button
              className={`theme-toggle-option${accountType === 'teacher' ? ' active' : ''}`}
              onClick={() => setAccountType('teacher')}
              type="button"
            >
              Teacher
            </button>
          </div>
        </div>

        <label className="form-label">Native Language</label>
        <select
          className="form-input"
          value={nativeLang}
          onChange={(e) => setNativeLang(e.target.value)}
        >
          <option value="">Select...</option>
          {LANGUAGES.filter((l) => l.code !== targetLang).map((l) => (
            <option key={l.code} value={l.code}>{l.name}</option>
          ))}
        </select>

        <label className="form-label">Target Language</label>
        <select
          className="form-input"
          value={targetLang}
          onChange={(e) => setTargetLang(e.target.value)}
        >
          <option value="">Select...</option>
          {LANGUAGES.filter((l) => l.code !== nativeLang).map((l) => (
            <option key={l.code} value={l.code}>{l.name}</option>
          ))}
        </select>

        <button
          className="btn btn-primary btn-block"
          onClick={handleSubmit}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Get Started'}
        </button>
      </div>
    </div>
  );
}
