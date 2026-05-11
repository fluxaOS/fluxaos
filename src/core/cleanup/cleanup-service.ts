/**
 * Cleanup service — four triggers (onPrClosed, runScheduledSweep,
 * cleanupToMakeRoom, removeEnvironment) + listBreakdown, all sharing one
 * safety-check pipeline. Safety gates: uncommitted → skip; merged → safe;
 * open/draft PR → skip; age > FLUXAOS_CLEANUP_STALE_DAYS → safe; else skip
 * (active-but-not-stale). DI: db, isolation port, logger, git helper bag —
 * no vendor imports leak into core. Shape: Archon
 * packages/core/src/services/cleanup-service.ts (MIT, shape-only).
 * R-ARTIFACTS W4 artifact-reap helpers live in
 * ./cleanup-service-artifacts.ts (free functions, same DI contract).
 */

import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import {
  isolationEnvironment,
  issuePullRequest,
  project,
} from '@/core/db/schema';
import type { IsolationProvider } from '@/core/ports/isolation';
import {
  type ArtifactsSafetyReason,
  forceRemoveArtifactsDir,
  isArtifactsSafeToRemove as isArtifactsSafeToRemoveImpl,
  sweepArtifacts,
} from './cleanup-service-artifacts';

export type { ArtifactsSafetyReason };

// Logger contract (DI, no adapter import).
export interface CleanupLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

// Git helper contract (DI; shell-outs live in adapters/git/worktree.ts).
export interface CleanupGitHelpers {
  hasUncommittedChanges(worktreePath: string): Promise<boolean>;
  isBranchMerged(
    repoPath: string,
    branchName: string,
    baseBranch: string
  ): Promise<boolean>;
  getCanonicalRepoPath(path: string): Promise<string>;
  // R-ARTIFACTS W4 — interface-only; adapter impls wired at bootstrap.
  listArtifactDirs(base: string): Promise<string[]>;
  removeArtifactsDir(path: string): Promise<void>;
  getArtifactsDirAge(path: string): Promise<Date>;
  getArtifactsBase(repoPath: string): string;
}

// Report types (public).
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

// Deps + factory signature.
export interface CleanupServiceDeps {
  db: Database;
  isolation: IsolationProvider;
  logger: CleanupLogger;
  git: CleanupGitHelpers;
  /**
   * Maximum worktree age in days before it is considered stale.
   * Undefined means the stale-age gate is disabled (no-op).
   */
  cleanupStaleDays?: number;
  /**
   * Minimum age in days before a terminal pipeline_run artifacts dir is
   * eligible for reaping. Undefined disables the artifacts sweep.
   */
  cleanupArtifactsRetentionDays?: number;
}

export interface CleanupService {
  onPrClosed(
    prNumber: number,
    repo: string,
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
  // R-ARTIFACTS W4: exposed for direct testing of the artifacts gate.
  isArtifactsSafeToRemove(
    runId: string,
    ageMs: number
  ): Promise<ArtifactsSafetyReason>;
}

type IsolationRow = typeof isolationEnvironment.$inferSelect;
type ProjectRow = typeof project.$inferSelect;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Helpers.
function ageDays(createdAt: Date, now: Date): number {
  return (now.getTime() - createdAt.getTime()) / MS_PER_DAY;
}

export function createCleanupService(deps: CleanupServiceDeps): CleanupService {
  const { db, isolation, logger, git } = deps;
  const staleDays: number | null = deps.cleanupStaleDays ?? null;
  const artifactsRetentionDays: number | undefined =
    deps.cleanupArtifactsRetentionDays;

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
      // Missing/unreadable worktree: absorb and fall through to staleness.
    }

    // 2. Branch merged → safe.
    // Invariant: isolation_environment.project_id is NOT NULL with an FK to
    // project, and project.default_branch is NOT NULL with default 'main'.
    // A null projectRow or null defaultBranch here is a schema-level invariant
    // violation, not a recoverable case — fail fast instead of silently
    // substituting and risking the wrong base branch.
    const projectRow = await loadProject(env.projectId);
    if (!projectRow) {
      throw new Error(
        `Invariant violation: isolation_environment ${env.id} references missing project ${env.projectId}`
      );
    }
    if (!projectRow.defaultBranch) {
      throw new Error(
        `Invariant violation: project ${projectRow.id} has null defaultBranch`
      );
    }
    const baseBranch = projectRow.defaultBranch;
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
      // R-ARTIFACTS W4: force-remove also tears down the artifact dir.
      if (force) {
        await forceRemoveArtifactsDir(
          logger,
          git,
          row.id,
          row.artifactsPath,
          warnings
        );
      }
      return { worktreeRemoved: true, warnings };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(message);
      logger.error({ envId: row.id, error: message }, 'cleanup.remove_failed');
      throw err;
    }
  }

  async function listActiveAcrossProjects(): Promise<IsolationRow[]> {
    // Single-tenant assumption: sweeps active isolation envs for ALL tenants.
    // In a multi-tenant deployment this would need an orgId filter so one
    // tenant's cleanup policy cannot delete another tenant's worktrees. (FLX-148)
    return db
      .select()
      .from(isolationEnvironment)
      .where(eq(isolationEnvironment.status, 'active'))
      .orderBy(asc(isolationEnvironment.createdAt));
  }

  // R-ARTIFACTS W4 — wrapper delegating to ./cleanup-service-artifacts.
  function isArtifactsSafeToRemove(
    runId: string,
    ageMs: number
  ): Promise<ArtifactsSafetyReason> {
    return isArtifactsSafeToRemoveImpl(
      db,
      runId,
      ageMs,
      artifactsRetentionDays
    );
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
    logger.info({ count: active.length }, 'cleanup.sweep_start');

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

    // R-ARTIFACTS W4: artifact reap runs AFTER the worktree pass.
    await sweepArtifacts(db, logger, git, report, artifactsRetentionDays);

    report.completedAt = new Date();
    logger.info(
      {
        removed: report.removed.length,
        skipped: report.skipped.length,
        errors: report.errors.length,
        durationMs: report.completedAt.getTime() - report.startedAt.getTime(),
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

    // Alpha: best-effort reap oldest-first; no byte guarantee — caller
    // inspects report.removed to see what happened.
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

    // R-ARTIFACTS W4: best-effort second-tier — reap stale artifacts too.
    await sweepArtifacts(db, logger, git, report, artifactsRetentionDays);

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
    repo: string,
    options: { merged: boolean }
  ): Promise<void> {
    const rows = await db
      .select()
      .from(issuePullRequest)
      .where(
        and(
          eq(issuePullRequest.prNumber, prNumber),
          eq(issuePullRequest.repo, repo)
        )
      );
    if (rows.length === 0) {
      logger.warn({ prNumber, repo }, 'cleanup.pr_not_found');
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
    isArtifactsSafeToRemove,
  };
}

export type { IsolationRow };
