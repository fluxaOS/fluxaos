/**
 * Client bootstrap — registers only adapters safe for the browser bundle.
 *
 * Called once from TRPCProvider. Server-only adapters (database, queue,
 * executor, stdoutParser) are registered by the full bootstrap() on the
 * server side.
 *
 * The registry is a module-local singleton; Next.js's separate client
 * and server bundles each get their own instance, so registering 'auth'
 * and 'realtime' here does not collide with bootstrap()'s registrations.
 */
import { registry } from './registry';
import { SupabaseAuthProvider } from '@/adapters/supabase/auth';
import { SupabaseRealtimeProvider } from '@/adapters/supabase/realtime';

let bootstrapped = false;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        'Check your .env file or environment configuration.',
    );
  }
  return value;
}

/**
 * Initialize browser-safe adapters. Safe to call multiple times — only runs once.
 */
export function bootstrapClient(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  registry.register('auth', () => {
    const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
    const supabaseKey = requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    return new SupabaseAuthProvider({ supabaseUrl, supabaseKey });
  });

  registry.register('realtime', () => {
    const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
    const supabaseKey = requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    return new SupabaseRealtimeProvider({ supabaseUrl, supabaseKey });
  });
}
