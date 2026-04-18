/**
 * Bootstrap — registers all adapters at startup.
 *
 * Called once when the app starts. Reads env vars, creates adapter
 * factories, registers them in the registry, and validates that
 * all required adapters are present.
 *
 * Fails fast: missing env vars crash the app with a clear error.
 */
import { registry } from './registry';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { SupabaseAuthProvider } from '@/adapters/supabase/auth';
import { SupabaseRealtimeProvider } from '@/adapters/supabase/realtime';
import { BullMQAdapter } from '@/adapters/bullmq/queue';
import { SubprocessExecutor } from '@/adapters/subprocess/executor';
import { SubprocessStdoutParser } from '@/adapters/subprocess/stdout-parser';

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

const REQUIRED_ADAPTERS = ['database', 'auth', 'queue', 'realtime'] as const;

let bootstrapped = false;

/**
 * Initialize all adapters. Safe to call multiple times — only runs once.
 */
export function bootstrap(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  // Database — Supabase Postgres via transaction pooler
  registry.register('database', () => {
    const url = requireEnv('DATABASE_URL');
    return new SupabaseDatabaseProvider(url);
  });

  // Auth — Supabase Auth
  registry.register('auth', () => {
    const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
    const supabaseKey = requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    return new SupabaseAuthProvider({ supabaseUrl, supabaseKey });
  });

  // Realtime — Supabase Realtime channels
  registry.register('realtime', () => {
    const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
    const supabaseKey = requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    return new SupabaseRealtimeProvider({ supabaseUrl, supabaseKey });
  });

  // Queue — BullMQ via Redis
  registry.register('queue', () => {
    const redisUrl = requireEnv('REDIS_URL');
    return new BullMQAdapter(redisUrl);
  });

  // Stage Executor — subprocess-based
  registry.register('executor', () => {
    return new SubprocessExecutor();
  });

  // Stdout Parser — subprocess output line parser
  registry.register('stdoutParser', () => {
    return new SubprocessStdoutParser();
  });

  // Validate all required adapters are registered
  registry.validate([...REQUIRED_ADAPTERS]);
}
