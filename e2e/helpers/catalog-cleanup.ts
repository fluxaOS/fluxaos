import { sql } from 'drizzle-orm';
import { SupabaseDatabaseProvider } from '../../src/adapters/supabase/database';
import type { Database } from '../../src/core/db/connection';

async function withDb(fn: (db: Database) => Promise<void>) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('catalog cleanup requires DATABASE_URL');

  const provider = new SupabaseDatabaseProvider(url);
  try {
    await fn(provider.getConnection());
  } finally {
    await provider.close();
  }
}

/**
 * E2E specs run against the shared dev DB. Anything they create on catalog
 * pages must be removed by deterministic prefix, or seed verification starts
 * screaming. Good. It should scream.
 */
export async function cleanupFlx252CreateEntityRows(): Promise<void> {
  await withDb(async (db) => {
    await db.execute(
      sql`DELETE FROM "routing_rule" WHERE "profile_id" IN (SELECT "id" FROM "routing_profile" WHERE "name" LIKE 'FLX-252 Profile %')`
    );
    await db.execute(
      sql`DELETE FROM "routing_profile" WHERE "name" LIKE 'FLX-252 Profile %'`
    );

    await db.execute(
      sql`DELETE FROM "team_member" WHERE "team_id" IN (SELECT "id" FROM "team" WHERE "name" LIKE 'FLX-252 Team %')`
    );
    await db.execute(
      sql`DELETE FROM "team" WHERE "name" LIKE 'FLX-252 Team %'`
    );

    await db.execute(
      sql`DELETE FROM "persona_skill" WHERE "skill_id" IN (SELECT "id" FROM "skill" WHERE "name" LIKE 'FLX-252 Skill %')`
    );
    await db.execute(
      sql`DELETE FROM "skill" WHERE "name" LIKE 'FLX-252 Skill %'`
    );

    await db.execute(
      sql`DELETE FROM "model" WHERE "provider_id" IN (SELECT "id" FROM "provider" WHERE "name" LIKE 'FLX-252 Provider %')`
    );
    await db.execute(
      sql`DELETE FROM "provider" WHERE "name" LIKE 'FLX-252 Provider %'`
    );
  });
}

export async function cleanupFlx253ConfirmModalRows(): Promise<void> {
  await withDb(async (db) => {
    await db.execute(
      sql`DELETE FROM "pipeline_stage" WHERE "name" LIKE 'flx253-cancel-%' OR "name" LIKE 'flx253-confirm-%'`
    );
    await db.execute(
      sql`DELETE FROM "persona_skill" WHERE "skill_id" IN (SELECT "id" FROM "skill" WHERE "name" LIKE 'flx253-skill-%')`
    );
    await db.execute(
      sql`DELETE FROM "skill" WHERE "name" LIKE 'flx253-skill-%'`
    );
  });
}
