/**
 * Client bootstrap — registers only adapters safe for the browser bundle.
 *
 * Called once from TRPCProvider. Server-only adapters (database, queue,
 * executor) are registered by the full bootstrap() on the server side.
 * Adapters registered here are all pure-JS / browser-safe: auth, realtime,
 * stdoutParser.
 *
 * The registry is a module-local singleton; Next.js's separate client
 * and server bundles each get their own instance, so registrations here
 * do not collide with bootstrap()'s registrations.
 */
import { registry } from './registry';
import { SupabaseAuthProvider } from '@/adapters/supabase/auth';
import { SupabaseRealtimeProvider } from '@/adapters/supabase/realtime';
import { SubprocessStdoutParser } from '@/adapters/subprocess/stdout-parser';

let bootstrapped = false;

// Next.js only inlines `process.env.NEXT_PUBLIC_*` into the client bundle when
// referenced as literal member expressions. Reading via `process.env[name]`
// leaves the lookup dynamic, yielding `undefined` at runtime in the browser.
function readPublicSupabaseEnv(): { supabaseUrl: string; supabaseKey: string } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Missing Supabase config: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set.',
    );
  }
  return { supabaseUrl, supabaseKey };
}

/**
 * Initialize browser-safe adapters. Safe to call multiple times — only runs once.
 */
export function bootstrapClient(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  registry.register('auth', () => {
    const { supabaseUrl, supabaseKey } = readPublicSupabaseEnv();
    return new SupabaseAuthProvider({ supabaseUrl, supabaseKey });
  });

  registry.register('realtime', () => {
    const { supabaseUrl, supabaseKey } = readPublicSupabaseEnv();
    return new SupabaseRealtimeProvider({ supabaseUrl, supabaseKey });
  });

  // SubprocessStdoutParser is pure logic (no node: imports) and is safe for
  // the client bundle. LiveOutput.tsx resolves it to parse streamed events.
  registry.register('stdoutParser', () => new SubprocessStdoutParser());
}
