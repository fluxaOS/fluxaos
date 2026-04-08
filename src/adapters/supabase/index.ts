import { registry } from '@/config';
import { SupabaseAuthProvider } from './auth';

registry.register('auth', 'supabase', () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing Supabase config: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set'
    );
  }

  return new SupabaseAuthProvider({ supabaseUrl, supabaseAnonKey });
});
