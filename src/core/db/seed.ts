/**
 * Seed script — populates Supabase with default org, user, project, pipeline,
 * issue catalogs, transitions, and status automation config.
 *
 * Usage: npx tsx src/core/db/seed.ts
 * Requires: DATABASE_URL or DIRECT_URL set in .env
 *
 * Idempotent: safe to run multiple times. Uses onConflictDoNothing() throughout.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, and, sql } from 'drizzle-orm';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import {
  organization,
  user,
  project,
  pipeline,
  pipelineStage,
  issueType,
  issueState,
  issueStatus,
  issuePriority,
  issueLabel,
  issueTransition,
  configEntry,
  harnessCatalog,
  skill,
  issue,
  provider,
  model,
  routingProfile,
  routingRule,
} from './schema';

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
      { name: 'implement', sortOrder: 2, gateMode: 'rules', gateRules: implementGateRules },
      { name: 'review', sortOrder: 3, gateMode: 'hold', gateRules: {} },
      { name: 'deploy', sortOrder: 4, gateMode: 'hold', gateRules: {} },
    ];

    for (const stage of stagesDef) {
      await db
        .insert(pipelineStage)
        .values({
          pipelineId: pipe.id,
          name: stage.name,
          sortOrder: stage.sortOrder,
          gateMode: stage.gateMode,
          harness: 'claude-code',
          timeoutSec: 300,
          maxRetries: 1,
          gateRules: stage.gateRules,
          // FKs set in 5d after harness + skill are seeded
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

  // ── 5b. Harness catalog ────────────────────────────────────────────────
  let [claudeHarness] = await db
    .insert(harnessCatalog)
    .values({
      name: 'Claude Code',
      slug: 'claude-code',
      binary: 'claude',
      modelFlag: '--model',
      dirFlag: '--add-dir',
      sessionNameFlag: '--name',
      promptTransport: 'argv',
      issuePromptTemplate: '{{skill_name}}: {{issue_title}} — {{issue_description}}',
      queuePromptTemplate: '{{issue_title}}',
      defaultArgs: ['--print', '--dangerously-skip-permissions'],
      envVars: {},
      contextLayout: { instructionsFile: 'CLAUDE.md', contextFile: 'context.md' },
    })
    .onConflictDoNothing({ target: harnessCatalog.slug })
    .returning();

  if (!claudeHarness) {
    [claudeHarness] = await db
      .select()
      .from(harnessCatalog)
      .where(eq(harnessCatalog.slug, 'claude-code'));
  }
  console.log(`  harness: ${claudeHarness.name} (${claudeHarness.id})`);

  // ── 5c. Skills ─────────────────────────────────────────────────────────
  // Load skill content from actual skill files on disk
  const skillsDir = join(process.cwd(), '.claude', 'skills');
  const skillsDef = [
    { name: 'research', description: 'Unified research and planning — assess, decide, execute' },
    { name: 'implement', description: 'Implementation orchestrator — build features from plans' },
    { name: 'review', description: 'Code review — review only, no implementation' },
    { name: 'deploy', description: 'Deploy — merge approved PRs' },
  ];

  const skillMap = new Map<string, string>();
  for (const def of skillsDef) {
    const skillPath = join(skillsDir, def.name, 'SKILL.md');
    let promptTemplate = `${def.name}: ${def.description}`;
    try {
      promptTemplate = readFileSync(skillPath, 'utf-8');
    } catch {
      console.log(`  warning: ${skillPath} not found, using fallback prompt`);
    }

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

  // ── 5d. Update pipeline stages with harness + skill FKs ───────────────
  if (allStages.length > 0) {
    for (const stage of allStages) {
      const skillId = skillMap.get(stage.name) ?? null;
      await db
        .update(pipelineStage)
        .set({
          harnessId: claudeHarness.id,
          ...(skillId ? { skillId } : {}),
        })
        .where(eq(pipelineStage.id, stage.id));
    }
    console.log('  updated pipeline stages with harness/skill FKs');
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
          preferredHarness: 'claude-code',
          sortStrategy: 'quality',
        })
        .onConflictDoNothing();
      console.log(`  routing: ${defaultProvider.name} → ${defaultModel?.identifier ?? 'n/a'} via ${defaultProfile.name}`);
    }
  }

  // ── 6. Issue type catalog ──────────────────────────────────────────────
  const typesDef = [
    { key: 'bug', displayName: 'Bug', color: '#ef4444', sortOrder: 10 },
    { key: 'feature', displayName: 'Feature', color: '#3b82f6', sortOrder: 20 },
    { key: 'task', displayName: 'Task', color: '#a855f7', sortOrder: 30 },
    { key: 'research', displayName: 'Research', color: '#22c55e', sortOrder: 40 },
    { key: 'enhancement', displayName: 'Enhancement', color: '#f59e0b', sortOrder: 50 },
  ];

  await db
    .insert(issueType)
    .values(typesDef.map((t) => ({ ...t, projectId: proj.id })))
    .onConflictDoNothing();
  console.log(`  issue types: ${typesDef.length}`);

  // ── 7. Issue state catalog ─────────────────────────────────────────────
  const statesDef = [
    { key: 'new', displayName: 'New', color: '#6b7280', sortOrder: 10, isTerminal: false },
    { key: 'research', displayName: 'Research', color: '#3b82f6', sortOrder: 20, isTerminal: false },
    { key: 'implement', displayName: 'Implement', color: '#a855f7', sortOrder: 30, isTerminal: false },
    { key: 'review', displayName: 'Review', color: '#f59e0b', sortOrder: 40, isTerminal: false },
    { key: 'rework', displayName: 'Rework', color: '#ef4444', sortOrder: 50, isTerminal: false },
    { key: 'deploy', displayName: 'Deploy', color: '#22c55e', sortOrder: 60, isTerminal: false },
    { key: 'complete', displayName: 'Complete', color: '#10b981', sortOrder: 70, isTerminal: true },
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
      { projectId: proj.id, key: 'general', displayName: 'General', color: '#6b7280', sortOrder: 10 },
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
    { from: 'new', to: 'implement', description: 'Skip research, start implementing' },
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

  // ── 12. Status automation config ───────────────────────────────────────
  const configDef = [
    { key: 'issues.status.on_create_key', value: '"open"' },
    { key: 'issues.status.on_enqueued_key', value: '"queued"' },
    { key: 'issues.status.on_running_key', value: '"running"' },
    { key: 'issues.status.on_blocked_key', value: '"blocked"' },
    { key: 'issues.status.on_completed_key', value: '"completed"' },
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
    await db.insert(issue).values({
      projectId: proj.id,
      number: 1,
      title: 'Add health check endpoint with build metadata',
      bodyMd: [
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
      ].join('\n'),
      stateId: stateMap.get('research')!,
      statusId: statusMap.get('open')!,
      typeId: typeMap.get('task')!,
      priorityId: priorityMap.get('medium')!,
      author: 'seed',
    });
    console.log('  issue: #1 seeded');
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
