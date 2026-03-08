// ---------------------------------------------------------------------------
// components/BottomToolbar.tsx -- Sidebar / bottom navigation bar
// ---------------------------------------------------------------------------

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getStudentDashboard } from '../api';
import { HomeIcon, BookIcon, BoltIcon, PeopleIcon, ClassworkIcon, PlayCircleIcon, SettingsIcon, ChevronLeftIcon, ChevronRightIcon } from './icons';

const COLLAPSED_KEY = 'sidebar-collapsed';
const NARROW_QUERY = '(min-width: 481px) and (max-width: 1024px)';

export default function BottomToolbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const isTeacher = user?.account_type === 'teacher';
  const isStudent = user?.account_type === 'student';
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingError, setPendingError] = useState(false);

  const manualPref = useRef(localStorage.getItem(COLLAPSED_KEY));
  const [collapsed, setCollapsed] = useState(() => {
    if (manualPref.current !== null) return manualPref.current === 'true';
    return window.matchMedia(NARROW_QUERY).matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('sidebar-collapsed', collapsed);
    return () => document.documentElement.classList.remove('sidebar-collapsed');
  }, [collapsed]);

  // Auto-collapse/expand based on viewport width when no manual preference is set
  useEffect(() => {
    const mql = window.matchMedia(NARROW_QUERY);
    const handler = (e: MediaQueryListEvent) => {
      if (manualPref.current !== null) return;
      setCollapsed(e.matches);
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      manualPref.current = String(next);
      localStorage.setItem(COLLAPSED_KEY, String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isStudent) return;
    let cancelled = false;
    getStudentDashboard()
      .then((data) => {
        if (!cancelled) {
          setPendingCount(data.pendingClasswork.count);
          setPendingError(false);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch pending classwork count:', err);
        if (!cancelled) setPendingError(true);
      });
    return () => { cancelled = true; };
  }, [isStudent]);

  const isHome = location.pathname === '/';
  const isDictionary = location.pathname === '/dictionary';
  const isPractice = location.pathname === '/practice' || location.pathname.startsWith('/practice/') || location.pathname === '/learn';
  const isSocial = location.pathname === '/chats';
  const isClasswork = location.pathname === '/classwork' || location.pathname.startsWith('/classwork/') || location.pathname === '/classes' || location.pathname === '/students' || location.pathname.startsWith('/students/');
  const isBrowse = location.pathname === '/browse' || location.pathname.startsWith('/channel/') || location.pathname.startsWith('/lesson/');
  const isSettings = location.pathname === '/settings';

  return (
    <nav className={`bottom-toolbar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-brand">
        <span className="sidebar-logo">Polycast</span>
        <button className="sidebar-collapse-btn" onClick={toggleCollapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronRightIcon size={16} /> : <ChevronLeftIcon size={16} />}
        </button>
      </div>
      <button
        className={`toolbar-tab toolbar-tab--blue${isHome ? ' active' : ''}`}
        onClick={() => navigate('/')}
      >
        <HomeIcon size={22} />
        <span className="toolbar-label">Home</span>
      </button>
      <button
        className={`toolbar-tab toolbar-tab--yellow${isPractice ? ' active' : ''}`}
        onClick={() => navigate('/practice')}
      >
        <BoltIcon size={22} />
        <span className="toolbar-label">Practice</span>
      </button>
      <button
        className={`toolbar-tab toolbar-tab--red${isDictionary ? ' active' : ''}`}
        onClick={() => navigate('/dictionary')}
      >
        <BookIcon size={22} />
        <span className="toolbar-label">Dictionary</span>
      </button>
      <button
        className={`toolbar-tab toolbar-tab--purple${isSocial ? ' active' : ''}`}
        onClick={() => navigate('/chats')}
      >
        <PeopleIcon size={22} />
        <span className="toolbar-label">Social</span>
      </button>
      {!isTeacher && (
        <button
          className={`toolbar-tab toolbar-tab--teal${isClasswork ? ' active' : ''}`}
          onClick={() => navigate('/classes')}
        >
          <span className="toolbar-tab-icon-wrap">
            <ClassworkIcon size={22} />
            {(pendingCount > 0 || pendingError) && <span className="toolbar-badge">{pendingError ? '!' : pendingCount}</span>}
          </span>
          <span className="toolbar-label">Classwork</span>
        </button>
      )}
      {isTeacher && (
        <button
          className={`toolbar-tab toolbar-tab--teal${isClasswork ? ' active' : ''}`}
          onClick={() => navigate('/classes')}
        >
          <ClassworkIcon size={22} />
          <span className="toolbar-label">Classwork</span>
        </button>
      )}
      <button
        className={`toolbar-tab toolbar-tab--orange${isBrowse ? ' active' : ''}`}
        onClick={() => navigate('/browse')}
      >
        <PlayCircleIcon size={22} />
        <span className="toolbar-label">Watch</span>
      </button>
      <button
        className={`toolbar-tab toolbar-tab--settings${isSettings ? ' active' : ''}`}
        onClick={() => navigate('/settings')}
      >
        <SettingsIcon size={22} />
        <span className="toolbar-label">Settings</span>
      </button>
    </nav>
  );
}
