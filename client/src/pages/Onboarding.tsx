import { createScopedRuntimeLogger } from '../utils/scopedRuntimeLogger';
const runtimeLog = createScopedRuntimeLogger('web.pages.onboarding');
// ---------------------------------------------------------------------------
// pages/Onboarding.tsx -- Post-signup language selection (required)
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { LANGUAGES } from '../components/classwork/languages';
import { toErrorMessage } from '../utils/errors';
import { CORE_LANGUAGE_CODES, languageDisplayName, translate, uiLanguage } from '../i18n';


export default function Onboarding() {
  const { user, updateSettings } = useAuth();
  const navigate = useNavigate();

  const [nativeLang, setNativeLang] = useState(user?.native_language || '');
  const [targetLang, setTargetLang] = useState(user?.target_language || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const locale = uiLanguage(nativeLang || user?.native_language);
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // If user already has languages set, send them home
  if (user?.native_language && user?.target_language) {
    return <Navigate to="/learn" replace />;
  }

  const handleSubmit = async () => {
    setError('');

    if (!nativeLang || !targetLang) {
      setError(t('onboarding.both'));
      return;
    }
    if (nativeLang === targetLang) {
      setError(t('onboarding.different'));
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
        <h1 className="auth-title">{t('onboarding.title')}</h1>
        <p className="auth-subtitle">{t('onboarding.subtitle')}</p>

        {error && <div className="auth-error">{error}</div>}

        <label className="form-label">{t('settings.native')}</label>
        <select
          className="form-input"
          value={nativeLang}
          onChange={(e) => setNativeLang(e.target.value)}
        >
          <option value="">{t('common.select')}</option>
          {LANGUAGES.filter((l) => CORE_LANGUAGE_CODES.has(l.code) && l.code !== targetLang).map((l) => (
            <option key={l.code} value={l.code}>{languageDisplayName(l.code, locale)}</option>
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
            <option key={l.code} value={l.code}>{languageDisplayName(l.code, locale)}</option>
          ))}
        </select>

        <button
          className="btn btn-primary btn-block"
          onClick={handleSubmit}
          disabled={saving}
        >
          {saving ? t('common.saving') : t('onboarding.start')}
        </button>
      </div>
    </div>
  );
}
