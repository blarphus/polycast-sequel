import React, { useMemo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../api';
import type { Classroom } from '../api';
import { useAuth } from '../hooks/useAuth';
import { useActiveClassroom } from '../hooks/useActiveClassroom';
import ClassroomSetupBanner from '../components/classroom/ClassroomSetupBanner';
import { PlusIcon, PeopleIcon, MoreVerticalIcon } from '../components/icons';
import { useClickOutside } from '../hooks/useClickOutside';
import { LANGUAGES } from '../components/classwork/languages';

// Banner images by language (Wikimedia Commons)
const LANGUAGE_BANNERS: Record<string, string> = {
  en: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/London_Skyline_from_Waterloo_Bridge%2C_London%2C_UK_-_Diliff.jpg/960px-London_Skyline_from_Waterloo_Bridge%2C_London%2C_UK_-_Diliff.jpg',
  es: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Amanecer_en_Barcelona_2012.JPG/960px-Amanecer_en_Barcelona_2012.JPG',
  pt: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Sugarloaf_Mountain%2C_Rio_de_Janeiro%2C_Brazil.jpg/960px-Sugarloaf_Mountain%2C_Rio_de_Janeiro%2C_Brazil.jpg',
  fr: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Eiffel_Tower_in_cityscape_of_Paris_at_night_light_%288210912882%29.jpg/960px-Eiffel_Tower_in_cityscape_of_Paris_at_night_light_%288210912882%29.jpg',
  ja: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Lake_Kawaguchiko_Sakura_Mount_Fuji_4.JPG/960px-Lake_Kawaguchiko_Sakura_Mount_Fuji_4.JPG',
  de: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Neuschwanstein_Castle_from_Marienbr%C3%BCcke%2C_2011_May.jpg/960px-Neuschwanstein_Castle_from_Marienbr%C3%BCcke%2C_2011_May.jpg',
};

// Fallback colors when no language is set
const BANNER_COLORS = [
  '#1e88e5', '#0d9488', '#7c3aed', '#c2410c', '#0891b2',
  '#4f46e5', '#b45309', '#0f766e', '#6d28d9', '#1d4ed8',
];

function bannerColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return BANNER_COLORS[Math.abs(hash) % BANNER_COLORS.length];
}

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
  const [createTargetLang, setCreateTargetLang] = useState('');
  const [createNativeLang, setCreateNativeLang] = useState('');
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
            <select
              className="form-input"
              value={createTargetLang}
              onChange={(e) => setCreateTargetLang(e.target.value)}
            >
              <option value="">Teaching language...</option>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
            <select
              className="form-input"
              value={createNativeLang}
              onChange={(e) => setCreateNativeLang(e.target.value)}
            >
              <option value="">Students speak...</option>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
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
                  <p className="gc-card-detail">
                    {classroom.student_count} student{classroom.student_count === 1 ? '' : 's'}
                  </p>
                  {classroom.class_code && (
                    <p className="gc-card-detail gc-card-code">Code: {classroom.class_code}</p>
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
