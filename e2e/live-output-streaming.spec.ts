// FLX-25: LiveOutput should append Realtime INSERT payloads while a stage runs.

import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Locator } from '@playwright/test';
import postgres from 'postgres';
import { type DaemonHandle, spawnDaemon } from './helpers/daemon';
import {
  readSeedProjectTargetRepoPath,
  resetDb,
  writeSeedProjectTargetRepoPath,
} from './helpers/reset-db';
import { expect, projectPath, test } from './helpers/setup';

const DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const HAS_DB = !!DATABASE_URL;

let targetRepoPath: string | null = null;
let operatorTargetRepoPath: string | null = null;
let handle: DaemonHandle | null = null;

test.describe('@flx-25 @ui @daemon @realtime', () => {
  test.skip(!HAS_DB, 'requires DATABASE_URL or DIRECT_URL');
  test.setTimeout(90_000);

  test.beforeAll(async () => {
    targetRepoPath = createTempGitRepo();

    await resetDb();
    // The fixture points the seed project at a temp repo; capture the
    // operator's value so afterAll can restore it for later suite specs.
    operatorTargetRepoPath = await readSeedProjectTargetRepoPath();

    // FLX-221: target_repo_path is a per-project column.
    await configureStreamingFixture(targetRepoPath);
    handle = await spawnDaemon({ graceSeconds: 5, shutdownTimeoutMs: 20_000 });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  });

  test.afterAll(async () => {
    if (handle && handle.daemon.exitCode === null) {
      await handle.shutdown().catch(() => undefined);
    }
    // Restore the operator's target repo path — the temp fixture dir is
    // deleted below and must not leak into later suite specs.
    await writeSeedProjectTargetRepoPath(operatorTargetRepoPath).catch(
      () => undefined
    );
    if (targetRepoPath) {
      rmSync(targetRepoPath, { recursive: true, force: true });
    }
  });

  test('LiveOutput shows stdout events before the run completes', async ({
    page,
  }) => {
    const sql = postgres(DATABASE_URL!, { max: 2, prepare: false });
    try {
      await page.goto(projectPath('/issues/1'));
      await expect(
        page.getByRole('heading', { name: /Add health check endpoint/ })
      ).toBeVisible({ timeout: 15_000 });

      await page.getByRole('button', { name: /Run Stage/ }).click();
      await expect(page.getByText(/Pipeline Run/i).first()).toBeVisible({
        timeout: 15_000,
      });

      const running = await waitForRunningStage(sql);
      const pane = page.getByTestId('live-output-pane');

      await expect
        .poll(() => loadLiveOutputState(sql, pane, running.runId), {
          timeout: 5_000,
          intervals: [250, 500, 1_000],
          message: 'first stdout line did not stream while run was active',
        })
        .toMatchObject({
          pipelineStatus: 'running',
          hasFirstLine: true,
        });

      await expect
        .poll(() => loadLiveOutputState(sql, pane, running.runId), {
          timeout: 5_000,
          intervals: [250, 500, 1_000],
          message: 'second stdout line did not stream while run was active',
        })
        .toMatchObject({
          pipelineStatus: 'running',
          hasFirstLine: true,
          hasSecondLine: true,
        });

      expect(handle?.daemon.exitCode, 'daemon died during streaming test').toBe(
        null
      );
    } finally {
      await sql.end();
    }
  });
});

function createTempGitRepo(): string {
  const repoPath = mkdtempSync(path.join(tmpdir(), 'fluxaos-flx25-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoPath });
  writeFileSync(
    path.join(repoPath, '.gitignore'),
    ['.fluxaos-worktrees/', '.fluxaos-artifacts/', '.fluxaos-*', ''].join('\n')
  );
  writeFileSync(path.join(repoPath, 'README.md'), '# FLX-25 fixture\n');
  execFileSync('git', ['add', '.'], { cwd: repoPath });
  execFileSync(
    'git',
    [
      '-c',
      'user.email=flx25@example.test',
      '-c',
      'user.name=FLX25',
      'commit',
      '-m',
      'seed',
    ],
    { cwd: repoPath }
  );
  return repoPath;
}

async function configureStreamingFixture(repoPath: string): Promise<void> {
  const sql = postgres(DATABASE_URL!, { max: 2, prepare: false });
  try {
    const [projectRow] = await sql<{ id: string }[]>`
      UPDATE "project"
      SET "repo_url" = 'https://github.com/fluxaos/flx-25-fixture',
          "default_branch" = 'main',
          "worktree_copy_files" = '[]'::jsonb,
          "target_repo_path" = ${repoPath},
          "updated_at" = NOW()
      WHERE "slug" = 'fluxaos'
      RETURNING id
    `;

    const stubScript = [
      "console.log('FLX25_STREAM_1');",
      "setTimeout(() => console.log('FLX25_STREAM_2'), 1500);",
      'setTimeout(() => {',
      "console.log(JSON.stringify({'flux:signal': {verdict: 'proceed', summary: 'FLX-25 complete'}}));",
      '}, 6000);',
    ].join('');

    const [driverRow] = await sql<{ id: string }[]>`
      INSERT INTO "driver" (
        "name", "slug", "binary", "default_args", "model_flag", "dir_flag",
        "session_name_flag", "prompt_transport", "output_format",
        "output_format_flag", "issue_prompt_template",
        "queue_prompt_template", "context_layout"
      )
      VALUES (
        'FLX-25 Stub Driver',
        'flx-25-stub-driver',
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
        "driver_id", "timeout_sec", "persona_id"
      )
      VALUES (
        ${pipelineRow.id}, 'research', 10, 'auto', 0, ${driverRow.id}, 30,
        (SELECT id FROM "persona" WHERE "project_id" = ${projectRow.id} LIMIT 1)
      )
    `;
  } finally {
    await sql.end();
  }
}

async function waitForRunningStage(sql: postgres.Sql) {
  await expect
    .poll(
      async () => {
        const [row] = await sql<{ run_id: string; stage_run_id: string }[]>`
          SELECT pr.id AS run_id,
                 sr.id AS stage_run_id
          FROM "pipeline_run" pr
          JOIN "stage_run" sr ON sr.pipeline_run_id = pr.id
          WHERE pr.status = 'running'
            AND sr.status = 'running'
          ORDER BY sr.created_at DESC
          LIMIT 1
        `;
        return {
          runId: row?.run_id ?? null,
          stageRunId: row?.stage_run_id ?? null,
        };
      },
      {
        timeout: 30_000,
        intervals: [250, 500, 1_000],
        message: 'stage_run never reached running',
      }
    )
    .toEqual({
      runId: expect.any(String),
      stageRunId: expect.any(String),
    });

  const [row] = await sql<{ run_id: string; stage_run_id: string }[]>`
    SELECT pr.id AS run_id,
           sr.id AS stage_run_id
    FROM "pipeline_run" pr
    JOIN "stage_run" sr ON sr.pipeline_run_id = pr.id
    WHERE pr.status = 'running'
      AND sr.status = 'running'
    ORDER BY sr.created_at DESC
    LIMIT 1
  `;
  return {
    runId: row.run_id,
    stageRunId: row.stage_run_id,
  };
}

async function loadLiveOutputState(
  sql: postgres.Sql,
  pane: Locator,
  runId: string
) {
  const text = await pane.textContent().catch(() => '');
  const [runRow] = await sql<{ status: string }[]>`
    SELECT status FROM "pipeline_run" WHERE id = ${runId}
  `;
  return {
    pipelineStatus: runRow.status,
    hasFirstLine: (text ?? '').includes('FLX25_STREAM_1'),
    hasSecondLine: (text ?? '').includes('FLX25_STREAM_2'),
  };
}
