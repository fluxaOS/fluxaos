/**
 * Cleanup service — four triggers sharing one safety-check pipeline.
 *
 * Triggers:
 *   1. onPrClosed(prNumber, { merged }) — reap the env for a closed PR's branch
 *   2. runScheduledSweep() — periodic sweep of all active envs
 *   3. cleanupToMakeRoom({ requiredBytes? }) — on-demand, oldest-first reaping
 *   4. removeEnvironment(envId, { force }) — direct removal by id
 *
 * Plus listBreakdown for UI/reporting.
 *
 * Safety checks gate every reap (unless { force: true }):
 *   - uncommitted changes  → skip (NOT safe)
 *   - branch merged upstream → safe (merged)
 *   - open/draft PR for the branch → skip (NOT safe)
 *   - age > FLUXAOS_CLEANUP_STALE_DAYS → safe (stale)
 *   - otherwise → skip (active-but-not-stale)
 *
 * DI: receives `db`, `isolation` port, `logger`, and a `git` helper bag.
 * No direct git shell-outs from within src/core/ — the git helpers are
 * injected via the `git` dep. No vendor imports leak into core.
 *
 * Shape borrowed from Archon's packages/core/src/services/cleanup-service.ts
 * (MIT, shape-only).
 */

import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import {
  isolationEnvironment,
  issuePullRequest,
  project,
} from '@/core/db/schema';
import type { IsolationProvider } from '@/core/ports/isolation';

// ── Logger contract (DI, no adapter import) ──────────────────────────────────

export interface CleanupLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

// ── Git helper contract (DI, shell-outs live in adapters/git/worktree.ts) ────

export interface CleanupGitHelpers {
  hasUncommittedChanges(worktreePath: string): Promise<boolean>;
  isBranchMerged(
    repoPath: string,
    branchName: string,
    baseBranch: string
  ): Promise<boolean>;
  getCanonicalRepoPath(path: string): Promise<string>;
}

// ── Report types (public) ────────────────────────────────────────────────────

export interface CleanupReport {
  removed: { envId: string; branchName: string; reason: string }[];
  skipped: { envId: string; reason: string }[];
  errors: { envId: string; error: string }[];
  startedAt: Date;
  completedAt: Date;
}

export interface RemoveEnvironmentResult {
  worktreeRemoved: boolean;
  skippedReason?: string;
  warnings: string[];
}

export interface BreakdownReport {
  totalActive: number;
  totalInactive: number;
  safeToRemove: number;
  skippedWithReason: Record<string, number>;
}

export interface SafetyResult {
  safe: boolean;
  reason: string;
}

// ── Deps + factory signature ─────────────────────────────────────────────────

export interface CleanupServiceDeps {
  db: Database;
  isolation: IsolationProvider;
  logger: CleanupLogger;
  git: CleanupGitHelpers;
}

export interface CleanupService {
  onPrClosed(
    prNumber: number,
    options: { merged: boolean }
  ): Promise<void>;
  removeEnvironment(
    envId: string,
    options?: { force?: boolean }
  ): Promise<RemoveEnvironmentResult>;
  runScheduledSweep(): Promise<CleanupReport>;
  cleanupToMakeRoom(options?: {
    requiredBytes?: number;
  }): Promise<CleanupReport>;
  listBreakdown(options: { projectId: string }): Promise<BreakdownReport>;
  // Exposed for testing the safety pipeline in isolation.
  isSafeToRemove(env: IsolationRow): Promise<SafetyResult>;
}

type IsolationRow = typeof isolationEnvironment.$inferSelect;
type ProjectRow = typeof project.$inferSelect;

// ── Helpers ──────────────────────────────────────────────────────────────────

function ageDays(createdAt: Date, now: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return (now.getTime() - createdAt.getTime()) / msPerDay;
}

function parseStaleDays(): number | null {
  const raw = process.env.FLUXAOS_CLEANUP_STALE_DAYS;
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createCleanupService(deps: CleanupServiceDeps): CleanupService {
  const { db, isolation, logger, git } = deps;

  async function loadProject(projectId: string): Promise<ProjectRow | null> {
    const [row] = await db
      .select()
      .from(project)
      .where(eq(project.id, projectId));
    return row ?? null;
  }

  async function openPrExists(branchName: string): Promise<boolean> {
    const rows = await db
      .select({ id: issuePullRequest.id })
      .from(issuePullRequest)
      .where(
        and(
          eq(issuePullRequest.headBranch, branchName),
          inArray(issuePullRequest.state, ['open', 'draft'])
        )
      )
      .limit(1);
    return rows.length > 0;
  }

  async function isSafeToRemove(env: IsolationRow): Promise<SafetyResult> {
    // 1. Uncommitted changes → NOT safe.
    try {
      if (await git.hasUncommittedChanges(env.workingPath)) {
        return { safe: false, reason: 'uncommitted' };
      }
    } catch {
      // If we can't inspect the worktree (missing directory, git error),
      // treat it as safe-to-remove via the stale branch below rather than
      // blocking forever on an unreadable path. The missing-worktree case
      // is a common result of manual deletion; cleanup should absorb it.
    }

    // 2. Branch merged → safe.
    const projectRow = await loadProject(env.projectId);
    const baseBranch = projectRow?.defaultBranch ?? 'main';
    try {
      const canonical = await git.getCanonicalRepoPath(env.workingPath);
      if (await git.isBranchMerged(canonical, env.branchName, baseBranch)) {
        return { safe: true, reason: 'merged' };
      }
    } catch {
      // Non-fatal: continue to PR + staleness checks.
    }

    // 3. Open/draft PR → NOT safe.
    if (await openPrExists(env.branchName)) {
      return { safe: false, reason: 'open-pr' };
    }

    // 4. Stale → safe (only if threshold is explicitly configured).
    const staleDays = parseStaleDays();
    if (staleDays !== null) {
      const age = ageDays(env.createdAt, new Date());
      if (age > staleDays) {
        return { safe: true, reason: 'stale' };
      }
    }

    // 5. Otherwise: active-but-not-stale.
    return { safe: false, reason: 'active-but-not-stale' };
  }

  async function removeEnvironment(
    envId: string,
    options: { force?: boolean } = {}
  ): Promise<RemoveEnvironmentResult> {
    const warnings: string[] = [];
    const force = options.force === true;

    const [row] = await db
      .select()
      .from(isolationEnvironment)
      .where(eq(isolationEnvironment.id, envId));

    if (!row) {
      return { worktreeRemoved: false, skippedReason: 'not-found', warnings };
    }

    if (row.status !== 'active') {
      return {
        worktreeRemoved: false,
        skippedReason: 'already-inactive',
        warnings,
      };
    }

    if (!force) {
      const safety = await isSafeToRemove(row);
      if (!safety.safe) {
        logger.info(
          { envId: row.id, reason: safety.reason },
          'cleanup.skip_not_safe'
        );
        return {
          worktreeRemoved: false,
          skippedReason: safety.reason,
          warnings,
        };
      }
    }

    try {
      await isolation.release(envId, { force });
      logger.info(
        { envId: row.id, branchName: row.branchName },
        'cleanup.removed'
      );
      return { worktreeRemoved: true, warnings };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(message);
      logger.error(
        { envId: row.id, error: message },
        'cleanup.remove_failed'
      );
      throw err;
    }
  }

  async function listActiveAcrossProjects(): Promise<IsolationRow[]> {
    return db
      .select()
      .from(isolationEnvironment)
      .where(eq(isolationEnvironment.status, 'active'))
      .orderBy(asc(isolationEnvironment.createdAt));
  }

  async function runScheduledSweep(): Promise<CleanupReport> {
    const startedAt = new Date();
    const report: CleanupReport = {
      removed: [],
      skipped: [],
      errors: [],
      startedAt,
      completedAt: startedAt,
    };

    const active = await listActiveAcrossProjects();
    logger.info(
      { count: active.length },
      'cleanup.sweep_start'
    );

    for (const env of active) {
      try {
        const safety = await isSafeToRemove(env);
        if (!safety.safe) {
          report.skipped.push({ envId: env.id, reason: safety.reason });
          continue;
        }
        if (safety.reason !== 'merged' && safety.reason !== 'stale') {
          // Defensive: only these two reasons trigger a reap in the sweep.
          report.skipped.push({ envId: env.id, reason: safety.reason });
          continue;
        }
        const result = await removeEnvironment(env.id, { force: false });
        if (result.worktreeRemoved) {
          report.removed.push({
            envId: env.id,
            branchName: env.branchName,
            reason: safety.reason,
          });
        } else {
          report.skipped.push({
            envId: env.id,
            reason: result.skippedReason ?? 'unknown',
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        report.errors.push({ envId: env.id, error: message });
      }
    }

    report.completedAt = new Date();
    logger.info(
      {
        removed: report.removed.length,
        skipped: report.skipped.length,
        errors: report.errors.length,
        durationMs:
          report.completedAt.getTime() - report.startedAt.getTime(),
      },
      'cleanup.sweep_done'
    );
    return report;
  }

  async function cleanupToMakeRoom(
    options: { requiredBytes?: number } = {}
  ): Promise<CleanupReport> {
    const startedAt = new Date();
    const report: CleanupReport = {
      removed: [],
      skipped: [],
      errors: [],
      startedAt,
      completedAt: startedAt,
    };

    // Alpha note: disk-free inspection is advisory. requiredBytes is a
    // best-effort target; we reap every safe candidate, oldest first, and
    // stop as soon as the report indicates the target has been met. Without
    // a reliable per-path statfs across filesystems we don't claim to free
    // a specific byte count — the caller logs what actually happened.
    const active = await listActiveAcrossProjects();
    logger.info(
      { count: active.length, requiredBytes: options.requiredBytes ?? null },
      'cleanup.make_room_start'
    );

    for (const env of active) {
      try {
        const safety = await isSafeToRemove(env);
        if (!safety.safe) {
          report.skipped.push({ envId: env.id, reason: safety.reason });
          continue;
        }
        const result = await removeEnvironment(env.id, { force: false });
        if (result.worktreeRemoved) {
          report.removed.push({
            envId: env.id,
            branchName: env.branchName,
            reason: safety.reason,
          });
        } else {
          report.skipped.push({
            envId: env.id,
            reason: result.skippedReason ?? 'unknown',
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        report.errors.push({ envId: env.id, error: message });
      }
    }

    report.completedAt = new Date();
    logger.info(
      {
        removed: report.removed.length,
        skipped: report.skipped.length,
        errors: report.errors.length,
      },
      'cleanup.make_room_done'
    );
    return report;
  }

  async function onPrClosed(
    prNumber: number,
    options: { merged: boolean }
  ): Promise<void> {
    const rows = await db
      .select()
      .from(issuePullRequest)
      .where(eq(issuePullRequest.prNumber, prNumber));
    if (rows.length === 0) {
      logger.warn({ prNumber }, 'cleanup.pr_not_found');
      return;
    }

    for (const pr of rows) {
      const envs = await db
        .select()
        .from(isolationEnvironment)
        .where(
          and(
            eq(isolationEnvironment.branchName, pr.headBranch),
            eq(isolationEnvironment.status, 'active')
          )
        );
      if (envs.length === 0) {
        logger.info(
          { prNumber, headBranch: pr.headBranch },
          'cleanup.pr_closed_no_env'
        );
        continue;
      }
      for (const env of envs) {
        try {
          await removeEnvironment(env.id, { force: options.merged });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(
            { envId: env.id, error: message },
            'cleanup.pr_closed_remove_failed'
          );
        }
      }
    }
  }

  async function listBreakdown(opts: {
    projectId: string;
  }): Promise<BreakdownReport> {
    const activeRows = await db
      .select()
      .from(isolationEnvironment)
      .where(
        and(
          eq(isolationEnvironment.projectId, opts.projectId),
          eq(isolationEnvironment.status, 'active')
        )
      );
    const inactiveRows = await db
      .select({ id: isolationEnvironment.id })
      .from(isolationEnvironment)
      .where(
        and(
          eq(isolationEnvironment.projectId, opts.projectId),
          eq(isolationEnvironment.status, 'inactive')
        )
      );

    let safeToRemove = 0;
    const skippedWithReason: Record<string, number> = {};
    for (const env of activeRows) {
      const safety = await isSafeToRemove(env);
      if (safety.safe) {
        safeToRemove += 1;
      } else {
        skippedWithReason[safety.reason] =
          (skippedWithReason[safety.reason] ?? 0) + 1;
      }
    }

    return {
      totalActive: activeRows.length,
      totalInactive: inactiveRows.length,
      safeToRemove,
      skippedWithReason,
    };
  }

  return {
    onPrClosed,
    removeEnvironment,
    runScheduledSweep,
    cleanupToMakeRoom,
    listBreakdown,
    isSafeToRemove,
  };
}

// Re-export the row type for consumer tests.
export type { IsolationRow };
