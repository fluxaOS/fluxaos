/**
 * Integration test setup.
 * Uses the real database. Each test suite tracks its own created IDs for cleanup.
 * Requires DATABASE_URL to be set (reads from .env).
 */
import { sql } from 'drizzle-orm';
import { db } from '@/core/db';

// Known seed data IDs — created by db:seed
export const SEED_PROJECT_ID = '274bc75a-60ad-4798-8075-5571b47a7cf5';
export const SEED_ORG_ID = '14c19dbd-a7b4-4928-9891-f6f1e51fb2bd';

/**
 * Clean up specific records by ID.
 * Deletes in FK-safe order: leaf tables first.
 */
export async function cleanup(opts: {
  personaIds?: string[];
  skillIds?: string[];
  issueIds?: string[];
}) {
  // 1. persona_skill (references persona + skill)
  if (opts.personaIds?.length) {
    for (const id of opts.personaIds) {
      await db.execute(sql`DELETE FROM persona_skill WHERE persona_id = ${id}`);
    }
  }

  // 2. issue_event (references issue)
  if (opts.issueIds?.length) {
    for (const id of opts.issueIds) {
      await db.execute(sql`DELETE FROM issue_event WHERE issue_id = ${id}`);
    }
  }

  // 3. persona (may reference itself via parent)
  if (opts.personaIds?.length) {
    // Clear parent references first to avoid self-FK issues
    for (const id of opts.personaIds) {
      await db.execute(
        sql`UPDATE persona SET parent_persona_id = NULL WHERE id = ${id}`
      );
    }
    for (const id of opts.personaIds) {
      await db.execute(sql`DELETE FROM persona WHERE id = ${id}`);
    }
  }

  // 4. skill
  if (opts.skillIds?.length) {
    for (const id of opts.skillIds) {
      await db.execute(sql`DELETE FROM skill WHERE id = ${id}`);
    }
  }

  // 5. issue
  if (opts.issueIds?.length) {
    for (const id of opts.issueIds) {
      await db.execute(sql`DELETE FROM issue WHERE id = ${id}`);
    }
  }
}

export { db };
