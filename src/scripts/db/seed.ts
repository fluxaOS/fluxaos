/**
 * Seed script — populates Supabase with default org, user, project, pipeline,
 * issue catalogs, transitions, and status automation config.
 *
 * Usage: npx tsx src/scripts/db/seed.ts
 * Requires: DATABASE_URL set in .env (pgbouncer pooled connection, port 6543).
 *
 * Idempotent: safe to run multiple times. Uses onConflictDoNothing() throughout.
 */
import 'dotenv/config';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { PIPELINE_SENTINEL } from '@/core/constants';
import {
  brand,
  configEntry,
  customer,
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
  persona,
  pipeline,
  pipelineStage,
  project,
  projectMember,
  provider,
  routingProfile,
  routingRule,
  skill,
  team,
  teamMember,
  user,
} from '@/core/db/schema';
import { renderMarkdown } from '@/core/markdown';

// Seed issues INSERT/SELECT/UPDATE only (no DDL). The pgbouncer pooled URL
// is the right shape — same as runtime app traffic.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'ERROR: DATABASE_URL must be set. ' +
      'seed.ts uses the Supabase pooled connection (port 6543) for DML. ' +
      'Run db:migrate (which uses DIRECT_URL) before seeding.'
  );
  process.exit(1);
}

const dbProvider = new SupabaseDatabaseProvider(url);
const db = dbProvider.getConnection();

async function seed() {
  console.log('Seeding fluxaOS database...\n');

  // ── 0. Default customer (FLX-239 placeholder) ─────────────────────────
  // The customer table is a billing placeholder; no routers/UI depend on it
  // yet. The default org's customer_id points at this row. Seed creates
  // exactly one row — the seed-check asserts this invariant.
  const existingCustomers = await db.select().from(customer);
  if (existingCustomers.length > 1) {
    throw new Error(
      `Seed expected 0 or 1 customer rows, found ${existingCustomers.length}. ` +
        `Run tsx src/scripts/db/nuke.ts and re-seed.`
    );
  }
  let cust = existingCustomers[0];
  if (!cust) {
    [cust] = await db.insert(customer).values({}).returning();
  }
  console.log(`  customer: ${cust.id}`);

  // ── 1. Default organization ────────────────────────────────────────────
  let [org] = await db
    .insert(organization)
    .values({
      name: 'Default',
      slug: 'default',
      settings: {},
      customerId: cust.id,
    })
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

  // ── 1b. Default team (FLX-239) ────────────────────────────────────────
  // Team is org-scoped. org_id is immutable post-create.
  // No unique constraint on team beyond PK — use check-then-insert pattern.
  let [defaultTeam] = await db
    .select()
    .from(team)
    .where(and(eq(team.orgId, org.id), eq(team.name, 'Default Team')));

  if (!defaultTeam) {
    [defaultTeam] = await db
      .insert(team)
      .values({
        orgId: org.id,
        name: 'Default Team',
        description: 'Default team for the Default org',
      })
      .returning();
  }
  console.log(`  team: ${defaultTeam.name} (${defaultTeam.id})`);

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
  // FLX-239: project.user_id dropped; project.team_id added. No unique
  // constraint beyond PK — use check-then-insert. orgId is required by the
  // schema (NOT NULL); the Stage 1 BEFORE INSERT trigger writes the same
  // value, so passing org.id is a no-op overwrite.
  let [proj] = await db
    .select()
    .from(project)
    .where(
      and(eq(project.teamId, defaultTeam.id), eq(project.slug, 'fluxaos'))
    );

  if (!proj) {
    [proj] = await db
      .insert(project)
      .values({
        teamId: defaultTeam.id,
        orgId: org.id,
        name: 'fluxaOS',
        slug: 'fluxaos',
        repoUrl: 'https://github.com/fluxaOS/fluxaos',
      })
      .returning();
  }
  console.log(`  project: ${proj.name} (${proj.id})`);

  // ── 3b. team_member + project_member (FLX-239) ────────────────────────
  // Wire the default user into the default team and the default project.
  await db
    .insert(teamMember)
    .values({
      userId: usr.id,
      teamId: defaultTeam.id,
      role: 'admin',
    })
    .onConflictDoNothing();
  console.log(`  team_member: ${usr.id} → ${defaultTeam.id}`);

  await db
    .insert(projectMember)
    .values({
      userId: usr.id,
      projectId: proj.id,
      role: 'admin',
    })
    .onConflictDoNothing();
  console.log(`  project_member: ${usr.id} → ${proj.id}`);

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

  // Wire project.defaultPipelineId → Standard Dev pipeline so IssueWatcher
  // can auto-dispatch when a new issue is filed.
  if (!proj.defaultPipelineId || proj.defaultPipelineId !== pipe.id) {
    [proj] = await db
      .update(project)
      .set({ defaultPipelineId: pipe.id })
      .where(eq(project.id, proj.id))
      .returning();
    console.log(`  project.defaultPipelineId → ${pipe.id}`);
  }

  // FLX-221: project.target_repo_path is the per-project replacement for
  // the retired env var. Seed leaves it null; operators set it via
  // Settings → Projects after first run. The stage runner fails fast with
  // a typed error when null at acquire time, so a freshly-seeded DB will
  // refuse to run pipelines until the column is populated.
  if (proj.targetRepoPath) {
    console.log(`  project.targetRepoPath: ${proj.targetRepoPath}`);
  } else {
    console.log(
      `  project.targetRepoPath: (null — set it via Settings → Projects before running a pipeline)`
    );
  }

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
    {
      name: 'research',
      sortOrder: 1,
      gateMode: 'auto',
      gateRules: {},
      onPass: 'implement',
      onFail: 'research',
      fallback: PIPELINE_SENTINEL.blocked,
    },
    {
      name: 'implement',
      sortOrder: 2,
      gateMode: 'rules',
      gateRules: implementGateRules,
      onPass: 'review',
      onFail: 'implement',
      fallback: PIPELINE_SENTINEL.blocked,
    },
    {
      name: 'review',
      sortOrder: 3,
      gateMode: 'auto',
      gateRules: {},
      onPass: PIPELINE_SENTINEL.complete,
      onFail: 'rework',
      fallback: PIPELINE_SENTINEL.blocked,
    },
    {
      name: 'rework',
      sortOrder: 4,
      gateMode: 'rules',
      gateRules: implementGateRules,
      onPass: 'review',
      onFail: PIPELINE_SENTINEL.blocked,
      fallback: PIPELINE_SENTINEL.blocked,
    },
    {
      name: 'deploy',
      sortOrder: 5,
      gateMode: 'manual',
      gateRules: {},
      onPass: PIPELINE_SENTINEL.complete,
      onFail: PIPELINE_SENTINEL.blocked,
      fallback: PIPELINE_SENTINEL.blocked,
    },
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
      onPass: stage.onPass,
      onFail: stage.onFail,
      fallback: stage.fallback,
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

  for (const def of skillsDef) {
    const promptTemplate = PIPELINE_PROMPT + ROLE_PROMPTS[def.name];

    // Catalog skill: all four scope columns NULL, kind='catalog'.
    // Upsert key: name + all scope columns NULL (isolates catalog row from
    // any future scoped overrides with the same name).
    let [row] = await db
      .select()
      .from(skill)
      .where(
        and(
          eq(skill.name, def.name),
          isNull(skill.orgId),
          isNull(skill.teamId),
          isNull(skill.userId),
          isNull(skill.projectId)
        )
      );

    const values = {
      name: def.name,
      description: def.description,
      promptTemplate,
      kind: 'catalog' as const,
      orgId: null,
      teamId: null,
      userId: null,
      projectId: null,
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
    console.log(`  skill: ${row.name} (${row.id})`);
  }

  // ── 5d. Update pipeline stages with driver FK ────────────────────────
  if (allStages.length > 0) {
    for (const stage of allStages) {
      await db
        .update(pipelineStage)
        .set({ driverId: claudeDriver.id })
        .where(eq(pipelineStage.id, stage.id));
    }
    console.log('  updated pipeline stages with driver FK');
  }

  // ── 5e. Provider + Model + Routing ─────────────────────────────────────
  // Anthropic: org-scoped. Promote any reset row (kind='catalog'/NULL scope
  // from migration Phase 12) or insert fresh.
  let [defaultProvider] = await db
    .select()
    .from(provider)
    .where(
      and(
        eq(provider.name, 'Anthropic'),
        eq(provider.orgId, org.id),
        eq(provider.kind, 'org')
      )
    );

  if (!defaultProvider) {
    const [resetProvider] = await db
      .select()
      .from(provider)
      .where(
        and(
          eq(provider.name, 'Anthropic'),
          eq(provider.kind, 'catalog'),
          isNull(provider.orgId)
        )
      );

    if (resetProvider) {
      [defaultProvider] = await db
        .update(provider)
        .set({
          orgId: org.id,
          teamId: null,
          userId: null,
          projectId: null,
          kind: 'org',
          type: 'anthropic',
          apiKeyRef: 'env:ANTHROPIC_API_KEY',
          isHealthy: true,
        })
        .where(eq(provider.id, resetProvider.id))
        .returning();
    } else {
      [defaultProvider] = await db
        .insert(provider)
        .values({
          orgId: org.id,
          teamId: null,
          userId: null,
          projectId: null,
          kind: 'org',
          name: 'Anthropic',
          type: 'anthropic',
          apiKeyRef: 'env:ANTHROPIC_API_KEY',
          isHealthy: true,
        })
        .returning();
    }
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
      .select()
      .from(routingProfile)
      .where(
        and(
          eq(routingProfile.name, 'Default'),
          eq(routingProfile.orgId, org.id),
          eq(routingProfile.kind, 'org')
        )
      );

    if (!defaultProfile) {
      const [resetProfile] = await db
        .select()
        .from(routingProfile)
        .where(
          and(
            eq(routingProfile.name, 'Default'),
            eq(routingProfile.kind, 'catalog'),
            isNull(routingProfile.orgId)
          )
        );

      if (resetProfile) {
        [defaultProfile] = await db
          .update(routingProfile)
          .set({
            orgId: org.id,
            teamId: null,
            userId: null,
            projectId: null,
            kind: 'org',
            description: 'Default routing profile',
            isDefault: true,
          })
          .where(eq(routingProfile.id, resetProfile.id))
          .returning();
      } else {
        [defaultProfile] = await db
          .insert(routingProfile)
          .values({
            orgId: org.id,
            teamId: null,
            userId: null,
            projectId: null,
            kind: 'org',
            name: 'Default',
            description: 'Default routing profile',
            isDefault: true,
          })
          .returning();
      }
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
  // OpenAI: org-scoped. Same promote-or-insert pattern as Anthropic.
  let [openaiProvider] = await db
    .select()
    .from(provider)
    .where(
      and(
        eq(provider.name, 'OpenAI'),
        eq(provider.orgId, org.id),
        eq(provider.kind, 'org')
      )
    );

  if (!openaiProvider) {
    const [resetOpenai] = await db
      .select()
      .from(provider)
      .where(
        and(
          eq(provider.name, 'OpenAI'),
          eq(provider.kind, 'catalog'),
          isNull(provider.orgId)
        )
      );

    if (resetOpenai) {
      [openaiProvider] = await db
        .update(provider)
        .set({
          orgId: org.id,
          teamId: null,
          userId: null,
          projectId: null,
          kind: 'org',
          type: 'openai',
          apiKeyRef: 'env:OPENAI_API_KEY',
          isHealthy: false,
        })
        .where(eq(provider.id, resetOpenai.id))
        .returning();
    } else {
      [openaiProvider] = await db
        .insert(provider)
        .values({
          orgId: org.id,
          teamId: null,
          userId: null,
          projectId: null,
          kind: 'org',
          name: 'OpenAI',
          type: 'openai',
          apiKeyRef: 'env:OPENAI_API_KEY',
          isHealthy: false,
        })
        .returning();
    }
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

  // ── 12.b Global operational config (scope='global', project_id=NULL) ───
  // FLX-222: runtime.workspace_root — DB is the sole source of truth for the
  // worktree storage override. The row's value is jsonb null by default
  // ("use in-project layout"); an operator can update it to an absolute path
  // string via Settings → System.
  // FLX-223: runtime.artifacts_root — same shape, distinct override for
  // per-run artifact directories.
  // FLX-224: cleanup.* — five rows owning cleanup-scheduler behaviour. The
  // four threshold rows are positive integers; the scheduler_enabled row is
  // a boolean (defaults to false — the cleanup loop is opt-in). Operators
  // flip scheduler_enabled to true via Settings → System once they're ready
  // for the daemon to start the cleanup loop.
  // The unique index treats NULL project_id as distinct, so we can't use
  // onConflictDoNothing — we check-then-insert instead.
  const globalConfigDef: Array<{ key: string; value: unknown }> = [
    { key: 'runtime.workspace_root', value: null },
    { key: 'runtime.artifacts_root', value: null },
    { key: 'cleanup.sweep_interval_min', value: 10 },
    { key: 'cleanup.stale_days', value: 7 },
    { key: 'cleanup.session_retention_days', value: 30 },
    { key: 'cleanup.artifacts_retention_days', value: 30 },
    { key: 'cleanup.scheduler_enabled', value: false },
  ];
  for (const entry of globalConfigDef) {
    const [existing] = await db
      .select({ id: configEntry.id })
      .from(configEntry)
      .where(
        and(
          eq(configEntry.scope, 'global'),
          isNull(configEntry.projectId),
          eq(configEntry.key, entry.key)
        )
      );
    if (existing) continue;
    await db.insert(configEntry).values({
      scope: 'global',
      projectId: null,
      key: entry.key,
      value: sql`${JSON.stringify(entry.value)}::jsonb`,
    });
  }
  console.log(`  global config entries: ${globalConfigDef.length}`);

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

  // ── Personas: seed one per stage and assign ──────────────────────────
  const personaDefs = [
    {
      stageName: 'research',
      personaName: 'Research Analyst',
      soul: `You are a thorough research analyst. Your job is to deeply understand a problem before anyone writes a single line of code.

When you receive an issue:
1. Read the issue title and description carefully
2. Explore the relevant codebase areas to understand the current state
3. Identify the root cause or the core implementation challenge
4. Document your findings clearly: what the problem is, which files are affected, what approach makes sense, what the risks are
5. Write your findings to the artifacts directory

You do NOT write code. You do NOT create branches. You do NOT modify any files except your artifacts output.`,
    },
    {
      stageName: 'implement',
      personaName: 'Software Engineer',
      soul: `You are a careful, quality-focused software engineer. You implement solutions that are clean, minimal, and correct.

When you receive an issue:
1. Read the research findings from the previous stage (check the artifacts directory)
2. Implement the solution following the project's conventions and architecture
3. Write only what is necessary — no gold-plating, no extra abstractions
4. Run the project's test suite to verify your changes
5. Commit your changes with a clear commit message referencing the issue

You follow the project's CLAUDE.md and AGENT_BEHAVIOR.md rules exactly.`,
    },
    {
      stageName: 'review',
      personaName: 'Code Reviewer',
      soul: `You are a meticulous code reviewer. You review for correctness, simplicity, and adherence to project conventions.

When you receive an issue:
1. Read the implementation diff and understand what changed
2. Check: Does it solve the stated problem? Does it introduce new bugs? Does it follow project conventions?
3. Check: Is it minimal? Would a simpler approach work?
4. Check: Are there any security issues, hardcoded values, or architectural violations?

If the implementation looks good: verdict pass. If there are issues: verdict fail. If you cannot assess: verdict blocked.`,
    },
    {
      stageName: 'rework',
      personaName: 'Software Engineer',
      soul: `You are a careful, quality-focused software engineer addressing review feedback.

When you receive an issue:
1. Read the review feedback carefully
2. Address each concern raised by the reviewer
3. Make targeted, minimal changes — do not refactor beyond what the review requested
4. Re-run tests to confirm nothing broke
5. Commit your changes`,
    },
    {
      stageName: 'deploy',
      personaName: 'Release Engineer',
      soul: `You are a careful release engineer. You verify that a change is safe to ship and perform the deployment.

When you receive an issue:
1. Verify the implementation is on a clean branch with tests passing
2. Create a pull request if one doesn't exist
3. Confirm the PR is mergeable (no conflicts, CI passing)
4. Merge the PR and clean up the branch`,
    },
  ];

  for (const pd of personaDefs) {
    // FLX-239: lookup by (name, projectId, kind='project'). On UAT, Phase 12
    // reset existing personas to kind='catalog' with NULL projectId — we
    // promote any such reset row back to the right project, or insert fresh.
    let [personaRow] = await db
      .select()
      .from(persona)
      .where(
        and(
          eq(persona.name, pd.personaName),
          eq(persona.projectId, proj.id),
          eq(persona.kind, 'project')
        )
      );

    // If no project-scoped row exists, look for a reset row (kind='catalog'
    // with NULL projectId) and promote it. Otherwise insert fresh.
    if (!personaRow) {
      const [resetRow] = await db
        .select()
        .from(persona)
        .where(
          and(
            eq(persona.name, pd.personaName),
            eq(persona.kind, 'catalog'),
            isNull(persona.projectId)
          )
        );

      if (resetRow) {
        // Promote: set projectId, kind='project', soul.
        [personaRow] = await db
          .update(persona)
          .set({
            projectId: proj.id,
            orgId: null,
            teamId: null,
            userId: null,
            kind: 'project',
            soul: pd.soul,
          })
          .where(eq(persona.id, resetRow.id))
          .returning();
      } else {
        [personaRow] = await db
          .insert(persona)
          .values({
            projectId: proj.id,
            orgId: null,
            teamId: null,
            userId: null,
            kind: 'project',
            name: pd.personaName,
            soul: pd.soul,
          })
          .returning();
      }
    } else {
      // Already project-scoped — just refresh soul.
      [personaRow] = await db
        .update(persona)
        .set({ soul: pd.soul })
        .where(eq(persona.id, personaRow.id))
        .returning();
    }

    // Assign to matching stage
    const matchingStage = allStages.find((s) => s.name === pd.stageName);
    if (matchingStage && personaRow) {
      await db
        .update(pipelineStage)
        .set({ personaId: personaRow.id })
        .where(eq(pipelineStage.id, matchingStage.id));
    }
  }
  console.log('  seeded personas and assigned to stages');

  // ── Brands: seed one org-scoped brand ─────────────────────────────────
  // Required by brand-screenshot.spec.ts: the spec looks for an <li> whose
  // subtitle is 'organization' (rendered when projectId is null).
  // Default brand — org-scoped. Promote any reset row or insert fresh.
  const [existingBrand] = await db
    .select()
    .from(brand)
    .where(
      and(
        eq(brand.name, 'Default Brand'),
        eq(brand.orgId, org.id),
        eq(brand.kind, 'org')
      )
    );

  if (!existingBrand) {
    const [resetBrand] = await db
      .select()
      .from(brand)
      .where(
        and(
          eq(brand.name, 'Default Brand'),
          eq(brand.kind, 'catalog'),
          isNull(brand.orgId)
        )
      );

    if (resetBrand) {
      await db
        .update(brand)
        .set({
          orgId: org.id,
          teamId: null,
          userId: null,
          projectId: null,
          kind: 'org',
          toneOfVoice: 'Professional and clear',
          styleGuide: 'Follow the fluxaOS voice and tone guidelines.',
          colors: { primary: '#6366f1', accent: '#8b5cf6' },
          fonts: { heading: 'Inter', body: 'Inter' },
          logoUrl: null,
        })
        .where(eq(brand.id, resetBrand.id));
      console.log('  brand: Default Brand (promoted from reset row)');
    } else {
      await db.insert(brand).values({
        orgId: org.id,
        teamId: null,
        userId: null,
        projectId: null,
        kind: 'org',
        name: 'Default Brand',
        toneOfVoice: 'Professional and clear',
        styleGuide: 'Follow the fluxaOS voice and tone guidelines.',
        colors: { primary: '#6366f1', accent: '#8b5cf6' },
        fonts: { heading: 'Inter', body: 'Inter' },
        logoUrl: null,
      });
      console.log('  brand: Default Brand (org-scoped)');
    }
  } else {
    console.log('  brand: Default Brand already exists');
  }

  console.log('\nSeed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
