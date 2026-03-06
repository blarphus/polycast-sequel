// ---------------------------------------------------------------------------
// pages/Students.tsx -- Teacher's classroom roster + student search
// ---------------------------------------------------------------------------

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useActiveClassroom } from '../hooks/useActiveClassroom';
import * as api from '../api';
import type { Classroom, ClassroomStudent, UserResult } from '../api';
import ClassroomPicker from '../components/classroom/ClassroomPicker';
import ClassroomSetupBanner from '../components/classroom/ClassroomSetupBanner';

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
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

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
      })
      .catch((err) => {
        console.error('Failed to load classroom students:', err);
        setError('Failed to load students');
      })
      .finally(() => setLoading(false));
  }, [activeClassroomId]);

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
        console.error('Student search failed:', err);
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
    } catch (err) {
      console.error('Failed to add student:', err);
    }
  };

  const handleRemove = async (studentId: string) => {
    if (!activeClassroomId) return;
    try {
      await api.removeClassroomStudent(activeClassroomId, studentId);
      setRoster((prev) => prev.filter((s) => s.id !== studentId));
      setAddedIds((prev) => {
        const next = new Set(prev);
        next.delete(studentId);
        return next;
      });
    } catch (err) {
      console.error('Failed to remove student:', err);
    }
  };

  const handleClassroomUpdated = async (updatedClassroom: Classroom) => {
    await reloadClassrooms();
    setActiveClassroomId(updatedClassroom.id);
  };

  return (
    <div className="students-page">
      <div className="students-header">
        <div className="students-header-main">
          <div>
            <h1 className="students-title">Students</h1>
            <Link className="classwork-manage-link" to="/classes">Manage classes</Link>
          </div>
          <ClassroomPicker
            classrooms={classrooms}
            value={activeClassroomId}
            onChange={setActiveClassroomId}
            label="Class"
          />
        </div>
      </div>

      {classroomsError && <div className="auth-error">{classroomsError}</div>}
      {activeClassroom?.needs_setup && isTeacher && (
        <ClassroomSetupBanner classroom={activeClassroom} onUpdated={handleClassroomUpdated} />
      )}

      {/* Search */}
      {isTeacher && (
        <div className="students-search">
          <input
            className="form-input"
            type="text"
            placeholder="Search for students..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
      )}

      {isTeacher && searchQuery.trim() && searchResults.length > 0 && (
        <div className="students-search-results">
          {searchResults.map((u) => (
            <div key={u.id} className="students-roster-item">
              <div className="students-avatar">
                {(u.display_name || u.username).charAt(0).toUpperCase()}
              </div>
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

      {isTeacher && searchQuery.trim() && searchResults.length === 0 && (
        <p className="students-empty">No students found</p>
      )}

      {/* Roster */}
      <div className="students-section-header">
        <h2 className="students-section-title">{activeClassroom?.name || 'Your Classroom'}</h2>
        <span className="students-count">{roster.length}</span>
      </div>

      {error && <div className="auth-error">{error}</div>}

      {classroomsLoading || loading ? (
        <div className="loading-screen"><div className="loading-spinner" /></div>
      ) : !activeClassroom ? (
        <p className="students-empty">No classroom selected yet.</p>
      ) : roster.length === 0 ? (
        <p className="students-empty">
          {isTeacher
            ? 'No students in this class yet. Search above to add students.'
            : 'No classmates are visible for this class yet.'}
        </p>
      ) : (
        <div className="students-roster">
          {roster.map((s) => (
            <div
              key={s.id}
              className="students-roster-item students-roster-item--clickable"
              onClick={() => navigate(`/students/${s.id}?classroomId=${activeClassroom.id}`)}
            >
              <div className="students-avatar">
                {(s.display_name || s.username).charAt(0).toUpperCase()}
                {s.online && <span className="students-online-dot" />}
              </div>
              <div className="students-info">
                <span className="students-name">{s.display_name || s.username}</span>
                <span className="students-username">@{s.username}</span>
              </div>
              {isTeacher && (
                <button
                  className="btn btn-small btn-danger"
                  onClick={(e) => { e.stopPropagation(); handleRemove(s.id); }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
