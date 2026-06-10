// FLX-84: daemon rework verdict journey.
//
// Deterministic daemon journey with a DB-configured stub driver. The review
// stage writes a result doc with verdict 'fail'; the engine must map that to
// the rework verdict, route via the stage's on_fail to the rework stage, run
// it to completion (verdict 'pass' + on_pass '__complete__'), and clean up
// the isolation env. (FLX-239 Stage 7: rewritten for the result-doc verdict
// contract — the legacy flux:signal/skill_signal gate path has no consumer
// in the modern engine.)

import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { type DaemonHandle, spawnDaemon } from './helpers/daemon';
import {
  readSeedProjectTargetRepoPath,
  resetDb,
  writeSeedProjectTargetRepoPath,
} from './helpers/reset-db';
import { expect, test } from './helpers/setup';

const DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const HAS_DB = !!DATABASE_URL;

let targetRepoPath: string | null = null;
let operatorTargetRepoPath: string | null = null;
let handle: DaemonHandle | null = null;

test.describe('@flx-84 @daemon @journey', () => {
  test.skip(!HAS_DB, 'requires DATABASE_URL or DIRECT_URL');
  test.setTimeout(90_000);

  test.beforeAll(async () => {
    targetRepoPath = createTempGitRepo();

    await resetDb();
    // The fixture points the seed project at a temp repo; capture the
    // operator's value so afterAll can restore it for later suite specs.
    operatorTargetRepoPath = await readSeedProjectTargetRepoPath();

    // FLX-221: target_repo_path is a per-project column.
    await configureReworkFixture(targetRepoPath);
    handle = await spawnDaemon({ graceSeconds: 5, shutdownTimeoutMs: 20_000 });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  });

  test.afterAll(async () => {
    if (handle) await handle.shutdown().catch(() => undefined);
    // Restore the operator's target repo path — the temp fixture dir is
    // deleted below and must not leak into later suite specs.
    await writeSeedProjectTargetRepoPath(operatorTargetRepoPath).catch(
      () => undefined
    );
    if (targetRepoPath) {
      rmSync(targetRepoPath, { recursive: true, force: true });
    }
  });

  test('daemon follows rework verdict into the rework stage and cleans up', async () => {
    const sql = postgres(DATABASE_URL!, { max: 2, prepare: false });
    try {
      const [issueRow] = await sql<
        { id: string; project_id: string; state_key: string }[]
      >`
        SELECT i.id, i.project_id, s.key AS state_key
        FROM "issue" i
        JOIN "issue_state" s ON s.id = i.state_id
        WHERE i.number = 1
        LIMIT 1
      `;
      expect(issueRow?.state_key).toBe('review');

      const [pipelineRow] = await sql<{ id: string }[]>`
        SELECT id FROM "pipeline" WHERE project_id = ${issueRow.project_id} LIMIT 1
      `;

      const [runRow] = await sql<{ id: string }[]>`
        INSERT INTO "pipeline_run" ("pipeline_id", "issue_id", "status")
        VALUES (${pipelineRow.id}, ${issueRow.id}, 'pending')
        RETURNING id
      `;

      await expect
        .poll(() => loadReworkJourneyState(sql, runRow.id, issueRow.id), {
          timeout: 45_000,
          intervals: [500, 1_000, 2_000],
          message:
            'daemon did not run review → rework stage sequence after rework verdict',
        })
        .toMatchObject({
          pipelineStatus: 'completed',
          stageRuns: [
            {
              stageName: 'review',
              status: 'completed',
              resultVerdict: 'fail',
            },
            {
              stageName: 'rework',
              status: 'completed',
              resultVerdict: 'pass',
            },
          ],
          isolationStatus: 'inactive',
          worktreeExists: false,
          prCount: 0,
        });

      expect(handle?.daemon.exitCode, 'daemon died mid-run').toBeNull();
    } finally {
      await sql.end();
    }
  });
});

function createTempGitRepo(): string {
  const repoPath = mkdtempSync(path.join(tmpdir(), 'fluxaos-flx84-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoPath });
  writeFileSync(
    path.join(repoPath, '.gitignore'),
    ['.fluxaos-worktrees/', '.fluxaos-artifacts/', '.fluxaos-*', ''].join('\n')
  );
  writeFileSync(path.join(repoPath, 'README.md'), '# FLX-84 fixture\n');
  execFileSync('git', ['add', '.'], { cwd: repoPath });
  execFileSync(
    'git',
    [
      '-c',
      'user.email=flx84@example.test',
      '-c',
      'user.name=FLX84',
      'commit',
      '-m',
      'seed',
    ],
    { cwd: repoPath }
  );
  return repoPath;
}

async function configureReworkFixture(repoPath: string): Promise<void> {
  const sql = postgres(DATABASE_URL!, { max: 2, prepare: false });
  try {
    const [projectRow] = await sql<{ id: string }[]>`
      UPDATE "project"
      SET "repo_url" = 'https://github.com/fluxaos/flx-84-fixture',
          "default_branch" = 'main',
          "worktree_copy_files" = '[]'::jsonb,
          "target_repo_path" = ${repoPath},
          "updated_at" = NOW()
      WHERE "id" = '00000000-0000-4000-8000-000000000001'
      RETURNING id
    `;

    // Modern verdict contract: the driver updates the result doc that
    // init-result-doc seeded at RESULT_DOC_PATH. doc.run.stage is the
    // authoritative stage discriminator (prompt content is persona-composed
    // and unreliable for matching). review -> 'fail' (routes via on_fail),
    // rework -> 'pass' (routes via on_pass '__complete__').
    const stubScript = [
      "const fs = require('node:fs');",
      'const p = process.env.RESULT_DOC_PATH;',
      "const doc = JSON.parse(fs.readFileSync(p, 'utf8'));",
      "const isReworkStage = doc.run.stage === 'rework';",
      "doc.verdict = isReworkStage ? 'pass' : 'fail';",
      "doc.summary = 'FLX-84 stub verdict for stage ' + doc.run.stage;",
      'fs.writeFileSync(p, JSON.stringify(doc, null, 2));',
    ].join('');

    const [driverRow] = await sql<{ id: string }[]>`
      INSERT INTO "driver" (
        "name", "slug", "binary", "default_args", "model_flag", "dir_flag",
        "session_name_flag", "prompt_transport", "output_format",
        "output_format_flag", "issue_prompt_template",
        "queue_prompt_template", "context_layout"
      )
      VALUES (
        'FLX-84 Stub Driver',
        'flx-84-stub-driver',
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
      ON CONFLICT ("slug")
      DO UPDATE SET
        "default_args" = EXCLUDED."default_args",
        "issue_prompt_template" = EXCLUDED."issue_prompt_template",
        "updated_at" = NOW()
      RETURNING id
    `;

    const [pipelineRow] = await sql<{ id: string }[]>`
      SELECT id FROM "pipeline" WHERE "project_id" = ${projectRow.id} LIMIT 1
    `;
    await sql`DELETE FROM "pipeline_stage" WHERE "pipeline_id" = ${pipelineRow.id}`;
    await sql`
      INSERT INTO "pipeline_stage" (
        "pipeline_id", "name", "sort_order", "gate_mode", "max_retries",
        "driver_id", "persona_id", "on_fail", "on_pass"
      )
      VALUES
        (
          ${pipelineRow.id}, 'review', 10, 'auto', 0, ${driverRow.id},
          (SELECT id FROM "persona" WHERE "project_id" = ${projectRow.id} LIMIT 1),
          'rework',
          NULL
        ),
        (
          ${pipelineRow.id}, 'rework', 20, 'auto', 0, ${driverRow.id},
          (SELECT id FROM "persona" WHERE "project_id" = ${projectRow.id} LIMIT 1),
          NULL,
          '__complete__'
        )
    `;

    await sql`
      UPDATE "issue"
      SET "state_id" = (
        SELECT id FROM "issue_state"
        WHERE "project_id" = ${projectRow.id} AND "key" = 'review'
        LIMIT 1
      ),
      "version" = "version" + 1,
      "updated_at" = NOW()
      WHERE "project_id" = ${projectRow.id} AND "number" = 1
    `;

    expect(existsSync(path.join(repoPath, '.git'))).toBe(true);
  } finally {
    await sql.end();
  }
}

async function loadReworkJourneyState(
  sql: postgres.Sql,
  runId: string,
  issueId: string
) {
  const [runRow] = await sql<{ status: string }[]>`
    SELECT status FROM "pipeline_run" WHERE id = ${runId}
  `;
  const [issueRow] = await sql<{ state_key: string }[]>`
    SELECT s.key AS state_key
    FROM "issue" i
    JOIN "issue_state" s ON s.id = i.state_id
    WHERE i.id = ${issueId}
  `;
  const stageRuns = await sql<
    {
      stage_name: string;
      status: string;
      result_verdict: string | null;
    }[]
  >`
    SELECT ps.name AS stage_name, sr.status,
           sr.result_doc->>'verdict' AS result_verdict
    FROM "stage_run" sr
    JOIN "pipeline_stage" ps ON ps.id = sr.pipeline_stage_id
    WHERE sr.pipeline_run_id = ${runId}
    ORDER BY sr.created_at ASC
  `;
  const [isoRow] = await sql<{ status: string; working_path: string }[]>`
    SELECT status, working_path
    FROM "isolation_environment"
    WHERE run_id = ${runId}
    LIMIT 1
  `;
  const [{ count: prCount }] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM "issue_pull_request" WHERE issue_id = ${issueId}
  `;

  return {
    issueState: issueRow?.state_key ?? null,
    pipelineStatus: runRow?.status ?? null,
    stageRuns: stageRuns.map((sr) => ({
      stageName: sr.stage_name,
      status: sr.status,
      resultVerdict: sr.result_verdict,
    })),
    isolationStatus: isoRow?.status ?? null,
    worktreeExists: isoRow ? existsSync(isoRow.working_path) : null,
    prCount,
  };
}
