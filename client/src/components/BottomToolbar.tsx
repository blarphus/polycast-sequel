// ---------------------------------------------------------------------------
// components/BottomToolbar.tsx -- Sidebar / bottom navigation bar
// ---------------------------------------------------------------------------

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getStudentDashboard } from '../api';
import { HomeIcon, BookIcon, BoltIcon, PeopleIcon, ClassworkIcon, PlayCircleIcon, SettingsIcon, ChevronLeftIcon, ChevronRightIcon, UserIcon, PlusIcon, CloseIcon } from './icons';
import { toErrorMessage } from '../utils/errors';

const COLLAPSED_KEY = 'sidebar-collapsed';
const NARROW_QUERY = '(min-width: 481px) and (max-width: 1024px)';

export default function BottomToolbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, savedAccounts, switchAccount, forgetSavedAccount } = useAuth();

  const isTeacher = user?.account_type === 'teacher';
  const isStudent = user?.account_type === 'student';
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingError, setPendingError] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [switchingAccountId, setSwitchingAccountId] = useState<string | null>(null);
  const [accountActionError, setAccountActionError] = useState('');

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

  const isHome = isTeacher
    ? location.pathname === '/classes' || location.pathname === '/students' || location.pathname.startsWith('/students/') || location.pathname === '/classwork' || location.pathname.startsWith('/classwork/')
    : location.pathname === '/';
  const isDictionary = location.pathname === '/dictionary';
  const isPractice = location.pathname === '/practice' || location.pathname.startsWith('/practice/') || location.pathname === '/learn';
  const isSocial = location.pathname === '/chats';
  const isClasswork = !isTeacher && (location.pathname === '/classwork' || location.pathname.startsWith('/classwork/') || location.pathname === '/classes' || location.pathname === '/students' || location.pathname.startsWith('/students/'));
  const isBrowse = location.pathname === '/browse' || location.pathname.startsWith('/channel/') || location.pathname.startsWith('/lesson/');
  const isSettings = location.pathname === '/settings';

  const handleSwitchAccount = useCallback(async (accountId: string) => {
    if (accountId === user?.id) {
      setAccountMenuOpen(false);
      return;
    }
    setSwitchingAccountId(accountId);
    setAccountActionError('');
    try {
      await switchAccount(accountId);
      setAccountMenuOpen(false);
      // Navigate home — Home.tsx redirects teachers to /classes automatically
      navigate('/');
    } catch (err) {
      setAccountActionError(toErrorMessage(err));
    } finally {
      setSwitchingAccountId(null);
    }
  }, [switchAccount, user?.id, navigate]);

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
        onClick={() => navigate(isTeacher ? '/classes' : '/')}
      >
        <HomeIcon size={22} />
        <span className="toolbar-label">Home</span>
      </button>
      {!isTeacher && (
        <button
          className={`toolbar-tab toolbar-tab--yellow${isPractice ? ' active' : ''}`}
          onClick={() => navigate('/practice')}
        >
          <BoltIcon size={22} />
          <span className="toolbar-label">Practice</span>
        </button>
      )}
      {!isTeacher && (
        <button
          className={`toolbar-tab toolbar-tab--red${isDictionary ? ' active' : ''}`}
          onClick={() => navigate('/dictionary')}
        >
          <BookIcon size={22} />
          <span className="toolbar-label">Dictionary</span>
        </button>
      )}
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
      <button
        className={`toolbar-tab toolbar-tab--orange${isBrowse ? ' active' : ''}`}
        onClick={() => navigate('/browse')}
      >
        <PlayCircleIcon size={22} />
        <span className="toolbar-label">Watch</span>
      </button>
      <button
        className={`toolbar-tab toolbar-tab--profile${accountMenuOpen ? ' active' : ''}`}
        onClick={() => {
          setAccountMenuOpen((prev) => !prev);
          setAccountActionError('');
        }}
      >
        <UserIcon size={22} />
        <span className="toolbar-label">Profiles</span>
      </button>
      {accountMenuOpen && (
        <div className="sidebar-account-popover">
          <div className="sidebar-account-popover-header">
            <div>
              <div className="sidebar-account-title">Profiles</div>
              <div className="sidebar-account-subtitle">Switch accounts or add another login</div>
            </div>
            <button className="sidebar-account-close" onClick={() => setAccountMenuOpen(false)}>
              <CloseIcon size={16} />
            </button>
          </div>
          <div className="sidebar-account-list">
            {savedAccounts.map((account) => (
              <div key={account.id} className={`sidebar-account-item${account.id === user?.id ? ' active' : ''}`}>
                <button
                  className="sidebar-account-main"
                  onClick={() => void handleSwitchAccount(account.id)}
                  disabled={switchingAccountId !== null}
                >
                  <span className="sidebar-account-name">{account.display_name || account.username}</span>
                  <span className="sidebar-account-meta">@{account.username} · {account.account_type}{account.id === user?.id ? ' · current' : ''}</span>
                </button>
                <button
                  className="sidebar-account-remove"
                  onClick={() => forgetSavedAccount(account.id)}
                  disabled={account.id === user?.id || switchingAccountId !== null}
                  title={account.id === user?.id ? 'Current profile' : 'Remove saved profile'}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          {accountActionError && <div className="sidebar-account-error">{accountActionError}</div>}
          <button
            className="sidebar-account-add"
            onClick={() => {
              setAccountMenuOpen(false);
              navigate('/login?addProfile=1', { state: { returnTo: location.pathname } });
            }}
          >
            <PlusIcon size={16} />
            Add another profile
          </button>
        </div>
      )}
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
