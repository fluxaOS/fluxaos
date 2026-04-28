// FLX-87: daemon journey for a deploy push conflict.

import 'dotenv/config';
import { execFileSync, execSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
let bareRemotePath: string | null = null;
let handle: DaemonHandle | null = null;

test.describe('@flx-87 @daemon @deploy @journey', () => {
  test.skip(!HAS_DB, 'requires DATABASE_URL or DIRECT_URL');
  test.setTimeout(90_000);

  test.beforeAll(async () => {
    const repos = createTempGitRepoWithBareRemote();
    targetRepoPath = repos.targetRepoPath;
    bareRemotePath = repos.bareRemotePath;
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

    await configureDeployConflictFixture();
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
    if (bareRemotePath) {
      rmSync(bareRemotePath, { recursive: true, force: true });
    }
  });

  test('deploy push conflict fails the stage/run and releases the worktree', async () => {
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

      const activeEnv = await waitForActiveEnv(sql, runRow.id);
      const remoteConflictSha = createRemoteConflictBranch(
        bareRemotePath!,
        activeEnv.branchName
      );

      await expect
        .poll(() => loadDeployConflictState(sql, runRow.id), {
          timeout: 45_000,
          intervals: [500, 1_000, 2_000],
          message: 'deploy conflict did not fail and clean up the run',
        })
        .toMatchObject({
          pipelineStatus: 'failed',
          latestStageStatus: 'failed',
          isolationStatus: 'inactive',
          worktreeExists: false,
          branchRows: 0,
          pullRequestRows: 0,
        });

      const finalState = await loadDeployConflictState(sql, runRow.id);
      expect(finalState.latestStageError).toContain('deploy failed: git push');
      expect(readRemoteBranchSha(bareRemotePath!, activeEnv.branchName)).toBe(
        remoteConflictSha
      );
      expect(
        handle?.daemon.exitCode,
        'daemon died during deploy conflict'
      ).toBe(null);
    } finally {
      await sql.end();
    }
  });
});

function createTempGitRepoWithBareRemote(): {
  targetRepoPath: string;
  bareRemotePath: string;
} {
  const bareRemote = mkdtempSync(path.join(tmpdir(), 'fluxaos-flx87-remote-'));
  execFileSync('git', ['init', '--bare', '-b', 'main'], { cwd: bareRemote });

  const repoPath = mkdtempSync(path.join(tmpdir(), 'fluxaos-flx87-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoPath });
  execFileSync('git', ['remote', 'add', 'origin', bareRemote], {
    cwd: repoPath,
  });
  writeFileSync(
    path.join(repoPath, '.gitignore'),
    ['.fluxaos-worktrees/', '.fluxaos-artifacts/', '.fluxaos-*', ''].join('\n')
  );
  writeFileSync(path.join(repoPath, 'README.md'), '# FLX-87 fixture\n');
  execFileSync('git', ['add', '.'], { cwd: repoPath });
  execFileSync(
    'git',
    [
      '-c',
      'user.email=flx87@example.test',
      '-c',
      'user.name=FLX87',
      'commit',
      '-m',
      'seed',
    ],
    { cwd: repoPath }
  );
  execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: repoPath });
  return { targetRepoPath: repoPath, bareRemotePath: bareRemote };
}

async function configureDeployConflictFixture(): Promise<void> {
  const sql = postgres(DATABASE_URL!, { max: 2, prepare: false });
  try {
    const [projectRow] = await sql<{ id: string }[]>`
      UPDATE "project"
      SET "repo_url" = 'https://github.com/fluxaos/flx-87-fixture',
          "default_branch" = 'main',
          "worktree_copy_files" = '[]'::jsonb,
          "updated_at" = NOW()
      WHERE "slug" = 'fluxaos'
      RETURNING id
    `;

    const stubScript = [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      'const workspace = process.argv.at(-1);',
      "fs.writeFileSync(path.join(workspace, 'flx87-deploy.txt'), 'local deploy change\\n');",
      "console.log('FLX87_WORKSPACE:' + workspace);",
      'setTimeout(() => {',
      "console.log(JSON.stringify({'flux:signal': {verdict: 'proceed', summary: 'FLX-87 deploy should conflict'}}));",
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
        'FLX-87 Stub Driver',
        'flx-87-stub-driver',
        'node',
        ${JSON.stringify(['-e', stubScript])}::jsonb,
        NULL,
        NULL,
        NULL,
        'argv',
        'text',
        NULL,
        '{{workspace_path}}',
        '{{workspace_path}}',
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
      VALUES (${pipelineRow.id}, 'implement', 10, 'auto', 0, ${driverRow.id}, 30)
    `;
  } finally {
    await sql.end();
  }
}

async function waitForActiveEnv(sql: postgres.Sql, runId: string) {
  await expect
    .poll(
      async () => {
        const [row] = await sql<
          { id: string; branch_name: string; working_path: string }[]
        >`
          SELECT id, branch_name, working_path
          FROM "isolation_environment"
          WHERE "run_id" = ${runId}
            AND "status" = 'active'
          ORDER BY "created_at" DESC
          LIMIT 1
        `;
        return {
          id: row?.id ?? null,
          branchName: row?.branch_name ?? null,
          workingPath: row?.working_path ?? null,
        };
      },
      {
        timeout: 30_000,
        intervals: [250, 500, 1_000],
        message: 'daemon never acquired an active isolation env',
      }
    )
    .toEqual({
      id: expect.any(String),
      branchName: expect.any(String),
      workingPath: expect.any(String),
    });

  const [row] = await sql<
    { id: string; branch_name: string; working_path: string }[]
  >`
    SELECT id, branch_name, working_path
    FROM "isolation_environment"
    WHERE "run_id" = ${runId}
      AND "status" = 'active'
    ORDER BY "created_at" DESC
    LIMIT 1
  `;
  return {
    id: row.id,
    branchName: row.branch_name,
    workingPath: row.working_path,
  };
}

function createRemoteConflictBranch(
  remotePath: string,
  branchName: string
): string {
  const clonePath = mkdtempSync(path.join(tmpdir(), 'fluxaos-flx87-conflict-'));
  execFileSync('git', ['clone', remotePath, clonePath]);
  execFileSync('git', ['checkout', '-b', branchName, 'origin/main'], {
    cwd: clonePath,
  });
  writeFileSync(
    path.join(clonePath, 'remote-conflict.txt'),
    `remote conflict for ${branchName}\n`
  );
  execFileSync('git', ['add', 'remote-conflict.txt'], { cwd: clonePath });
  execFileSync(
    'git',
    [
      '-c',
      'user.email=flx87@example.test',
      '-c',
      'user.name=FLX87',
      'commit',
      '-m',
      'remote conflict',
    ],
    { cwd: clonePath }
  );
  execFileSync('git', ['push', 'origin', branchName], { cwd: clonePath });
  const sha = execFileSync('git', ['rev-parse', branchName], {
    cwd: clonePath,
    encoding: 'utf8',
  }).trim();
  rmSync(clonePath, { recursive: true, force: true });
  return sha;
}

async function loadDeployConflictState(sql: postgres.Sql, runId: string) {
  const [runRow] = await sql<{ status: string; issue_id: string | null }[]>`
    SELECT status, issue_id FROM "pipeline_run" WHERE id = ${runId}
  `;
  const [stageRow] = await sql<
    { status: string; error_message: string | null }[]
  >`
    SELECT status, error_message
    FROM "stage_run"
    WHERE "pipeline_run_id" = ${runId}
    ORDER BY "created_at" DESC
    LIMIT 1
  `;
  const [envRow] = await sql<{ status: string; working_path: string }[]>`
    SELECT status, working_path
    FROM "isolation_environment"
    WHERE "run_id" = ${runId}
    ORDER BY "created_at" DESC
    LIMIT 1
  `;
  const [branchRow] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM "issue_branch"
    WHERE "issue_id" = ${runRow.issue_id}
  `;
  const [pullRequestRow] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM "issue_pull_request"
    WHERE "issue_id" = ${runRow.issue_id}
  `;
  return {
    pipelineStatus: runRow.status,
    latestStageStatus: stageRow?.status ?? null,
    latestStageError: stageRow?.error_message ?? null,
    isolationStatus: envRow?.status ?? null,
    worktreeExists: envRow ? existsSync(envRow.working_path) : null,
    branchRows: branchRow.count,
    pullRequestRows: pullRequestRow.count,
  };
}

function readRemoteBranchSha(remotePath: string, branchName: string): string {
  const refPath = path.join(
    remotePath,
    'refs',
    'heads',
    ...branchName.split('/')
  );
  if (existsSync(refPath)) return readFileSync(refPath, 'utf8').trim();
  return execFileSync('git', ['rev-parse', branchName], {
    cwd: remotePath,
    encoding: 'utf8',
  }).trim();
}
