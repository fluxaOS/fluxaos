/**
 * Seed script — populates Supabase with default org, user, project, pipeline,
 * issue catalogs, transitions, and status automation config.
 *
 * Usage: npx tsx src/scripts/db/seed.ts
 * Requires: DATABASE_URL or DIRECT_URL set in .env
 *
 * Idempotent: safe to run multiple times. Uses onConflictDoNothing() throughout.
 */
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import {
  configEntry,
  driver,
  issue,
  issueLabel,
  issuePriority,
  issueState,
  issueStatus,
  issueTransition,
  issueType,
  model,
  organization,
  pipeline,
  pipelineStage,
  project,
  provider,
  routingProfile,
  routingRule,
  skill,
  user,
} from '@/core/db/schema';
import { renderMarkdown } from '@/core/markdown';

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DIRECT_URL or DATABASE_URL must be set.');
  process.exit(1);
}

const dbProvider = new SupabaseDatabaseProvider(url);
const db = dbProvider.getConnection();

async function seed() {
  console.log('Seeding fluxaOS database...\n');

  // ── 1. Default organization ────────────────────────────────────────────
  let [org] = await db
    .insert(organization)
    .values({ name: 'Default', slug: 'default', settings: {} })
    .onConflictDoNothing({ target: organization.slug })
    .returning();

  if (!org) {
    // Already exists — fetch it
    [org] = await db
      .select()
      .from(organization)
      .where(eq(organization.slug, 'default'));
  }
  console.log(`  org: ${org.name} (${org.id})`);

  // ── 2. Default user ────────────────────────────────────────────────────
  const seedEmail = process.env.SEED_USER_EMAIL ?? 'admin@fluxaos.local';

  let [usr] = await db
    .insert(user)
    .values({
      orgId: org.id,
      email: seedEmail,
      name: 'Admin',
      slug: 'admin',
    })
    .onConflictDoNothing()
    .returning();

  if (!usr) {
    [usr] = await db
      .select()
      .from(user)
      .where(and(eq(user.orgId, org.id), eq(user.slug, 'admin')));
  }
  console.log(`  user: ${usr.name} <${usr.email}> (${usr.id})`);

  // ── 3. Default project ─────────────────────────────────────────────────
  let [proj] = await db
    .insert(project)
    .values({
      orgId: org.id,
      userId: usr.id,
      name: 'fluxaOS',
      slug: 'fluxaos',
      repoUrl: 'https://github.com/fluxaOS/fluxaos',
    })
    .onConflictDoNothing()
    .returning();

  if (!proj) {
    [proj] = await db
      .select()
      .from(project)
      .where(and(eq(project.userId, usr.id), eq(project.slug, 'fluxaos')));
  }
  console.log(`  project: ${proj.name} (${proj.id})`);

  // ── 4. Default pipeline (no unique constraint — check first) ────────
  let [pipe] = await db
    .select()
    .from(pipeline)
    .where(
      and(eq(pipeline.projectId, proj.id), eq(pipeline.name, 'Standard Dev'))
    );

  if (!pipe) {
    [pipe] = await db
      .insert(pipeline)
      .values({
        projectId: proj.id,
        name: 'Standard Dev',
        description: 'Research → Implement → Review → Deploy',
        isDefault: true,
      })
      .returning();
  }
  console.log(`  pipeline: ${pipe.name} (${pipe.id})`);

  // ── 5. Pipeline stages (no unique constraint — check first) ────────
  const existingStages = await db
    .select()
    .from(pipelineStage)
    .where(eq(pipelineStage.pipelineId, pipe.id));

  if (existingStages.length === 0) {
    // Example gate rules for the 'implement' stage:
    // - exit code must be 0 (rework if not)
    // - cost must be under $10 (hold if not)
    const implementGateRules = {
      logic: 'AND',
      rules: [
        {
          field: 'exit_code',
          operator: 'equals',
          value: 0,
          severity: 'required',
          onFail: 'rework',
          label: 'Clean exit required',
        },
        {
          field: 'cost_usd',
          operator: 'less_than',
          value: 10,
          severity: 'required',
          onFail: 'hold',
          label: 'Cost cap',
        },
      ],
    };

    const stagesDef = [
      { name: 'research', sortOrder: 1, gateMode: 'auto', gateRules: {} },
      {
        name: 'implement',
        sortOrder: 2,
        gateMode: 'rules',
        gateRules: implementGateRules,
      },
      { name: 'review', sortOrder: 3, gateMode: 'auto', gateRules: {} },
    ];

    for (const stage of stagesDef) {
      await db
        .insert(pipelineStage)
        .values({
          pipelineId: pipe.id,
          name: stage.name,
          sortOrder: stage.sortOrder,
          gateMode: stage.gateMode,
          driver: 'claude-code',
          timeoutSec: 300,
          maxRetries: 1,
          gateRules: stage.gateRules,
          // FKs set in 5d after driver + skill are seeded
        })
        .returning();
    }
  }
  // Re-query stages so the FK update below always runs
  const allStages = await db
    .select()
    .from(pipelineStage)
    .where(eq(pipelineStage.pipelineId, pipe.id));
  console.log(`  pipeline stages: ${allStages.length}`);

  // ── 5b. Driver catalog ────────────────────────────────────────────────
  let [claudeDriver] = await db
    .insert(driver)
    .values({
      name: 'Claude Code',
      slug: 'claude-code',
      binary: 'claude',
      modelFlag: '--model',
      dirFlag: '--add-dir',
      sessionNameFlag: '--name',
      promptTransport: 'argv',
      outputFormat: 'stream-json',
      outputFormatFlag: '--output-format',
      issuePromptTemplate:
        '{{skill_name}}: {{issue_title}} — {{issue_description}}',
      queuePromptTemplate: '{{issue_title}}',
      defaultArgs: ['-p', '--verbose', '--dangerously-skip-permissions'],
      envVars: {},
      contextLayout: {
        instructionsFile: 'CLAUDE.md',
        contextFile: 'context.md',
      },
    })
    .onConflictDoNothing({ target: driver.slug })
    .returning();

  if (!claudeDriver) {
    [claudeDriver] = await db
      .select()
      .from(driver)
      .where(eq(driver.slug, 'claude-code'));
  }
  console.log(`  driver: ${claudeDriver.name} (${claudeDriver.id})`);

  // ── 5c. Skills ─────────────────────────────────────────────────────────
  // Lean pipeline prompts — designed for headless --print mode in isolated workspaces.
  // The workspace contains only CLAUDE.md (persona + skill definition) and context.md
  // (issue details). Do NOT load the full interactive SKILL.md files — those are for
  // Claude Code slash-command use and will cause token waste and misbehavior in --print mode.
  const PIPELINE_PROMPT = `You are running as a pipeline agent in headless mode. You have two files available:
- CLAUDE.md — your instructions and skill definition for this task
- context.md — the issue you are working on

Read both files. Assess the issue. Do the work described in CLAUDE.md for this issue.

When complete, emit your result as a flux:signal on a single stdout line:
echo '{"flux:signal": {"verdict": "proceed", "summary": "brief description of what was done"}}'

If the issue is already complete or further ahead than its current state, emit:
echo '{"flux:signal": {"verdict": "hold", "reason": "already_complete", "summary": "explanation", "meta": {"targetState": "<state key>"}}}'

Valid state keys: new, research, implement, review, rework, deploy, complete

If you cannot proceed without human input, emit:
echo '{"flux:signal": {"verdict": "hold", "reason": "needs_human", "summary": "explanation", "meta": {"question": "specific question for the human"}}}'

Do not ask questions. Do not use slash commands. Do not run CLI tools beyond what the task genuinely requires.`;

  // R-ARTIFACTS: per-skill suffixes that use the {{artifacts_path}} template
  // variable. Later stages read what earlier stages wrote at known paths.
  const ARTIFACTS_SUFFIX: Record<string, string> = {
    research: `

Artifacts directory: {{artifacts_path}}
Write your findings to {{artifacts_path}}/research-findings.md before emitting flux:signal. Later stages will read it.`,
    implement: `

Artifacts directory: {{artifacts_path}}
Before editing, read {{artifacts_path}}/research-findings.md if it exists — earlier stages may have captured constraints. Write an implementation plan to {{artifacts_path}}/plan.md before you edit the worktree.`,
    review: `

Artifacts directory: {{artifacts_path}}
Read {{artifacts_path}}/plan.md if it exists to see what was intended, then diff it against the actual worktree changes. Write your review to {{artifacts_path}}/review-findings.md before emitting flux:signal.`,
    rework: `

Artifacts directory: {{artifacts_path}}
Read {{artifacts_path}}/review-findings.md if it exists and address the concerns it raises before editing.`,
  };

  const skillsDef = [
    {
      name: 'research',
      description: 'Unified research and planning — assess, decide, execute',
    },
    {
      name: 'implement',
      description: 'Implementation orchestrator — build features from plans',
    },
    {
      name: 'review',
      description: 'Code review — review only, no implementation',
    },
    {
      name: 'rework',
      description: 'Rework — address review feedback and resubmit',
    },
  ];

  const skillMap = new Map<string, string>();
  for (const def of skillsDef) {
    const promptTemplate = PIPELINE_PROMPT + (ARTIFACTS_SUFFIX[def.name] ?? '');

    let [row] = await db
      .insert(skill)
      .values({
        name: def.name,
        description: def.description,
        promptTemplate,
        scope: 'project',
        projectId: proj.id,
      })
      .onConflictDoNothing()
      .returning();

    if (!row) {
      [row] = await db
        .select()
        .from(skill)
        .where(and(eq(skill.projectId, proj.id), eq(skill.name, def.name)));
    }
    skillMap.set(def.name, row.id);
    console.log(`  skill: ${row.name} (${row.id})`);
  }

  // ── 5d. Update pipeline stages with driver + skill FKs ───────────────
  if (allStages.length > 0) {
    for (const stage of allStages) {
      const skillId = skillMap.get(stage.name) ?? null;
      await db
        .update(pipelineStage)
        .set({
          driverId: claudeDriver.id,
          ...(skillId ? { skillId } : {}),
        })
        .where(eq(pipelineStage.id, stage.id));
    }
    console.log('  updated pipeline stages with driver/skill FKs');
  }

  // ── 5e. Provider + Model + Routing ─────────────────────────────────────
  let [defaultProvider] = await db
    .insert(provider)
    .values({
      orgId: org.id,
      name: 'Anthropic',
      type: 'anthropic',
      apiKeyRef: 'env:ANTHROPIC_API_KEY',
      isHealthy: true,
    })
    .onConflictDoNothing()
    .returning();

  if (!defaultProvider) {
    [defaultProvider] = await db
      .select()
      .from(provider)
      .where(eq(provider.orgId, org.id))
      .limit(1);
  }

  if (defaultProvider) {
    let [defaultModel] = await db
      .insert(model)
      .values({
        providerId: defaultProvider.id,
        name: 'Claude Sonnet 4.6',
        identifier: 'claude-sonnet-4-6',
        costPer1kInput: '0.003',
        costPer1kOutput: '0.015',
      })
      .onConflictDoNothing()
      .returning();

    if (!defaultModel) {
      [defaultModel] = await db
        .select()
        .from(model)
        .where(eq(model.providerId, defaultProvider.id))
        .limit(1);
    }

    let [defaultProfile] = await db
      .insert(routingProfile)
      .values({
        orgId: org.id,
        name: 'Default',
        description: 'Default routing profile',
        isDefault: true,
      })
      .onConflictDoNothing()
      .returning();

    if (!defaultProfile) {
      [defaultProfile] = await db
        .select()
        .from(routingProfile)
        .where(eq(routingProfile.orgId, org.id))
        .limit(1);
    }

    if (defaultProfile) {
      await db
        .insert(routingRule)
        .values({
          profileId: defaultProfile.id,
          stageName: null, // wildcard — matches all stages
          preferredDriver: 'claude-code',
          sortStrategy: 'quality',
        })
        .onConflictDoNothing();
      console.log(
        `  routing: ${defaultProvider.name} → ${defaultModel?.identifier ?? 'n/a'} via ${defaultProfile.name}`
      );
    }
  }

  // ── 6. Issue type catalog ──────────────────────────────────────────────
  const typesDef = [
    { key: 'bug', displayName: 'Bug', color: '#ef4444', sortOrder: 10 },
    { key: 'feature', displayName: 'Feature', color: '#3b82f6', sortOrder: 20 },
    { key: 'task', displayName: 'Task', color: '#a855f7', sortOrder: 30 },
    {
      key: 'research',
      displayName: 'Research',
      color: '#22c55e',
      sortOrder: 40,
    },
    {
      key: 'enhancement',
      displayName: 'Enhancement',
      color: '#f59e0b',
      sortOrder: 50,
    },
  ];

  await db
    .insert(issueType)
    .values(typesDef.map((t) => ({ ...t, projectId: proj.id })))
    .onConflictDoNothing();
  console.log(`  issue types: ${typesDef.length}`);

  // ── 7. Issue state catalog ─────────────────────────────────────────────
  const statesDef = [
    {
      key: 'new',
      displayName: 'New',
      color: '#6b7280',
      sortOrder: 10,
      isTerminal: false,
    },
    {
      key: 'research',
      displayName: 'Research',
      color: '#3b82f6',
      sortOrder: 20,
      isTerminal: false,
    },
    {
      key: 'implement',
      displayName: 'Implement',
      color: '#a855f7',
      sortOrder: 30,
      isTerminal: false,
    },
    {
      key: 'review',
      displayName: 'Review',
      color: '#f59e0b',
      sortOrder: 40,
      isTerminal: false,
    },
    {
      key: 'rework',
      displayName: 'Rework',
      color: '#ef4444',
      sortOrder: 50,
      isTerminal: false,
    },
    {
      key: 'deploy',
      displayName: 'Deploy',
      color: '#22c55e',
      sortOrder: 60,
      isTerminal: false,
    },
    {
      key: 'complete',
      displayName: 'Complete',
      color: '#10b981',
      sortOrder: 70,
      isTerminal: true,
    },
  ];

  await db
    .insert(issueState)
    .values(statesDef.map((s) => ({ ...s, projectId: proj.id })))
    .onConflictDoNothing();
  console.log(`  issue states: ${statesDef.length}`);

  // Fetch state IDs for transitions
  const states = await db
    .select({ id: issueState.id, key: issueState.key })
    .from(issueState)
    .where(eq(issueState.projectId, proj.id));
  const stateMap = new Map(states.map((s) => [s.key, s.id]));

  // ── 8. Issue status catalog ────────────────────────────────────────────
  const statusesDef = [
    { key: 'open', displayName: 'Open', sortOrder: 5 },
    { key: 'queued', displayName: 'Queued', sortOrder: 10 },
    { key: 'running', displayName: 'Running', sortOrder: 20 },
    { key: 'blocked', displayName: 'Blocked', sortOrder: 30 },
    { key: 'completed', displayName: 'Completed', sortOrder: 40 },
  ];

  await db
    .insert(issueStatus)
    .values(statusesDef.map((s) => ({ ...s, projectId: proj.id })))
    .onConflictDoNothing();
  console.log(`  issue statuses: ${statusesDef.length}`);

  // ── 9. Issue priority catalog ──────────────────────────────────────────
  const prioritiesDef = [
    { key: 'critical', displayName: 'Critical', weight: 100, color: '#ef4444' },
    { key: 'high', displayName: 'High', weight: 200, color: '#f97316' },
    { key: 'medium', displayName: 'Medium', weight: 300, color: '#eab308' },
    { key: 'low', displayName: 'Low', weight: 400, color: '#6b7280' },
  ];

  await db
    .insert(issuePriority)
    .values(prioritiesDef.map((p) => ({ ...p, projectId: proj.id })))
    .onConflictDoNothing();
  console.log(`  issue priorities: ${prioritiesDef.length}`);

  // ── 10. Issue label catalog ────────────────────────────────────────────
  await db
    .insert(issueLabel)
    .values([
      {
        projectId: proj.id,
        key: 'general',
        displayName: 'General',
        color: '#6b7280',
        sortOrder: 10,
      },
    ])
    .onConflictDoNothing();
  console.log('  issue labels: 1');

  // ── 11. Issue transitions ──────────────────────────────────────────────
  const transitionsDef = [
    { from: 'new', to: 'research', description: 'Start research' },
    { from: 'research', to: 'implement', description: 'Begin implementation' },
    { from: 'implement', to: 'review', description: 'Submit for review' },
    { from: 'implement', to: 'research', description: 'Back to research' },
    { from: 'review', to: 'rework', description: 'Needs rework' },
    { from: 'review', to: 'deploy', description: 'Approve for deploy' },
    { from: 'rework', to: 'review', description: 'Resubmit for review' },
    { from: 'deploy', to: 'complete', description: 'Mark complete' },
    { from: 'complete', to: 'implement', description: 'Reopen' },
    {
      from: 'new',
      to: 'implement',
      description: 'Skip research, start implementing',
    },
  ];

  await db
    .insert(issueTransition)
    .values(
      transitionsDef.map((t, i) => ({
        projectId: proj.id,
        fromStateId: stateMap.get(t.from)!,
        toStateId: stateMap.get(t.to)!,
        description: t.description,
        sortOrder: (i + 1) * 10,
      }))
    )
    .onConflictDoNothing();
  console.log(`  issue transitions: ${transitionsDef.length}`);

  // ── 12. Status + state automation config ───────────────────────────────
  const configDef = [
    { key: 'issues.status.on_create_key', value: '"open"' },
    { key: 'issues.status.on_enqueued_key', value: '"queued"' },
    { key: 'issues.status.on_running_key', value: '"running"' },
    { key: 'issues.status.on_blocked_key', value: '"blocked"' },
    { key: 'issues.status.on_completed_key', value: '"completed"' },
    // FLX-79: deploy bridge advances issue state to this key after PR opens.
    { key: 'issues.state.on_deploy_complete_key', value: '"review"' },
    // FLX-84: rework verdicts move issues to this DB-configured state.
    { key: 'issues.state.on_rework_key', value: '"rework"' },
  ];

  await db
    .insert(configEntry)
    .values(
      configDef.map((c) => ({
        scope: 'project',
        projectId: proj.id,
        key: c.key,
        value: c.value,
      }))
    )
    .onConflictDoNothing();
  console.log(`  config entries: ${configDef.length}`);

  // ── 13. Seed issue ─────────────────────────────────────────────────────
  const types = await db
    .select({ id: issueType.id, key: issueType.key })
    .from(issueType)
    .where(eq(issueType.projectId, proj.id));
  const typeMap = new Map(types.map((t) => [t.key, t.id]));

  const statuses = await db
    .select({ id: issueStatus.id, key: issueStatus.key })
    .from(issueStatus)
    .where(eq(issueStatus.projectId, proj.id));
  const statusMap = new Map(statuses.map((s) => [s.key, s.id]));

  const priorities = await db
    .select({ id: issuePriority.id, key: issuePriority.key })
    .from(issuePriority)
    .where(eq(issuePriority.projectId, proj.id));
  const priorityMap = new Map(priorities.map((p) => [p.key, p.id]));

  const existingIssues = await db
    .select()
    .from(issue)
    .where(eq(issue.projectId, proj.id));

  if (existingIssues.length === 0) {
    const issue1Md = [
      '## Summary',
      '',
      'Add a `/api/health` endpoint that returns build metadata (git sha, build time, version).',
      '',
      '## Implementation Plan',
      '',
      '1. Read `src/app/api/health/route.ts`',
      '2. Update the health endpoint to include git sha from `git rev-parse HEAD`',
      '3. Add build timestamp',
      '4. Return JSON with `{ status: "ok", sha, buildTime, version }`',
      '',
      '## Acceptance Criteria',
      '',
      '- [ ] `/api/health` returns JSON with status, sha, buildTime, version',
      '- [ ] No hardcoded values — reads from environment or git',
    ].join('\n');

    await db.insert(issue).values({
      projectId: proj.id,
      number: 1,
      title: 'Add health check endpoint with build metadata',
      bodyMd: issue1Md,
      bodyHtml: renderMarkdown(issue1Md),
      stateId: stateMap.get('research')!,
      statusId: statusMap.get('open')!,
      typeId: typeMap.get('task')!,
      priorityId: priorityMap.get('medium')!,
      author: 'seed',
    });
    console.log('  issue: #1 seeded');

    // Issue #2 — tests the hold/already_complete → stateOverride path.
    // The health endpoint already exists at src/app/api/health/route.ts.
    // When the research stage runs, the skill should detect this and emit
    // hold/already_complete with targetState: 'complete'.
    const issue2Md = [
      '## Summary',
      '',
      'Add a `/api/health` endpoint that returns build metadata.',
      '',
      'Note: This endpoint already exists at `src/app/api/health/route.ts`',
      'and fully meets the requirements.',
      '',
      '## Acceptance Criteria',
      '',
      '- [ ] `/api/health` returns JSON with status and build info',
    ].join('\n');

    await db.insert(issue).values({
      projectId: proj.id,
      number: 2,
      title: 'Add /api/health endpoint with build metadata',
      bodyMd: issue2Md,
      bodyHtml: renderMarkdown(issue2Md),
      stateId: stateMap.get('research')!,
      statusId: statusMap.get('open')!,
      typeId: typeMap.get('task')!,
      priorityId: priorityMap.get('medium')!,
      author: 'seed',
    });
    console.log('  issue: #2 seeded (already_complete test case)');
  } else {
    console.log(`  issues: ${existingIssues.length} existing`);
  }

  console.log('\nSeed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
