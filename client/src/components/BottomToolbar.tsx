import { createScopedRuntimeLogger } from '../utils/scopedRuntimeLogger';
const runtimeLog = createScopedRuntimeLogger('web.components.bottomtoolbar');
// ---------------------------------------------------------------------------
// components/BottomToolbar.tsx -- Sidebar / bottom navigation bar
// ---------------------------------------------------------------------------

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getStudentDashboard } from '../api';
import { HomeIcon, BookIcon, BookOpenIcon, BoltIcon, TargetIcon, PeopleIcon, ClassworkIcon, PlayCircleIcon, FolderIcon, SettingsIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon, UserIcon, PlusIcon, CloseIcon } from './icons';
import { toErrorMessage } from '../utils/errors';
import { useClickOutside } from '../hooks/useClickOutside';

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
  const [inProgressOpen, setInProgressOpen] = useState(false);
  const [switchingAccountId, setSwitchingAccountId] = useState<string | null>(null);
  const [accountActionError, setAccountActionError] = useState('');
  const navigationMenuRef = useRef<HTMLDivElement>(null);

  const closeNavigationMenus = useCallback(() => {
    setAccountMenuOpen(false);
    setInProgressOpen(false);
  }, []);

  useClickOutside(navigationMenuRef, closeNavigationMenus);

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
        runtimeLog.error('Failed to fetch pending classwork count:', err);
        if (!cancelled) setPendingError(true);
      });
    return () => { cancelled = true; };
  }, [isStudent]);

  const isHome = location.pathname === '/home';
  const isDictionary = location.pathname === '/' || location.pathname === '/dictionary';
  const isFlashcards = location.pathname === '/learn' || location.pathname.startsWith('/learn/');
  const isPractice = location.pathname === '/practice' || location.pathname.startsWith('/practice/');
  const isSocial = location.pathname === '/chats';
  const isClasswork = !isTeacher && (location.pathname === '/classwork' || location.pathname.startsWith('/classwork/') || location.pathname === '/classes' || location.pathname === '/students' || location.pathname.startsWith('/students/'));
  const isBrowse = location.pathname === '/browse' || location.pathname.startsWith('/channel/') || location.pathname.startsWith('/lesson/');
  const isBooks = location.pathname === '/books' || location.pathname.startsWith('/books/');
  const isLocalVideos = location.pathname === '/local-videos' || location.pathname.startsWith('/local-watch/');
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
      // Return to the default flashcards after switching profiles.
      navigate('/');
    } catch (err) {
      setAccountActionError(toErrorMessage(err));
    } finally {
      setSwitchingAccountId(null);
    }
  }, [switchAccount, user?.id, navigate]);

  const navigateFromMenu = useCallback((path: string) => {
    closeNavigationMenus();
    navigate(path);
  }, [closeNavigationMenus, navigate]);

  return (
    <nav className={`bottom-toolbar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-brand">
        <span className="sidebar-logo">Polycast</span>
        <button className="sidebar-collapse-btn" onClick={toggleCollapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronRightIcon size={16} /> : <ChevronLeftIcon size={16} />}
        </button>
      </div>
      <button
        className={`toolbar-tab toolbar-tab--red${isDictionary ? ' active' : ''}`}
        onClick={() => navigate('/dictionary')}
      >
        <BookIcon size={22} />
        <span className="toolbar-label">Dictionary</span>
      </button>
      <button
        className={`toolbar-tab toolbar-tab--yellow${isFlashcards ? ' active' : ''}`}
        onClick={() => navigate('/learn')}
      >
        <BoltIcon size={22} />
        <span className="toolbar-label">Flashcards</span>
      </button>
      <button
        className={`toolbar-tab toolbar-tab--yellow${isPractice ? ' active' : ''}`}
        onClick={() => navigate('/practice')}
      >
        <TargetIcon size={22} />
        <span className="toolbar-label">Practice</span>
      </button>
      <button
        className={`toolbar-tab toolbar-tab--indigo${isBooks ? ' active' : ''}`}
        onClick={() => navigate('/books')}
      >
        <BookOpenIcon size={22} />
        <span className="toolbar-label">Books</span>
      </button>
      <div ref={navigationMenuRef} className={`sidebar-in-progress${inProgressOpen ? ' open' : ''}`}>
        <button
          className="toolbar-tab sidebar-in-progress-toggle"
          onClick={() => setInProgressOpen((open) => {
            if (open) setAccountMenuOpen(false);
            return !open;
          })}
          aria-expanded={inProgressOpen}
        >
          <span className="sidebar-in-progress-icon">
            <SettingsIcon size={22} />
          </span>
          <span className="toolbar-label">In progress</span>
          <span className="sidebar-in-progress-chevron">
            {inProgressOpen ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
          </span>
        </button>
        {inProgressOpen && (
          <div className="sidebar-in-progress-items">
            <button
              className={`toolbar-tab toolbar-tab--blue${isHome ? ' active' : ''}`}
              onClick={() => navigateFromMenu('/home')}
            >
              <HomeIcon size={22} />
              <span className="toolbar-label">Home</span>
            </button>
            <button
              className={`toolbar-tab toolbar-tab--purple${isSocial ? ' active' : ''}`}
              onClick={() => navigateFromMenu('/chats')}
            >
              <PeopleIcon size={22} />
              <span className="toolbar-label">Social</span>
            </button>
            {!isTeacher && (
              <button
                className={`toolbar-tab toolbar-tab--teal${isClasswork ? ' active' : ''}`}
                onClick={() => navigateFromMenu('/classes')}
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
              onClick={() => navigateFromMenu('/browse')}
            >
              <PlayCircleIcon size={22} />
              <span className="toolbar-label">Watch</span>
            </button>
            <button
              className={`toolbar-tab toolbar-tab--green${isLocalVideos ? ' active' : ''}`}
              onClick={() => navigateFromMenu('/local-videos')}
            >
              <FolderIcon size={22} />
              <span className="toolbar-label">Local</span>
            </button>
            <button
              className={`toolbar-tab toolbar-tab--profile${accountMenuOpen ? ' active' : ''}`}
              aria-expanded={accountMenuOpen}
              aria-haspopup="menu"
              onClick={() => {
                setAccountMenuOpen((prev) => !prev);
                setAccountActionError('');
              }}
            >
              <UserIcon size={22} />
              <span className="toolbar-label">Profiles</span>
              <span className="sidebar-profile-chevron"><ChevronRightIcon size={16} /></span>
            </button>
            <button
              className={`toolbar-tab toolbar-tab--settings${isSettings ? ' active' : ''}`}
              onClick={() => navigateFromMenu('/settings')}
            >
              <SettingsIcon size={22} />
              <span className="toolbar-label">Settings</span>
            </button>
          </div>
        )}
        {inProgressOpen && accountMenuOpen && (
          <div className="sidebar-account-popover" role="menu" aria-label="Profiles">
            <div className="sidebar-account-popover-header">
              <div>
                <div className="sidebar-account-title">Profiles</div>
                <div className="sidebar-account-subtitle">Switch accounts or add another login</div>
              </div>
              <button
                className="sidebar-account-close"
                onClick={() => setAccountMenuOpen(false)}
                aria-label="Close profile menu"
              >
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
                closeNavigationMenus();
                navigate('/login?addProfile=1', { state: { returnTo: location.pathname } });
              }}
            >
              <PlusIcon size={16} />
              Add another profile
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
