import { relations } from 'drizzle-orm';
import {
  boolean,
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

export const project = pgTable(
  'project',
  {
    id,
    orgId: uuid('org_id')
      .notNull()
      .references(() => organization.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    repoUrl: text('repo_url'),
    defaultPipelineId: uuid('default_pipeline_id'),
    brandId: uuid('brand_id'),
    createdAt,
    updatedAt,
  },
  (t) => [uniqueIndex('project_org_slug_idx').on(t.orgId, t.slug)]
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
  harness: text('harness'),
  timeoutSec: integer('timeout_sec').default(300),
  maxRetries: integer('max_retries').default(0),
  gateMode: text('gate_mode').default('auto'),
  gateRules: jsonb('gate_rules'),
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
  harness: text('harness'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).default('0'),
  tokensIn: integer('tokens_in').default(0),
  tokensOut: integer('tokens_out').default(0),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
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

// ─── Issues ─────────────────────────────────────────────────────────────────

export const issue = pgTable('issue', {
  id,
  projectId: uuid('project_id')
    .notNull()
    .references(() => project.id),
  title: text('title').notNull(),
  description: text('description'),
  state: text('state').notNull().default('open'),
  priority: text('priority').default('medium'),
  type: text('type').default('task'),
  createdBy: text('created_by'),
  source: text('source').default('internal'),
  createdAt,
  updatedAt,
});

export const issueEvent = pgTable('issue_event', {
  id,
  issueId: uuid('issue_id')
    .notNull()
    .references(() => issue.id),
  type: text('type').notNull(),
  payload: jsonb('payload'),
  timestamp: timestamp('timestamp', { withTimezone: true })
    .defaultNow()
    .notNull(),
  createdAt,
});

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
  preferredHarness: text('preferred_harness'),
  fallbackHarness: text('fallback_harness'),
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

export const configEntry = pgTable('config_entry', {
  id,
  scope: text('scope').notNull().default('global'),
  key: text('key').notNull(),
  value: jsonb('value').notNull(),
  previousValue: jsonb('previous_value'),
  changedBy: text('changed_by'),
  createdAt,
  updatedAt,
});

// ═══════════════════════════════════════════════════════════════════════════
// Relations
// ═══════════════════════════════════════════════════════════════════════════

export const organizationRelations = relations(organization, ({ many }) => ({
  projects: many(project),
  providers: many(provider),
  routingProfiles: many(routingProfile),
  brands: many(brand),
}));

export const projectRelations = relations(project, ({ one, many }) => ({
  organization: one(organization, {
    fields: [project.orgId],
    references: [organization.id],
  }),
  pipelines: many(pipeline),
  issues: many(issue),
  teams: many(team),
}));

export const pipelineRelations = relations(pipeline, ({ one, many }) => ({
  project: one(project, {
    fields: [pipeline.projectId],
    references: [project.id],
  }),
  stages: many(pipelineStage),
  runs: many(pipelineRun),
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
  events: many(event),
}));

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
  events: many(issueEvent),
  pipelineRuns: many(pipelineRun),
}));

export const issueEventRelations = relations(issueEvent, ({ one }) => ({
  issue: one(issue, {
    fields: [issueEvent.issueId],
    references: [issue.id],
  }),
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
