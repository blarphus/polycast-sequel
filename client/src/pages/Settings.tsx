import { createScopedRuntimeLogger } from '../utils/scopedRuntimeLogger';
const runtimeLog = createScopedRuntimeLogger('web.pages.settings');
// ---------------------------------------------------------------------------
// pages/Settings.tsx -- Language settings page
// ---------------------------------------------------------------------------

import '../styles/settings.css';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { LANGUAGES } from '../components/classwork/languages';
import { ChevronLeftIcon } from '../components/icons';
import { toErrorMessage } from '../utils/errors';
import { CORE_LANGUAGE_CODES } from '../i18n';
import { useI18n } from '../hooks/useI18n';

export default function Settings() {
  const { user, updateSettings } = useAuth();
  const { theme, toggleTheme, bgTexture, setBgTexture } = useTheme();
  const navigate = useNavigate();
  const { t, languageName } = useI18n();

  const [nativeLang, setNativeLang] = useState(user?.native_language || '');
  const [targetLang, setTargetLang] = useState(user?.target_language || '');
  const [dailyNewLimit, setDailyNewLimit] = useState(user?.daily_new_limit ?? 5);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setNativeLang(user?.native_language || '');
    setTargetLang(user?.target_language || '');
    setDailyNewLimit(user?.daily_new_limit ?? 5);
  }, [user]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await updateSettings(nativeLang || null, targetLang || null, dailyNewLimit);
      setSaved(true);
    } catch (err: any) {
      runtimeLog.error('Settings: save failed:', err);
      setError(toErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <button className="channel-back-btn" onClick={() => navigate(-1)}>
          <ChevronLeftIcon size={18} />
          {t('settings.back')}
        </button>
        <h1 className="auth-title">{t('settings.title')}</h1>
        <p className="auth-subtitle">{t('settings.subtitle')}</p>

        <div className="theme-toggle-row">
          <span className="form-label" style={{ marginBottom: 0 }}>{t('settings.theme')}</span>
          <div className="theme-toggle">
            <button
              className={`theme-toggle-option${theme === 'light' ? ' active' : ''}`}
              onClick={() => theme !== 'light' && toggleTheme()}
            >
              {t('settings.light')}
            </button>
            <button
              className={`theme-toggle-option${theme === 'dark' ? ' active' : ''}`}
              onClick={() => theme !== 'dark' && toggleTheme()}
            >
              {t('settings.dark')}
            </button>
          </div>
        </div>

        <div className="texture-toggle-row">
          <span className="form-label" style={{ marginBottom: 0 }}>{t('settings.background')}</span>
          <div className="texture-toggle">
            {(['none', 'dots', 'lines', 'noise', 'grid'] as const).map((texture) => (
              <button
                key={texture}
                className={`texture-toggle-option${bgTexture === texture ? ' active' : ''}`}
                onClick={() => setBgTexture(texture)}
              >
                {{ none: t('settings.none'), dots: t('settings.dots'), lines: t('settings.lines'), noise: t('settings.noise'), grid: t('settings.grid') }[texture]}
              </button>
            ))}
          </div>
        </div>

        <div className="daily-limit-row">
          <span className="form-label" style={{ marginBottom: 0 }}>{t('settings.dailyWords')}</span>
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
          <span className="form-label" style={{ marginBottom: 0 }}>{t('settings.ranking')}</span>
          <button className="btn btn-small" onClick={() => navigate('/catalog-progress')} type="button">
            {t('settings.rankingProgress')}
          </button>
        </div>

        {error && <div className="auth-error">{error}</div>}
        {saved && <div className="settings-success">{t('settings.saved')}</div>}

        <label className="form-label">{t('settings.native')}</label>
        <select
          className="form-input"
          value={nativeLang}
          onChange={(e) => setNativeLang(e.target.value)}
        >
          <option value="">{t('common.select')}</option>
          {LANGUAGES.filter((l) => CORE_LANGUAGE_CODES.has(l.code) && l.code !== targetLang).map((l) => (
            <option key={l.code} value={l.code}>{languageName(l.code)}</option>
          ))}
        </select>

        <label className="form-label">{t('settings.target')}</label>
        <select
          className="form-input"
          value={targetLang}
          onChange={(e) => setTargetLang(e.target.value)}
        >
          <option value="">{t('common.select')}</option>
          {LANGUAGES.filter((l) => CORE_LANGUAGE_CODES.has(l.code) && l.code !== nativeLang).map((l) => (
            <option key={l.code} value={l.code}>{languageName(l.code)}</option>
          ))}
        </select>

        <button className="btn btn-primary btn-block" onClick={handleSave} disabled={saving}>
          {saving ? t('common.saving') : t('common.save')}
        </button>

        <div className="auth-link">
          <a href="#" onClick={(e) => { e.preventDefault(); navigate('/'); }}>{t('settings.backHome')}</a>
        </div>
      </div>
    </div>
  );
}
