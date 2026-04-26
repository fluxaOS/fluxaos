/**
 * Health check endpoint — resolves each adapter via registry and reports status.
 * Also includes build metadata (git sha, build time, version).
 *
 * GET /api/health → JSON showing all adapters and their health.
 */
import { execSync } from 'node:child_process';
import { NextResponse } from 'next/server';
import type { BullMQAdapter } from '@/adapters/bullmq/queue';
import type { SupabaseAuthProvider } from '@/adapters/supabase/auth';
import { bootstrap } from '@/config/bootstrap';
import { registry } from '@/config/registry';
import type { DatabaseProvider } from '@/core/ports/database';

/** Read build metadata from env vars (set at build time) or fall back to git at runtime. */
function getBuildMeta(): { sha: string; buildTime: string; version: string } {
  const sha =
    process.env.NEXT_PUBLIC_GIT_SHA ??
    (() => {
      try {
        return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
      } catch {
        return 'unknown';
      }
    })();

  const buildTime =
    process.env.NEXT_PUBLIC_BUILD_TIME ?? new Date().toISOString();

  const version = process.env.npm_package_version ?? '0.1.0';

  return { sha, buildTime, version };
}

/** Run a health check with a timeout to prevent hanging. */
async function withTimeout(
  fn: () => Promise<boolean>,
  timeoutMs: number
): Promise<boolean | string> {
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), timeoutMs)
      ),
    ]);
    return result;
  } catch (e) {
    return e instanceof Error ? e.message : 'unknown error';
  }
}

async function checkAdapter(
  name: string,
  healthFn: () => Promise<boolean>
): Promise<{ registered: boolean; healthy: boolean | string }> {
  try {
    registry.get(name);
    return { registered: true, healthy: await withTimeout(healthFn, 5000) };
  } catch (e) {
    return {
      registered: false,
      healthy: e instanceof Error ? e.message : 'unknown error',
    };
  }
}

export async function GET() {
  try {
    bootstrap();

    const [database, auth, queue] = await Promise.all([
      checkAdapter('database', () =>
        registry.get<DatabaseProvider>('database').healthCheck()
      ),
      checkAdapter('auth', () =>
        registry.get<SupabaseAuthProvider>('auth').healthCheck()
      ),
      checkAdapter('queue', () =>
        registry.get<BullMQAdapter>('queue').healthCheck()
      ),
    ]);

    const adapters = { database, auth, queue };

    const allHealthy = Object.values(adapters).every(
      (a) => a.registered && a.healthy === true
    );

    const build = getBuildMeta();

    return NextResponse.json(
      {
        status: allHealthy ? 'healthy' : 'degraded',
        adapters,
        registeredAdapters: registry.names(),
        timestamp: new Date().toISOString(),
        sha: build.sha,
        buildTime: build.buildTime,
        version: build.version,
      },
      { status: allHealthy ? 200 : 503 }
    );
  } catch (e) {
    return NextResponse.json(
      {
        status: 'error',
        error: e instanceof Error ? e.message : 'bootstrap failed',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
