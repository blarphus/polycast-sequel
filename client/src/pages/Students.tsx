import { createScopedRuntimeLogger } from '../utils/scopedRuntimeLogger';
const runtimeLog = createScopedRuntimeLogger('web.pages.students');
// ---------------------------------------------------------------------------
// pages/Students.tsx -- Teacher's classroom roster + student search
// ---------------------------------------------------------------------------

import '../styles/students.css';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useActiveClassroom } from '../hooks/useActiveClassroom';
import * as api from '../api';
import type { Classroom, ClassroomStudent, StudentDetail, UserResult } from '../api';
import ClassroomPicker from '../components/classroom/ClassroomPicker';
import ClassroomSetupBanner from '../components/classroom/ClassroomSetupBanner';
import {
  BookOpenIcon,
  CalendarIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FlameIcon,
  PlusIcon,
  SearchIcon,
  TargetIcon,
} from '../components/icons';
import Avatar from '../components/Avatar';

export default function Students() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isTeacher = user?.account_type === 'teacher';
  const [searchParams, setSearchParams] = useSearchParams();
  const classroomIdParam = searchParams.get('classroomId');
  const {
    classrooms,
    activeClassroom,
    activeClassroomId,
    setActiveClassroomId,
    loading: classroomsLoading,
    error: classroomsError,
    reloadClassrooms,
  } = useActiveClassroom(classroomIdParam);
  const [roster, setRoster] = useState<ClassroomStudent[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserResult[]>([]);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rosterQuery, setRosterQuery] = useState('');
  const [rosterSort, setRosterSort] = useState<'name' | 'online' | 'recent'>('online');
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [studentDetail, setStudentDetail] = useState<StudentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!activeClassroomId) return;
    const next = new URLSearchParams(searchParams);
    next.set('classroomId', activeClassroomId);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [activeClassroomId, searchParams, setSearchParams]);

  // Fetch classroom roster on classroom change
  useEffect(() => {
    setError('');
    setSearchQuery('');
    setSearchResults([]);
    if (!activeClassroomId) {
      setRoster([]);
      setAddedIds(new Set());
      setLoading(false);
      return;
    }

    setLoading(true);
    api.getClassroomStudents(activeClassroomId)
      .then((students) => {
        setRoster(students);
        setAddedIds(new Set(students.map((s) => s.id)));
        setSelectedStudentId((current) => (
          current && students.some((student) => student.id === current)
            ? current
            : students[0]?.id || null
        ));
      })
      .catch((err) => {
        runtimeLog.error('Failed to load classroom students:', err);
        setError('Failed to load students');
      })
      .finally(() => setLoading(false));
  }, [activeClassroomId]);

  useEffect(() => {
    if (!activeClassroomId || !selectedStudentId) {
      setStudentDetail(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setError('');
    api.getStudentStats(activeClassroomId, selectedStudentId)
      .then((detail) => {
        if (!cancelled) setStudentDetail(detail);
      })
      .catch((err) => {
        runtimeLog.error('Failed to load selected student:', err);
        if (!cancelled) {
          setStudentDetail(null);
          setError('Failed to load the selected student dashboard');
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeClassroomId, selectedStudentId]);

  // Debounced search
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const results = await api.searchUsers(query, 'student');
        setSearchResults(results);
      } catch (err) {
        runtimeLog.error('Student search failed:', err);
      }
    }, 300);
  }, []);

  const handleAdd = async (studentId: string) => {
    if (!activeClassroomId) return;
    try {
      await api.addClassroomStudent(activeClassroomId, studentId);
      setAddedIds((prev) => new Set(prev).add(studentId));
      // Refresh roster
      const updated = await api.getClassroomStudents(activeClassroomId);
      setRoster(updated);
      setSelectedStudentId(studentId);
      setSearchQuery('');
      setSearchResults([]);
      setAddPanelOpen(false);
    } catch (err) {
      runtimeLog.error('Failed to add student:', err);
      setError('Failed to add student');
    }
  };

  const handleRemove = async (studentId: string) => {
    if (!activeClassroomId) return;
    try {
      await api.removeClassroomStudent(activeClassroomId, studentId);
      setRoster((prev) => prev.filter((s) => s.id !== studentId));
      if (selectedStudentId === studentId) {
        const nextStudent = roster.find((student) => student.id !== studentId);
        setSelectedStudentId(nextStudent?.id || null);
      }
      setAddedIds((prev) => {
        const next = new Set(prev);
        next.delete(studentId);
        return next;
      });
    } catch (err) {
      runtimeLog.error('Failed to remove student:', err);
      setError('Failed to remove student');
    }
  };

  const handleClassroomUpdated = async (updatedClassroom: Classroom) => {
    await reloadClassrooms();
    setActiveClassroomId(updatedClassroom.id);
  };

  const visibleRoster = useMemo(() => {
    const needle = rosterQuery.trim().toLocaleLowerCase();
    return [...roster]
      .filter((student) => !needle
        || student.username.toLocaleLowerCase().includes(needle)
        || student.display_name.toLocaleLowerCase().includes(needle))
      .sort((a, b) => {
        if (rosterSort === 'online') {
          return Number(b.online) - Number(a.online)
            || (b.added_at || '').localeCompare(a.added_at || '')
            || a.username.localeCompare(b.username);
        }
        if (rosterSort === 'recent') {
          return (b.added_at || '').localeCompare(a.added_at || '')
            || a.username.localeCompare(b.username);
        }
        return (a.display_name || a.username).localeCompare(b.display_name || b.username);
      });
  }, [roster, rosterQuery, rosterSort]);

  const selectedRosterStudent = roster.find((student) => student.id === selectedStudentId) || null;
  const openStudentDashboard = () => {
    if (!activeClassroom || !selectedStudentId) return;
    navigate(`/students/${selectedStudentId}?classroomId=${activeClassroom.id}`);
  };

  const accuracyLabel = studentDetail?.stats.accuracy == null
    ? '—'
    : `${Math.round(studentDetail.stats.accuracy * 100)}%`;

  return (
    <div className="students-page">
      <header className="students-header">
        <div className="students-heading">
          <h1 className="students-title">Students</h1>
          <ClassroomPicker
            classrooms={classrooms}
            value={activeClassroomId}
            onChange={setActiveClassroomId}
            label="Class"
          />
        </div>
        {isTeacher && activeClassroom && (
          <div className="students-header-actions">
            {activeClassroom.class_code && (
              <div className="students-class-code">
                <span>Class code:</span>
                <code>{activeClassroom.class_code}</code>
                <button onClick={() => navigator.clipboard.writeText(activeClassroom.class_code!)}>Copy</button>
              </div>
            )}
            <button className="students-add-button" onClick={() => setAddPanelOpen((open) => !open)}>
              <PlusIcon size={18} />
              Add student
            </button>
          </div>
        )}
      </header>

      {classroomsError && <div className="auth-error">{classroomsError}</div>}
      {activeClassroom?.needs_setup && isTeacher && (
        <ClassroomSetupBanner classroom={activeClassroom} onUpdated={handleClassroomUpdated} />
      )}

      {isTeacher && activeClassroom && addPanelOpen && (
        <div className="students-add-section">
          <div className="students-add-header">
            <PlusIcon size={16} strokeWidth={2.5} />
            <span>Add a student by username</span>
          </div>
          <div className="students-search">
            <input
              className="form-input"
              type="text"
              placeholder="Search by username..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              autoComplete="off"
            />
          </div>

          {searchQuery.trim() && searchResults.length > 0 && (
            <div className="students-search-results">
              {searchResults.map((u) => (
                <div key={u.id} className="students-roster-item">
                  <Avatar name={u.display_name || u.username} className="students-avatar" />
                  <div className="students-info">
                    <span className="students-name">{u.display_name || u.username}</span>
                    <span className="students-username">@{u.username}</span>
                  </div>
                  <button
                    className="btn btn-small"
                    disabled={addedIds.has(u.id)}
                    onClick={() => handleAdd(u.id)}
                  >
                    {addedIds.has(u.id) ? 'Added' : 'Add'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {searchQuery.trim() && searchResults.length === 0 && (
            <p className="students-empty">No students found</p>
          )}
        </div>
      )}

      {error && <div className="auth-error">{error}</div>}

      {classroomsLoading || loading ? (
        <div className="loading-screen"><div className="loading-spinner" /></div>
      ) : !activeClassroom ? (
        <p className="students-empty">No classroom selected yet.</p>
      ) : roster.length === 0 ? (
        <p className="students-empty">
          {isTeacher
            ? 'No students in this class yet. Add a student or share the class code above.'
            : 'No classmates are visible for this class yet.'}
        </p>
      ) : (
        <main className="students-workspace">
          <aside className="students-roster-panel" aria-label="Class roster">
            <label className="students-roster-search">
              <SearchIcon size={18} />
              <input
                type="search"
                placeholder="Search students…"
                value={rosterQuery}
                onChange={(event) => setRosterQuery(event.target.value)}
              />
            </label>
            <div className="students-roster-controls">
              <label>
                <span>Sort by</span>
                <select value={rosterSort} onChange={(event) => setRosterSort(event.target.value as typeof rosterSort)}>
                  <option value="online">Online first</option>
                  <option value="recent">Recently added</option>
                  <option value="name">Name</option>
                </select>
              </label>
              <span>{visibleRoster.length} {visibleRoster.length === 1 ? 'student' : 'students'}</span>
            </div>
            <div className="students-roster">
              {visibleRoster.map((student) => (
                <button
                  key={student.id}
                  className={`students-roster-item${selectedStudentId === student.id ? ' active' : ''}`}
                  onClick={() => setSelectedStudentId(student.id)}
                >
                  <Avatar name={student.display_name || student.username} className="students-avatar">
                    <span className={`students-presence-dot${student.online ? ' online' : ''}`} />
                  </Avatar>
                  <span className="students-info">
                    <strong>{student.display_name || student.username}</strong>
                    <small>@{student.username}</small>
                  </span>
                  {student.online && <span className="students-online-pill">Online</span>}
                  <ChevronRightIcon size={18} />
                </button>
              ))}
              {visibleRoster.length === 0 && <p className="students-empty">No students match that search.</p>}
            </div>
            <div className="students-roster-footer">Showing {visibleRoster.length} of {roster.length} students</div>
          </aside>

          <section className="students-overview" aria-live="polite">
            {detailLoading || !selectedRosterStudent ? (
              <div className="students-overview-loading"><div className="loading-spinner" /></div>
            ) : !studentDetail ? (
              <div className="students-empty">Select a student to view their dashboard.</div>
            ) : (
              <>
                <div className="students-profile-row">
                  <Avatar name={selectedRosterStudent.display_name || selectedRosterStudent.username} className="students-profile-avatar">
                    <span className={`students-presence-dot${selectedRosterStudent.online ? ' online' : ''}`} />
                  </Avatar>
                  <div className="students-profile-copy">
                    <h2>{selectedRosterStudent.display_name || selectedRosterStudent.username}</h2>
                    <span>@{selectedRosterStudent.username}</span>
                    <small>{selectedRosterStudent.online ? 'Online now' : 'Currently offline'}</small>
                  </div>
                  <button className="students-dashboard-button" onClick={openStudentDashboard}>
                    Open full dashboard <ExternalLinkIcon size={16} />
                  </button>
                </div>

                <div className="students-summary-row">
                  <article className="students-due-card">
                    <CalendarIcon size={24} />
                    <strong>{studentDetail.stats.wordsDue}</strong>
                    <span>cards due today</span>
                    <p>{studentDetail.stats.wordsDue > 0 ? 'Review is waiting for this student.' : 'This student is caught up.'}</p>
                    <button onClick={openStudentDashboard}>View due cards</button>
                  </article>
                  <div className="students-metric-grid">
                    <article>
                      <TargetIcon size={20} />
                      <strong>{accuracyLabel}</strong>
                      <span>Accuracy</span>
                    </article>
                    <article>
                      <FlameIcon size={20} />
                      <strong>{studentDetail.stats.streak}</strong>
                      <span>Day streak</span>
                    </article>
                    <article>
                      <BookOpenIcon size={20} />
                      <strong>{studentDetail.stats.totalWords}</strong>
                      <span>Total words</span>
                    </article>
                    <article>
                      <CheckCircleIcon size={20} />
                      <strong>{studentDetail.stats.wordsMastered}</strong>
                      <span>Mastered</span>
                    </article>
                  </div>
                </div>

                <div className="students-activity-card">
                  <div className="students-card-heading">
                    <h3>Activity</h3>
                    <span>Last 7 days</span>
                  </div>
                  <div className="students-week">
                    {studentDetail.activity.slice(-7).map((day) => {
                      const total = day.reviews + day.wordsAdded + day.practiceSessions + day.drills + day.voiceSessions;
                      const date = new Date(`${day.day}T12:00:00`);
                      return (
                        <div key={day.day}>
                          <span>{date.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                          <i className={total > 0 ? 'active' : ''}>{total > 0 ? <CheckCircleIcon size={18} /> : '—'}</i>
                          <strong>{day.reviews}</strong>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="students-bottom-grid">
                  <article className="students-attention-card">
                    <div className="students-card-heading">
                      <h3>Needs attention</h3>
                      <span>{studentDetail.stats.wordsDue > 0 ? 'Today' : 'On track'}</span>
                    </div>
                    <button onClick={openStudentDashboard}>
                      <CalendarIcon size={20} />
                      <span>
                        <strong>{studentDetail.stats.wordsDue} cards due today</strong>
                        <small>Open the student dictionary and review schedule.</small>
                      </span>
                      <ChevronRightIcon size={18} />
                    </button>
                    <button onClick={openStudentDashboard}>
                      <TargetIcon size={20} />
                      <span>
                        <strong>{studentDetail.stats.wordsInLearning} words still learning</strong>
                        <small>{studentDetail.stats.wordsNew} new cards have not graduated yet.</small>
                      </span>
                      <ChevronRightIcon size={18} />
                    </button>
                  </article>

                  <article className="students-recent-card">
                    <div className="students-card-heading">
                      <h3>Recent activity</h3>
                      <span>{studentDetail.recentSessions.length} sessions</span>
                    </div>
                    {studentDetail.recentSessions.slice(0, 4).map((session) => (
                      <div key={`${session.type}-${session.id}`} className="students-recent-row">
                        <CheckCircleIcon size={17} />
                        <span>
                          <strong>{session.type === 'flashcards' ? 'Reviewed' : session.type}</strong>
                          <small>{session.correctCount}/{session.questionCount} correct</small>
                        </span>
                        <time>{new Date(session.doneAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
                      </div>
                    ))}
                    {studentDetail.recentSessions.length === 0 && (
                      <p className="students-empty students-empty--compact">No completed sessions yet.</p>
                    )}
                  </article>
                </div>

                {isTeacher && (
                  <button
                    className="students-remove-link"
                    onClick={() => handleRemove(selectedRosterStudent.id)}
                  >
                    Remove {selectedRosterStudent.display_name || selectedRosterStudent.username} from this class
                  </button>
                )}
              </>
            )}
          </section>
        </main>
      )}
    </div>
  );
}
