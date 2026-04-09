/**
 * Database type export — used by core services via DI.
 *
 * The actual connection is created in adapters/supabase/database.ts.
 * Core code only imports the type, never the implementation.
 */
import type { drizzle } from 'drizzle-orm/postgres-js';
import type * as schema from './schema';

export type Database = ReturnType<typeof drizzle<typeof schema>>;
