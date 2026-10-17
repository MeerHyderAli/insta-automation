import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createHttpApi, type Api } from '../lib/api';
import { createDemoApi } from '../lib/demo';
import { DEMO_MODE, supabase } from '../lib/supabase';
import type { ConfigResponse } from '../lib/types';

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  demoMode: boolean;
  config: ConfigResponse | null;
  api: Api;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const demoUser: AuthUser = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'demo@example.test',
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(DEMO_MODE ? demoUser : null);
  const [loading, setLoading] = useState(!DEMO_MODE);
  const [config, setConfig] = useState<ConfigResponse | null>(null);

  const api = useMemo<Api>(() => {
    if (DEMO_MODE) return createDemoApi();
    return createHttpApi(async () => {
      if (!supabase) return null;
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    });
  }, []);

  useEffect(() => {
    api
      .getConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, [api]);

  useEffect(() => {
    if (DEMO_MODE) return;
    if (!supabase) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        const sessionUser = data.session?.user;
        setUser(sessionUser ? { id: sessionUser.id, email: sessionUser.email ?? null } : null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user;
      setUser(sessionUser ? { id: sessionUser.id, email: sessionUser.email ?? null } : null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      demoMode: DEMO_MODE,
      config,
      api,
      async signIn(email, password) {
        if (DEMO_MODE) {
          setUser(demoUser);
          return;
        }
        if (!supabase) {
          throw new Error(
            'Authentication is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
          );
        }
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);
      },
      async signUp(email, password) {
        if (DEMO_MODE) {
          setUser(demoUser);
          return { needsConfirmation: false };
        }
        if (!supabase) {
          throw new Error(
            'Authentication is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
          );
        }
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw new Error(error.message);
        return { needsConfirmation: Boolean(data.user && !data.session) };
      },
      async signOut() {
        if (DEMO_MODE) {
          setUser(demoUser);
          return;
        }
        if (supabase) await supabase.auth.signOut();
        setUser(null);
      },
    }),
    [user, loading, config, api],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
