import React, { useMemo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../api';
import type { Classroom } from '../api';
import { useAuth } from '../hooks/useAuth';
import { useActiveClassroom } from '../hooks/useActiveClassroom';
import ClassroomSetupBanner from '../components/classroom/ClassroomSetupBanner';
import { PlusIcon, PeopleIcon, MoreVerticalIcon } from '../components/icons';
import { useClickOutside } from '../hooks/useClickOutside';

// Stable color palette for card banners
const BANNER_COLORS = [
  '#1e88e5', // blue
  '#0d9488', // teal
  '#7c3aed', // purple
  '#c2410c', // burnt orange
  '#0891b2', // cyan
  '#4f46e5', // indigo
  '#b45309', // amber
  '#0f766e', // dark teal
  '#6d28d9', // violet
  '#1d4ed8', // royal blue
];

function bannerColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return BANNER_COLORS[Math.abs(hash) % BANNER_COLORS.length];
}

// Three-dot menu for card actions
function CardMenu({
  classroom,
  onEdit,
  onDelete,
  onClose,
}: {
  classroom: Classroom;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, onClose);

  return (
    <div ref={menuRef} className="stream-post-menu">
      <button className="stream-post-menu-item" onClick={() => { onEdit(); onClose(); }}>Edit class</button>
      <button className="stream-post-menu-item stream-post-menu-item--danger" onClick={() => { onDelete(); onClose(); }}>Delete class</button>
    </div>
  );
}

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
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

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

  const openClasswork = (classroom: Classroom) => {
    setActiveClassroomId(classroom.id);
    navigate(`/classwork?classroomId=${classroom.id}`);
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
            const color = bannerColor(classroom.id);
            return (
              <div key={classroom.id} className="gc-card">
                <div
                  className="gc-card-banner"
                  style={{ background: color }}
                  onClick={() => openClasswork(classroom)}
                >
                  <h2 className="gc-card-name">{classroom.name}</h2>
                  {classroom.teacher_names.length > 0 && (
                    <p className="gc-card-teacher">{classroom.teacher_names.join(', ')}</p>
                  )}
                  <div className="gc-card-banner-badges">
                    {classroom.needs_setup && <span className="gc-card-badge">Needs setup</span>}
                  </div>
                </div>

                <div className="gc-card-body">
                  <p className="gc-card-detail">
                    {classroom.student_count} student{classroom.student_count === 1 ? '' : 's'}
                  </p>
                  {classroom.class_code && (
                    <p className="gc-card-detail">Code: {classroom.class_code}</p>
                  )}
                </div>

                {isTeacher && isEditing && (
                  <div className="gc-card-edit-section">
                    <ClassroomSetupBanner classroom={classroom} onUpdated={handleUpdated} />
                  </div>
                )}

                {isTeacher && (
                  <div className="gc-card-footer">
                    <button
                      className="gc-card-action"
                      onClick={() => {
                        setActiveClassroomId(classroom.id);
                        navigate(`/students?classroomId=${classroom.id}`);
                      }}
                      title="Students"
                    >
                      <PeopleIcon size={20} />
                    </button>
                    <div style={{ position: 'relative' }}>
                      <button
                        className="gc-card-action"
                        onClick={() => setMenuOpenId((prev) => prev === classroom.id ? null : classroom.id)}
                        title="More options"
                      >
                        <MoreVerticalIcon size={20} />
                      </button>
                      {menuOpenId === classroom.id && (
                        <CardMenu
                          classroom={classroom}
                          onEdit={() => setEditingId((prev) => prev === classroom.id ? null : classroom.id)}
                          onDelete={() => handleDelete(classroom)}
                          onClose={() => setMenuOpenId(null)}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
