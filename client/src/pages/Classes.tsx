import { useMemo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../api';
import type { Classroom } from '../api';
import { useAuth } from '../hooks/useAuth';
import { useActiveClassroom } from '../hooks/useActiveClassroom';
import ClassroomSetupBanner from '../components/classroom/ClassroomSetupBanner';
import { PlusIcon, PeopleIcon, MoreVerticalIcon, CloseIcon, CalendarIcon } from '../components/icons';
import { useClickOutside } from '../hooks/useClickOutside';
import { LANGUAGES } from '../components/classwork/languages';
import { formatUsDateTime } from '../utils/dateFormat';
import { LANGUAGE_BANNERS, bannerColor } from '../utils/languageBanners';

function languageName(code: string | null) {
  if (!code) return null;
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

// Three-dot menu for card actions
function CardMenu({
  onEdit,
  onDelete,
  onClose,
}: {
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, onClose);

  return (
    <div ref={menuRef} className="gc-card-menu">
      <button className="gc-card-menu-item" onClick={() => { onEdit(); onClose(); }}>Edit class</button>
      <button className="gc-card-menu-item gc-card-menu-item--danger" onClick={() => { onDelete(); onClose(); }}>Delete class</button>
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
  const [createTargetLang, setCreateTargetLang] = useState('');
  const [createNativeLang, setCreateNativeLang] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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
        target_language: createTargetLang || undefined,
        native_language: createNativeLang || undefined,
      });
      await reloadClassrooms();
      setActiveClassroomId(classroom.id);
      setCreateName('');
      setCreateTargetLang('');
      setCreateNativeLang('');
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
    try {
      await api.deleteClassroom(classroom.id);
      await reloadClassrooms();
    } catch (err) {
      console.error('Failed to delete classroom:', err);
      setCreateError(err instanceof Error ? err.message : 'Failed to delete classroom');
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
        <div className="create-class-overlay" onClick={() => setShowCreateForm(false)}>
          <div className="create-class-modal" onClick={(e) => e.stopPropagation()}>
            <div className="create-class-modal-header">
              <h2 className="create-class-modal-title">Create a new class</h2>
              <button
                className="create-class-modal-close"
                type="button"
                onClick={() => setShowCreateForm(false)}
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <form onSubmit={handleCreate}>
              <div className="create-class-modal-body">
                <label className="create-class-field">
                  <span className="create-class-label">Class name</span>
                  <input
                    className="form-input"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="e.g. Spanish 101"
                    required
                    autoFocus
                  />
                </label>

                <label className="create-class-field">
                  <span className="create-class-label">Teaching language</span>
                  <select
                    className="form-input"
                    value={createTargetLang}
                    onChange={(e) => setCreateTargetLang(e.target.value)}
                    required
                  >
                    <option value="" disabled>Select a language...</option>
                    {LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>{l.name}</option>
                    ))}
                  </select>
                </label>

                <label className="create-class-field">
                  <span className="create-class-label">Students speak</span>
                  <select
                    className="form-input"
                    value={createNativeLang}
                    onChange={(e) => setCreateNativeLang(e.target.value)}
                    required
                  >
                    <option value="" disabled>Select a language...</option>
                    {LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>{l.name}</option>
                    ))}
                  </select>
                </label>

                {createError && <div className="auth-error">{createError}</div>}
              </div>

              <div className="create-class-modal-footer">
                <button className="btn btn-secondary" type="button" onClick={() => setShowCreateForm(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary" type="submit" disabled={creating}>
                  {creating ? 'Creating...' : 'Create class'}
                </button>
              </div>
            </form>
          </div>
        </div>
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
            const bannerImg = classroom.target_language ? LANGUAGE_BANNERS[classroom.target_language] : null;
            const color = bannerColor(classroom.id);
            const targetName = languageName(classroom.target_language);
            const nativeName = languageName(classroom.native_language);

            return (
              <div key={classroom.id} className="gc-card">
                <div
                  className="gc-card-banner"
                  style={bannerImg
                    ? { backgroundImage: `linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.1) 60%), url(${bannerImg})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                    : { background: color }
                  }
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
                  {targetName && (
                    <p className="gc-card-detail">
                      {targetName}{nativeName ? ` (for ${nativeName} speakers)` : ''}
                    </p>
                  )}
                  {classroom.next_class_at && (
                    <p className="gc-card-detail gc-card-next-lesson">
                      <CalendarIcon size={14} />
                      {classroom.next_class_title ? `${classroom.next_class_title} — ` : ''}
                      {formatUsDateTime(classroom.next_class_at)}
                    </p>
                  )}
                </div>

                {isTeacher && isEditing && (
                  <div className="gc-card-edit-section">
                    <ClassroomSetupBanner classroom={classroom} onUpdated={handleUpdated} />
                  </div>
                )}

                <div className="gc-card-footer">
                  <div className="gc-card-footer-info">
                    {classroom.class_code && (
                      <span className="gc-card-footer-code">Code: {classroom.class_code}</span>
                    )}
                  </div>
                  <div className="gc-card-footer-actions">
                    <button
                      className="gc-card-action gc-card-action--students"
                      onClick={() => {
                        setActiveClassroomId(classroom.id);
                        navigate(`/students?classroomId=${classroom.id}`);
                      }}
                      title="Students"
                    >
                      <PeopleIcon size={16} />
                      <span>{classroom.student_count}</span>
                    </button>
                    {isTeacher && (
                      <div className="gc-card-menu-anchor">
                        <button
                          className="gc-card-action"
                          onClick={() => setMenuOpenId((prev) => prev === classroom.id ? null : classroom.id)}
                          title="More options"
                        >
                          <MoreVerticalIcon size={20} />
                        </button>
                        {menuOpenId === classroom.id && (
                          <CardMenu
                            onEdit={() => setEditingId((prev) => prev === classroom.id ? null : classroom.id)}
                            onDelete={() => handleDelete(classroom)}
                            onClose={() => setMenuOpenId(null)}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
