/**
 * Nuke script — deletes all data from every table in FK-safe order.
 *
 * Usage: npx tsx src/scripts/db/nuke.ts
 * Requires: DIRECT_URL set in .env (session-mode, port 5432).
 *
 * Tables that don't exist yet are skipped gracefully.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';

// Destructive script — issues bulk DELETEs across the full FK graph. Require
// the session-mode direct connection so all statements run on the same
// backend (predictable locking, no pgbouncer transaction-mode surprises).
const url = process.env.DIRECT_URL;
if (!url) {
  console.error(
    'ERROR: DIRECT_URL must be set. ' +
      'nuke.ts requires the Supabase direct connection (port 5432) — ' +
      'DATABASE_URL (pgbouncer transaction mode) is not acceptable.'
  );
  process.exit(1);
}

// Hard guard: nuke.ts must never run against the UAT Supabase project.
// The dev/UAT env-file regression (FLX-123, 2026-05-05 / 2026-05-07) silently
// pointed dev at UAT credentials; without this guard, every `flux server dev
// reset` nukes UAT. Defense in depth — does not rely on env-file hygiene.
const UAT_PROJECT_REF = 'zesinfsluyxiwzldeffa';
if (url.includes(UAT_PROJECT_REF)) {
  console.error(
    `ERROR: nuke.ts refuses to run against UAT project (${UAT_PROJECT_REF}).\n` +
      `       Current DB URL host contains the UAT project ref.\n` +
      `       Check .env / .env.local — dev should point at dpdjlnpvxkepkwzwuvim.`
  );
  process.exit(1);
}

const provider = new SupabaseDatabaseProvider(url);
const db = provider.getConnection();

/** Tables in FK-safe deletion order: leaves first, then parents. */
const tables = [
  'issue_event',
  'issue_comment',
  'issue_branch',
  'issue_pull_request',
  'issue_commit',
  'stage_gate_result',
  'event',
  'stage_run',
  'isolation_environment',
  'pipeline_run',
  'issue',
  'issue_transition',
  'issue_type',
  'issue_state',
  'issue_status',
  'issue_priority',
  'issue_label',
  'pipeline_stage',
  'pipeline',
  'config_entry',
  'driver',
  'persona_skill',
  'team_member',
  'memory',
  'skill',
  'persona',
  'team',
  'brand',
  'routing_rule',
  'routing_profile',
  'model',
  'provider',
  'project',
  'user',
  'organization',
];

async function nuke() {
  console.log('Nuking fluxaOS database...\n');

  let deleted = 0;
  let skipped = 0;

  for (const table of tables) {
    try {
      // Use raw SQL with identifier quoting to avoid reserved-word issues.
      const result = await db.execute(
        sql.raw(`DELETE FROM "${table}" RETURNING 1`)
      );
      const count = Array.isArray(result) ? result.length : 0;
      console.log(`  ✓ ${table}: deleted ${count} row(s)`);
      deleted++;
    } catch (err: unknown) {
      // Drizzle wraps postgres-js errors; the original sits in .cause
      const cause = (err as { cause?: Record<string, unknown> })?.cause;
      const code = cause?.code ?? '';
      const detail = cause?.message ?? (err as Error)?.message ?? String(err);
      // 42P01 = undefined_table in Postgres
      if (code === '42P01' || String(detail).includes('does not exist')) {
        console.log(`  – ${table}: skipped (table does not exist)`);
        skipped++;
      } else {
        console.error(`  ✗ ${table}: ERROR [${code}] — ${detail}`);
      }
    }
  }

  console.log(
    `\nDone. ${deleted} table(s) cleared, ${skipped} table(s) skipped.`
  );
  process.exit(0);
}

nuke().catch((err) => {
  console.error('Nuke failed:', err);
  process.exit(1);
});
