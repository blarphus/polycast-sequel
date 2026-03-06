import React, { useEffect, useState } from 'react';
import * as api from '../../api';
import type { Classroom } from '../../api';

interface Props {
  classroom: Classroom;
  onUpdated: (classroom: Classroom) => void;
}

export default function ClassroomSetupBanner({ classroom, onUpdated }: Props) {
  const [name, setName] = useState(classroom.name);
  const [section, setSection] = useState(classroom.section ?? '');
  const [subject, setSubject] = useState(classroom.subject ?? '');
  const [room, setRoom] = useState(classroom.room ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setName(classroom.name);
    setSection(classroom.section ?? '');
    setSubject(classroom.subject ?? '');
    setRoom(classroom.room ?? '');
    setError('');
  }, [classroom]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const updated = await api.updateClassroom(classroom.id, {
        name: name.trim() || classroom.name,
        section: section.trim() || null,
        subject: subject.trim() || null,
        room: room.trim() || null,
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
    ? 'Rename it and add a little context now. Existing classwork will keep working.'
    : 'Update the class name or metadata without changing what students see elsewhere.';

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
        <input
          className="form-input"
          value={section}
          onChange={(e) => setSection(e.target.value)}
          placeholder="Section"
        />
        <input
          className="form-input"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
        />
        <input
          className="form-input"
          value={room}
          onChange={(e) => setRoom(e.target.value)}
          placeholder="Room"
        />
        <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Save class'}
        </button>
      </form>

      {error && <div className="auth-error">{error}</div>}
    </div>
  );
}
