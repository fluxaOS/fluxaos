/**
 * tRPC initialization — creates the router and procedure helpers.
 *
 * Context includes the database instance resolved via the adapter registry.
 * Services receive the database via DI — no singleton imports.
 */
import { initTRPC } from '@trpc/server';
import { bootstrap } from '@/config/bootstrap';
import { registry } from '@/config/registry';
import type { DatabaseProvider } from '@/core/ports/database';
import type { Database } from '@/core/db/connection';

export interface TRPCContext {
  db: Database;
}

export function createTRPCContext(): TRPCContext {
  bootstrap();
  const dbProvider = registry.get<DatabaseProvider>('database');
  return { db: dbProvider.getConnection() };
}

const t = initTRPC.context<TRPCContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
