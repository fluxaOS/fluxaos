/**
 * Integration tests: Gate Engine against real Supabase Postgres.
 *
 * Tests the pure engine (all operators, AND/OR groups, severity, nesting)
 * AND the service layer (DB read, audit persistence).
 *
 * NOT mocks. Every service test hits the real database.
 */
import 'dotenv/config';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import {
  createOrganizationService,
  createProjectService,
  createUserService,
  createPipelineService,
} from '@/core/services';
import { createGateService } from '@/core/gates/service';
import { evaluateGate } from '@/core/gates/engine';
import type { Rule, RuleGroup, GateMode } from '@/core/gates/types';
import * as schema from '@/core/db/schema';
import type { Database } from '@/core/db/connection';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();

const RUN = Date.now();
const cleanup: { table: string; id: string }[] = [];

const tableMap: Record<string, any> = {
  stageGateResult: schema.stageGateResult,
  stageRun: schema.stageRun,
  pipelineRun: schema.pipelineRun,
  pipelineStage: schema.pipelineStage,
  pipeline: schema.pipeline,
  project: schema.project,
  user: schema.user,
  organization: schema.organization,
};

afterAll(async () => {
  for (const { table, id } of cleanup.reverse()) {
    const t = tableMap[table];
    if (t) await db.delete(t).where(eq(t.id, id)).catch(() => {});
  }
});

// ─── Shared test data ──────────────────────────────────────────────────────

let orgId: string;
let userId: string;
let projectId: string;
let pipelineId: string;
let stageAutoId: string;
let stageRulesId: string;
let stageHoldId: string;
let pipelineRunId: string;
let stageRunId: string;

beforeAll(async () => {
  // Create test org → user → project → pipeline → stages → pipeline run → stage run
  const orgSvc = createOrganizationService(db);
  const org = await orgSvc.create({
    name: `GateTestOrg-${RUN}`,
    slug: `gate-test-org-${RUN}`,
    settings: {},
  });
  orgId = org.id;
  cleanup.push({ table: 'organization', id: orgId });

  const userSvc = createUserService(db);
  const usr = await userSvc.create({
    orgId,
    email: `gate-test-${RUN}@test.local`,
    name: 'Gate Tester',
    slug: `gate-tester-${RUN}`,
  });
  userId = usr.id;
  cleanup.push({ table: 'user', id: userId });

  const projSvc = createProjectService(db);
  const proj = await projSvc.create({
    orgId,
    userId,
    name: `GateTestProject-${RUN}`,
    slug: `gate-test-project-${RUN}`,
  });
  projectId = proj.id;
  cleanup.push({ table: 'project', id: projectId });

  // Pipeline
  const [pipe] = await db
    .insert(schema.pipeline)
    .values({
      projectId,
      name: `GatePipeline-${RUN}`,
      isDefault: true,
    })
    .returning();
  pipelineId = pipe.id;
  cleanup.push({ table: 'pipeline', id: pipelineId });

  // Stages with different gate modes
  const costRule: RuleGroup = {
    logic: 'AND',
    rules: [
      {
        field: 'cost_usd',
        operator: 'less_than',
        value: 10,
        severity: 'required',
        onFail: 'hold',
        label: 'Cost cap',
      },
      {
        field: 'exit_code',
        operator: 'equals',
        value: 0,
        severity: 'required',
        onFail: 'rework',
        label: 'Clean exit',
      },
    ],
  };

  const [sAuto] = await db
    .insert(schema.pipelineStage)
    .values({
      pipelineId,
      name: `stage-auto-${RUN}`,
      sortOrder: 1,
      gateMode: 'auto',
      gateRules: [],
    })
    .returning();
  stageAutoId = sAuto.id;
  cleanup.push({ table: 'pipelineStage', id: stageAutoId });

  const [sRules] = await db
    .insert(schema.pipelineStage)
    .values({
      pipelineId,
      name: `stage-rules-${RUN}`,
      sortOrder: 2,
      gateMode: 'rules',
      gateRules: costRule,
    })
    .returning();
  stageRulesId = sRules.id;
  cleanup.push({ table: 'pipelineStage', id: stageRulesId });

  const [sHold] = await db
    .insert(schema.pipelineStage)
    .values({
      pipelineId,
      name: `stage-hold-${RUN}`,
      sortOrder: 3,
      gateMode: 'hold',
      gateRules: [],
    })
    .returning();
  stageHoldId = sHold.id;
  cleanup.push({ table: 'pipelineStage', id: stageHoldId });

  // Pipeline run + stage run (for audit trail)
  const [pRun] = await db
    .insert(schema.pipelineRun)
    .values({ pipelineId, status: 'running' })
    .returning();
  pipelineRunId = pRun.id;
  cleanup.push({ table: 'pipelineRun', id: pipelineRunId });

  const [sRun] = await db
    .insert(schema.stageRun)
    .values({
      pipelineRunId,
      pipelineStageId: stageRulesId,
      status: 'queued',
    })
    .returning();
  stageRunId = sRun.id;
  cleanup.push({ table: 'stageRun', id: stageRunId });
});

// ═══════════════════════════════════════════════════════════════════════════
// Pure Engine Tests (no DB)
// ═══════════════════════════════════════════════════════════════════════════

describe('gate engine — operators', () => {
  const makeRule = (
    field: string,
    operator: Rule['operator'],
    value: unknown,
  ): RuleGroup => ({
    logic: 'AND',
    rules: [{ field, operator, value, severity: 'required', onFail: 'hold' }],
  });

  it('equals: passes on match', () => {
    const r = evaluateGate('rules', makeRule('status', 'equals', 'ok'), {
      status: 'ok',
    });
    expect(r.passed).toBe(true);
    expect(r.verdict).toBe('proceed');
  });

  it('equals: fails on mismatch', () => {
    const r = evaluateGate('rules', makeRule('status', 'equals', 'ok'), {
      status: 'fail',
    });
    expect(r.passed).toBe(false);
  });

  it('equals: numeric string comparison', () => {
    const r = evaluateGate('rules', makeRule('count', 'equals', 5), {
      count: '5',
    });
    expect(r.passed).toBe(true);
  });

  it('not_equals: passes on mismatch', () => {
    const r = evaluateGate('rules', makeRule('x', 'not_equals', 'bad'), {
      x: 'good',
    });
    expect(r.passed).toBe(true);
  });

  it('less_than: numeric comparison', () => {
    const r = evaluateGate('rules', makeRule('cost', 'less_than', 10), {
      cost: 5.5,
    });
    expect(r.passed).toBe(true);
  });

  it('less_than: fails when equal', () => {
    const r = evaluateGate('rules', makeRule('cost', 'less_than', 10), {
      cost: 10,
    });
    expect(r.passed).toBe(false);
  });

  it('greater_than: numeric comparison', () => {
    const r = evaluateGate('rules', makeRule('score', 'greater_than', 80), {
      score: 95,
    });
    expect(r.passed).toBe(true);
  });

  it('contains: string includes substring', () => {
    const r = evaluateGate('rules', makeRule('output', 'contains', 'success'), {
      output: 'build success — 0 errors',
    });
    expect(r.passed).toBe(true);
  });

  it('contains: array includes element', () => {
    const r = evaluateGate('rules', makeRule('tags', 'contains', 'reviewed'), {
      tags: ['tested', 'reviewed', 'approved'],
    });
    expect(r.passed).toBe(true);
  });

  it('matches: regex', () => {
    const r = evaluateGate('rules', makeRule('version', 'matches', '^v\\d+\\.\\d+'), {
      version: 'v2.3',
    });
    expect(r.passed).toBe(true);
  });

  it('matches: fails on invalid regex (no crash)', () => {
    const r = evaluateGate('rules', makeRule('x', 'matches', '[invalid'), {
      x: 'test',
    });
    expect(r.passed).toBe(false);
  });

  it('in: value in array', () => {
    const rules: RuleGroup = {
      logic: 'AND',
      rules: [{
        field: 'env',
        operator: 'in',
        value: ['staging', 'production'],
        severity: 'required',
        onFail: 'hold',
      }],
    };
    const r = evaluateGate('rules', rules, { env: 'staging' });
    expect(r.passed).toBe(true);
  });

  it('in: value not in array', () => {
    const rules: RuleGroup = {
      logic: 'AND',
      rules: [{
        field: 'env',
        operator: 'in',
        value: ['staging', 'production'],
        severity: 'required',
        onFail: 'hold',
      }],
    };
    const r = evaluateGate('rules', rules, { env: 'dev' });
    expect(r.passed).toBe(false);
  });

  it('exists: field present', () => {
    const r = evaluateGate('rules', makeRule('output', 'exists', null), {
      output: 'some data',
    });
    expect(r.passed).toBe(true);
  });

  it('exists: field missing', () => {
    const r = evaluateGate('rules', makeRule('output', 'exists', null), {});
    expect(r.passed).toBe(false);
  });

  it('exists: field null fails', () => {
    const r = evaluateGate('rules', makeRule('output', 'exists', null), {
      output: null,
    });
    expect(r.passed).toBe(false);
  });
});

describe('gate engine — dot-path field resolution', () => {
  it('resolves nested fields', () => {
    const rules: RuleGroup = {
      logic: 'AND',
      rules: [{
        field: 'output.tests.passed',
        operator: 'equals',
        value: true,
        severity: 'required',
        onFail: 'hold',
      }],
    };
    const r = evaluateGate('rules', rules, {
      output: { tests: { passed: true } },
    });
    expect(r.passed).toBe(true);
  });

  it('undefined for missing nested path', () => {
    const rules: RuleGroup = {
      logic: 'AND',
      rules: [{
        field: 'output.deep.missing',
        operator: 'exists',
        severity: 'required',
        onFail: 'hold',
      }],
    };
    const r = evaluateGate('rules', rules, { output: {} });
    expect(r.passed).toBe(false);
  });
});

describe('gate engine — AND/OR groups', () => {
  it('AND: all must pass', () => {
    const rules: RuleGroup = {
      logic: 'AND',
      rules: [
        { field: 'a', operator: 'equals', value: 1, severity: 'required', onFail: 'hold' },
        { field: 'b', operator: 'equals', value: 2, severity: 'required', onFail: 'hold' },
      ],
    };
    expect(evaluateGate('rules', rules, { a: 1, b: 2 }).passed).toBe(true);
    expect(evaluateGate('rules', rules, { a: 1, b: 99 }).passed).toBe(false);
  });

  it('OR: any can pass', () => {
    const rules: RuleGroup = {
      logic: 'OR',
      rules: [
        { field: 'a', operator: 'equals', value: 1, severity: 'required', onFail: 'hold' },
        { field: 'b', operator: 'equals', value: 2, severity: 'required', onFail: 'hold' },
      ],
    };
    expect(evaluateGate('rules', rules, { a: 1, b: 99 }).passed).toBe(true);
    expect(evaluateGate('rules', rules, { a: 99, b: 99 }).passed).toBe(false);
  });

  it('nested groups', () => {
    const rules: RuleGroup = {
      logic: 'AND',
      rules: [
        { field: 'exit_code', operator: 'equals', value: 0, severity: 'required', onFail: 'hold' },
        {
          logic: 'OR',
          rules: [
            { field: 'env', operator: 'equals', value: 'staging', severity: 'required', onFail: 'hold' },
            { field: 'env', operator: 'equals', value: 'production', severity: 'required', onFail: 'hold' },
          ],
        },
      ],
    };
    // exit_code=0, env=staging → pass
    expect(evaluateGate('rules', rules, { exit_code: 0, env: 'staging' }).passed).toBe(true);
    // exit_code=1 → fail
    expect(evaluateGate('rules', rules, { exit_code: 1, env: 'staging' }).passed).toBe(false);
    // exit_code=0, env=dev → fail
    expect(evaluateGate('rules', rules, { exit_code: 0, env: 'dev' }).passed).toBe(false);
  });

  it('rejects nesting beyond depth 3', () => {
    const deep: RuleGroup = {
      logic: 'AND',
      rules: [{
        logic: 'AND',
        rules: [{
          logic: 'AND',
          rules: [{
            logic: 'AND',
            rules: [
              { field: 'x', operator: 'equals', value: 1, severity: 'required', onFail: 'hold' },
            ],
          }],
        }],
      }],
    };
    expect(() => evaluateGate('rules', deep, { x: 1 })).toThrow('nesting exceeds maximum depth');
  });
});

describe('gate engine — severity and actions', () => {
  it('warn severity does not block', () => {
    const rules: RuleGroup = {
      logic: 'AND',
      rules: [{
        field: 'cost',
        operator: 'less_than',
        value: 1,
        severity: 'warn',
        onFail: 'notify',
      }],
    };
    const r = evaluateGate('rules', rules, { cost: 50 });
    // Warn fails the rule but verdict is still proceed
    expect(r.passed).toBe(true);
    expect(r.verdict).toBe('proceed');
    expect(r.ruleResults[0].passed).toBe(false);
  });

  it('block severity always holds', () => {
    const rules: RuleGroup = {
      logic: 'AND',
      rules: [{
        field: 'anything',
        operator: 'equals',
        value: 'whatever',
        severity: 'block',
        onFail: 'hold',
      }],
    };
    const r = evaluateGate('rules', rules, { anything: 'whatever' });
    expect(r.passed).toBe(false);
    expect(r.verdict).toBe('hold');
  });

  it('worst action wins: rework > hold', () => {
    const rules: RuleGroup = {
      logic: 'AND',
      rules: [
        { field: 'a', operator: 'equals', value: 1, severity: 'required', onFail: 'hold' },
        { field: 'b', operator: 'equals', value: 1, severity: 'required', onFail: 'rework' },
      ],
    };
    const r = evaluateGate('rules', rules, { a: 99, b: 99 });
    expect(r.verdict).toBe('rework');
  });

  it('abort is the worst verdict', () => {
    const rules: RuleGroup = {
      logic: 'AND',
      rules: [
        { field: 'a', operator: 'equals', value: 1, severity: 'required', onFail: 'rework' },
        { field: 'b', operator: 'equals', value: 1, severity: 'required', onFail: 'abort' },
      ],
    };
    const r = evaluateGate('rules', rules, { a: 99, b: 99 });
    expect(r.verdict).toBe('abort');
  });
});

describe('gate engine — gate modes', () => {
  it('auto mode always proceeds', () => {
    const r = evaluateGate('auto', null, {});
    expect(r.verdict).toBe('proceed');
    expect(r.passed).toBe(true);
  });

  it('skip mode always proceeds', () => {
    const r = evaluateGate('skip', null, {});
    expect(r.verdict).toBe('proceed');
  });

  it('hold mode always holds', () => {
    const r = evaluateGate('hold', null, {});
    expect(r.verdict).toBe('hold');
    expect(r.passed).toBe(false);
  });

  it('manual mode always holds', () => {
    const r = evaluateGate('manual', null, {});
    expect(r.verdict).toBe('hold');
  });

  it('rules mode with empty rules proceeds', () => {
    const r = evaluateGate('rules', { logic: 'AND', rules: [] }, {});
    expect(r.verdict).toBe('proceed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Service Tests (hit real Supabase)
// ═══════════════════════════════════════════════════════════════════════════

describe('gate service — evaluateStageGate', () => {
  it('auto stage proceeds without evaluating rules', async () => {
    const svc = createGateService(db);
    const r = await svc.evaluateStageGate(stageAutoId, stageRunId, {
      cost_usd: 999,
    });
    expect(r.verdict).toBe('proceed');
    expect(r.passed).toBe(true);
  });

  it('hold stage always holds', async () => {
    const svc = createGateService(db);
    const r = await svc.evaluateStageGate(stageHoldId, stageRunId, {});
    expect(r.verdict).toBe('hold');
    expect(r.passed).toBe(false);
  });

  it('rules stage evaluates and passes', async () => {
    const svc = createGateService(db);
    const r = await svc.evaluateStageGate(stageRulesId, stageRunId, {
      cost_usd: 5,
      exit_code: 0,
    });
    expect(r.verdict).toBe('proceed');
    expect(r.passed).toBe(true);
    expect(r.ruleResults).toHaveLength(2);
  });

  it('rules stage evaluates and fails', async () => {
    const svc = createGateService(db);
    const r = await svc.evaluateStageGate(stageRulesId, stageRunId, {
      cost_usd: 50,
      exit_code: 1,
    });
    expect(r.passed).toBe(false);
    // Both rules fail: cost_usd (hold) and exit_code (rework)
    // rework > hold, so verdict is rework
    expect(r.verdict).toBe('rework');
  });

  it('persists audit result to stage_gate_result table', async () => {
    const svc = createGateService(db);
    await svc.evaluateStageGate(stageRulesId, stageRunId, {
      cost_usd: 2,
      exit_code: 0,
    });

    // Query the audit table directly
    const results = await db
      .select()
      .from(schema.stageGateResult)
      .where(eq(schema.stageGateResult.stageRunId, stageRunId));

    expect(results.length).toBeGreaterThan(0);
    const latest = results[results.length - 1];
    expect(latest.verdict).toBe('proceed');
    expect(latest.passed).toBe(true);
    expect(latest.reason).toBe('all rules passed');

    // Track for cleanup
    for (const r of results) {
      cleanup.push({ table: 'stageGateResult', id: r.id });
    }
  });

  it('throws on nonexistent stage', async () => {
    const svc = createGateService(db);
    await expect(
      svc.evaluateStageGate(
        '00000000-0000-0000-0000-000000000000',
        stageRunId,
        {},
      ),
    ).rejects.toThrow('pipeline stage not found');
  });
});

describe('gate service — testEvaluate', () => {
  it('evaluates without persisting', async () => {
    const svc = createGateService(db);
    const rules: RuleGroup = {
      logic: 'AND',
      rules: [{
        field: 'score',
        operator: 'greater_than',
        value: 50,
        severity: 'required',
        onFail: 'hold',
      }],
    };
    const r = svc.testEvaluate('rules', rules, { score: 75 });
    expect(r.passed).toBe(true);
    expect(r.verdict).toBe('proceed');
  });
});
