/**
 * Gate Engine Demo — run from terminal to see the engine work.
 *
 * Usage: npx tsx src/scripts/gates-demo.ts
 *
 * Reads the seeded pipeline stages from the database, then evaluates
 * gate rules against sample contexts to show verdicts.
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import {
  pipeline,
  pipelineRun,
  pipelineStage,
  stageRun,
} from '@/core/db/schema';
import { evaluateGate } from '@/core/gates/engine';
import { createGateService } from '@/core/gates/service';
import type { GateMode, RuleGroup } from '@/core/gates/types';

// Demo issues SELECT/INSERT/DELETE on pipeline tables — same shape as
// runtime app traffic. Use the pooled connection.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'ERROR: DATABASE_URL must be set. ' +
      'gates-demo.ts uses the Supabase pooled connection (port 6543).'
  );
  process.exit(1);
}

const provider = new SupabaseDatabaseProvider(url);
const db = provider.getConnection();

function printResult(label: string, result: any) {
  const icon = result.passed ? '✅' : '❌';
  console.log(`\n${icon} ${label}`);
  console.log(`   Verdict: ${result.verdict}`);
  console.log(`   Passed:  ${result.passed}`);
  console.log(`   Reason:  ${result.reason}`);
  if (result.ruleResults.length > 0) {
    console.log(`   Rules evaluated: ${result.ruleResults.length}`);
    for (const rr of result.ruleResults) {
      const ri = rr.passed ? '  ✓' : '  ✗';
      const label = rr.rule.label ? ` [${rr.rule.label}]` : '';
      console.log(
        `   ${ri} ${rr.rule.field} ${rr.rule.operator} ${JSON.stringify(rr.rule.value)}${label}`
      );
      if (!rr.passed) {
        console.log(
          `      → actual: ${JSON.stringify(rr.actualValue)} — ${rr.reason}`
        );
      }
    }
  }
}

async function demo() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  fluxaOS Gate Engine Demo');
  console.log('═══════════════════════════════════════════════════════');

  // ── 1. Show seeded stages and their gate config ──────────────────────
  console.log('\n── Seeded Pipeline Stages ──────────────────────────\n');
  const stages = await db
    .select({
      id: pipelineStage.id,
      name: pipelineStage.name,
      sortOrder: pipelineStage.sortOrder,
      gateMode: pipelineStage.gateMode,
      gateRules: pipelineStage.gateRules,
    })
    .from(pipelineStage);

  for (const s of stages) {
    const hasRules =
      s.gateRules &&
      typeof s.gateRules === 'object' &&
      'logic' in (s.gateRules as any);
    console.log(
      `  ${s.sortOrder}. ${s.name} — gate mode: ${s.gateMode}${hasRules ? ' (rules configured)' : ''}`
    );
  }

  // ── 2. Pure engine: test gate modes ──────────────────────────────────
  console.log('\n── Gate Mode Tests (pure engine, no DB) ───────────\n');

  printResult('auto mode — always proceeds', evaluateGate('auto', null, {}));

  printResult('hold mode — always holds', evaluateGate('hold', null, {}));

  printResult('skip mode — always proceeds', evaluateGate('skip', null, {}));

  // ── 3. Pure engine: rule evaluation ──────────────────────────────────
  console.log('\n── Rule Evaluation Tests ───────────────────────────\n');

  const rulesStage = stages.find((s) => s.gateMode === 'rules');
  if (rulesStage?.gateRules) {
    const rules = rulesStage.gateRules as RuleGroup;
    const mode = rulesStage.gateMode as GateMode;

    printResult(
      `${rulesStage.name}: exit_code=0, cost_usd=5 (should PASS)`,
      evaluateGate(mode, rules, { exit_code: 0, cost_usd: 5 })
    );

    printResult(
      `${rulesStage.name}: exit_code=1, cost_usd=5 (should REWORK — bad exit)`,
      evaluateGate(mode, rules, { exit_code: 1, cost_usd: 5 })
    );

    printResult(
      `${rulesStage.name}: exit_code=0, cost_usd=50 (should HOLD — over budget)`,
      evaluateGate(mode, rules, { exit_code: 0, cost_usd: 50 })
    );

    printResult(
      `${rulesStage.name}: exit_code=1, cost_usd=50 (should REWORK — worst wins)`,
      evaluateGate(mode, rules, { exit_code: 1, cost_usd: 50 })
    );
  }

  // ── 4. Advanced: OR groups, nested context, regex ────────────────────
  console.log('\n── Advanced Rule Tests ─────────────────────────────\n');

  const orRules: RuleGroup = {
    logic: 'AND',
    rules: [
      {
        field: 'exit_code',
        operator: 'equals',
        value: 0,
        severity: 'required',
        onFail: 'hold',
        label: 'Clean exit',
      },
      {
        logic: 'OR',
        rules: [
          {
            field: 'env',
            operator: 'equals',
            value: 'staging',
            severity: 'required',
            onFail: 'hold',
            label: 'Staging env',
          },
          {
            field: 'env',
            operator: 'equals',
            value: 'production',
            severity: 'required',
            onFail: 'hold',
            label: 'Production env',
          },
        ],
      },
    ],
  };

  printResult(
    'OR group: exit=0, env=staging (should PASS)',
    evaluateGate('rules', orRules, { exit_code: 0, env: 'staging' })
  );

  printResult(
    'OR group: exit=0, env=dev (should HOLD — wrong env)',
    evaluateGate('rules', orRules, { exit_code: 0, env: 'dev' })
  );

  const nestedRules: RuleGroup = {
    logic: 'AND',
    rules: [
      {
        field: 'output.tests.passed',
        operator: 'equals',
        value: true,
        severity: 'required',
        onFail: 'rework',
        label: 'Tests passed',
      },
      {
        field: 'output.version',
        operator: 'matches',
        value: '^v\\d+\\.\\d+',
        severity: 'required',
        onFail: 'hold',
        label: 'Version format',
      },
      {
        field: 'tags',
        operator: 'contains',
        value: 'reviewed',
        severity: 'warn',
        onFail: 'notify',
        label: 'Has review tag',
      },
    ],
  };

  printResult(
    'Nested context + regex: all pass',
    evaluateGate('rules', nestedRules, {
      output: { tests: { passed: true }, version: 'v2.3' },
      tags: ['tested', 'reviewed'],
    })
  );

  printResult(
    'Nested context: tests failed (should REWORK)',
    evaluateGate('rules', nestedRules, {
      output: { tests: { passed: false }, version: 'v2.3' },
      tags: ['tested', 'reviewed'],
    })
  );

  printResult(
    'Warn severity: missing review tag (should still PROCEED)',
    evaluateGate('rules', nestedRules, {
      output: { tests: { passed: true }, version: 'v2.3' },
      tags: ['tested'],
    })
  );

  // ── 5. Service: DB-backed evaluation with audit trail ────────────────
  if (rulesStage) {
    console.log('\n── Service Test (DB read + audit persistence) ─────\n');

    const svc = createGateService(db);

    // Create a temporary pipeline run + stage run for audit
    const [pRun] = await db
      .insert(pipelineRun)
      .values({
        pipelineId: (await db.select({ id: pipeline.id }).from(pipeline))[0].id,
        status: 'running',
      })
      .returning();

    const [sRun] = await db
      .insert(stageRun)
      .values({
        pipelineRunId: pRun.id,
        pipelineStageId: rulesStage.id,
        status: 'queued',
      })
      .returning();

    const r = await svc.evaluateStageGate(rulesStage.id, sRun.id, {
      exit_code: 0,
      cost_usd: 3.5,
    });

    printResult(
      `Service: evaluated ${rulesStage.name} from DB (exit=0, cost=3.50)`,
      r
    );
    console.log('\n   📝 Audit result persisted to stage_gate_result table');

    // Show the audit record
    const { stageGateResult } = await import('@/core/db/schema');
    const audits = await db
      .select()
      .from(stageGateResult)
      .where(eq(stageGateResult.stageRunId, sRun.id));

    console.log(
      `   📋 ${audits.length} audit record(s) found for this stage run`
    );
    if (audits[0]) {
      console.log(
        `      verdict: ${audits[0].verdict}, passed: ${audits[0].passed}`
      );
    }

    // Cleanup
    const { stageGateResult: sgr } = await import('@/core/db/schema');
    for (const a of audits) {
      await db.delete(sgr).where(eq(sgr.id, a.id));
    }
    await db.delete(stageRun).where(eq(stageRun.id, sRun.id));
    await db.delete(pipelineRun).where(eq(pipelineRun.id, pRun.id));
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Demo complete.');
  console.log('═══════════════════════════════════════════════════════\n');
  process.exit(0);
}

demo().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
