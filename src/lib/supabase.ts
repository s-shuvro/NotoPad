import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase credentials missing. Check your environment variables.');
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');
