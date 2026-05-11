// FLX-85: daemon SIGTERM graceful-drain journey.
//
// The daemon should stop accepting new work on SIGTERM, wait for an in-flight
// stage_run to finish within the configured grace window, and exit cleanly.

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

let targetRepoPath: string | null = null;
let handle: DaemonHandle | null = null;

test.describe('@flx-85 @daemon @journey', () => {
  test.skip(!HAS_DB, 'requires DATABASE_URL or DIRECT_URL');
  test.setTimeout(90_000);

  test.beforeAll(async () => {
    targetRepoPath = createTempGitRepo();

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

    // FLX-221: target_repo_path is a per-project column; set it on the
    // seeded project row before spawning the daemon.
    await configureDrainFixture(targetRepoPath);
    handle = await spawnDaemon({ graceSeconds: 5, shutdownTimeoutMs: 20_000 });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  });

  test.afterAll(async () => {
    if (handle && handle.daemon.exitCode === null) {
      await handle.shutdown().catch(() => undefined);
    }
    if (targetRepoPath) {
      rmSync(targetRepoPath, { recursive: true, force: true });
    }
  });

  test('SIGTERM waits for in-flight stage_run to drain before daemon exit', async () => {
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

      const exited = waitForExit(handle!.daemon);
      handle!.daemon.kill('SIGTERM');
      const exitCode = await exited;
      expect(exitCode).toBe(0);

      const [runningRows] = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM "stage_run" WHERE status = 'running'
      `;
      expect(runningRows.count).toBe(0);

      const [stageAfter] = await sql<{ status: string }[]>`
        SELECT status FROM "stage_run" WHERE id = ${running.stageRunId}
      `;
      expect(stageAfter.status).toBe('completed');
      expect(isProcessAlive(running.childPid)).toBe(false);
    } finally {
      await sql.end();
    }
  });
});

function createTempGitRepo(): string {
  const repoPath = mkdtempSync(path.join(tmpdir(), 'fluxaos-flx85-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoPath });
  writeFileSync(
    path.join(repoPath, '.gitignore'),
    ['.fluxaos-worktrees/', '.fluxaos-artifacts/', '.fluxaos-*', ''].join('\n')
  );
  writeFileSync(path.join(repoPath, 'README.md'), '# FLX-85 fixture\n');
  execFileSync('git', ['add', '.'], { cwd: repoPath });
  execFileSync(
    'git',
    [
      '-c',
      'user.email=flx85@example.test',
      '-c',
      'user.name=FLX85',
      'commit',
      '-m',
      'seed',
    ],
    { cwd: repoPath }
  );
  return repoPath;
}

async function configureDrainFixture(repoPath: string): Promise<void> {
  const sql = postgres(DATABASE_URL!, { max: 2, prepare: false });
  try {
    const [projectRow] = await sql<{ id: string }[]>`
      UPDATE "project"
      SET "repo_url" = 'https://github.com/fluxaos/flx-85-fixture',
          "default_branch" = 'main',
          "worktree_copy_files" = '[]'::jsonb,
          "target_repo_path" = ${repoPath},
          "updated_at" = NOW()
      WHERE "slug" = 'fluxaos'
      RETURNING id
    `;

    const stubScript = [
      "console.log('FLX85_PID:' + process.pid);",
      'setTimeout(() => {',
      "console.log(JSON.stringify({'flux:signal': {verdict: 'proceed', summary: 'FLX-85 drain complete'}}));",
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
        'FLX-85 Stub Driver',
        'flx-85-stub-driver',
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
  return expect
    .poll(
      async () => {
        const [row] = await sql<
          {
            stage_run_id: string;
            child_pid: number | null;
          }[]
        >`
        SELECT sr.id AS stage_run_id,
               substring(e.payload->>'text' FROM 'FLX85_PID:([0-9]+)')::int AS child_pid
        FROM "stage_run" sr
        LEFT JOIN "event" e ON e.stage_run_id = sr.id
          AND e.type = 'output'
          AND e.payload->>'text' LIKE 'FLX85_PID:%'
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
    .not.toMatchObject({ stageRunId: null, childPid: null })
    .then(async () => {
      const [row] = await sql<
        {
          stage_run_id: string;
          child_pid: number;
        }[]
      >`
        SELECT sr.id AS stage_run_id,
               substring(e.payload->>'text' FROM 'FLX85_PID:([0-9]+)')::int AS child_pid
        FROM "stage_run" sr
        JOIN "event" e ON e.stage_run_id = sr.id
          AND e.type = 'output'
          AND e.payload->>'text' LIKE 'FLX85_PID:%'
        WHERE sr.pipeline_run_id = ${runId}
        ORDER BY sr.created_at DESC
        LIMIT 1
      `;
      return { stageRunId: row.stage_run_id, childPid: row.child_pid };
    });
}

function waitForExit(child: NonNullable<DaemonHandle['daemon']>) {
  return new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code));
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
