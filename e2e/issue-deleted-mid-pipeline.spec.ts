// FLX-86: daemon journey for an issue deleted while its pipeline is running.

import 'dotenv/config';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { type DaemonHandle, spawnDaemon } from './helpers/daemon';
import { expect, test } from './helpers/setup';

const DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const HAS_DB = !!DATABASE_URL;
const REPO_ROOT = path.resolve(__dirname, '..');

let previousTargetRepoPath: string | undefined;
let targetRepoPath: string | null = null;
let handle: DaemonHandle | null = null;

test.describe('@flx-86 @daemon @journey', () => {
  test.skip(!HAS_DB, 'requires DATABASE_URL or DIRECT_URL');
  test.setTimeout(90_000);

  test.beforeAll(async () => {
    targetRepoPath = createTempGitRepo();
    previousTargetRepoPath = process.env.FLUXAOS_TARGET_REPO_PATH;
    process.env.FLUXAOS_TARGET_REPO_PATH = targetRepoPath;

    execSync('npx tsx src/scripts/db/nuke.ts', {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    execSync('npm run db:seed', {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: process.env,
    });

    await configureIssueDeletedFixture(targetRepoPath);
    handle = await spawnDaemon({ graceSeconds: 5, shutdownTimeoutMs: 20_000 });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  });

  test.afterAll(async () => {
    if (handle && handle.daemon.exitCode === null) {
      await handle.shutdown().catch(() => undefined);
    }
    if (previousTargetRepoPath === undefined) {
      delete process.env.FLUXAOS_TARGET_REPO_PATH;
    } else {
      process.env.FLUXAOS_TARGET_REPO_PATH = previousTargetRepoPath;
    }
    if (targetRepoPath) {
      rmSync(targetRepoPath, { recursive: true, force: true });
    }
  });

  test('daemon fails and releases a run whose issue is deleted mid-stage', async () => {
    const sql = postgres(DATABASE_URL!, { max: 2, prepare: false });
    try {
      const [issueRow] = await sql<{ id: string; project_id: string }[]>`
        SELECT id, project_id FROM "issue" WHERE number = 1 LIMIT 1
      `;
      const [pipelineRow] = await sql<{ id: string }[]>`
        SELECT id FROM "pipeline" WHERE project_id = ${issueRow.project_id} LIMIT 1
      `;
      const [runRow] = await sql<{ id: string }[]>`
        INSERT INTO "pipeline_run" ("pipeline_id", "issue_id", "status")
        VALUES (${pipelineRow.id}, ${issueRow.id}, 'pending')
        RETURNING id
      `;

      const running = await waitForRunningStage(sql, runRow.id);
      expect(running.stageRunId).toBeTruthy();
      expect(running.childPid).toBeGreaterThan(0);

      await sql`DELETE FROM "issue" WHERE id = ${issueRow.id}`;

      await expect
        .poll(() => loadDeletedIssueRunState(sql, runRow.id), {
          timeout: 45_000,
          intervals: [500, 1_000, 2_000],
          message:
            'daemon did not fail and clean up a run whose issue was deleted',
        })
        .toMatchObject({
          issueExists: false,
          pipelineStatus: 'failed',
          runningStageRuns: 0,
          isolationStatus: 'inactive',
          worktreeExists: false,
        });

      expect(isProcessAlive(running.childPid)).toBe(false);
      expect(handle?.daemon.exitCode, 'daemon died mid-run').toBeNull();
    } finally {
      await sql.end();
    }
  });
});

function createTempGitRepo(): string {
  const repoPath = mkdtempSync(path.join(tmpdir(), 'fluxaos-flx86-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoPath });
  writeFileSync(
    path.join(repoPath, '.gitignore'),
    ['.fluxaos-worktrees/', '.fluxaos-artifacts/', '.fluxaos-*', ''].join('\n')
  );
  writeFileSync(path.join(repoPath, 'README.md'), '# FLX-86 fixture\n');
  execFileSync('git', ['add', '.'], { cwd: repoPath });
  execFileSync(
    'git',
    [
      '-c',
      'user.email=flx86@example.test',
      '-c',
      'user.name=FLX86',
      'commit',
      '-m',
      'seed',
    ],
    { cwd: repoPath }
  );
  return repoPath;
}

async function configureIssueDeletedFixture(repoPath: string): Promise<void> {
  const sql = postgres(DATABASE_URL!, { max: 2, prepare: false });
  try {
    const [projectRow] = await sql<{ id: string }[]>`
      UPDATE "project"
      SET "repo_url" = 'https://github.com/fluxaos/flx-86-fixture',
          "default_branch" = 'main',
          "worktree_copy_files" = '[]'::jsonb,
          "updated_at" = NOW()
      WHERE "slug" = 'fluxaos'
      RETURNING id
    `;

    const stubScript = [
      "console.log('FLX86_PID:' + process.pid);",
      'setTimeout(() => {',
      "console.log(JSON.stringify({'flux:signal': {verdict: 'proceed', summary: 'FLX-86 complete after delete'}}));",
      '}, 2500);',
    ].join('');

    const [driverRow] = await sql<{ id: string }[]>`
      INSERT INTO "driver" (
        "name", "slug", "binary", "default_args", "model_flag", "dir_flag",
        "session_name_flag", "prompt_transport", "output_format",
        "output_format_flag", "issue_prompt_template",
        "queue_prompt_template", "context_layout"
      )
      VALUES (
        'FLX-86 Stub Driver',
        'flx-86-stub-driver',
        'node',
        ${JSON.stringify(['-e', stubScript])}::jsonb,
        NULL,
        NULL,
        NULL,
        'argv',
        'text',
        NULL,
        '{{skill_name}} {{issue_title}}',
        '{{issue_title}}',
        '{"instructionsFile":".fluxaos-instructions.md","contextFile":".fluxaos-context.md"}'::jsonb
      )
      RETURNING id
    `;

    const [pipelineRow] = await sql<{ id: string }[]>`
      SELECT id FROM "pipeline" WHERE "project_id" = ${projectRow.id} LIMIT 1
    `;
    await sql`DELETE FROM "pipeline_stage" WHERE "pipeline_id" = ${pipelineRow.id}`;
    await sql`
      INSERT INTO "pipeline_stage" (
        "pipeline_id", "name", "sort_order", "gate_mode", "max_retries",
        "driver_id", "timeout_sec"
      )
      VALUES (${pipelineRow.id}, 'research', 10, 'auto', 0, ${driverRow.id}, 30)
    `;

    expect(existsSync(path.join(repoPath, '.git'))).toBe(true);
  } finally {
    await sql.end();
  }
}

async function waitForRunningStage(sql: postgres.Sql, runId: string) {
  await expect
    .poll(
      async () => {
        const [row] = await sql<
          {
            stage_run_id: string;
            child_pid: number | null;
          }[]
        >`
          SELECT sr.id AS stage_run_id,
                 substring(e.payload->>'text' FROM 'FLX86_PID:([0-9]+)')::int AS child_pid
          FROM "stage_run" sr
          LEFT JOIN "event" e ON e.stage_run_id = sr.id
            AND e.type = 'output'
            AND e.payload->>'text' LIKE 'FLX86_PID:%'
          WHERE sr.pipeline_run_id = ${runId}
            AND sr.status = 'running'
          ORDER BY sr.created_at DESC
          LIMIT 1
        `;
        return {
          stageRunId: row?.stage_run_id ?? null,
          childPid: row?.child_pid ?? null,
        };
      },
      {
        timeout: 30_000,
        intervals: [250, 500, 1_000],
        message:
          'stage_run never entered running status with a child pid event',
      }
    )
    .toEqual({
      stageRunId: expect.any(String),
      childPid: expect.any(Number),
    });

  const [row] = await sql<
    {
      stage_run_id: string;
      child_pid: number;
    }[]
  >`
    SELECT sr.id AS stage_run_id,
           substring(e.payload->>'text' FROM 'FLX86_PID:([0-9]+)')::int AS child_pid
    FROM "stage_run" sr
    JOIN "event" e ON e.stage_run_id = sr.id
      AND e.type = 'output'
      AND e.payload->>'text' LIKE 'FLX86_PID:%'
    WHERE sr.pipeline_run_id = ${runId}
    ORDER BY sr.created_at DESC
    LIMIT 1
  `;
  return { stageRunId: row.stage_run_id, childPid: row.child_pid };
}

async function loadDeletedIssueRunState(sql: postgres.Sql, runId: string) {
  const [runRow] = await sql<{ status: string; issue_id: string | null }[]>`
    SELECT status, issue_id FROM "pipeline_run" WHERE id = ${runId}
  `;
  const [issueCount] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM "issue" WHERE id = ${runRow.issue_id}
  `;
  const [runningRows] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM "stage_run"
    WHERE "pipeline_run_id" = ${runId}
      AND "status" = 'running'
  `;
  const [envRow] = await sql<{ status: string; working_path: string }[]>`
    SELECT status, working_path
    FROM "isolation_environment"
    WHERE "run_id" = ${runId}
    ORDER BY "created_at" DESC
    LIMIT 1
  `;
  return {
    issueExists: issueCount.count > 0,
    pipelineStatus: runRow.status,
    runningStageRuns: runningRows.count,
    isolationStatus: envRow?.status ?? null,
    worktreeExists: envRow ? existsSync(envRow.working_path) : null,
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
