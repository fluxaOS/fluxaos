/**
 * DEF-022 regression: per-stage pipeline_runs on the same (pipeline, issue)
 * inherit the prior run's artifacts_path so cross-stage handoff works when
 * the alpha UI creates a fresh pipeline_run per "Run Stage" click.
 *
 * Exercises `acquireIsolationEnv` against real Supabase + a real git tmp
 * repo. The real WorktreeIsolationProvider is the acquire backend; we're
 * proving the look-up-prior-run-and-pass-artifactsPath path threads through
 * end to end.
 */
import 'dotenv/config';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGitOps } from '@/adapters/git/git-ops';
import { createWorktreeIsolationProvider } from '@/adapters/git/worktree-isolation-provider';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import { acquireIsolationEnv } from '@/core/orchestrator/stage-runner-env';
import { deleteOrgFixture } from './cleanup-fixtures';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();
const execFileAsync = promisify(execFile);

const RUN = Date.now();
let _orgId: string;
let repoPath: string;
let projectId: string;
let pipelineId: string;
let issueTypeId: string;
let issueStateId: string;
let issueStatusId: string;
let issuePriorityId: string;
let isolationProvider: ReturnType<typeof createWorktreeIsolationProvider>;

afterAll(async () => {
  if (_orgId) await deleteOrgFixture(db, _orgId);
  if (repoPath) {
    await rm(repoPath, { recursive: true, force: true }).catch(() => undefined);
  }
  await provider.close();
});

async function gitInTmp(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

beforeAll(async () => {
  repoPath = await mkdtemp(join(tmpdir(), `fluxaos-art-inherit-${RUN}-`));
  await gitInTmp(repoPath, ['init', '-b', 'main']);
  await gitInTmp(repoPath, ['config', 'user.email', 'inherit@fluxaos.local']);
  await gitInTmp(repoPath, ['config', 'user.name', 'Inherit']);
  await gitInTmp(repoPath, ['commit', '--allow-empty', '-m', 'initial']);

  const [org] = await db
    .insert(schema.organization)
    .values({ name: `inherit-org-${RUN}`, slug: `inherit-org-${RUN}` })
    .returning();
  _orgId = org.id;

  const [user] = await db
    .insert(schema.user)
    .values({
      orgId: org.id,
      email: `inherit-${RUN}@test.local`,
      name: 'Inherit',
      slug: `inherit-${RUN}`,
    })
    .returning();

  const [team] = await db
    .insert(schema.team)
    .values({ orgId: org.id, name: `inherit-team-${RUN}` })
    .returning();

  const [proj] = await db
    .insert(schema.project)
    .values({
      orgId: org.id,
      teamId: team.id,
      name: `inherit-proj-${RUN}`,
      slug: `inherit-proj-${RUN}`,
      repoUrl: 'https://github.com/fluxaos/inherit-fixture',
      defaultBranch: 'main',
      // FLX-221: target repo path is per-project; acquireIsolationEnv
      // reads it directly from the project row.
      targetRepoPath: repoPath,
    })
    .returning();
  await db
    .insert(schema.projectMember)
    .values({ userId: user.id, projectId: proj.id });
  projectId = proj.id;

  const [pipe] = await db
    .insert(schema.pipeline)
    .values({ projectId: proj.id, name: `inherit-pipe-${RUN}` })
    .returning();
  pipelineId = pipe.id;

  // Minimal issue-model lookups so we can insert an issue.
  const [itype] = await db
    .insert(schema.issueType)
    .values({
      projectId: proj.id,
      key: `feat-${RUN}`,
      displayName: 'Feat',
      color: '#000',
      sortOrder: 1,
    })
    .returning();
  issueTypeId = itype.id;

  const [istate] = await db
    .insert(schema.issueState)
    .values({
      projectId: proj.id,
      key: `open-${RUN}`,
      displayName: 'Open',
      sortOrder: 1,
      color: '#000',
    })
    .returning();
  issueStateId = istate.id;

  const [istatus] = await db
    .insert(schema.issueStatus)
    .values({
      projectId: proj.id,
      key: `inp-${RUN}`,
      displayName: 'InP',
      sortOrder: 1,
    })
    .returning();
  issueStatusId = istatus.id;

  const [iprio] = await db
    .insert(schema.issuePriority)
    .values({
      projectId: proj.id,
      key: `med-${RUN}`,
      displayName: 'Med',
      weight: 1,
      color: '#000',
    })
    .returning();
  issuePriorityId = iprio.id;

  isolationProvider = createWorktreeIsolationProvider({ db });
}, 30000);

describe('DEF-022 — artifacts_path inheritance across pipeline_runs', () => {
  it("second pipeline_run on same (pipeline, issue) inherits first run's artifacts_path", async () => {
    // Issue under test
    const [iss] = await db
      .insert(schema.issue)
      .values({
        projectId,
        number: 1,
        title: `inherit-issue-${RUN}`,
        typeId: issueTypeId,
        stateId: issueStateId,
        statusId: issueStatusId,
        priorityId: issuePriorityId,
        bodyMd: 'test',
        author: 'system',
      })
      .returning();

    // First pipeline_run — no prior artifacts_path exists, should mint fresh.
    const [run1] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId, issueId: iss.id, status: 'pending' })
      .returning();

    const result1 = await acquireIsolationEnv({
      db,
      isolation: isolationProvider,
      gitOps: createGitOps(),
      projectId,
      runId: run1.id,
      pipelineId,
      issueId: iss.id,
      issueNumber: 1,
    });

    expect(result1.env.artifactsPath).toBeTruthy();
    expect(result1.env.artifactsPath).toContain(run1.id);

    // Mirror env.artifactsPath onto pipeline_run like stage-runner does.
    await db
      .update(schema.pipelineRun)
      .set({ artifactsPath: result1.env.artifactsPath })
      .where(eq(schema.pipelineRun.id, run1.id));

    // Release run1 so we can acquire against a fresh pipeline_run without
    // the one-active-env-per-project guard biting.
    await isolationProvider.release(result1.env.id);

    // Second pipeline_run on the SAME (pipeline, issue) — should inherit.
    const [run2] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId, issueId: iss.id, status: 'pending' })
      .returning();

    const result2 = await acquireIsolationEnv({
      db,
      isolation: isolationProvider,
      gitOps: createGitOps(),
      projectId,
      runId: run2.id,
      pipelineId,
      issueId: iss.id,
      issueNumber: 1,
    });

    expect(
      result2.env.artifactsPath,
      'run2 must inherit run1 artifacts_path'
    ).toBe(result1.env.artifactsPath);
    expect(
      result2.env.artifactsPath,
      'inherited path must contain run1 id (not run2 id)'
    ).toContain(run1.id);

    await isolationProvider.release(result2.env.id);
  }, 60000);

  it('first pipeline_run (no prior runs) mints fresh artifacts_path', async () => {
    const [iss] = await db
      .insert(schema.issue)
      .values({
        projectId,
        number: 2,
        title: `inherit-fresh-${RUN}`,
        typeId: issueTypeId,
        stateId: issueStateId,
        statusId: issueStatusId,
        priorityId: issuePriorityId,
        bodyMd: 'test',
        author: 'system',
      })
      .returning();

    const [run] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId, issueId: iss.id, status: 'pending' })
      .returning();

    const result = await acquireIsolationEnv({
      db,
      isolation: isolationProvider,
      gitOps: createGitOps(),
      projectId,
      runId: run.id,
      pipelineId,
      issueId: iss.id,
      issueNumber: 2,
    });

    expect(result.env.artifactsPath).toBeTruthy();
    expect(
      result.env.artifactsPath,
      'fresh run must use own runId in path'
    ).toContain(run.id);

    await isolationProvider.release(result.env.id);
  }, 60000);

  it('pipeline_run with null issueId does not inherit (no issue scope)', async () => {
    const [run] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId, issueId: null, status: 'pending' })
      .returning();

    const result = await acquireIsolationEnv({
      db,
      isolation: isolationProvider,
      gitOps: createGitOps(),
      projectId,
      runId: run.id,
      pipelineId,
      issueId: null,
      issueNumber: null,
    });

    expect(result.env.artifactsPath).toContain(run.id);
    await isolationProvider.release(result.env.id);
  }, 60000);
});
