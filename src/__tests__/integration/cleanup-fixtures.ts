/**
 * Shared fixtures + helpers for cleanup-service integration tests.
 *
 * Not a test file itself (filename excludes `.test.ts`). Imported by
 * `cleanup.test.ts` and `cleanup-triggers.test.ts` to avoid duplicating
 * the org/user/project/pipeline/issue bootstrap.
 */
import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import {
  getCanonicalRepoPath,
  hasUncommittedChanges,
  isBranchMerged,
} from '@/adapters/git/worktree';
import { createWorktreeIsolationProvider } from '@/adapters/git/worktree-isolation-provider';
import {
  type CleanupLogger,
  createCleanupService,
} from '@/core/cleanup/cleanup-service';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';

const execFileAsync = promisify(execFile);

export const RUN = Date.now();

export interface CleanupBag {
  table: string;
  id: string;
}

export async function gitInTmp(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

export async function makeRepo(
  label: string,
  tmpRepos: string[]
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `fluxaos-cleanup-${label}-${RUN}-`));
  tmpRepos.push(dir);
  await gitInTmp(dir, ['init', '-b', 'main']);
  await gitInTmp(dir, ['config', 'user.email', 'cleanup@fluxaos.local']);
  await gitInTmp(dir, ['config', 'user.name', 'CleanupTest']);
  await gitInTmp(dir, ['commit', '--allow-empty', '-m', 'initial']);
  return dir;
}

/**
 * Add a divergent commit on the worktree's branch so
 * `git branch --merged main` no longer lists it.
 */
export async function divergeBranch(worktreePath: string): Promise<void> {
  await execFileAsync('git', ['config', 'user.email', 'div@fluxaos.local'], {
    cwd: worktreePath,
  });
  await execFileAsync('git', ['config', 'user.name', 'DivTest'], {
    cwd: worktreePath,
  });
  await execFileAsync(
    'git',
    ['commit', '--allow-empty', '-m', 'diverge from main'],
    { cwd: worktreePath }
  );
}

export interface Fixture {
  repoPath: string;
  orgId: string;
  userId: string;
  projectId: string;
  pipelineId: string;
  runId: string;
  issueId: string;
}

export async function makeFixture(
  db: Database,
  label: string,
  tmpRepos: string[],
  cleanup: CleanupBag[]
): Promise<Fixture> {
  function push(table: string, id: string) {
    cleanup.push({ table, id });
  }

  const repoPath = await makeRepo(label, tmpRepos);

  const [org] = await db
    .insert(schema.organization)
    .values({
      name: `cleanup-org-${label}-${RUN}`,
      slug: `cleanup-org-${label}-${RUN}`,
    })
    .returning();
  push('organization', org.id);

  const [userRow] = await db
    .insert(schema.user)
    .values({
      orgId: org.id,
      email: `cleanup-${label}-${RUN}@test.local`,
      name: 'Cleanup',
      slug: `cleanup-${label}-${RUN}`,
    })
    .returning();
  push('user', userRow.id);

  const [projectRow] = await db
    .insert(schema.project)
    .values({
      orgId: org.id,
      userId: userRow.id,
      name: `cleanup-proj-${label}-${RUN}`,
      slug: `cleanup-proj-${label}-${RUN}`,
      repoUrl: 'https://github.com/fluxaos/cleanup-test-fixture',
      defaultBranch: 'main',
    })
    .returning();
  push('project', projectRow.id);

  const [pipelineRow] = await db
    .insert(schema.pipeline)
    .values({ projectId: projectRow.id, name: `cleanup-pipe-${label}` })
    .returning();
  push('pipeline', pipelineRow.id);

  const [runRow] = await db
    .insert(schema.pipelineRun)
    .values({ pipelineId: pipelineRow.id, status: 'pending' })
    .returning();
  push('pipelineRun', runRow.id);

  const [typeRow] = await db
    .insert(schema.issueType)
    .values({
      projectId: projectRow.id,
      key: 'task',
      displayName: 'Task',
      color: '#000',
      sortOrder: 0,
      isActive: true,
    })
    .returning();
  push('issueType', typeRow.id);

  const [stateRow] = await db
    .insert(schema.issueState)
    .values({
      projectId: projectRow.id,
      key: 'new',
      displayName: 'New',
      color: '#000',
      sortOrder: 0,
      isActive: true,
      isTerminal: false,
    })
    .returning();
  push('issueState', stateRow.id);

  const [statusRow] = await db
    .insert(schema.issueStatus)
    .values({
      projectId: projectRow.id,
      key: 'open',
      displayName: 'Open',
      sortOrder: 0,
      isActive: true,
    })
    .returning();
  push('issueStatus', statusRow.id);

  const [priorityRow] = await db
    .insert(schema.issuePriority)
    .values({
      projectId: projectRow.id,
      key: 'normal',
      displayName: 'Normal',
      color: '#000',
      weight: 0,
      isActive: true,
    })
    .returning();
  push('issuePriority', priorityRow.id);

  const [issueRow] = await db
    .insert(schema.issue)
    .values({
      projectId: projectRow.id,
      typeId: typeRow.id,
      stateId: stateRow.id,
      statusId: statusRow.id,
      priorityId: priorityRow.id,
      title: `cleanup issue ${label}`,
      number: 1,
    })
    .returning();
  push('issue', issueRow.id);

  return {
    repoPath,
    orgId: org.id,
    userId: userRow.id,
    projectId: projectRow.id,
    pipelineId: pipelineRow.id,
    runId: runRow.id,
    issueId: issueRow.id,
  };
}

export interface LoggerWithRecords extends CleanupLogger {
  records: { level: string; obj: Record<string, unknown>; msg?: string }[];
}

export function makeLogger(): LoggerWithRecords {
  const records: {
    level: string;
    obj: Record<string, unknown>;
    msg?: string;
  }[] = [];
  return {
    records,
    info: (obj, msg) => records.push({ level: 'info', obj, msg }),
    warn: (obj, msg) => records.push({ level: 'warn', obj, msg }),
    error: (obj, msg) => records.push({ level: 'error', obj, msg }),
  };
}

export interface ArtifactsFakes {
  listArtifactDirs?: (base: string) => Promise<string[]>;
  removeArtifactsDir?: (path: string) => Promise<void>;
  getArtifactsDirAge?: (path: string) => Promise<Date>;
  getArtifactsBase?: (repoPath: string) => string;
}

/**
 * Build the cleanup service with a configurable artifacts helper bag.
 *
 * The non-artifacts tests don't exercise the artifacts code paths, so they
 * get no-op defaults. Artifacts-specific tests pass in fakes that record
 * and/or return scripted values.
 */
export function buildService(db: Database, artifacts: ArtifactsFakes = {}) {
  const isolation = createWorktreeIsolationProvider({ db });
  const logger = makeLogger();
  const service = createCleanupService({
    db,
    isolation,
    logger,
    git: {
      hasUncommittedChanges,
      isBranchMerged,
      getCanonicalRepoPath,
      listArtifactDirs: artifacts.listArtifactDirs ?? (async () => []),
      removeArtifactsDir:
        artifacts.removeArtifactsDir ?? (async () => undefined),
      getArtifactsDirAge:
        artifacts.getArtifactsDirAge ?? (async () => new Date()),
      getArtifactsBase: artifacts.getArtifactsBase ?? ((repoPath) => repoPath),
    },
  });
  return { isolation, service, logger };
}

export async function runCleanupTeardown(
  db: Database,
  cleanup: CleanupBag[]
): Promise<void> {
  for (const { table, id } of [...cleanup].reverse()) {
    const t = (schema as Record<string, unknown>)[table];
    if (t)
      await db
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .delete(t as any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .where(eq((t as any).id, id))
        .catch(() => undefined);
  }
}
