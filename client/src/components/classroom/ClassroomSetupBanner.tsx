import React, { useEffect, useState } from 'react';
import * as api from '../../api';
import type { Classroom } from '../../api';
import { LANGUAGES } from '../classwork/languages';

interface Props {
  classroom: Classroom;
  onUpdated: (classroom: Classroom) => void;
}

export default function ClassroomSetupBanner({ classroom, onUpdated }: Props) {
  const [name, setName] = useState(classroom.name);
  const [targetLanguage, setTargetLanguage] = useState(classroom.target_language ?? '');
  const [nativeLanguage, setNativeLanguage] = useState(classroom.native_language ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setName(classroom.name);
    setTargetLanguage(classroom.target_language ?? '');
    setNativeLanguage(classroom.native_language ?? '');
    setError('');
  }, [classroom]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const updated = await api.updateClassroom(classroom.id, {
        name: name.trim() || classroom.name,
        target_language: targetLanguage || null,
        native_language: nativeLanguage || null,
        needs_setup: false,
      });
      onUpdated(updated);
    } catch (err) {
      console.error('Failed to update classroom:', err);
      setError(err instanceof Error ? err.message : 'Failed to update classroom');
    } finally {
      setSaving(false);
    }
  };

  const title = classroom.needs_setup ? 'Set up this imported class' : 'Edit class details';
  const description = classroom.needs_setup
    ? 'Rename it and set languages now. Existing classwork will keep working.'
    : 'Update the class name and language settings.';

  return (
    <div className="classroom-setup-banner">
      <div className="classroom-setup-copy">
        <h2 className="classroom-setup-title">{title}</h2>
        <p className="classroom-setup-text">
          {description}
        </p>
      </div>

      <form className="classroom-setup-form" onSubmit={handleSave}>
        <label className="classroom-setup-field">
          <span className="classroom-setup-label">Class name</span>
          <input
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Class name"
          />
        </label>
        <label className="classroom-setup-field">
          <span className="classroom-setup-label">Target language</span>
          <select
            className="form-input"
            value={targetLanguage}
            onChange={(e) => setTargetLanguage(e.target.value)}
          >
            <option value="">Select...</option>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
        </label>
        <label className="classroom-setup-field">
          <span className="classroom-setup-label">Student native language</span>
          <select
            className="form-input"
            value={nativeLanguage}
            onChange={(e) => setNativeLanguage(e.target.value)}
          >
            <option value="">Select...</option>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Save class'}
        </button>
      </form>

      {error && <div className="auth-error">{error}</div>}
    </div>
  );
}
