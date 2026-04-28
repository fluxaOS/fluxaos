import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ─── Helpers ────────────────────────────────────────────────────────────────

const id = uuid('id').primaryKey().defaultRandom();
const createdAt = timestamp('created_at', { withTimezone: true })
  .defaultNow()
  .notNull();
const updatedAt = timestamp('updated_at', { withTimezone: true })
  .defaultNow()
  .notNull();

// ─── Organization & Project ─────────────────────────────────────────────────

export const organization = pgTable('organization', {
  id,
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  settings: jsonb('settings'),
  createdAt,
  updatedAt,
});

export const user = pgTable(
  'user',
  {
    id,
    // Optimistic concurrency token — required by RecordEditor (FLX-3).
    version: integer('version').notNull().default(1),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organization.id),
    email: text('email').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    avatarUrl: text('avatar_url'),
    createdAt,
    updatedAt,
  },
  (t) => [uniqueIndex('user_org_slug_idx').on(t.orgId, t.slug)]
);

export const project = pgTable(
  'project',
  {
    id,
    orgId: uuid('org_id')
      .notNull()
      .references(() => organization.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    repoUrl: text('repo_url'),
    defaultBranch: text('default_branch').notNull().default('main'),
    worktreeCopyFiles: jsonb('worktree_copy_files')
      .notNull()
      .default(sql`'[]'::jsonb`),
    defaultPipelineId: uuid('default_pipeline_id'),
    brandId: uuid('brand_id'),
    createdAt,
    updatedAt,
  },
  (t) => [uniqueIndex('project_user_slug_idx').on(t.userId, t.slug)]
);

// ─── Pipeline ───────────────────────────────────────────────────────────────

export const pipeline = pgTable('pipeline', {
  id,
  projectId: uuid('project_id')
    .notNull()
    .references(() => project.id),
  name: text('name').notNull(),
  description: text('description'),
  isDefault: boolean('is_default').default(false),
  createdAt,
  updatedAt,
});

export const pipelineStage = pgTable('pipeline_stage', {
  id,
  pipelineId: uuid('pipeline_id')
    .notNull()
    .references(() => pipeline.id),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull(),
  personaId: uuid('persona_id'),
  driver: text('driver'),
  timeoutSec: integer('timeout_sec').default(300),
  maxRetries: integer('max_retries').default(0),
  gateMode: text('gate_mode').default('auto'),
  gateRules: jsonb('gate_rules'),
  skillId: uuid('skill_id').references(() => skill.id),
  driverId: uuid('driver_id').references(() => driver.id),
  createdAt,
  updatedAt,
});

export const pipelineRun = pgTable('pipeline_run', {
  id,
  pipelineId: uuid('pipeline_id')
    .notNull()
    .references(() => pipeline.id),
  issueId: uuid('issue_id'),
  status: text('status').notNull().default('pending'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  totalCostUsd: numeric('total_cost_usd', { precision: 10, scale: 6 }).default(
    '0'
  ),
  artifactsPath: text('artifacts_path'),
  createdAt,
  updatedAt,
});

export const stageRun = pgTable('stage_run', {
  id,
  pipelineRunId: uuid('pipeline_run_id')
    .notNull()
    .references(() => pipelineRun.id),
  pipelineStageId: uuid('pipeline_stage_id')
    .notNull()
    .references(() => pipelineStage.id),
  status: text('status').notNull().default('queued'),
  provider: text('provider'),
  model: text('model'),
  driver: text('driver'),
  attempt: integer('attempt').notNull().default(1),
  pid: integer('pid'),
  exitCode: integer('exit_code'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).default('0'),
  tokensIn: integer('tokens_in').default(0),
  tokensOut: integer('tokens_out').default(0),
  skillId: uuid('skill_id').references(() => skill.id),
  driverId: uuid('driver_id').references(() => driver.id),
  skillSignal: text('skill_signal'),
  skillMetadata: jsonb('skill_metadata'),
  trigger: text('trigger').notNull().default('manual'),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt,
  updatedAt,
});

// ─── Gate Results (append-only audit) ──────────────────────────────────────

export const stageGateResult = pgTable('stage_gate_result', {
  id,
  stageRunId: uuid('stage_run_id')
    .notNull()
    .references(() => stageRun.id),
  verdict: text('verdict').notNull(),
  passed: boolean('passed').notNull(),
  worstAction: text('worst_action'),
  ruleSnapshot: jsonb('rule_snapshot').notNull(),
  ruleResults: jsonb('rule_results').notNull(),
  reason: text('reason').notNull(),
  createdAt,
});

// ─── Driver Catalog ──────────────────────────────────────────────────────

export const driver = pgTable('driver', {
  id,
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  binary: text('binary').notNull(),
  defaultArgs: jsonb('default_args').notNull().default(sql`'[]'::jsonb`),
  modelFlag: text('model_flag'),
  dirFlag: text('dir_flag'),
  sessionNameFlag: text('session_name_flag'),
  promptTransport: text('prompt_transport').notNull().default('argv'),
  outputFormat: text('output_format').notNull().default('stream-json'),
  outputFormatFlag: text('output_format_flag'),
  promptSendDelayMs: integer('prompt_send_delay_ms').notNull().default(0),
  probeCommand: text('probe_command'),
  issuePromptTemplate: text('issue_prompt_template'),
  queuePromptTemplate: text('queue_prompt_template'),
  envVars: jsonb('env_vars').notNull().default(sql`'{}'::jsonb`),
  extraArgs: jsonb('extra_args').notNull().default(sql`'{}'::jsonb`),
  // FLX-78: no driver-specific default in core schema. Driver rows are
  // seeded with concrete contextLayout values (see src/scripts/db/seed.ts).
  // Engine fails fast if a driver row is created without one.
  contextLayout: jsonb('context_layout').notNull(),
  isEnabled: boolean('is_enabled').notNull().default(true),
  notes: text('notes'),
  version: integer('version').notNull().default(1),
  createdAt,
  updatedAt,
});

// ─── Event Store (append-only) ──────────────────────────────────────────────

export const event = pgTable('event', {
  id,
  stageRunId: uuid('stage_run_id')
    .notNull()
    .references(() => stageRun.id),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
  timestamp: timestamp('timestamp', { withTimezone: true })
    .defaultNow()
    .notNull(),
  createdAt,
});

// ─── Issue Catalogs ────────────────────────────────────────────────────────

export const issueType = pgTable(
  'issue_type',
  {
    id,
    projectId: uuid('project_id').references(() => project.id, {
      onDelete: 'restrict',
    }),
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    color: text('color').notNull(),
    sortOrder: integer('sort_order').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('issue_type_project_key_idx')
      .on(t.projectId, t.key)
      .where(sql`${t.projectId} IS NOT NULL`),
    uniqueIndex('issue_type_global_key_idx')
      .on(t.key)
      .where(sql`${t.projectId} IS NULL`),
  ]
);

export const issueState = pgTable(
  'issue_state',
  {
    id,
    projectId: uuid('project_id').references(() => project.id, {
      onDelete: 'restrict',
    }),
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    color: text('color').notNull(),
    sortOrder: integer('sort_order').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    isTerminal: boolean('is_terminal').notNull().default(false),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('issue_state_project_key_idx')
      .on(t.projectId, t.key)
      .where(sql`${t.projectId} IS NOT NULL`),
    uniqueIndex('issue_state_global_key_idx')
      .on(t.key)
      .where(sql`${t.projectId} IS NULL`),
  ]
);

export const issueStatus = pgTable(
  'issue_status',
  {
    id,
    projectId: uuid('project_id').references(() => project.id, {
      onDelete: 'restrict',
    }),
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('issue_status_project_key_idx')
      .on(t.projectId, t.key)
      .where(sql`${t.projectId} IS NOT NULL`),
    uniqueIndex('issue_status_global_key_idx')
      .on(t.key)
      .where(sql`${t.projectId} IS NULL`),
  ]
);

export const issuePriority = pgTable(
  'issue_priority',
  {
    id,
    projectId: uuid('project_id').references(() => project.id, {
      onDelete: 'restrict',
    }),
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    color: text('color').notNull(),
    weight: integer('weight').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('issue_priority_project_key_idx')
      .on(t.projectId, t.key)
      .where(sql`${t.projectId} IS NOT NULL`),
    uniqueIndex('issue_priority_global_key_idx')
      .on(t.key)
      .where(sql`${t.projectId} IS NULL`),
  ]
);

export const issueLabel = pgTable(
  'issue_label',
  {
    id,
    projectId: uuid('project_id').references(() => project.id, {
      onDelete: 'restrict',
    }),
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    color: text('color').notNull(),
    sortOrder: integer('sort_order').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('issue_label_project_key_idx')
      .on(t.projectId, t.key)
      .where(sql`${t.projectId} IS NOT NULL`),
    uniqueIndex('issue_label_global_key_idx')
      .on(t.key)
      .where(sql`${t.projectId} IS NULL`),
  ]
);

export const issueTransition = pgTable(
  'issue_transition',
  {
    id,
    projectId: uuid('project_id').references(() => project.id, {
      onDelete: 'restrict',
    }),
    fromStateId: uuid('from_state_id')
      .notNull()
      .references(() => issueState.id, { onDelete: 'restrict' }),
    toStateId: uuid('to_state_id')
      .notNull()
      .references(() => issueState.id, { onDelete: 'restrict' }),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('issue_transition_project_states_idx')
      .on(t.projectId, t.fromStateId, t.toStateId)
      .where(sql`${t.projectId} IS NOT NULL`),
    uniqueIndex('issue_transition_global_states_idx')
      .on(t.fromStateId, t.toStateId)
      .where(sql`${t.projectId} IS NULL`),
  ]
);

// ─── Issues (rich model) ───────────────────────────────────────────────────

export const issue = pgTable(
  'issue',
  {
    id,
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    bodyMd: text('body_md'),
    bodyHtml: text('body_html'),
    stateId: uuid('state_id')
      .notNull()
      .references(() => issueState.id, { onDelete: 'restrict' }),
    statusId: uuid('status_id')
      .notNull()
      .references(() => issueStatus.id, { onDelete: 'restrict' }),
    typeId: uuid('type_id')
      .notNull()
      .references(() => issueType.id, { onDelete: 'restrict' }),
    priorityId: uuid('priority_id')
      .notNull()
      .references(() => issuePriority.id, { onDelete: 'restrict' }),
    isClosed: boolean('is_closed').notNull().default(false),
    assignee: text('assignee'),
    author: text('author').notNull().default('system'),
    labels: jsonb('labels').notNull().default(sql`'[]'::jsonb`),
    version: integer('version').notNull().default(1),
    source: text('source').default('internal'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    // Self-FK. Declared as a bare uuid here because Drizzle's typing for
    // self-references inside the same table definition is awkward. The FK,
    // same-project trigger, and self-parent CHECK all live in the migration
    // (drizzle/0009_r_epic.sql). R-EPIC.
    parentIssueId: uuid('parent_issue_id'),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('issue_project_number_idx').on(t.projectId, t.number),
    index('issue_project_closed_idx').on(t.projectId, t.isClosed),
    index('issue_parent_idx').on(t.parentIssueId),
  ]
);

export const issueEvent = pgTable('issue_event', {
  id,
  issueId: uuid('issue_id')
    .notNull()
    .references(() => issue.id, { onDelete: 'cascade' }),
  actor: text('actor').notNull().default('system'),
  type: text('type').notNull(),
  payload: jsonb('payload'),
  timestamp: timestamp('timestamp', { withTimezone: true })
    .defaultNow()
    .notNull(),
  createdAt,
});

// ─── Issue Entities ────────────────────────────────────────────────────────

export const issueComment = pgTable('issue_comment', {
  id,
  issueId: uuid('issue_id')
    .notNull()
    .references(() => issue.id, { onDelete: 'cascade' }),
  commentNumber: integer('comment_number').notNull(),
  bodyMd: text('body_md'),
  bodyHtml: text('body_html'),
  author: text('author'),
  version: integer('version').notNull().default(1),
  isDeleted: boolean('is_deleted').notNull().default(false),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  createdAt,
  updatedAt,
});

// ─── Issue Git Placeholders (no CRUD until R5) ────────────────────────────

export const issueBranch = pgTable('issue_branch', {
  id,
  issueId: uuid('issue_id')
    .notNull()
    .references(() => issue.id, { onDelete: 'cascade' }),
  repo: text('repo').notNull(),
  branchName: text('branch_name').notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdBy: text('created_by'),
  createdAt,
  updatedAt,
});

export const issuePullRequest = pgTable('issue_pull_request', {
  id,
  issueId: uuid('issue_id')
    .notNull()
    .references(() => issue.id, { onDelete: 'cascade' }),
  repo: text('repo').notNull(),
  provider: text('provider').notNull(),
  prNumber: integer('pr_number').notNull(),
  prUrl: text('pr_url').notNull(),
  title: text('title').notNull(),
  state: text('state').notNull(),
  headBranch: text('head_branch').notNull(),
  baseBranch: text('base_branch').notNull(),
  author: text('author'),
  mergedAt: timestamp('merged_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt,
  updatedAt,
});

export const issueCommit = pgTable('issue_commit', {
  id,
  issueId: uuid('issue_id')
    .notNull()
    .references(() => issue.id, { onDelete: 'cascade' }),
  repo: text('repo').notNull(),
  sha: text('sha').notNull(),
  author: text('author'),
  message: text('message'),
  committedAt: timestamp('committed_at', { withTimezone: true }).notNull(),
  createdAt,
  updatedAt,
});

// ─── Isolation Environments (R-RUNTIME: worktree-per-run) ─────────────────

export const isolationEnvironment = pgTable(
  'isolation_environment',
  {
    id,
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    runId: uuid('run_id')
      .notNull()
      .references(() => pipelineRun.id),
    provider: text('provider').notNull().default('worktree'),
    workingPath: text('working_path').notNull(),
    branchName: text('branch_name').notNull(),
    status: text('status').notNull().default('active'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    artifactsPath: text('artifacts_path'),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('isolation_env_active_idx')
      .on(t.projectId, t.runId)
      .where(sql`status = 'active'`),
    index('isolation_env_project_status_idx').on(t.projectId, t.status),
  ]
);

// ─── Routing ────────────────────────────────────────────────────────────────

export const provider = pgTable('provider', {
  id,
  orgId: uuid('org_id')
    .notNull()
    .references(() => organization.id),
  name: text('name').notNull(),
  type: text('type').notNull(),
  baseUrl: text('base_url'),
  apiKeyRef: text('api_key_ref'),
  isHealthy: boolean('is_healthy').default(true),
  createdAt,
  updatedAt,
});

export const model = pgTable('model', {
  id,
  providerId: uuid('provider_id')
    .notNull()
    .references(() => provider.id),
  name: text('name').notNull(),
  identifier: text('identifier').notNull(),
  capabilities: jsonb('capabilities'),
  costPer1kInput: numeric('cost_per_1k_input', { precision: 10, scale: 6 }),
  costPer1kOutput: numeric('cost_per_1k_output', { precision: 10, scale: 6 }),
  createdAt,
  updatedAt,
});

export const routingProfile = pgTable('routing_profile', {
  id,
  orgId: uuid('org_id')
    .notNull()
    .references(() => organization.id),
  name: text('name').notNull(),
  description: text('description'),
  isDefault: boolean('is_default').default(false),
  createdAt,
  updatedAt,
});

export const routingRule = pgTable('routing_rule', {
  id,
  profileId: uuid('profile_id')
    .notNull()
    .references(() => routingProfile.id),
  stageName: text('stage_name'),
  allowedModelsPattern: text('allowed_models_pattern'),
  preferredDriver: text('preferred_driver'),
  fallbackDriver: text('fallback_driver'),
  sortStrategy: text('sort_strategy').default('quality'),
  maxCostUsd: numeric('max_cost_usd', { precision: 10, scale: 6 }),
  createdAt,
  updatedAt,
});

// ─── Personas & Skills ──────────────────────────────────────────────────────

export const persona = pgTable('persona', {
  id,
  scope: text('scope').notNull().default('project'),
  projectId: uuid('project_id').references(() => project.id),
  name: text('name').notNull(),
  soul: text('soul'),
  identity: jsonb('identity'),
  brandId: uuid('brand_id').references(() => brand.id),
  routingProfileId: uuid('routing_profile_id').references(
    () => routingProfile.id
  ),
  parentPersonaId: uuid('parent_persona_id'),
  createdAt,
  updatedAt,
});

export const skill = pgTable('skill', {
  id,
  scope: text('scope').notNull().default('project'),
  projectId: uuid('project_id').references(() => project.id),
  name: text('name').notNull(),
  description: text('description'),
  promptTemplate: text('prompt_template'),
  inputSchema: jsonb('input_schema'),
  outputSchema: jsonb('output_schema'),
  tags: jsonb('tags'),
  version: integer('version').default(1),
  createdAt,
  updatedAt,
});

export const personaSkill = pgTable(
  'persona_skill',
  {
    personaId: uuid('persona_id')
      .notNull()
      .references(() => persona.id),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skill.id),
    enabled: boolean('enabled').default(true),
    configOverrides: jsonb('config_overrides'),
    createdAt,
    updatedAt,
  },
  (t) => [primaryKey({ columns: [t.personaId, t.skillId] })]
);

export const team = pgTable('team', {
  id,
  projectId: uuid('project_id')
    .notNull()
    .references(() => project.id),
  name: text('name').notNull(),
  description: text('description'),
  createdAt,
  updatedAt,
});

export const teamMember = pgTable(
  'team_member',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id),
    personaId: uuid('persona_id')
      .notNull()
      .references(() => persona.id),
    role: text('role'),
    createdAt,
    updatedAt,
  },
  (t) => [primaryKey({ columns: [t.teamId, t.personaId] })]
);

// ─── Brand ──────────────────────────────────────────────────────────────────

export const brand = pgTable('brand', {
  id,
  orgId: uuid('org_id')
    .notNull()
    .references(() => organization.id),
  projectId: uuid('project_id'),
  name: text('name').notNull(),
  colors: jsonb('colors'),
  fonts: jsonb('fonts'),
  toneOfVoice: text('tone_of_voice'),
  styleGuide: text('style_guide'),
  logoUrl: text('logo_url'),
  createdAt,
  updatedAt,
});

// ─── Memory ─────────────────────────────────────────────────────────────────

export const memory = pgTable('memory', {
  id,
  scope: text('scope').notNull().default('project'),
  projectId: uuid('project_id').references(() => project.id),
  personaId: uuid('persona_id').references(() => persona.id),
  type: text('type').notNull(),
  content: text('content').notNull(),
  embedding: jsonb('embedding'),
  relevanceScore: numeric('relevance_score', { precision: 5, scale: 4 }),
  createdAt,
  updatedAt,
});

// ─── System ─────────────────────────────────────────────────────────────────

export const configEntry = pgTable(
  'config_entry',
  {
    id,
    scope: text('scope').notNull().default('global'),
    projectId: uuid('project_id').references(() => project.id),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    previousValue: jsonb('previous_value'),
    changedBy: text('changed_by'),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('config_entry_scope_project_key_idx').on(
      t.scope,
      t.projectId,
      t.key
    ),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════
// Relations
// ═══════════════════════════════════════════════════════════════════════════

export const organizationRelations = relations(organization, ({ many }) => ({
  users: many(user),
  projects: many(project),
  providers: many(provider),
  routingProfiles: many(routingProfile),
  brands: many(brand),
}));

export const userRelations = relations(user, ({ one, many }) => ({
  organization: one(organization, {
    fields: [user.orgId],
    references: [organization.id],
  }),
  projects: many(project),
}));

export const projectRelations = relations(project, ({ one, many }) => ({
  organization: one(organization, {
    fields: [project.orgId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [project.userId],
    references: [user.id],
  }),
  pipelines: many(pipeline),
  issues: many(issue),
  teams: many(team),
  isolationEnvironments: many(isolationEnvironment),
}));

export const isolationEnvironmentRelations = relations(
  isolationEnvironment,
  ({ one }) => ({
    project: one(project, {
      fields: [isolationEnvironment.projectId],
      references: [project.id],
    }),
    pipelineRun: one(pipelineRun, {
      fields: [isolationEnvironment.runId],
      references: [pipelineRun.id],
    }),
  })
);

export const pipelineRelations = relations(pipeline, ({ one, many }) => ({
  project: one(project, {
    fields: [pipeline.projectId],
    references: [project.id],
  }),
  stages: many(pipelineStage),
  runs: many(pipelineRun),
}));

export const driverRelations = relations(driver, ({ many }) => ({
  pipelineStages: many(pipelineStage),
  stageRuns: many(stageRun),
}));

export const pipelineStageRelations = relations(
  pipelineStage,
  ({ one, many }) => ({
    pipeline: one(pipeline, {
      fields: [pipelineStage.pipelineId],
      references: [pipeline.id],
    }),
    persona: one(persona, {
      fields: [pipelineStage.personaId],
      references: [persona.id],
    }),
    skillEntry: one(skill, {
      fields: [pipelineStage.skillId],
      references: [skill.id],
    }),
    driverEntry: one(driver, {
      fields: [pipelineStage.driverId],
      references: [driver.id],
    }),
    stageRuns: many(stageRun),
  })
);

export const pipelineRunRelations = relations(pipelineRun, ({ one, many }) => ({
  pipeline: one(pipeline, {
    fields: [pipelineRun.pipelineId],
    references: [pipeline.id],
  }),
  issue: one(issue, {
    fields: [pipelineRun.issueId],
    references: [issue.id],
  }),
  stageRuns: many(stageRun),
}));

export const stageRunRelations = relations(stageRun, ({ one, many }) => ({
  pipelineRun: one(pipelineRun, {
    fields: [stageRun.pipelineRunId],
    references: [pipelineRun.id],
  }),
  pipelineStage: one(pipelineStage, {
    fields: [stageRun.pipelineStageId],
    references: [pipelineStage.id],
  }),
  skillEntry: one(skill, {
    fields: [stageRun.skillId],
    references: [skill.id],
  }),
  driverEntry: one(driver, {
    fields: [stageRun.driverId],
    references: [driver.id],
  }),
  events: many(event),
  gateResults: many(stageGateResult),
}));

export const stageGateResultRelations = relations(
  stageGateResult,
  ({ one }) => ({
    stageRun: one(stageRun, {
      fields: [stageGateResult.stageRunId],
      references: [stageRun.id],
    }),
  })
);

export const eventRelations = relations(event, ({ one }) => ({
  stageRun: one(stageRun, {
    fields: [event.stageRunId],
    references: [stageRun.id],
  }),
}));

export const issueRelations = relations(issue, ({ one, many }) => ({
  project: one(project, {
    fields: [issue.projectId],
    references: [project.id],
  }),
  state: one(issueState, {
    fields: [issue.stateId],
    references: [issueState.id],
  }),
  status: one(issueStatus, {
    fields: [issue.statusId],
    references: [issueStatus.id],
  }),
  type: one(issueType, {
    fields: [issue.typeId],
    references: [issueType.id],
  }),
  priority: one(issuePriority, {
    fields: [issue.priorityId],
    references: [issuePriority.id],
  }),
  events: many(issueEvent),
  comments: many(issueComment),
  pipelineRuns: many(pipelineRun),
}));

export const issueEventRelations = relations(issueEvent, ({ one }) => ({
  issue: one(issue, {
    fields: [issueEvent.issueId],
    references: [issue.id],
  }),
}));

export const issueCommentRelations = relations(issueComment, ({ one }) => ({
  issue: one(issue, {
    fields: [issueComment.issueId],
    references: [issue.id],
  }),
}));

export const issueTypeRelations = relations(issueType, ({ many }) => ({
  issues: many(issue),
}));

export const issueStateRelations = relations(issueState, ({ many }) => ({
  issues: many(issue),
}));

export const issueStatusRelations = relations(issueStatus, ({ many }) => ({
  issues: many(issue),
}));

export const issuePriorityRelations = relations(issuePriority, ({ many }) => ({
  issues: many(issue),
}));

export const providerRelations = relations(provider, ({ one, many }) => ({
  organization: one(organization, {
    fields: [provider.orgId],
    references: [organization.id],
  }),
  models: many(model),
}));

export const modelRelations = relations(model, ({ one }) => ({
  provider: one(provider, {
    fields: [model.providerId],
    references: [provider.id],
  }),
}));

export const routingProfileRelations = relations(
  routingProfile,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [routingProfile.orgId],
      references: [organization.id],
    }),
    rules: many(routingRule),
    personas: many(persona),
  })
);

export const routingRuleRelations = relations(routingRule, ({ one }) => ({
  profile: one(routingProfile, {
    fields: [routingRule.profileId],
    references: [routingProfile.id],
  }),
}));

export const personaRelations = relations(persona, ({ one, many }) => ({
  project: one(project, {
    fields: [persona.projectId],
    references: [project.id],
  }),
  brand: one(brand, {
    fields: [persona.brandId],
    references: [brand.id],
  }),
  routingProfile: one(routingProfile, {
    fields: [persona.routingProfileId],
    references: [routingProfile.id],
  }),
  parent: one(persona, {
    fields: [persona.parentPersonaId],
    references: [persona.id],
  }),
  personaSkills: many(personaSkill),
  teamMemberships: many(teamMember),
  pipelineStages: many(pipelineStage),
}));

export const skillRelations = relations(skill, ({ one, many }) => ({
  project: one(project, {
    fields: [skill.projectId],
    references: [project.id],
  }),
  personaSkills: many(personaSkill),
  pipelineStages: many(pipelineStage),
  stageRuns: many(stageRun),
}));

export const personaSkillRelations = relations(personaSkill, ({ one }) => ({
  persona: one(persona, {
    fields: [personaSkill.personaId],
    references: [persona.id],
  }),
  skill: one(skill, {
    fields: [personaSkill.skillId],
    references: [skill.id],
  }),
}));

export const teamRelations = relations(team, ({ one, many }) => ({
  project: one(project, {
    fields: [team.projectId],
    references: [project.id],
  }),
  members: many(teamMember),
}));

export const teamMemberRelations = relations(teamMember, ({ one }) => ({
  team: one(team, {
    fields: [teamMember.teamId],
    references: [team.id],
  }),
  persona: one(persona, {
    fields: [teamMember.personaId],
    references: [persona.id],
  }),
}));

export const brandRelations = relations(brand, ({ one, many }) => ({
  organization: one(organization, {
    fields: [brand.orgId],
    references: [organization.id],
  }),
  personas: many(persona),
}));

export const memoryRelations = relations(memory, ({ one }) => ({
  project: one(project, {
    fields: [memory.projectId],
    references: [project.id],
  }),
  persona: one(persona, {
    fields: [memory.personaId],
    references: [persona.id],
  }),
}));
