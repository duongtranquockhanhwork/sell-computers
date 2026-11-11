import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { resetSocket } from './socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState({ googleEnabled: false });

  const refresh = useCallback(async () => {
    try {
      const { user: u } = await api.get('/auth/me');
      setUser(u);
      return u;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    api.get('/config').then(setConfig).catch(() => {});
  }, [refresh]);

  const login = async (email, password) => {
    const { user: u } = await api.post('/auth/login', { email, password });
    setUser(u);
    resetSocket();
    return u;
  };

  const logout = async () => {
    await api.post('/auth/logout');
    setUser(null);
    resetSocket();
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, logout, refresh, config }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
