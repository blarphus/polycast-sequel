import { createScopedRuntimeLogger } from '../utils/scopedRuntimeLogger';
const runtimeLog = createScopedRuntimeLogger('web.pages.onboarding');
// ---------------------------------------------------------------------------
// pages/Onboarding.tsx -- Post-signup language selection (required)
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { LANGUAGES } from '../components/classwork/languages';
import { toErrorMessage } from '../utils/errors';


export default function Onboarding() {
  const { user, updateSettings } = useAuth();
  const navigate = useNavigate();

  const [nativeLang, setNativeLang] = useState(user?.native_language || '');
  const [targetLang, setTargetLang] = useState(user?.target_language || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // If user already has languages set, send them home
  if (user?.native_language && user?.target_language) {
    return <Navigate to="/learn" replace />;
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
      await updateSettings(nativeLang, targetLang);
      navigate('/learn', { replace: true });
    } catch (err: unknown) {
      runtimeLog.error('Onboarding: save failed:', err);
      setError(toErrorMessage(err));
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
