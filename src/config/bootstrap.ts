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
import { createGitHubAdapter } from '@/adapters/github';
import { LangGraphStageGraphRunner } from '@/adapters/langgraph/stage-graph-runner-adapter';
import { SubprocessExecutor } from '@/adapters/subprocess/executor';
import { SubprocessStdoutParser } from '@/adapters/subprocess/stdout-parser';
import { SupabaseAuthProvider } from '@/adapters/supabase/auth';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { SupabaseRealtimeProvider } from '@/adapters/supabase/realtime';
import type { DatabaseProvider } from '@/core/ports';
import type { FluxaosConfig } from './env';
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

const REQUIRED_ADAPTERS = ['database', 'auth', 'queue', 'realtime', 'stageGraphRunner'] as const;

let bootstrapped = false;

/**
 * Initialize all adapters. Safe to call multiple times — only runs once.
 *
 * @param config - Optional FluxaosConfig from which workspace/artifacts root
 *   overrides are read. When omitted (e.g. web-server bootstrap where the
 *   cleanup vars are not set), the isolation provider falls back to the
 *   in-project directory layout.
 */
export function bootstrap(config?: FluxaosConfig): void {
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
  // workspaceRoot / artifactsRoot are threaded in from FluxaosConfig so the
  // adapter never reads process.env directly.
  registry.register('isolation', () => {
    const dbProvider = registry.get<DatabaseProvider>('database');
    return createWorktreeIsolationProvider({
      db: dbProvider.getConnection(),
      workspaceRoot: config?.workspaceRoot,
      artifactsRoot: config?.artifactsRoot,
    });
  });

  // Git — GitHub adapter (legacy single-forge resolver). Requires
  // FLUXAOS_GITHUB_TOKEN at call time (not at registration time), so
  // operators can boot the app without the token when they don't need
  // deploy-bridge functionality yet. GitHubAuthError (missing token)
  // surfaces to the caller. Kept for call sites that don't have a
  // repoUrl handy; new call sites should prefer the gitFactory.
  registry.register('git', () => createGitHubAdapter());

  // FLX-4 — GitProviderFactory. Routes a repo URL to the right forge
  // adapter (GitHub, GitLab, Gitea, Forgejo). The non-GitHub adapters
  // are stubs in the FLX-4 slice; they throw NotImplementedError until
  // a future PR wires their REST APIs.
  registry.register('gitFactory', () => createGitProviderFactory());

  // Validate all required adapters are registered
  registry.validate([...REQUIRED_ADAPTERS]);
}
