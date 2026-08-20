import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, tokens } from './api';

export interface Me {
  id: string;
  email: string;
  name: string;
  status: string;
  roles: { id: string; name: string }[];
  permissions: string[];
  tenant: { id: string; name: string; slug: string } | null;
  settings: Record<string, unknown>;
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (input: {
    tenantName: string;
    name: string;
    email: string;
    password: string;
  }) => Promise<void>;
  logout: () => void;
  can: (permission: string) => boolean;
  /** Persist one UI-preference key to /me/settings (Part A dismissal etc.). */
  setSetting: (key: string, value: unknown) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    if (!tokens.access) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api<Me>('/me'));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMe();
    const onLogout = (): void => setMe(null);
    window.addEventListener('approvex:logout', onLogout);
    return () => window.removeEventListener('approvex:logout', onLogout);
  }, [loadMe]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api<{ accessToken: string; refreshToken: string }>('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      tokens.set(res);
      await loadMe();
    },
    [loadMe],
  );

  const signup = useCallback(
    async (input: { tenantName: string; name: string; email: string; password: string }) => {
      const res = await api<{ accessToken: string; refreshToken: string }>('/auth/signup', {
        method: 'POST',
        body: input,
      });
      tokens.set(res);
      await loadMe();
    },
    [loadMe],
  );

  const logout = useCallback(() => {
    tokens.clear();
    setMe(null);
  }, []);

  const can = useCallback(
    (permission: string) => me?.permissions.includes(permission) ?? false,
    [me],
  );

  const setSetting = useCallback(async (key: string, value: unknown) => {
    // Optimistic: reflect locally, then persist the shallow-merged patch.
    setMe((prev) => (prev ? { ...prev, settings: { ...prev.settings, [key]: value } } : prev));
    const merged = await api<Record<string, unknown>>('/me/settings', {
      method: 'PATCH',
      body: { [key]: value },
    });
    setMe((prev) => (prev ? { ...prev, settings: merged } : prev));
  }, []);

  return (
    <AuthContext.Provider value={{ me, loading, login, signup, logout, can, setSetting }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
