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

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  authError: string;
  login: (username: string, password: string) => Promise<void>;
  signup: (username: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  updateSettings: (native_language: string | null, target_language: string | null, daily_new_limit?: number, account_type?: 'student' | 'teacher', cefr_level?: string | null) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  // Check session on mount
  useEffect(() => {
    let cancelled = false;
    api
      .getMe()
      .then((u) => {
        if (!cancelled) {
          setUser(u);
          setAuthError('');
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
  }, []);

  const signup = useCallback(async (username: string, password: string, displayName: string) => {
    const u = await api.signup(username, password, displayName);
    setUser(u);
    setAuthError('');
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    setAuthError('');
  }, []);

  const updateSettings = useCallback(async (native_language: string | null, target_language: string | null, daily_new_limit?: number, account_type?: 'student' | 'teacher', cefr_level?: string | null) => {
    const u = await api.updateSettings(native_language, target_language, daily_new_limit, account_type, cefr_level);
    setUser(u);
    setAuthError('');
  }, []);

  return createElement(
    AuthContext.Provider,
    { value: { user, loading, authError, login, signup, logout, updateSettings } },
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
