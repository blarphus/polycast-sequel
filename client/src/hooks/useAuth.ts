import { createScopedRuntimeLogger } from '../utils/scopedRuntimeLogger';
const runtimeLog = createScopedRuntimeLogger('web.hooks.useauth');
// ---------------------------------------------------------------------------
// hooks/useAuth.ts -- AuthContext, AuthProvider, useAuth
// ---------------------------------------------------------------------------

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
  createElement,
} from 'react';
import * as api from '../api';
import { SESSION_EXPIRED_EVENT, setApiSessionActive, type SessionExpiredDetail } from '../api/core';
import type { AuthUser } from '../api';
import type { SavedAccount } from '../utils/savedAccounts';
import { toErrorMessage } from '../utils/errors';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  authError: string;
  savedAccounts: SavedAccount[];
  login: (username: string, password: string) => Promise<void>;
  signup: (username: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  switchAccount: (userId: string) => Promise<void>;
  forgetSavedAccount: (userId: string) => void;
  updateSettings: (native_language: string | null, target_language: string | null, daily_new_limit?: number, account_type?: 'student' | 'teacher', cefr_level?: string | null, daily_word_goal?: number) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);

  useEffect(() => {
    const handleSessionExpired = (event: Event) => {
      const detail = (event as CustomEvent<SessionExpiredDetail>).detail;
      setApiSessionActive(false);
      setUser(null);
      setSavedAccounts([]);
      setAuthError(detail?.diagnostic?.message || 'Your session expired. Please log in again.');
      setLoading(false);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, []);

  const refreshProfiles = useCallback(async () => {
    const { accounts } = await api.getProfileAccounts();
    setSavedAccounts(accounts);
  }, []);

  // Check session on mount
  useEffect(() => {
    let cancelled = false;
    api
      .getMe()
      .then((u) => {
        if (!cancelled) {
          setApiSessionActive(true);
          setUser(u);
          setAuthError('');
          api.getProfileAccounts()
            .then(({ accounts }) => {
              if (!cancelled) setSavedAccounts(accounts);
            })
            .catch((err) => {
              runtimeLog.error('Profile session list failed:', err);
            });
        }
      })
      .catch((err) => {
        runtimeLog.error('Auth session check failed:', err);
        if (!cancelled) {
          setApiSessionActive(false);
          setUser(null);
          setAuthError(toErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const u = await api.login(username, password);
    setApiSessionActive(true);
    setUser(u);
    setAuthError('');
    await refreshProfiles();
  }, [refreshProfiles]);

  const signup = useCallback(async (username: string, password: string, displayName: string) => {
    const u = await api.signup(username, password, displayName);
    setApiSessionActive(true);
    setUser(u);
    setAuthError('');
    await refreshProfiles();
  }, [refreshProfiles]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setApiSessionActive(false);
      setUser(null);
      setSavedAccounts([]);
      setAuthError('');
    }
  }, []);

  const switchAccount = useCallback(async (userId: string) => {
    if (!savedAccounts.some((entry) => entry.id === userId)) {
      throw new Error('Saved account not found');
    }

    const nextUser = await api.switchProfile(userId);
    setUser(nextUser);
    setAuthError('');
    await refreshProfiles();
  }, [savedAccounts, refreshProfiles]);

  const forgetSavedAccount = useCallback((userId: string) => {
    void api.forgetProfile(userId)
      .then(refreshProfiles)
      .catch((err) => setAuthError(toErrorMessage(err)));
  }, [refreshProfiles]);

  const updateSettings = useCallback(async (native_language: string | null, target_language: string | null, daily_new_limit?: number, account_type?: 'student' | 'teacher', cefr_level?: string | null, daily_word_goal?: number) => {
    const u = await api.updateSettings(native_language, target_language, daily_new_limit, account_type, cefr_level, daily_word_goal);
    setUser(u);
    setAuthError('');
    await refreshProfiles();
  }, [refreshProfiles]);

  return createElement(
    AuthContext.Provider,
    { value: { user, loading, authError, savedAccounts, login, signup, logout, switchAccount, forgetSavedAccount, updateSettings } },
    children,
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export type { AuthUser };
export { AuthContext };
