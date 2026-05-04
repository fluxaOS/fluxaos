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
        playbookPath: 'standard-dev',
        playbookScope: 'bundled',
      })
      .returning();
  }

  if (pipe && !pipe.playbookPath) {
    [pipe] = await db
      .update(pipeline)
      .set({ playbookPath: 'standard-dev', playbookScope: 'bundled' })
      .where(eq(pipeline.id, pipe.id))
      .returning();
  }
  console.log(`  pipeline: ${pipe.name} (${pipe.id})`);

  // ── 5. Pipeline stages (no unique constraint — converge by name) ────────
  // Real dogfooding uses the full workflow: research -> implement -> review,
  // with review able to route to rework, then deploy after approval.
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
    {
      name: 'rework',
      sortOrder: 4,
      gateMode: 'rules',
      gateRules: implementGateRules,
    },
    { name: 'deploy', sortOrder: 5, gateMode: 'manual', gateRules: {} },
  ];

  for (const stage of stagesDef) {
    const [existingStage] = await db
      .select()
      .from(pipelineStage)
      .where(
        and(
          eq(pipelineStage.pipelineId, pipe.id),
          eq(pipelineStage.name, stage.name)
        )
      );

    const values = {
      sortOrder: stage.sortOrder,
      gateMode: stage.gateMode,
      driver: 'claude-code',
      timeoutSec: 300,
      maxRetries: 1,
      gateRules: stage.gateRules,
    };

    if (existingStage) {
      await db
        .update(pipelineStage)
        .set(values)
        .where(eq(pipelineStage.id, existingStage.id));
    } else {
      await db.insert(pipelineStage).values({
        pipelineId: pipe.id,
        name: stage.name,
        ...values,
        // FKs set in 5d after driver + skill are seeded.
      });
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

  // FLX-6: OpenAI Codex CLI driver. Mirror of the Claude Code driver
  // shape, configured for the `codex` CLI binary. Seeded as disabled
  // (isEnabled: false) because the binary may not be installed on every
  // homelab. Operators flip isEnabled in Settings → Drivers when they
  // have the CLI configured.
  let [codexDriver] = await db
    .insert(driver)
    .values({
      name: 'OpenAI Codex CLI',
      slug: 'openai-codex',
      binary: 'codex',
      modelFlag: '--model',
      dirFlag: '--cwd',
      sessionNameFlag: null,
      promptTransport: 'argv',
      outputFormat: 'stream-json',
      outputFormatFlag: '--output-format',
      issuePromptTemplate:
        '{{skill_name}}: {{issue_title}} — {{issue_description}}',
      queuePromptTemplate: '{{issue_title}}',
      defaultArgs: ['--print'],
      envVars: {},
      contextLayout: {
        instructionsFile: 'AGENTS.md',
        contextFile: 'context.md',
      },
      isEnabled: false,
      notes:
        'OpenAI Codex CLI driver (FLX-6). Disabled by default — flip isEnabled once the `codex` binary is installed and authenticated.',
    })
    .onConflictDoNothing({ target: driver.slug })
    .returning();

  if (!codexDriver) {
    [codexDriver] = await db
      .select()
      .from(driver)
      .where(eq(driver.slug, 'openai-codex'));
  }
  console.log(`  driver: ${codexDriver.name} (${codexDriver.id})`);

  // ── 5c. Skills ─────────────────────────────────────────────────────────
  // DB-backed fluxaOS runtime skills. These are adapted from the fh-commons
  // research/implement/review/rework/deploy roles, but remove fhc/pat/Python
  // assumptions and speak the flux:signal contract consumed by the engine.
  const PIPELINE_PROMPT = `You are running as a fluxaOS pipeline agent in headless mode. You have two files available:
- AGENTS.md or CLAUDE.md - project instructions and repo rules
- context.md - the issue, stage, and runtime context

Read the available instruction file and context.md first. Work only on the issue in context. Prefer existing repo patterns, keep changes scoped, and preserve unrelated user work.

Artifacts directory: {{artifacts_path}}
Use artifacts for durable handoff between stages. Write the stage artifact named in your role instructions before emitting a signal.

When complete, emit exactly one flux:signal on a single stdout line:
echo '{"flux:signal": {"verdict": "proceed", "summary": "brief description of the completed stage"}}'

If review finds blocking issues, emit:
echo '{"flux:signal": {"verdict": "rework", "summary": "brief description of required changes"}}'

If the issue is already complete or belongs in a later state, emit:
echo '{"flux:signal": {"verdict": "hold", "reason": "already_complete", "summary": "explanation", "meta": {"targetState": "<state key>"}}}'

Valid state keys: new, research, implement, review, rework, deploy, complete

If you cannot proceed without operator input, emit:
echo '{"flux:signal": {"verdict": "hold", "reason": "needs_human", "summary": "explanation", "meta": {"question": "specific question for the operator"}}}'

If the stage attempted work but failed because checks are broken, emit:
echo '{"flux:signal": {"verdict": "abort", "summary": "what failed and what was tried"}}'

Do not ask questions interactively. Do not use slash commands. Do not invent missing requirements. Run only commands that are relevant to the current stage.`;

  const ROLE_PROMPTS: Record<string, string> = {
    research: `

Role: Research
Goal: turn the issue into an implementation-ready plan.

Do:
- Inspect the issue, relevant docs, and existing code.
- Identify constraints, risks, acceptance criteria, affected files, and verification commands.
- Prefer the simplest reversible path that fits fluxaOS architecture.
- Write {{artifacts_path}}/research-findings.md with the plan, affected areas, risks, and verification approach.

Do not:
- Modify source code unless the issue is already complete and only documentation/artifacts are needed.
- Open or merge PRs.
- Deploy.

Exit:
- proceed when the issue is ready for implement.
- hold/already_complete with targetState if the repo is already further ahead.
- hold/needs_human only when a concrete operator decision is required.`,
    implement: `

Role: Implement
Goal: make the scoped code/docs/config changes and leave the branch ready for review.

Before editing:
- Read {{artifacts_path}}/research-findings.md if it exists.
- Write {{artifacts_path}}/plan.md with the intended edits and checks.

Do:
- Edit the repo directly in the provided isolated worktree.
- Follow TypeScript, Next.js, Drizzle, and fluxaOS project conventions.
- Add or update focused integration/e2e verification when behavior changes.
- Run the relevant checks for the files touched, normally npm run lint, npm run build, npm run verify, npx vitest, or targeted Playwright specs as appropriate.
- Leave a concise implementation summary in {{artifacts_path}}/implementation-summary.md.

Do not:
- Merge PRs, deploy production, or close issues.
- Rework unrelated code.
- Hide failing checks.

Exit:
- proceed only when implementation and relevant checks are done or clearly documented.
- hold/needs_human for missing requirements or blocked external dependencies.
- abort when implementation was attempted but cannot be made passing.`,
    review: `

Role: Review
Goal: review implementation quality and route to deploy or rework.

Do:
- Read {{artifacts_path}}/plan.md and {{artifacts_path}}/implementation-summary.md if present.
- Inspect the diff against the base branch and relevant runtime behavior.
- Look for correctness bugs, regressions, missing tests, architecture violations, data loss, security risks, and deploy risks.
- Run focused verification when practical.
- Write {{artifacts_path}}/review-findings.md.

Do not:
- Implement fixes.
- Merge PRs, deploy production, or close issues.
- Approve work that has unverified high-risk behavior.

Exit:
- proceed when the work is ready for deploy.
- rework when fixes are required; include concrete findings in the summary and artifact.
- hold/needs_human only for decisions the reviewer cannot make from repo context.`,
    rework: `

Role: Rework
Goal: address review findings and resubmit for review.

Before editing:
- Read {{artifacts_path}}/review-findings.md.
- Identify each blocking finding and the intended fix.

Do:
- Apply only the changes needed to address review feedback.
- Re-run the checks relevant to changed behavior.
- Update {{artifacts_path}}/implementation-summary.md with what changed during rework.

Do not:
- Create a new unrelated implementation path.
- Merge PRs, deploy production, or close issues.
- Ignore unresolved review findings.

Exit:
- proceed when rework is complete and ready for review again.
- hold/needs_human for ambiguous or conflicting review requirements.
- abort when rework was attempted but cannot be made passing.`,
    deploy: `

Role: Deploy
Goal: merge approved work, update the internal fluxaOS deployment, verify it, and close the issue.

Preflight:
- Confirm review approved the work and no unresolved blocking findings remain.
- Confirm the PR or branch tied to the issue is the one being shipped.
- Confirm the local checkout is clean except for expected deploy operations.

Do:
- Merge the approved PR using the repo's normal GitHub flow.
- Pull the merged main branch locally.
- Run /mnt/stacks/docker/fluxaos/build.sh after changes merge to main.
- Verify the internal development build at flux.jdp21.com and/or the configured health endpoint.
- Write {{artifacts_path}}/deploy-summary.md with PR, commit, deploy command result, verification result, and any cleanup.

Do not:
- Review or rewrite the approved implementation.
- Deploy unapproved work.
- Skip verification after build.sh.

Exit:
- proceed when merge, deploy, and verification are complete.
- hold/needs_human when approval, credentials, or deploy access is missing.
- abort when merge or deployment fails after attempted recovery.`,
  };

  const skillsDef = [
    {
      name: 'research',
      description:
        'Research and planning - produce an implementation-ready plan',
    },
    {
      name: 'implement',
      description: 'Implementation - build scoped changes from the plan',
    },
    {
      name: 'review',
      description:
        'Review - inspect implementation and route to deploy or rework',
    },
    {
      name: 'rework',
      description: 'Rework - address review feedback and resubmit',
    },
    {
      name: 'deploy',
      description:
        'Deploy - merge approved work, run build.sh, verify, and close',
    },
  ];

  const skillMap = new Map<string, string>();
  for (const def of skillsDef) {
    const promptTemplate = PIPELINE_PROMPT + ROLE_PROMPTS[def.name];

    let [row] = await db
      .select()
      .from(skill)
      .where(and(eq(skill.projectId, proj.id), eq(skill.name, def.name)));

    const values = {
      name: def.name,
      description: def.description,
      promptTemplate,
      scope: 'project',
      projectId: proj.id,
    };

    if (row) {
      [row] = await db
        .update(skill)
        .set(values)
        .where(eq(skill.id, row.id))
        .returning();
    } else {
      [row] = await db.insert(skill).values(values).returning();
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

  // FLX-6: OpenAI provider + model. Seeded so operators see OpenAI in
  // Settings → Providers and can wire a routing rule to the codex driver
  // when their CLI is configured. Model identifier and costs reflect
  // GPT-5.4 pricing as published; adjust in Settings → Providers if
  // OpenAI updates the price sheet.
  let [openaiProvider] = await db
    .insert(provider)
    .values({
      orgId: org.id,
      name: 'OpenAI',
      type: 'openai',
      apiKeyRef: 'env:OPENAI_API_KEY',
      isHealthy: false,
    })
    .onConflictDoNothing()
    .returning();

  if (!openaiProvider) {
    [openaiProvider] = await db
      .select()
      .from(provider)
      .where(and(eq(provider.orgId, org.id), eq(provider.type, 'openai')));
  }

  if (openaiProvider) {
    await db
      .insert(model)
      .values({
        providerId: openaiProvider.id,
        name: 'GPT-5.4',
        identifier: 'gpt-5.4',
        costPer1kInput: '0.005',
        costPer1kOutput: '0.020',
      })
      .onConflictDoNothing();
    console.log(`  provider: ${openaiProvider.name} (gpt-5.4)`);
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
