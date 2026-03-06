// ---------------------------------------------------------------------------
// components/BottomToolbar.tsx -- Sidebar / bottom navigation bar
// ---------------------------------------------------------------------------

import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getPendingClasswork } from '../api';
import { HomeIcon, BookIcon, TargetIcon, PeopleIcon, ClassworkIcon, PlayCircleIcon, SettingsIcon } from './icons';

export default function BottomToolbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const isTeacher = user?.account_type === 'teacher';
  const isStudent = user?.account_type === 'student';
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!isStudent) return;
    let cancelled = false;
    getPendingClasswork()
      .then((data) => { if (!cancelled) setPendingCount(data.count); })
      .catch((err) => console.error('Failed to fetch pending classwork count:', err));
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
    <nav className="bottom-toolbar">
      <div className="sidebar-brand">
        <span className="sidebar-logo">Polycast</span>
      </div>
      <button
        className={`toolbar-tab toolbar-tab--blue${isHome ? ' active' : ''}`}
        onClick={() => navigate('/')}
      >
        <HomeIcon size={22} />
        <span className="toolbar-label">Home</span>
      </button>
      <button
        className={`toolbar-tab toolbar-tab--red${isDictionary ? ' active' : ''}`}
        onClick={() => navigate('/dictionary')}
      >
        <BookIcon size={22} />
        <span className="toolbar-label">Dictionary</span>
      </button>
      <button
        className={`toolbar-tab toolbar-tab--yellow${isPractice ? ' active' : ''}`}
        onClick={() => navigate('/practice')}
      >
        <TargetIcon size={22} />
        <span className="toolbar-label">Practice</span>
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
            {pendingCount > 0 && <span className="toolbar-badge">{pendingCount}</span>}
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
