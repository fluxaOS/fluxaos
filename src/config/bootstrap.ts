/**
 * Bootstrap — registers all adapters at startup.
 *
 * Called once when the app starts. Reads env vars, creates adapter
 * factories, registers them in the registry, and validates that
 * all required adapters are present.
 *
 * Fails fast: missing env vars crash the app with a clear error.
 */

import { BullMQAdapter } from '@/adapters/bullmq/queue';
import { createWorktreeIsolationProvider } from '@/adapters/git';
import { createGitProviderFactory } from '@/adapters/git-router/factory';
import { LangGraphStageGraphRunner } from '@/adapters/langgraph/stage-graph-runner-adapter';
import { SubprocessExecutor } from '@/adapters/subprocess/executor';
import { SubprocessStdoutParser } from '@/adapters/subprocess/stdout-parser';
import { SupabaseAuthProvider } from '@/adapters/supabase/auth';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { SupabaseRealtimeProvider } from '@/adapters/supabase/realtime';
import type { DatabaseProvider } from '@/core/ports';
import { registry } from './registry';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        'Check your .env file or environment configuration.'
    );
  }
  return value;
}

const REQUIRED_ADAPTERS = [
  'database',
  'auth',
  'queue',
  'realtime',
  'stageGraphRunner',
] as const;

let bootstrapped = false;

/**
 * Initialize all adapters. Safe to call multiple times — only runs once.
 *
 * `bootstrap()` no longer takes a FluxaosConfig — both workspace_root and
 * artifacts_root overrides moved to the DB (`runtime.workspace_root`,
 * `runtime.artifacts_root`); the isolation provider reads them via
 * `getRuntimeWorkspaceRoot(db)` / `getRuntimeArtifactsRoot(db)` at every
 * acquire (FLX-222 / FLX-223). The remaining FluxaosConfig fields
 * (cleanup thresholds, target repo path, result-doc scripts) are threaded
 * directly into their consumers by the daemon — not via `bootstrap`.
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

  // Stage Graph Runner — LangGraph implementation of StageGraphRunner port
  registry.register('stageGraphRunner', () => {
    return new LangGraphStageGraphRunner();
  });

  // Isolation — worktree-per-run workspace provider. Depends on the
  // database adapter being resolvable (factory evaluates lazily).
  // Both workspaceRoot and artifactsRoot were migrated to the DB-backed
  // `runtime.workspace_root` / `runtime.artifacts_root` config_entry rows
  // (FLX-222, FLX-223); the provider reads them via the runtime-config
  // accessors at every acquire. Bootstrap no longer threads either root
  // through DI — the provider only needs `db`.
  registry.register('isolation', () => {
    const dbProvider = registry.get<DatabaseProvider>('database');
    return createWorktreeIsolationProvider({
      db: dbProvider.getConnection(),
    });
  });

  // FLX-4 — GitProviderFactory. Routes a repo URL to the right forge
  // adapter (GitHub, GitLab, Gitea, Forgejo). The non-GitHub adapters
  // are stubs in the FLX-4 slice; they throw NotImplementedError until
  // a future PR wires their REST APIs. This is the only git resolution
  // path; FLUXAOS_GITHUB_TOKEN is required at call time (not at
  // registration time) and missing-token errors surface to the caller.
  registry.register('gitFactory', () => createGitProviderFactory());

  // Validate all required adapters are registered
  registry.validate([...REQUIRED_ADAPTERS]);
}
