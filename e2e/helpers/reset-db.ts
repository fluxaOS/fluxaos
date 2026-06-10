// e2e/helpers/reset-db.ts
//
// Shared nuke + reseed for specs that need a pristine DB (FLX-266).
//
// `project.target_repo_path` is operator-owned per-project config (FLX-221)
// that a bare nuke+seed destroys: the seed intentionally leaves the column
// null, so every spec that reset the DB mid-suite silently broke each
// daemon-dependent spec that ran after it (stage acquisition fails fast on
// the null). resetDb() captures the operator's value before the nuke and
// writes it back after the seed — state capture/restore, not a fallback:
// when the column was null before the reset it stays null after.
//
// The seed's deterministic project UUID (src/scripts/db/seed-ids.ts) is what
// makes the restore addressable across the nuke.

import { execSync } from 'node:child_process';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { and, eq, sql } from 'drizzle-orm';
import { SupabaseDatabaseProvider } from '../../src/adapters/supabase/database';
import { issue, issueStatus, project } from '../../src/core/db/schema';
import { SEED_PROJECT_ID } from '../../src/scripts/db/seed-ids';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Specs run under whatever env Playwright was launched with; merge the repo
// env files the same way the daemon-spawning specs always have.
const env = {
  ...process.env,
  ...loadDotenv({ path: path.join(REPO_ROOT, '.env') }).parsed,
  ...loadDotenv({ path: path.join(REPO_ROOT, '.env.local') }).parsed,
};

function databaseUrl(): string {
  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error('reset-db helper requires DATABASE_URL');
  }
  return url;
}

async function withDb<T>(
  fn: (db: ReturnType<SupabaseDatabaseProvider['getConnection']>) => Promise<T>
): Promise<T> {
  const provider = new SupabaseDatabaseProvider(databaseUrl());
  try {
    return await fn(provider.getConnection());
  } finally {
    await provider.close();
  }
}

/** Current target_repo_path of the seeded default project (null when unset
 *  or when the row does not exist, e.g. between nuke and seed). */
export async function readSeedProjectTargetRepoPath(): Promise<string | null> {
  return withDb(async (db) => {
    const [row] = await db
      .select({ targetRepoPath: project.targetRepoPath })
      .from(project)
      .where(eq(project.id, SEED_PROJECT_ID));
    return row?.targetRepoPath ?? null;
  });
}

/** Write target_repo_path on the seeded default project. Specs that point
 *  the column at a temp fixture repo MUST capture the prior value and write
 *  it back in afterAll — the suite shares one operator runtime. */
export async function writeSeedProjectTargetRepoPath(
  value: string | null
): Promise<void> {
  await withDb(async (db) => {
    await db
      .update(project)
      .set({ targetRepoPath: value })
      .where(eq(project.id, SEED_PROJECT_ID));
  });
}

/**
 * Park the seed issues so the operator daemon's IssueWatcher does not
 * auto-dispatch them, and clear any runs it already dispatched in the
 * window between seed and now.
 *
 * The suite runs against the operator's live daemon (full-issue-lifecycle's
 * contract). The watcher dispatches any issue whose status is 'open' the
 * moment the seed inserts it — racing every fixture that swaps pipeline
 * stages (FK violations on stage_run) and keeping "Run Stage" busy on the
 * seed issues. Parking them at 'blocked' is deterministic because the
 * watcher re-reads issue state at dispatch time (FLX-266): even a
 * late-arriving Realtime event skips a parked issue.
 *
 * Specs exercise the seed issues via manual Run Stage triggers (unaffected
 * by issue status); specs that need auto-dispatch file their own issues.
 */
export async function quiesceSeedIssues(): Promise<void> {
  await withDb(async (db) => {
    const [blocked] = await db
      .select({ id: issueStatus.id })
      .from(issueStatus)
      .where(
        and(
          eq(issueStatus.projectId, SEED_PROJECT_ID),
          eq(issueStatus.key, 'blocked')
        )
      );
    if (!blocked) {
      throw new Error(
        "quiesceSeedIssues: seed project has no 'blocked' issue status"
      );
    }
    await db
      .update(issue)
      .set({ statusId: blocked.id })
      .where(eq(issue.projectId, SEED_PROJECT_ID));

    // Give any dispatch that re-read 'open' before the park committed a
    // moment to land its pipeline_run insert, then clear it below.
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    // Clear anything the watcher dispatched before the park landed.
    // FK order mirrors src/scripts/db/nuke.ts. A straggler executor can
    // insert a stage_run / isolation_environment row BETWEEN these
    // sequential deletes (FK violation on the pipeline_run delete), so
    // retry the sweep — stragglers stop once the park is visible to the
    // watcher's dispatch-time re-read.
    const tables = [
      'issue_branch',
      'issue_pull_request',
      'issue_commit',
      'stage_gate_result',
      'event',
      'stage_run',
      'isolation_environment',
      'deploy_run',
      'pipeline_run',
    ];
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      lastErr = null;
      try {
        for (const table of tables) {
          await db.execute(sql.raw(`DELETE FROM "${table}"`));
        }
        break;
      } catch (err) {
        lastErr = err;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
    if (lastErr) throw lastErr;
  });
}

/** Nuke + reseed, preserving operator-owned per-project runtime config and
 *  parking the seed issues (see quiesceSeedIssues). */
export async function resetDb(): Promise<void> {
  const operatorTargetRepoPath = await readSeedProjectTargetRepoPath();
  execSync('npx tsx src/scripts/db/nuke.ts', {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env,
  });
  execSync('npm run db:seed', {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env,
  });
  if (operatorTargetRepoPath !== null) {
    await writeSeedProjectTargetRepoPath(operatorTargetRepoPath);
  }
  await quiesceSeedIssues();
}
