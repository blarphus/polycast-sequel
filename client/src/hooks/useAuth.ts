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
import type { AuthUser } from '../api';
import { loadSavedAccounts, removeSavedAccount, upsertSavedAccount, type SavedAccount } from '../utils/savedAccounts';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  authError: string;
  savedAccounts: SavedAccount[];
  login: (username: string, password: string) => Promise<void>;
  signup: (username: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  addSavedAccount: (username: string, password: string) => Promise<void>;
  switchAccount: (userId: string) => Promise<void>;
  forgetSavedAccount: (userId: string) => void;
  updateSettings: (native_language: string | null, target_language: string | null, daily_new_limit?: number, account_type?: 'student' | 'teacher', cefr_level?: string | null) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>(() => loadSavedAccounts());
  const [currentSessionToken, setCurrentSessionToken] = useState<string | null>(null);

  // Check session on mount
  useEffect(() => {
    let cancelled = false;
    api
      .getMe()
      .then((u) => {
        if (!cancelled) {
          setUser(u);
          setAuthError('');
          const accounts = loadSavedAccounts();
          const matchingAccount = accounts.find((account) => account.id === u.id) || null;
          setSavedAccounts(accounts);
          setCurrentSessionToken(matchingAccount?.token || null);
          api.exportSessionToken()
            .then(({ token }) => {
              if (cancelled) return;
              setCurrentSessionToken(token);
              setSavedAccounts(upsertSavedAccount(u, token));
            })
            .catch((err) => {
              console.error('Auth session export failed:', err);
            });
        }
      })
      .catch((err) => {
        console.error('Auth session check failed:', err);
        if (!cancelled) {
          setUser(null);
          setAuthError(err instanceof Error ? err.message : String(err));
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
    setUser(u);
    setAuthError('');
    setCurrentSessionToken(u.token);
    setSavedAccounts(upsertSavedAccount(u, u.token));
  }, []);

  const signup = useCallback(async (username: string, password: string, displayName: string) => {
    const u = await api.signup(username, password, displayName);
    setUser(u);
    setAuthError('');
    setCurrentSessionToken(u.token);
    setSavedAccounts(upsertSavedAccount(u, u.token));
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    setAuthError('');
    setCurrentSessionToken(null);
  }, []);

  const addSavedAccount = useCallback(async (username: string, password: string) => {
    let activeToken = currentSessionToken;
    if (!activeToken && user) {
      const exported = await api.exportSessionToken();
      activeToken = exported.token;
      setCurrentSessionToken(exported.token);
      setSavedAccounts(upsertSavedAccount(user, exported.token));
    }

    const addedUser = await api.login(username, password);
    setSavedAccounts(upsertSavedAccount(addedUser, addedUser.token));

    if (activeToken && (!user || user.id !== addedUser.id)) {
      const restoredUser = await api.restoreSession(activeToken);
      setUser(restoredUser);
      setAuthError('');
      setCurrentSessionToken(restoredUser.token);
      setSavedAccounts(upsertSavedAccount(restoredUser, restoredUser.token));
      return;
    }

    setUser(addedUser);
    setAuthError('');
    setCurrentSessionToken(addedUser.token);
  }, [currentSessionToken, user]);

  const switchAccount = useCallback(async (userId: string) => {
    const account = savedAccounts.find((entry) => entry.id === userId);
    if (!account) {
      throw new Error('Saved account not found');
    }

    try {
      const nextUser = await api.restoreSession(account.token);
      setUser(nextUser);
      setAuthError('');
      setCurrentSessionToken(nextUser.token);
      setSavedAccounts(upsertSavedAccount(nextUser, nextUser.token));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes('invalid') || message.toLowerCase().includes('expired')) {
        setSavedAccounts(removeSavedAccount(userId));
      }
      throw err;
    }
  }, [savedAccounts]);

  const forgetSavedAccount = useCallback((userId: string) => {
    const nextAccounts = removeSavedAccount(userId);
    setSavedAccounts(nextAccounts);
    if (user?.id === userId) {
      setCurrentSessionToken(null);
    }
  }, [user?.id]);

  const updateSettings = useCallback(async (native_language: string | null, target_language: string | null, daily_new_limit?: number, account_type?: 'student' | 'teacher', cefr_level?: string | null) => {
    const u = await api.updateSettings(native_language, target_language, daily_new_limit, account_type, cefr_level);
    setUser(u);
    setAuthError('');
    if (currentSessionToken) {
      setSavedAccounts(upsertSavedAccount(u, currentSessionToken));
    }
  }, [currentSessionToken]);

  return createElement(
    AuthContext.Provider,
    { value: { user, loading, authError, savedAccounts, login, signup, logout, addSavedAccount, switchAccount, forgetSavedAccount, updateSettings } },
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
