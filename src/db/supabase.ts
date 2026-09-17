import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config, DEMO } from '../config';

export const supabase: SupabaseClient | null = DEMO
  ? null
  : createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    });

export function sb(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}
