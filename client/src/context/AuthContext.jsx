import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (email, password) => {
    await api('/auth/login', { method: 'POST', body: { email, password } });
    const { user: me } = await api('/auth/me'); // includes the host pages for host accounts
    setUser(me);
    return me;
  }, []);

  const register = useCallback(async (form) => {
    const { user: me } = await api('/auth/register', { method: 'POST', body: form });
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, login, register, logout }), [user, ready, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/** Where each kind of account lands after logging in. */
export const homeFor = (user) =>
  user?.role === 'host' ? '/' : '/';
