// FLX-84: daemon rework verdict journey.
//
// Deterministic daemon journey with a DB-configured stub driver. The first
// stage emits a `rework` signal; the engine must move the issue to the
// configured rework state and run the rework stage next.

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

test.describe('@flx-84 @daemon @journey', () => {
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

    // FLX-221: target_repo_path is a per-project column.
    await configureReworkFixture(targetRepoPath);
    handle = await spawnDaemon({ graceSeconds: 5, shutdownTimeoutMs: 20_000 });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  });

  test.afterAll(async () => {
    if (handle) await handle.shutdown().catch(() => undefined);
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
          issueState: 'rework',
          pipelineStatus: 'failed',
          stageRuns: [
            {
              stageName: 'review',
              status: 'completed',
              skillSignal: 'rework',
              gateVerdict: 'rework',
            },
            {
              stageName: 'rework',
              status: 'failed',
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
      WHERE "slug" = 'fluxaos'
      RETURNING id
    `;

    await sql`
      INSERT INTO "config_entry" ("project_id", "key", "value")
      VALUES (${projectRow.id}, 'issues.state.on_rework_key', '"rework"'::jsonb)
      ON CONFLICT ("scope", "project_id", "key")
      DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = NOW()
    `;

    const stubScript = [
      "const prompt = process.argv.join(' ');",
      'const isReworkStage = /\\brework\\b/.test(prompt.toLowerCase());',
      "const verdict = isReworkStage ? 'proceed' : 'rework';",
      "console.log(JSON.stringify({'flux:signal': {verdict, summary: 'FLX-84 stub'}}));",
      'if (isReworkStage) process.exit(1);',
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
        "driver_id", "gate_rules"
      )
      VALUES
        (
          ${pipelineRow.id},
          'review',
          10,
          'rules',
          0,
          ${driverRow.id},
          '{"logic":"AND","rules":[{"field":"skill_signal","operator":"equals","value":"proceed","severity":"required","onFail":"rework","label":"Skill must signal proceed"}]}'::jsonb
        ),
        (${pipelineRow.id}, 'rework', 20, 'auto', 0, ${driverRow.id}, NULL)
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
      skill_signal: string | null;
      gate_verdict: string | null;
    }[]
  >`
    SELECT ps.name AS stage_name, sr.status, sr.skill_signal, sgr.verdict AS gate_verdict
    FROM "stage_run" sr
    JOIN "pipeline_stage" ps ON ps.id = sr.pipeline_stage_id
    LEFT JOIN "stage_gate_result" sgr ON sgr.stage_run_id = sr.id
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
      skillSignal: sr.skill_signal,
      gateVerdict: sr.gate_verdict,
    })),
    isolationStatus: isoRow?.status ?? null,
    worktreeExists: isoRow ? existsSync(isoRow.working_path) : null,
    prCount,
  };
}
