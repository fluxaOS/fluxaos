/**
 * Health check endpoint — resolves each adapter via registry and reports status.
 *
 * GET /api/health → JSON showing all adapters and their health.
 */
import { NextResponse } from 'next/server';
import { bootstrap } from '@/config/bootstrap';
import { registry } from '@/config/registry';
import type { DatabaseProvider } from '@/core/ports/database';
import type { SupabaseAuthProvider } from '@/adapters/supabase/auth';
import type { BullMQAdapter } from '@/adapters/bullmq/queue';

/** Run a health check with a timeout to prevent hanging. */
async function withTimeout(
  fn: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean | string> {
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), timeoutMs),
      ),
    ]);
    return result;
  } catch (e) {
    return e instanceof Error ? e.message : 'unknown error';
  }
}

async function checkAdapter(
  name: string,
  healthFn: () => Promise<boolean>,
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
        registry.get<DatabaseProvider>('database').healthCheck(),
      ),
      checkAdapter('auth', () =>
        registry.get<SupabaseAuthProvider>('auth').healthCheck(),
      ),
      checkAdapter('queue', () =>
        registry.get<BullMQAdapter>('queue').healthCheck(),
      ),
    ]);

    const adapters = { database, auth, queue };

    const allHealthy = Object.values(adapters).every(
      (a) => a.registered && a.healthy === true,
    );

    return NextResponse.json(
      {
        status: allHealthy ? 'healthy' : 'degraded',
        adapters,
        registeredAdapters: registry.names(),
        timestamp: new Date().toISOString(),
      },
      { status: allHealthy ? 200 : 503 },
    );
  } catch (e) {
    return NextResponse.json(
      {
        status: 'error',
        error: e instanceof Error ? e.message : 'bootstrap failed',
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
