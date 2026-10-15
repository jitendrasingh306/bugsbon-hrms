import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setCsrfToken } from './api.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api('/auth/me')
      .then((d) => alive && setUser(d.user))
      .catch(() => alive && setUser(null))
      .finally(() => alive && setLoading(false));
    const onExpired = () => setUser(null);
    window.addEventListener('auth:expired', onExpired);
    return () => {
      alive = false;
      window.removeEventListener('auth:expired', onExpired);
    };
  }, []);

  const login = useCallback(async (identifier, password) => {
    const d = await api('/auth/login', { method: 'POST', body: { identifier, password } });
    setCsrfToken(d.csrfToken);
    setUser(d.user);
    return d.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setCsrfToken(null);
    }
  }, []);

  const applySession = useCallback((d) => {
    setCsrfToken(d.csrfToken);
    setUser(d.user);
  }, []);

  const can = useCallback(
    (perm) => !!user && (user.permissions.includes('*') || user.permissions.includes(perm)),
    [user]
  );

  const value = useMemo(
    () => ({ user, loading, login, logout, applySession, can }),
    [user, loading, login, logout, applySession, can]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
