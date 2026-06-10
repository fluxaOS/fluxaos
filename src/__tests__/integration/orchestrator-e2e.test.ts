/**
 * Integration tests: R5-V Orchestrator infrastructure against real Supabase.
 *
 * Tests the command builder, skill materializer, output parser, and
 * orchestrator audit trail — all against the real database.
 *
 * NOT mocks. Every service test hits the real database.
 */
import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fsMaterializerAdapter } from '@/adapters/fs';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import {
  buildCommand,
  type DriverConfig,
  renderTemplate,
} from '@/core/orchestrator/command-builder';
import { createPipelineRunService } from '@/core/orchestrator/pipeline-run-service';
import {
  createOrganizationService,
  createPipelineService,
  createProjectService,
  createUserService,
} from '@/core/services';
import { cleanup, materialize } from '@/core/skills/materializer';
import { deleteOrgFixture } from './cleanup-fixtures';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();

const RUN = Date.now();
let _orgId: string;

afterAll(async () => {
  if (_orgId) await deleteOrgFixture(db, _orgId);
});

// ─── Shared test data ──────────────────────────────────────────────────────

let orgId: string;
let userId: string;
let projectId: string;
let pipelineId: string;
let stageId: string;

beforeAll(async () => {
  const org = await createOrganizationService(db).create({
    name: `OrchTestOrg-${RUN}`,
    settings: {},
  });
  orgId = org.id;
  _orgId = org.id;

  const user = await createUserService(db).create({
    orgId,
    email: `orch-test-${RUN}@test.local`,
    name: 'Orch User',
  });
  userId = user.id;

  const [team] = await db
    .insert(schema.team)
    .values({
      orgId,
      name: `OrchTeam-${RUN}`,
    })
    .returning();

  const project = await createProjectService(db).create({
    orgId,
    teamId: team.id,
    userId,
    name: `OrchProject-${RUN}`,
  });
  projectId = project.id;

  const pipeline = await createPipelineService(db).create({
    projectId,
    name: `Orch Pipeline ${RUN}`,
  });
  pipelineId = pipeline.id;

  const stage = await createPipelineService(db).stages.create({
    pipelineId,
    name: 'test-stage',
    sortOrder: 1,
    gateMode: 'auto',
    maxRetries: 0,
  });
  stageId = stage.id;
});

// ─── Command Builder ─────────────────────────────────────────────────────

describe('command builder', () => {
  const driver: DriverConfig = {
    binary: 'claude',
    defaultArgs: ['--dangerously-skip-permissions'],
    modelFlag: '--model',
    dirFlag: '--add-dir',
    sessionNameFlag: '--session-name',
    promptTransport: 'argv',
    outputFormat: 'stream-json',
    outputFormatFlag: '--output-format',
    issuePromptTemplate: '{{skill_name}}: {{issue_title}}',
    queuePromptTemplate: '{{issue_title}}',
    envVars: { CLAUDE_ENV: 'test' },
  };

  it('builds correct command array from driver config', () => {
    const result = buildCommand(driver, {
      model: 'claude-sonnet-4-20250514',
      workspacePath: '/tmp/test-workspace',
      prompt: 'Test prompt',
      sessionName: 'test-session',
    });

    expect(result.binary).toBe('claude');
    expect(result.args).toContain('--dangerously-skip-permissions');
    expect(result.args).toContain('--model');
    expect(result.args).toContain('claude-sonnet-4-20250514');
    expect(result.args).toContain('--add-dir');
    expect(result.args).toContain('/tmp/test-workspace');
    expect(result.args).toContain('--session-name');
    expect(result.args).toContain('test-session');
    expect(result.env).toEqual({ CLAUDE_ENV: 'test' });
  });

  it('renders template variables correctly', () => {
    const result = renderTemplate(
      '{{skill_name}}: {{issue_title}} ({{issue_number}})',
      {
        skill_name: 'research',
        issue_title: 'Fix the bug',
        issue_number: 42,
      }
    );
    expect(result).toBe('research: Fix the bug (42)');
  });

  it('leaves unknown variables as-is', () => {
    const result = renderTemplate('{{known}} {{unknown}}', {
      skill_name: 'test',
    });
    expect(result).toContain('{{unknown}}');
  });
});

// ─── Skill Materializer ──────────────────────────────────────────────────

describe('skill materializer', () => {
  let workspacePath: string;

  it('creates workspace with skill and context files', async () => {
    workspacePath = await materialize({
      stageRunId: `test-materializer-${RUN}`,
      contextLayout: {
        instructionsFile: 'CLAUDE.md',
        contextFile: 'context.md',
      },
      fs: fsMaterializerAdapter,
      persona: {
        soul: 'You are a helpful assistant.',
        identity: 'Test Identity',
        brandToneOfVoice: 'Professional',
      },
      skill: {
        name: 'research',
        promptTemplate: 'Research the topic thoroughly.',
      },
      issue: {
        number: 1,
        title: 'Test Issue',
        bodyMd: 'This is a test',
        state: 'open',
        priority: 'high',
      },
      projectName: 'Test Project',
    });

    expect(existsSync(workspacePath)).toBe(true);
    expect(existsSync(join(workspacePath, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(workspacePath, 'context.md'))).toBe(true);

    const claudeMd = readFileSync(join(workspacePath, 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toContain('## Skill: research');
    expect(claudeMd).toContain('Research the topic thoroughly.');

    const contextContent = readFileSync(
      join(workspacePath, 'context.md'),
      'utf-8'
    );
    expect(contextContent).toContain('Test Issue');
    expect(contextContent).toContain('#1');
  });

  it('cleans up workspace after cleanup call', async () => {
    expect(existsSync(workspacePath)).toBe(true);
    await cleanup(workspacePath, fsMaterializerAdapter);
    expect(existsSync(workspacePath)).toBe(false);
  });
});

// Output parser coverage moved to src/__tests__/integration/stdout-parser.test.ts
// (exercises the SubprocessStdoutParser adapter via registry.get('stdoutParser')).

// ─── Orchestrator DB operations ──────────────────────────────────────────

describe('orchestrator pipeline run lifecycle', () => {
  let runId: string;
  let stageRunId: string;

  it('creates a pipeline run', async () => {
    const svc = createPipelineRunService(db);
    const run = await svc.createRun(
      pipelineId,
      '00000000-0000-0000-0000-000000000000'
    );
    runId = run.id;
    expect(run.status).toBe('pending');
    expect(run.pipelineId).toBe(pipelineId);
  });

  it('creates a stage run with correct attempt', async () => {
    const svc = createPipelineRunService(db);
    const sr = await svc.createStageRun(runId, stageId);
    stageRunId = sr.id;
    expect(sr.status).toBe('pending');
    expect(sr.pipelineRunId).toBe(runId);
    expect(sr.pipelineStageId).toBe(stageId);
  });

  it('appends events to the audit trail', async () => {
    const svc = createPipelineRunService(db);
    await svc.appendEvent(stageRunId, 'launched', {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      attempt: 1,
    });

    // Verify the event was written
    const events = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.stageRunId, stageRunId));
    const evt = events.find((e) => e.type === 'launched');
    expect(evt).toBeDefined();
    expect(evt?.stageRunId).toBe(stageRunId);
  });

  it('completes a stage run', async () => {
    const svc = createPipelineRunService(db);
    await svc.completeStageRun(stageRunId, 'completed', {
      costUsd: '0.05',
    });

    // Verify the stage run was updated
    const [sr] = await db
      .select()
      .from(schema.stageRun)
      .where(eq(schema.stageRun.id, stageRunId));
    expect(sr.status).toBe('completed');
  });

  it('retrieves events for a stage run', async () => {
    const events = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.stageRunId, stageRunId));
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.type === 'launched')).toBe(true);
  });

  it('completes the pipeline run', async () => {
    const svc = createPipelineRunService(db);
    await svc.completeRun(runId, 'completed');

    const [run] = await db
      .select()
      .from(schema.pipelineRun)
      .where(eq(schema.pipelineRun.id, runId));
    expect(run.status).toBe('completed');
  });
});

// ─── DEF-017: event ordering ───────────────────────────────────────────────

describe('event ordering — DEF-017', () => {
  // Reproduces the symptom from the DEF-011 verification: when the orchestrator
  // fires off many appendEvent inserts without awaiting (the production path),
  // their DB-assigned timestamps can disagree with producer line order.
  // listEvents() must restore monotonic lineNumber ordering for stream events
  // while preserving timestamp chronology for lifecycle events that have no
  // lineNumber.

  let orderingRunId: string;
  let orderingStageRunId: string;

  beforeAll(async () => {
    const svc = createPipelineRunService(db);
    const run = await svc.createRun(
      pipelineId,
      '00000000-0000-0000-0000-000000000000'
    );
    orderingRunId = run.id;

    const sr = await svc.createStageRun(orderingRunId, stageId);
    orderingStageRunId = sr.id;
  });

  it('returns stream events in monotonic lineNumber order even when fired off concurrently', async () => {
    const svc = createPipelineRunService(db);

    // Lifecycle event first (no lineNumber).
    await svc.appendEvent(orderingStageRunId, 'launched', {
      provider: 'test',
      model: 'test-model',
    });

    // 20 stream events fired off concurrently — mirrors stage-runner's
    // fire-and-forget pattern. Without ordering, DB row order is undefined.
    const N = 20;
    await Promise.all(
      Array.from({ length: N }, (_, i) => {
        const lineNumber = i + 1;
        return svc.appendEvent(orderingStageRunId, 'output', {
          id: `out-${lineNumber}`,
          kind: 'text',
          lineNumber,
          text: `line ${lineNumber}`,
        });
      })
    );

    // Trailing lifecycle event (no lineNumber).
    await svc.appendEvent(orderingStageRunId, 'completed', {
      exitCode: 0,
      duration: 123,
    });

    const events = await svc.listEvents(orderingStageRunId);

    expect(events.length).toBe(N + 2);

    // Stream events must come back in monotonic lineNumber order.
    const lineNumbers = events
      .map((e) => (e.payload as { lineNumber?: number }).lineNumber)
      .filter((n): n is number => typeof n === 'number');
    expect(lineNumbers.length).toBe(N);
    const sorted = [...lineNumbers].sort((a, b) => a - b);
    expect(lineNumbers).toEqual(sorted);

    // Lifecycle events (launched/completed) keep their chronological position
    // — the first event must be the leading 'launched', the last must be the
    // trailing 'completed'.
    expect(events[0].type).toBe('launched');
    expect(events[events.length - 1].type).toBe('completed');
  });
});
