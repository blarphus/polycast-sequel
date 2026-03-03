// ---------------------------------------------------------------------------
// pages/Onboarding.tsx -- Post-signup language selection (required)
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { LANGUAGES } from '../components/classwork/languages';

export default function Onboarding() {
  const { user, updateSettings } = useAuth();
  const navigate = useNavigate();

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
      navigate('/', { replace: true });
    } catch (err: unknown) {
      console.error('Onboarding: save failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

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
          {LANGUAGES.map((l) => (
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
          {LANGUAGES.map((l) => (
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
