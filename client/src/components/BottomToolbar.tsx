// ---------------------------------------------------------------------------
// components/BottomToolbar.tsx -- Bottom navigation bar (Home | Dictionary | Learn | Chats)
// ---------------------------------------------------------------------------

import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function BottomToolbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const isTeacher = user?.account_type === 'teacher';
  const isHome = location.pathname === '/';
  const isDictionary = location.pathname === '/dictionary';
  const isLearn = location.pathname === '/learn';
  const isChats = location.pathname === '/chats';
  const isStudents = location.pathname === '/students' || location.pathname.startsWith('/students/');

  return (
    <nav className="bottom-toolbar">
      <div className="sidebar-brand">
        <span className="sidebar-logo">Polycast</span>
      </div>
      <button
        className={`toolbar-tab toolbar-tab--blue${isHome ? ' active' : ''}`}
        onClick={() => navigate('/')}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
        <span className="toolbar-label">Home</span>
      </button>
      <button
        className={`toolbar-tab toolbar-tab--red${isDictionary ? ' active' : ''}`}
        onClick={() => navigate('/dictionary')}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        <span className="toolbar-label">Dictionary</span>
      </button>
      <button
        className={`toolbar-tab toolbar-tab--green${isLearn ? ' active' : ''}`}
        onClick={() => navigate('/learn')}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
        <span className="toolbar-label">Learn</span>
      </button>
      <button
        className={`toolbar-tab toolbar-tab--purple${isChats ? ' active' : ''}`}
        onClick={() => navigate('/chats')}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span className="toolbar-label">Chats</span>
      </button>
      {isTeacher && (
        <button
          className={`toolbar-tab toolbar-tab--orange${isStudents ? ' active' : ''}`}
          onClick={() => navigate('/students')}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <span className="toolbar-label">Students</span>
        </button>
      )}
    </nav>
  );
}
