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
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
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
    })
    .returning();
  push('organization', org.id);

  const [userRow] = await db
    .insert(schema.user)
    .values({
      orgId: org.id,
      email: `cleanup-${label}-${RUN}@test.local`,
      name: 'Cleanup',
    })
    .returning();
  push('user', userRow.id);

  const [teamRow] = await db
    .insert(schema.team)
    .values({ orgId: org.id, name: `cleanup-team-${label}-${RUN}` })
    .returning();
  push('team', teamRow.id);

  const [projectRow] = await db
    .insert(schema.project)
    .values({
      orgId: org.id,
      teamId: teamRow.id,
      name: `cleanup-proj-${label}-${RUN}`,
      repoUrl: 'https://github.com/fluxaos/cleanup-test-fixture',
      defaultBranch: 'main',
    })
    .returning();
  push('project', projectRow.id);
  await db
    .insert(schema.projectMember)
    .values({ userId: userRow.id, projectId: projectRow.id });

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
      author: 'system',
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
/**
 * Update (or insert) a global cleanup `config_entry` row.
 *
 * FLX-224: the cleanup thresholds + scheduler-enabled gate moved from env
 * vars to `config_entry` (scope='global', project_id=NULL). Tests inject
 * values directly into the DB via this helper. The positive-integer
 * threshold accessors reject zero, so very-stale envs need an explicit
 * `createdAt` push-back in the past.
 */
export async function setGlobalConfig(
  db: Database,
  key: string,
  value: unknown
): Promise<void> {
  const [existing] = await db
    .select({ id: schema.configEntry.id })
    .from(schema.configEntry)
    .where(
      and(
        eq(schema.configEntry.scope, 'global'),
        isNull(schema.configEntry.projectId),
        eq(schema.configEntry.key, key)
      )
    );
  if (existing) {
    await db
      .update(schema.configEntry)
      .set({ value: sql`${JSON.stringify(value)}::jsonb` })
      .where(eq(schema.configEntry.id, existing.id));
    return;
  }
  await db.insert(schema.configEntry).values({
    scope: 'global',
    projectId: null,
    key,
    value: sql`${JSON.stringify(value)}::jsonb`,
  });
}

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

/**
 * FK-safe teardown for a test-created org and all its dependent data.
 *
 * Deletes in the same leaf-first order as `src/scripts/db/nuke.ts`, but
 * scoped to the given org ID so it never touches other tenants' rows.
 *
 * Call this from `afterAll` instead of a hand-rolled reverse-cleanup loop
 * whenever a test creates an org/user/project fixture.
 */
export async function deleteOrgFixture(
  db: Database,
  orgId: string
): Promise<void> {
  // Resolve all project IDs under this org once so every subsequent query
  // can scope to them with a simple `inArray`.
  const projectRows = await db
    .select({ id: schema.project.id })
    .from(schema.project)
    .where(eq(schema.project.orgId, orgId))
    .catch(() => [] as { id: string }[]);
  const projectIds = projectRows.map((r) => r.id);

  // Resolve all pipeline IDs under these projects.
  const pipelineIds: string[] =
    projectIds.length > 0
      ? await db
          .select({ id: schema.pipeline.id })
          .from(schema.pipeline)
          .where(inArray(schema.pipeline.projectId, projectIds))
          .then((rows) => rows.map((r) => r.id))
          .catch(() => [])
      : [];

  // Resolve all pipeline_run IDs under these pipelines.
  const pipelineRunIds: string[] =
    pipelineIds.length > 0
      ? await db
          .select({ id: schema.pipelineRun.id })
          .from(schema.pipelineRun)
          .where(inArray(schema.pipelineRun.pipelineId, pipelineIds))
          .then((rows) => rows.map((r) => r.id))
          .catch(() => [])
      : [];

  // Resolve all stage_run IDs under these pipeline_runs.
  const stageRunIds: string[] =
    pipelineRunIds.length > 0
      ? await db
          .select({ id: schema.stageRun.id })
          .from(schema.stageRun)
          .where(inArray(schema.stageRun.pipelineRunId, pipelineRunIds))
          .then((rows) => rows.map((r) => r.id))
          .catch(() => [])
      : [];

  // Resolve all issue IDs under these projects.
  const issueIds: string[] =
    projectIds.length > 0
      ? await db
          .select({ id: schema.issue.id })
          .from(schema.issue)
          .where(inArray(schema.issue.projectId, projectIds))
          .then((rows) => rows.map((r) => r.id))
          .catch(() => [])
      : [];

  // Resolve persona/skill/team IDs under this org for junction tables.
  const personaIds: string[] =
    projectIds.length > 0
      ? await db
          .select({ id: schema.persona.id })
          .from(schema.persona)
          .where(inArray(schema.persona.projectId, projectIds))
          .then((rows) => rows.map((r) => r.id))
          .catch(() => [])
      : [];

  const _skillIds: string[] =
    projectIds.length > 0
      ? await db
          .select({ id: schema.skill.id })
          .from(schema.skill)
          .where(inArray(schema.skill.projectId, projectIds))
          .then((rows) => rows.map((r) => r.id))
          .catch(() => [])
      : [];

  const teamIds: string[] = await db
    .select({ id: schema.team.id })
    .from(schema.team)
    .where(eq(schema.team.orgId, orgId))
    .then((rows) => rows.map((r) => r.id))
    .catch(() => []);

  // Routing profile IDs under this org (for routingRule children).
  const routingProfileIds: string[] = await db
    .select({ id: schema.routingProfile.id })
    .from(schema.routingProfile)
    .where(eq(schema.routingProfile.orgId, orgId))
    .then((rows) => rows.map((r) => r.id))
    .catch(() => []);

  // Provider IDs under this org (for model children).
  const providerIds: string[] = await db
    .select({ id: schema.provider.id })
    .from(schema.provider)
    .where(eq(schema.provider.orgId, orgId))
    .then((rows) => rows.map((r) => r.id))
    .catch(() => []);

  // ── Delete in FK-safe leaf-first order ──────────────────────────────────

  // 1. issue_event (FK → issue, cascade but delete explicitly for safety)
  if (issueIds.length > 0) {
    await db
      .delete(schema.issueEvent)
      .where(inArray(schema.issueEvent.issueId, issueIds))
      .catch(() => undefined);
  }

  // 2. issue_comment (FK → issue, cascade)
  if (issueIds.length > 0) {
    await db
      .delete(schema.issueComment)
      .where(inArray(schema.issueComment.issueId, issueIds))
      .catch(() => undefined);
  }

  // 3. issue_branch (FK → issue, cascade)
  if (issueIds.length > 0) {
    await db
      .delete(schema.issueBranch)
      .where(inArray(schema.issueBranch.issueId, issueIds))
      .catch(() => undefined);
  }

  // 4. issue_pull_request (FK → issue, cascade)
  if (issueIds.length > 0) {
    await db
      .delete(schema.issuePullRequest)
      .where(inArray(schema.issuePullRequest.issueId, issueIds))
      .catch(() => undefined);
  }

  // 5. issue_commit (FK → issue, cascade)
  if (issueIds.length > 0) {
    await db
      .delete(schema.issueCommit)
      .where(inArray(schema.issueCommit.issueId, issueIds))
      .catch(() => undefined);
  }

  // 6. stage_gate_result (FK → stage_run)
  if (stageRunIds.length > 0) {
    await db
      .delete(schema.stageGateResult)
      .where(inArray(schema.stageGateResult.stageRunId, stageRunIds))
      .catch(() => undefined);
  }

  // 7. event (FK → stage_run)
  if (stageRunIds.length > 0) {
    await db
      .delete(schema.event)
      .where(inArray(schema.event.stageRunId, stageRunIds))
      .catch(() => undefined);
  }

  // 8. stage_run (FK → pipeline_run, pipeline_stage)
  if (pipelineRunIds.length > 0) {
    await db
      .delete(schema.stageRun)
      .where(inArray(schema.stageRun.pipelineRunId, pipelineRunIds))
      .catch(() => undefined);
  }

  // 9. isolation_environment (FK → project, pipeline_run)
  if (projectIds.length > 0) {
    await db
      .delete(schema.isolationEnvironment)
      .where(inArray(schema.isolationEnvironment.projectId, projectIds))
      .catch(() => undefined);
  }

  // 10. pipeline_run (FK → pipeline)
  if (pipelineIds.length > 0) {
    await db
      .delete(schema.pipelineRun)
      .where(inArray(schema.pipelineRun.pipelineId, pipelineIds))
      .catch(() => undefined);
  }

  // 11. issue (FK → project, state, status, type, priority)
  if (projectIds.length > 0) {
    await db
      .delete(schema.issue)
      .where(inArray(schema.issue.projectId, projectIds))
      .catch(() => undefined);
  }

  // 12. issue_transition (FK → project, issue_state)
  if (projectIds.length > 0) {
    await db
      .delete(schema.issueTransition)
      .where(inArray(schema.issueTransition.projectId, projectIds))
      .catch(() => undefined);
  }

  // 13. issue_type / issue_state / issue_status / issue_priority / issue_label
  //     (FK → project with onDelete: 'restrict')
  if (projectIds.length > 0) {
    await db
      .delete(schema.issueType)
      .where(inArray(schema.issueType.projectId, projectIds))
      .catch(() => undefined);
    await db
      .delete(schema.issueState)
      .where(inArray(schema.issueState.projectId, projectIds))
      .catch(() => undefined);
    await db
      .delete(schema.issueStatus)
      .where(inArray(schema.issueStatus.projectId, projectIds))
      .catch(() => undefined);
    await db
      .delete(schema.issuePriority)
      .where(inArray(schema.issuePriority.projectId, projectIds))
      .catch(() => undefined);
    await db
      .delete(schema.issueLabel)
      .where(inArray(schema.issueLabel.projectId, projectIds))
      .catch(() => undefined);
  }

  // 14. pipeline_stage (FK → pipeline)
  if (pipelineIds.length > 0) {
    await db
      .delete(schema.pipelineStage)
      .where(inArray(schema.pipelineStage.pipelineId, pipelineIds))
      .catch(() => undefined);
  }

  // 15. pipeline (FK → project)
  if (projectIds.length > 0) {
    await db
      .delete(schema.pipeline)
      .where(inArray(schema.pipeline.projectId, projectIds))
      .catch(() => undefined);
  }

  // 16. config_entry (FK → project, nullable)
  if (projectIds.length > 0) {
    await db
      .delete(schema.configEntry)
      .where(inArray(schema.configEntry.projectId, projectIds))
      .catch(() => undefined);
  }

  // 17. cron_job (FK → project, onDelete: cascade)
  if (projectIds.length > 0) {
    await db
      .delete(schema.cronJob)
      .where(inArray(schema.cronJob.projectId, projectIds))
      .catch(() => undefined);
  }

  // 18. memory (FK → project, persona — nullable)
  if (projectIds.length > 0) {
    await db
      .delete(schema.memory)
      .where(inArray(schema.memory.projectId, projectIds))
      .catch(() => undefined);
  }

  // 19. persona_skill junction (FK → persona, skill)
  if (personaIds.length > 0) {
    await db
      .delete(schema.personaSkill)
      .where(inArray(schema.personaSkill.personaId, personaIds))
      .catch(() => undefined);
  }

  // 20. team_member junction (FK → team, persona)
  if (teamIds.length > 0) {
    await db
      .delete(schema.teamMember)
      .where(inArray(schema.teamMember.teamId, teamIds))
      .catch(() => undefined);
  }

  // 21. skill (FK → project, nullable)
  if (projectIds.length > 0) {
    await db
      .delete(schema.skill)
      .where(inArray(schema.skill.projectId, projectIds))
      .catch(() => undefined);
  }

  // 22. persona (FK → project, nullable)
  if (projectIds.length > 0) {
    await db
      .delete(schema.persona)
      .where(inArray(schema.persona.projectId, projectIds))
      .catch(() => undefined);
  }

  // 23. project_member (FK → project/user)
  if (projectIds.length > 0) {
    await db
      .delete(schema.projectMember)
      .where(inArray(schema.projectMember.projectId, projectIds))
      .catch(() => undefined);
  }

  // 24. brand (FK → org)
  await db
    .delete(schema.brand)
    .where(eq(schema.brand.orgId, orgId))
    .catch(() => undefined);

  // 25. routing_rule (FK → routing_profile)
  if (routingProfileIds.length > 0) {
    await db
      .delete(schema.routingRule)
      .where(inArray(schema.routingRule.profileId, routingProfileIds))
      .catch(() => undefined);
  }

  // 26. routing_profile (FK → org)
  await db
    .delete(schema.routingProfile)
    .where(eq(schema.routingProfile.orgId, orgId))
    .catch(() => undefined);

  // 27. model (FK → provider)
  if (providerIds.length > 0) {
    await db
      .delete(schema.model)
      .where(inArray(schema.model.providerId, providerIds))
      .catch(() => undefined);
  }

  // 28. provider (FK → org)
  await db
    .delete(schema.provider)
    .where(eq(schema.provider.orgId, orgId))
    .catch(() => undefined);

  // 29. project (FK → org, user)
  if (projectIds.length > 0) {
    await db
      .delete(schema.project)
      .where(inArray(schema.project.id, projectIds))
      .catch(() => undefined);
  }

  // 30. team (FK → org; project rows referencing it are gone)
  if (teamIds.length > 0) {
    await db
      .delete(schema.team)
      .where(inArray(schema.team.id, teamIds))
      .catch(() => undefined);
  }

  // 31. user (FK → org)
  await db
    .delete(schema.user)
    .where(eq(schema.user.orgId, orgId))
    .catch(() => undefined);

  // 32. organization
  await db
    .delete(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .catch(() => undefined);
}
