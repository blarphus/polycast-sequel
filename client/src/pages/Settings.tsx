// ---------------------------------------------------------------------------
// pages/Settings.tsx -- Language settings page
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { LANGUAGES } from '../components/classwork/languages';
import PlacementTest from '../components/PlacementTest';
import { ChevronLeftIcon } from '../components/icons';

export default function Settings() {
  const { user, savedAccounts, switchAccount, forgetSavedAccount, updateSettings } = useAuth();
  const { theme, toggleTheme, bgTexture, setBgTexture } = useTheme();
  const navigate = useNavigate();

  const [nativeLang, setNativeLang] = useState(user?.native_language || '');
  const [targetLang, setTargetLang] = useState(user?.target_language || '');
  const [dailyNewLimit, setDailyNewLimit] = useState(user?.daily_new_limit ?? 5);
  const [accountType, setAccountType] = useState<'student' | 'teacher'>(user?.account_type || 'student');
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [showPlacement, setShowPlacement] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState(user?.id || '');

  useEffect(() => {
    setNativeLang(user?.native_language || '');
    setTargetLang(user?.target_language || '');
    setDailyNewLimit(user?.daily_new_limit ?? 5);
    setAccountType(user?.account_type || 'student');
    setSelectedAccountId(user?.id || '');
  }, [user]);

  const PLACEMENT_LANGUAGES = ['en', 'es', 'pt'];
  const canTakePlacement = PLACEMENT_LANGUAGES.includes(user?.target_language || '');

  const handlePlacementComplete = async (level: string) => {
    try {
      await updateSettings(nativeLang || null, targetLang || null, undefined, undefined, level);
      setSaved(true);
    } catch (err) {
      console.error('Settings: save cefr_level failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
    setShowPlacement(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await updateSettings(nativeLang || null, targetLang || null, dailyNewLimit, accountType);
      setSaved(true);
    } catch (err: any) {
      console.error('Settings: save failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSwitchAccount = async () => {
    if (!selectedAccountId || selectedAccountId === user?.id) return;
    setSwitching(true);
    setError('');
    setSaved(false);
    try {
      await switchAccount(selectedAccountId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSwitching(false);
    }
  };

  const switchableAccounts = savedAccounts;

  if (showPlacement && user?.target_language) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1 className="auth-title">Placement Test</h1>
          <p className="auth-subtitle">Let's assess your vocabulary level</p>
          <PlacementTest language={user.target_language} onComplete={handlePlacementComplete} />
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="saved-account-panel">
          <div className="saved-account-header">
            <div>
              <div className="saved-account-title">Saved Accounts</div>
              <div className="saved-account-subtitle">Switch between your teacher and student sessions on this device</div>
            </div>
          </div>
          <div className="saved-account-row">
            <select
              className="form-input saved-account-select"
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
            >
              {switchableAccounts.length === 0 ? (
                <option value="">No saved accounts yet</option>
              ) : (
                switchableAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.display_name || account.username} ({account.account_type})
                    {account.id === user?.id ? ' - Current' : ''}
                  </option>
                ))
              )}
            </select>
            <button
              className="btn btn-primary"
              type="button"
              onClick={handleSwitchAccount}
              disabled={switching || !selectedAccountId || selectedAccountId === user?.id}
            >
              {switching ? 'Switching...' : 'Switch'}
            </button>
          </div>
          {switchableAccounts.length > 0 && (
            <div className="saved-account-list">
              {switchableAccounts.map((account) => (
                <div key={account.id} className={`saved-account-chip${account.id === user?.id ? ' active' : ''}`}>
                  <div className="saved-account-chip-main">
                    <span className="saved-account-chip-name">{account.display_name || account.username}</span>
                    <span className="saved-account-chip-meta">@{account.username} · {account.account_type}</span>
                  </div>
                  <button
                    className="saved-account-remove"
                    type="button"
                    onClick={() => forgetSavedAccount(account.id)}
                    title="Remove saved account"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button className="channel-back-btn" onClick={() => navigate(-1)}>
          <ChevronLeftIcon size={18} />
          Back
        </button>
        <h1 className="auth-title">Settings</h1>
        <p className="auth-subtitle">Set your language preferences</p>

        <div className="theme-toggle-row">
          <span className="form-label" style={{ marginBottom: 0 }}>Theme</span>
          <div className="theme-toggle">
            <button
              className={`theme-toggle-option${theme === 'light' ? ' active' : ''}`}
              onClick={() => theme !== 'light' && toggleTheme()}
            >
              Light
            </button>
            <button
              className={`theme-toggle-option${theme === 'dark' ? ' active' : ''}`}
              onClick={() => theme !== 'dark' && toggleTheme()}
            >
              Dark
            </button>
          </div>
        </div>

        <div className="texture-toggle-row">
          <span className="form-label" style={{ marginBottom: 0 }}>Background</span>
          <div className="texture-toggle">
            {(['none', 'dots', 'lines', 'noise', 'grid'] as const).map((t) => (
              <button
                key={t}
                className={`texture-toggle-option${bgTexture === t ? ' active' : ''}`}
                onClick={() => setBgTexture(t)}
              >
                {t === 'none' ? 'None' : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="daily-limit-row">
          <span className="form-label" style={{ marginBottom: 0 }}>Daily new words</span>
          <div className="daily-limit-stepper">
            <button
              className="daily-limit-btn"
              onClick={() => setDailyNewLimit((v) => Math.max(1, v - 1))}
              disabled={dailyNewLimit <= 1}
            >
              &minus;
            </button>
            <span className="daily-limit-value">{dailyNewLimit}</span>
            <button
              className="daily-limit-btn"
              onClick={() => setDailyNewLimit((v) => Math.min(50, v + 1))}
              disabled={dailyNewLimit >= 50}
            >
              +
            </button>
          </div>
        </div>

        <div className="theme-toggle-row">
          <span className="form-label" style={{ marginBottom: 0 }}>Account type</span>
          <div className="theme-toggle">
            <button
              className={`theme-toggle-option${accountType === 'student' ? ' active' : ''}`}
              onClick={() => setAccountType('student')}
            >
              Student
            </button>
            <button
              className={`theme-toggle-option${accountType === 'teacher' ? ' active' : ''}`}
              onClick={() => setAccountType('teacher')}
            >
              Teacher
            </button>
          </div>
        </div>

        {canTakePlacement && (
          <div className="theme-toggle-row">
            <span className="form-label" style={{ marginBottom: 0 }}>
              CEFR Level{user?.cefr_level ? `: ${user.cefr_level}` : ''}
            </span>
            <button
              className="btn btn-small"
              onClick={() => setShowPlacement(true)}
              type="button"
            >
              {user?.cefr_level ? 'Retake Test' : 'Take Test'}
            </button>
          </div>
        )}

        {error && <div className="auth-error">{error}</div>}
        {saved && <div className="settings-success">Settings saved!</div>}

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

        <button className="btn btn-primary btn-block" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>

        <div className="auth-link">
          <a href="#" onClick={(e) => { e.preventDefault(); navigate('/'); }}>Back to Home</a>
        </div>
      </div>
    </div>
  );
}
