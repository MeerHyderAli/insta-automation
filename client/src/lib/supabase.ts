import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** The anon key is public by design; the service role key is never used here. */
export const supabase =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'pkce',
        },
      })
    : null;

export const isSupabaseConfigured = Boolean(supabase);

/**
 * Demo mode is explicit, or automatic in local development when Supabase is
 * not configured. It is never automatic in a production build.
 */
export const DEMO_MODE =
  (import.meta.env.VITE_DEMO_MODE as string | undefined) === 'true' ||
  (import.meta.env.DEV && !isSupabaseConfigured);
