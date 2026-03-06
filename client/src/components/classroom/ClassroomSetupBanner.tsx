import React, { useEffect, useState } from 'react';
import * as api from '../../api';
import type { Classroom } from '../../api';

interface Props {
  classroom: Classroom;
  onUpdated: (classroom: Classroom) => void;
}

export default function ClassroomSetupBanner({ classroom, onUpdated }: Props) {
  const [name, setName] = useState(classroom.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setName(classroom.name);
    setError('');
  }, [classroom]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const updated = await api.updateClassroom(classroom.id, {
        name: name.trim() || classroom.name,
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
    ? 'Rename it now. Existing classwork will keep working.'
    : 'Update the class name.';

  return (
    <div className="classroom-setup-banner">
      <div className="classroom-setup-copy">
        <h2 className="classroom-setup-title">{title}</h2>
        <p className="classroom-setup-text">
          {description}
        </p>
      </div>

      <form className="classroom-setup-form" onSubmit={handleSave}>
        <input
          className="form-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Class name"
        />
        <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Save class'}
        </button>
      </form>

      {error && <div className="auth-error">{error}</div>}
    </div>
  );
}
