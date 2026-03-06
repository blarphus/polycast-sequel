import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../api';
import type { Classroom } from '../api';
import { useAuth } from '../hooks/useAuth';
import { useActiveClassroom } from '../hooks/useActiveClassroom';
import ClassroomSetupBanner from '../components/classroom/ClassroomSetupBanner';
import { PlusIcon } from '../components/icons';

export default function Classes() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isTeacher = user?.account_type === 'teacher';
  const {
    classrooms,
    setActiveClassroomId,
    loading,
    error,
    reloadClassrooms,
  } = useActiveClassroom();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const sortedClassrooms = useMemo(
    () => [...classrooms].sort((a, b) => Number(b.needs_setup) - Number(a.needs_setup)),
    [classrooms],
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      const classroom = await api.createClassroom({
        name: createName.trim(),
      });
      await reloadClassrooms();
      setActiveClassroomId(classroom.id);
      setCreateName('');
      setShowCreateForm(false);
    } catch (err) {
      console.error('Failed to create classroom:', err);
      setCreateError(err instanceof Error ? err.message : 'Failed to create classroom');
    } finally {
      setCreating(false);
    }
  };

  const handleUpdated = async (updated: Classroom) => {
    await reloadClassrooms();
    setActiveClassroomId(updated.id);
    setEditingId(null);
  };

  const handleDelete = async (classroom: Classroom) => {
    const msg = classroom.student_count > 0
      ? `Delete "${classroom.name}"? This will remove all ${classroom.student_count} student${classroom.student_count === 1 ? '' : 's'}, posts, and topics permanently.`
      : `Delete "${classroom.name}"? All posts and topics will be permanently removed.`;
    if (!confirm(msg)) return;
    setDeletingId(classroom.id);
    try {
      await api.deleteClassroom(classroom.id);
      await reloadClassrooms();
    } catch (err) {
      console.error('Failed to delete classroom:', err);
      setCreateError(err instanceof Error ? err.message : 'Failed to delete classroom');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="classes-page">
      <div className="classes-header">
        <div>
          <h1 className="classes-title">Classes</h1>
          <p className="classes-subtitle">
            {isTeacher
              ? 'Manage your classes and open the current classwork shell for each one.'
              : 'Open your enrolled classes here. Your classwork stream will stay tied to the selected class.'}
          </p>
        </div>

        {isTeacher && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreateForm((prev) => !prev)}>
            <PlusIcon size={14} strokeWidth={2.5} />
            Create class
          </button>
        )}
      </div>

      {error && <div className="auth-error">{error}</div>}

      {isTeacher && showCreateForm && (
        <form className="classes-form-card" onSubmit={handleCreate}>
          <div className="classes-form-grid">
            <input
              className="form-input"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="Class name"
              required
            />
          </div>
          <div className="classes-form-actions">
            <button className="btn btn-primary btn-sm" type="submit" disabled={creating}>
              {creating ? 'Creating...' : 'Create'}
            </button>
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => setShowCreateForm(false)}>
              Cancel
            </button>
          </div>
          {createError && <div className="auth-error">{createError}</div>}
        </form>
      )}

      {loading ? (
        <div className="loading-screen"><div className="loading-spinner" /></div>
      ) : sortedClassrooms.length === 0 ? (
        <div className="classwork-empty">
          {isTeacher ? 'No classes yet. Create one to start organizing your classroom.' : 'You are not enrolled in any classes yet.'}
        </div>
      ) : (
        <div className="classes-grid">
          {sortedClassrooms.map((classroom) => {
            const isEditing = editingId === classroom.id;
            return (
              <div key={classroom.id} className="classes-card">
                <div className="classes-card-header">
                  <div>
                    <h2 className="classes-card-title">{classroom.name}</h2>
                  </div>
                  <div className="classes-badges">
                    {classroom.is_default_migrated && <span className="classes-badge">Imported</span>}
                    {classroom.needs_setup && <span className="classes-badge classes-badge--warning">Needs setup</span>}
                  </div>
                </div>

                {classroom.teacher_names.length > 0 && (
                  <p className="classes-card-detail">
                    Teachers: {classroom.teacher_names.join(', ')}
                  </p>
                )}
                <p className="classes-card-detail">
                  {classroom.student_count} student{classroom.student_count === 1 ? '' : 's'}
                </p>
                {classroom.class_code && (
                  <p className="classes-card-detail">Class code: {classroom.class_code}</p>
                )}

                {isTeacher && isEditing && (
                  <ClassroomSetupBanner classroom={classroom} onUpdated={handleUpdated} />
                )}
                <div className="classes-card-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setActiveClassroomId(classroom.id);
                      navigate(`/classwork?classroomId=${classroom.id}`);
                    }}
                  >
                    Open classwork
                  </button>
                  {isTeacher ? (
                    <>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setActiveClassroomId(classroom.id);
                          navigate(`/students?classroomId=${classroom.id}`);
                        }}
                      >
                        Open students
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setEditingId((prev) => prev === classroom.id ? null : classroom.id);
                        }}
                      >
                        {isEditing ? 'Close setup' : 'Edit class'}
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDelete(classroom)}
                        disabled={deletingId === classroom.id}
                      >
                        {deletingId === classroom.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
