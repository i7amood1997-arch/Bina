const env = import.meta.env;

export const config = {
  supabaseUrl: (env.VITE_SUPABASE_URL as string | undefined) ?? '',
  supabaseAnonKey: (env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '',
  googleClientId: (env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '',
  googleApiKey: (env.VITE_GOOGLE_API_KEY as string | undefined) ?? '',
  googleAppId: (env.VITE_GOOGLE_APP_ID as string | undefined) ?? '',
  aiModel: 'claude-sonnet-5',
};

/** Demo mode: no Supabase configured → everything stays on this device. */
export const DEMO = !config.supabaseUrl || !config.supabaseAnonKey;
export const DRIVE_ENABLED = !!config.googleClientId;

export const local = {
  get(key: string): string | null { try { return localStorage.getItem(`hb.${key}`); } catch { return null; } },
  set(key: string, v: string | null) {
    try { v === null ? localStorage.removeItem(`hb.${key}`) : localStorage.setItem(`hb.${key}`, v); } catch { /* ignore */ }
  },
};
