# FLX-239 Stage 1 — Schema Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the tenancy + waterfall schema in one PR. New tenancy tables (customer/team/team_member/project_member), new waterfall scope columns on six feature tables, drop pre-existing collision columns, replace unique indexes for catalog-scope, add the project.org_id denormalization trigger. No app code consumes the new shape yet — that's Stages 2-7.

**Architecture:** Drizzle schema definition in `src/core/db/schema.ts` is the source of truth; `npm run db:generate` emits migration SQL into `drizzle/`. Triggers and partial indexes are hand-written into the migration file (Drizzle codegen doesn't emit them). The nuke script and three known-affected e2e specs are updated atomically with the schema.

**Tech Stack:** Drizzle ORM, Postgres 15 (Supabase Cloud), TypeScript 5, Vitest (integration tests against real Supabase).

**Spec:** `docs/superpowers/specs/2026-05-18-tenancy-waterfall-design.md`
**Epic plan:** `docs/superpowers/plans/2026-05-18-tenancy-waterfall-epic.md` (Stage 1 section)
**Branch:** `flx-239-stage-1-schema`
**Linear:** FLX-239 (status stays In Progress through this stage)

---

## File Structure

**Modified:**
- `src/core/db/schema.ts` — biggest file. Adds `customer` table, drops old `team`/`team_member`, adds new `team`/`team_member`/`project_member`, modifies `organization`/`project`/`persona`/`skill`/`brand`/`provider`/`driver`/`routingProfile`, updates relations (`personaRelations`, `skillRelations`, drops old `teamRelations`/`teamMemberRelations` and re-creates with new shape).
- `src/scripts/db/nuke.ts` — table list updated for new shape (add `customer`, `project_member`; team_member already in list but its schema is replaced; remove drops for catalog-rich rows that will simply be reseeded).
- `e2e/team-crud.spec.ts` — `test.skip(...)` with FLX-239 reference.
- `e2e/flx-252-create-entity-form.spec.ts` — `test.skip(...)` with FLX-239 reference.
- `e2e/settings-url-context.spec.ts` — `test.skip(...)` with FLX-239 reference.

**Created (one drizzle migration file, hand-edited after `db:generate`):**
- `drizzle/0030_flx_239_tenancy_waterfall.sql` — combined migration with all schema changes, ordered for safety.

**Not modified in this stage (deferred to later):**
- Any router under `src/server/routers/` — Stage 5.
- Any page under `src/app/[org]/[user]/[project]/**` — Stage 4.
- `src/scripts/db/seed.ts` — Stage 2.
- Feature consumers (`src/core/services/*`, `src/core/orchestrator/*`, `src/adapters/*`) — Stage 6.
- Slug columns — Stage 8.

---

## Pre-flight (do once before starting any task)

- [ ] **PF1: Create worktree + branch**

```bash
cd /mnt/dev/fluxaos
fhc worktree create flx-239-stage-1-schema
# cd to the printed path
```

- [ ] **PF2: Confirm branch and clean state**

Run: `git status --short --branch`
Expected: `## flx-239-stage-1-schema...` with no working-tree changes.

- [ ] **PF3: Confirm dev DB is reachable**

Run: `echo "$DIRECT_URL" | head -c 60`
Expected: a URL containing `dpdjlnpvxkepkwzwuvim` (the dev Supabase project ref). If it shows `zesinfsluyxiwzldeffa` (UAT) or empty, STOP and surface a `.env.local` config error — nuke must not run against UAT.

- [ ] **PF4: Note the current migration journal head**

Run: `tail -10 drizzle/meta/_journal.json`
Expected output ends at `0029_flx_221_project_target_repo_path`. The new migration will be `0030`. If a different number appears, use `<next>_flx_239_tenancy_waterfall.sql` and update the references in this plan accordingly.

---

## Task 1: RLS policy audit

Postgres drops policies on a dropped table, but policies on *other* tables that reference a dropped table can fail. The old `team` and `team_member` tables are being dropped; we must confirm no other RLS policy reaches into them.

**Files:**
- No files modified. This is an audit step that produces a captured log committed alongside Task 2.

- [ ] **Step 1.1: Query the dev DB for any RLS policies referencing the old team tables**

Run: `psql "$DIRECT_URL" -c "SELECT schemaname, tablename, policyname, qual::text, with_check::text FROM pg_policies WHERE qual::text ILIKE '%team%' OR qual::text ILIKE '%team_member%' OR with_check::text ILIKE '%team%' OR with_check::text ILIKE '%team_member%';" 2>&1 | tee /tmp/flx-239-stage-1-rls-audit.txt`
Expected: zero rows (no policies referencing team semantically) OR a small set of policies. If non-empty, each row needs an entry in Task 2's migration to either DROP the policy or rewrite it. If `psql` isn't available, use `npx tsx -e` with a query via the Supabase JS client.

- [ ] **Step 1.2: Determine handling for each policy (if any returned)**

For each row in the audit:
- If the policy is on a table being dropped (`team`, `team_member`) — no action needed; Postgres drops the policy with the table.
- If the policy is on a table NOT being dropped but references `team`/`team_member` — must `DROP POLICY ... ON ...` in Task 2's migration. Write the exact `DROP POLICY` statement and add it to a note for Task 2.

- [ ] **Step 1.3: Commit the audit log to the branch**

```bash
mkdir -p docs/superpowers/audits
cp /tmp/flx-239-stage-1-rls-audit.txt docs/superpowers/audits/2026-05-18-flx-239-stage-1-rls.txt
git add docs/superpowers/audits/2026-05-18-flx-239-stage-1-rls.txt
git commit -m "audit(rls): pre-migration policy audit for FLX-239 Stage 1

Captures the state of pg_policies referencing team/team_member before
the tenancy migration drops those tables. Empty result = no DROP POLICY
statements needed in the migration. Non-empty = each is addressed in
the migration file.

Refs FLX-239"
```

---

## Task 2: Drizzle schema rewrite — tenancy tables

Modify `src/core/db/schema.ts` to add `customer`, replace `team`/`team_member`, add `project_member`. Drop `project.userId` FK. Add `project.teamId`. Drop pre-existing collision columns on `persona`, `skill`, `brand`.

**Files:**
- Modify: `src/core/db/schema.ts:28-39` (organization — add `customerId`)
- Modify: `src/core/db/schema.ts:63-92` (project — drop `userId`, add `teamId`, drop `project_user_slug_idx`)
- Modify: `src/core/db/schema.ts:716-732` (persona — drop `scope`, drop `projectId`)
- Modify: `src/core/db/schema.ts:734-750` (skill — drop `scope`, drop `projectId`)
- Modify: `src/core/db/schema.ts:797-826` (team / team_member — full rewrite)
- Modify: `src/core/db/schema.ts:828-846` (brand — drop `projectId`)
- Modify: `src/core/db/schema.ts:1132-1191` (personaRelations, skillRelations, teamRelations, teamMemberRelations — rewrite)

- [ ] **Step 2.1: Read the current schema sections to mentally diff**

Run: `sed -n '28,92p;716,750p;797,826p;828,846p' src/core/db/schema.ts`
This shows the pre-modification text of all sections this task edits. Don't edit yet; you're confirming the line numbers in this plan are accurate.

- [ ] **Step 2.2: Add `customer` table BEFORE `organization`**

Edit `src/core/db/schema.ts`. Insert at line 27 (just before `export const organization`), after the helpers section:

```typescript
// ─── Customer (FLX-239 placeholder; not in use until billing epic) ──────────
// Per spec docs/superpowers/specs/2026-05-18-tenancy-waterfall-design.md
// `## Customer placeholder`: schema column reserved but no routers/UI/auth
// depend on it. The seed inserts one default customer row and points the
// default org at it.
export const customer = pgTable('customer', {
  id,
  externalBillingId: text('external_billing_id'),
  createdAt,
  updatedAt,
});
```

- [ ] **Step 2.3: Add `customerId` to `organization`**

In the `organization` table (line 28-39 of pre-edit), add `customerId` between `slug` and `settings`. The result:

```typescript
export const organization = pgTable('organization', {
  id,
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  // FLX-239: placeholder. Nullable, no FK constraint. Reserved for billing.
  customerId: uuid('customer_id'),
  settings: jsonb('settings'),
  subscriptionTier: text('subscription_tier').notNull().default('free'),
  createdAt,
  updatedAt,
});
```

- [ ] **Step 2.4: Rewrite the `project` table (drop userId, add teamId, drop project_user_slug_idx)**

Replace lines 63-92 with:

```typescript
export const project = pgTable('project', {
  id,
  orgId: uuid('org_id')
    .notNull()
    .references(() => organization.id),
  // FLX-239: project belongs to a team. trigger overwrites org_id from
  // team.org_id (see drizzle/0030_flx_239_tenancy_waterfall.sql).
  teamId: uuid('team_id')
    .notNull()
    .references(() => team.id),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  repoUrl: text('repo_url'),
  defaultBranch: text('default_branch').notNull().default('main'),
  worktreeCopyFiles: jsonb('worktree_copy_files')
    .notNull()
    .default(sql`'[]'::jsonb`),
  defaultPipelineId: uuid('default_pipeline_id'),
  brandId: uuid('brand_id'),
  // FLX-221: absolute path to the on-disk clone of this project's target repo.
  targetRepoPath: text('target_repo_path'),
  createdAt,
  updatedAt,
});
```

Note: the old `(t) => [uniqueIndex('project_user_slug_idx').on(t.userId, t.slug)]` is dropped — the column it indexed is gone. No replacement index in Stage 1 (slug is in URL → unique constraint comes back in Stage 4 or Stage 8 when slugs are removed entirely).

- [ ] **Step 2.5: Drop `persona.scope` and `persona.projectId` (and unrelated cleanup: keep brandId, routingProfileId, parentPersonaId untouched)**

Replace lines 716-732 with:

```typescript
export const persona = pgTable('persona', {
  id,
  // FLX-239 waterfall scope columns. CHECK constraint enforced by migration
  // SQL: exactly one of org_id/team_id/user_id/project_id is non-null AND
  // kind matches that layer, OR all four null AND kind = 'catalog'.
  orgId: uuid('org_id'),
  teamId: uuid('team_id'),
  userId: uuid('user_id'),
  projectId: uuid('project_id'),
  kind: text('kind').notNull().default('catalog'),
  name: text('name').notNull(),
  soul: text('soul'),
  identity: jsonb('identity'),
  brandId: uuid('brand_id').references(() => brand.id),
  routingProfileId: uuid('routing_profile_id').references(
    () => routingProfile.id
  ),
  parentPersonaId: uuid('parent_persona_id'),
  // Optimistic concurrency token — required by RecordEditor (FLX-124).
  version: integer('version').notNull().default(1),
  createdAt,
  updatedAt,
});
```

Note: the old `scope: text('scope').notNull().default('project')` is GONE. The old `projectId: uuid('project_id').references(() => project.id)` is GONE (replaced by the waterfall `projectId` which has no FK constraint — references the project for the project-scope case but is enforced via the CHECK + by-convention application logic).

- [ ] **Step 2.6: Drop `skill.scope` and `skill.projectId`**

Replace lines 734-750 with:

```typescript
export const skill = pgTable('skill', {
  id,
  // FLX-239 waterfall scope columns.
  orgId: uuid('org_id'),
  teamId: uuid('team_id'),
  userId: uuid('user_id'),
  projectId: uuid('project_id'),
  kind: text('kind').notNull().default('catalog'),
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
```

- [ ] **Step 2.7: Rewrite `team` and `team_member` (full replacement)**

Replace lines 797-826 with:

```typescript
// FLX-239: team is a permission group of HUMAN users (not AI personas).
// org_id is immutable post-create (no team-org-move procedure in v1).
export const team = pgTable('team', {
  id,
  orgId: uuid('org_id')
    .notNull()
    .references(() => organization.id),
  name: text('name').notNull(),
  description: text('description'),
  // Optimistic concurrency token — required by RecordEditor (FLX-124).
  version: integer('version').notNull().default(1),
  createdAt,
  updatedAt,
});

// FLX-239: humans-only. (user_id, team_id) is the PK.
export const teamMember = pgTable(
  'team_member',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id),
    role: text('role'),
    createdAt,
    updatedAt,
  },
  (t) => [primaryKey({ columns: [t.userId, t.teamId] })]
);

// FLX-239: per-user explicit project grants (independent of team_member).
export const projectMember = pgTable(
  'project_member',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    role: text('role'),
    createdAt,
    updatedAt,
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectId] })]
);
```

- [ ] **Step 2.8: Drop `brand.projectId`, add waterfall scope columns**

Replace lines 828-846 with:

```typescript
export const brand = pgTable('brand', {
  id,
  // FLX-239 waterfall scope columns.
  orgId: uuid('org_id'),
  teamId: uuid('team_id'),
  userId: uuid('user_id'),
  projectId: uuid('project_id'),
  kind: text('kind').notNull().default('catalog'),
  name: text('name').notNull(),
  colors: jsonb('colors'),
  fonts: jsonb('fonts'),
  toneOfVoice: text('tone_of_voice'),
  styleGuide: text('style_guide'),
  logoUrl: text('logo_url'),
  // Optimistic concurrency token — required by RecordEditor (FLX-124).
  version: integer('version').notNull().default(1),
  createdAt,
  updatedAt,
});
```

Note: the old `brand.orgId NOT NULL` is GONE (now nullable as part of the waterfall). The old vestigial `brand.projectId uuid` is REPLACED by the waterfall `projectId` (same column name, no FK).

- [ ] **Step 2.9: Add waterfall columns to `provider`, `driver`, `routingProfile`. Drop NOT NULL on existing `orgId` columns.**

Replace lines 652-670 (provider) with:

```typescript
export const provider = pgTable(
  'provider',
  {
    id,
    // FLX-239 waterfall scope columns. orgId was NOT NULL pre-FLX-239.
    orgId: uuid('org_id'),
    teamId: uuid('team_id'),
    userId: uuid('user_id'),
    projectId: uuid('project_id'),
    kind: text('kind').notNull().default('catalog'),
    name: text('name').notNull(),
    type: text('type').notNull(),
    baseUrl: text('base_url'),
    apiKeyRef: text('api_key_ref'),
    isHealthy: boolean('is_healthy').default(true),
    // Optimistic concurrency token — required by RecordEditor (FLX-124).
    version: integer('version').notNull().default(1),
    createdAt,
    updatedAt,
  },
  // Old `uniqueIndex('provider_org_id_name_idx').on(t.orgId, t.name)` removed;
  // replaced by partial unique indexes in the migration SQL (see
  // drizzle/0030_flx_239_tenancy_waterfall.sql).
  () => []
);
```

Replace lines 230-257 (`driver` table) with the complete block below. The driver table has 17 existing columns; all are preserved verbatim, with the five new waterfall columns inserted between `id,` and `name`:

```typescript
export const driver = pgTable('driver', {
  id,
  // FLX-239 waterfall scope columns.
  orgId: uuid('org_id'),
  teamId: uuid('team_id'),
  userId: uuid('user_id'),
  projectId: uuid('project_id'),
  kind: text('kind').notNull().default('catalog'),
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
  contextLayout: jsonb('context_layout').notNull(),
  isEnabled: boolean('is_enabled').notNull().default(true),
  notes: text('notes'),
  version: integer('version').notNull().default(1),
  createdAt,
  updatedAt,
});
```

Replace `routingProfile` (lines 686-698) with:

```typescript
export const routingProfile = pgTable('routing_profile', {
  id,
  // FLX-239 waterfall scope columns. orgId was NOT NULL pre-FLX-239.
  orgId: uuid('org_id'),
  teamId: uuid('team_id'),
  userId: uuid('user_id'),
  projectId: uuid('project_id'),
  kind: text('kind').notNull().default('catalog'),
  name: text('name').notNull(),
  description: text('description'),
  isDefault: boolean('is_default').default(false),
  // Optimistic concurrency token — required by RecordEditor (FLX-124).
  version: integer('version').notNull().default(1),
  createdAt,
  updatedAt,
});
```

- [ ] **Step 2.10: Update `personaRelations` and `skillRelations`**

Drops to make in `personaRelations` (live line 1132-1152):
- DROP `project: one(project, { fields: [persona.projectId], ... })` — column was dropped in Step 2.5.
- DROP `teamMemberships: many(teamMember)` — old team_member had a `personaId` FK; the new team_member table has no persona FK.
- KEEP `brand`, `routingProfile`, `parent`, `personaSkills`, `pipelineStages` relations.

Drops to make in `skillRelations` (live line 1154-1161):
- DROP `project: one(project, { fields: [skill.projectId], ... })` — column was dropped in Step 2.6.
- KEEP `personaSkills`, `stageRuns` relations.

Replace lines 1132-1161:

```typescript
export const personaRelations = relations(persona, ({ one, many }) => ({
  // FLX-239: project relation removed; persona.projectId is now a waterfall
  // scope column with no FK, not a parent relation. Brand, routingProfile,
  // parent-persona relations remain.
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
  pipelineStages: many(pipelineStage),
  // FLX-239: teamMemberships removed (old team_member used persona_id; new
  // team_member uses user_id).
}));

export const skillRelations = relations(skill, ({ many }) => ({
  // FLX-239: project relation removed (waterfall scope column, no FK).
  personaSkills: many(personaSkill),
  stageRuns: many(stageRun),
}));
```

- [ ] **Step 2.11: Replace `teamRelations` and `teamMemberRelations`. Add `projectMemberRelations`.**

Replace lines 1174-1191:

```typescript
export const teamRelations = relations(team, ({ one, many }) => ({
  organization: one(organization, {
    fields: [team.orgId],
    references: [organization.id],
  }),
  members: many(teamMember),
  projects: many(project),
}));

export const teamMemberRelations = relations(teamMember, ({ one }) => ({
  user: one(user, {
    fields: [teamMember.userId],
    references: [user.id],
  }),
  team: one(team, {
    fields: [teamMember.teamId],
    references: [team.id],
  }),
}));

export const projectMemberRelations = relations(projectMember, ({ one }) => ({
  user: one(user, {
    fields: [projectMember.userId],
    references: [user.id],
  }),
  project: one(project, {
    fields: [projectMember.projectId],
    references: [project.id],
  }),
}));
```

- [ ] **Step 2.12: Update `projectRelations` (drop user relation, add team relation, add members)**

Find `projectRelations` (line 930). Replace its body with:

```typescript
export const projectRelations = relations(project, ({ one, many }) => ({
  organization: one(organization, {
    fields: [project.orgId],
    references: [organization.id],
  }),
  // FLX-239: project belongs to a team; user relation removed.
  team: one(team, {
    fields: [project.teamId],
    references: [team.id],
  }),
  brand: one(brand, {
    fields: [project.brandId],
    references: [brand.id],
  }),
  members: many(projectMember),
  pipelines: many(pipeline),
  issues: many(issue),
  // Preserve other relations the current projectRelations declares. Read the
  // current block first and merge accordingly.
}));
```

When applying, read the current `projectRelations` block first (around lines 930-944) and preserve any relations not listed here.

- [ ] **Step 2.13: Update `userRelations` and `organizationRelations` for the new memberships**

Find `userRelations` (line 922). Add to it:

```typescript
export const userRelations = relations(user, ({ one, many }) => ({
  organization: one(organization, {
    fields: [user.orgId],
    references: [organization.id],
  }),
  // FLX-239: user membership relations.
  teamMemberships: many(teamMember),
  projectMemberships: many(projectMember),
  // ... preserve other relations from the current block ...
}));
```

Find `organizationRelations` (line 914). Add `teams: many(team)` and `customer: one(customer, { fields: [organization.customerId], references: [customer.id] })` to its body.

Add a new `customerRelations` after `organizationRelations`:

```typescript
export const customerRelations = relations(customer, ({ many }) => ({
  organizations: many(organization),
}));
```

- [ ] **Step 2.13b: Add auth-identity invariant comment on `user.id`**

Per epic plan: "Stage 1 adds a SQL comment on the `user.id` column referencing the spec." Find the `user` table definition (line 41-61). Insert a JSDoc comment immediately above `id,` inside the `pgTable('user', { ... })` body:

```typescript
export const user = pgTable(
  'user',
  {
    // FLX-239 invariant: user.id === auth.users.id. The fluxaOS user row's
    // primary key is the same UUID as the corresponding Supabase auth account.
    // The seed enforces this; trpc.ts's viewer resolver depends on it.
    // See docs/superpowers/specs/2026-05-18-tenancy-waterfall-design.md
    // §"Auth identity contract".
    id,
    // ... rest of the table definition unchanged ...
```

- [ ] **Step 2.14: Type-check the schema**

Run: `npx tsc --noEmit src/core/db/schema.ts`
Expected: PASS (zero errors). If errors, every error references a line in `schema.ts`; fix and re-run. Common errors at this step: missing relation fields, dropped column still referenced in a relation.

- [ ] **Step 2.15: Run a broader build to surface downstream type errors**

Run: `npx tsc --noEmit 2>&1 | head -60`
Expected: many errors in `src/server/routers/*` and `src/lib/resolve-context.ts` referring to `persona.scope`, `skill.projectId`, `team.projectId`, `project.userId`, `teamMember.personaId` etc.

**These errors are expected and intentional.** They will be fixed in Stages 5–6. For Stage 1, the build does NOT need to pass — `schema.ts` itself needs to type-check, but app code consuming the old shape stays broken on purpose. Document the count: `npx tsc --noEmit 2>&1 | grep -c "error TS"` and capture the number in the PR description.

- [ ] **Step 2.16: Commit the schema rewrite**

```bash
git add src/core/db/schema.ts
git commit -m "schema(flx-239): tenancy + waterfall scope columns

Adds customer, project_member, rewrites team/team_member, adds
waterfall scope columns + kind to persona/skill/brand/provider/
driver/routingProfile, drops pre-existing collision columns (persona.
scope, persona.projectId, skill.scope, skill.projectId, brand.
projectId, project.userId), adds project.teamId, drops project_user_
slug_idx and provider_org_id_name_idx (replaced by partial indexes in
migration SQL — see next commit).

Drizzle relations updated: personaRelations and skillRelations drop
the project relation (scope is now a column, not a FK); teamRelations
and teamMemberRelations rewritten for human-user membership;
projectMemberRelations added; userRelations/organizationRelations
extended with new memberships and customer FK.

App code under src/server/* and src/app/* will not type-check after
this commit — Stages 5-6 repair those. Stage 1 verification gate is
db:migrate clean + db:generate no drift + schema.ts type-check pass.

Refs FLX-239"
```

---

## Task 3: Drizzle migration SQL — generate + hand-edit

Drizzle's `db:generate` produces a baseline SQL file, but it cannot emit:
- Triggers (the `project.org_id` denormalization trigger).
- Partial unique indexes (the replacement for `provider_org_id_name_idx`).
- The correct DROP-INDEX-before-DROP-COLUMN ordering for `project_user_slug_idx`.

So: generate first, then hand-edit the file before applying.

**Files:**
- Create: `drizzle/0030_flx_239_tenancy_waterfall.sql` (generated; then hand-edited).
- Modify: `drizzle/meta/_journal.json` (updated by `db:generate`).
- Possibly: `drizzle/meta/0030_snapshot.json` (created by `db:generate`).

- [ ] **Step 3.1: Generate baseline migration SQL**

Run: `npm run db:generate`
Expected output: `drizzle/0030_<auto-name>.sql` is created. If the codegen names it something other than `0030_flx_239_tenancy_waterfall`, rename it with `git mv drizzle/0030_<auto>.sql drizzle/0030_flx_239_tenancy_waterfall.sql` AND update the `tag` field for the new entry in `drizzle/meta/_journal.json` to `0030_flx_239_tenancy_waterfall`. The journal `tag` MUST match the filename.

- [ ] **Step 3.2: Read the generated migration**

Run: `cat drizzle/0030_flx_239_tenancy_waterfall.sql`
Expected: a sequence of `CREATE TABLE`, `ALTER TABLE ADD COLUMN`, `ALTER TABLE DROP COLUMN`, `ALTER TABLE ADD CONSTRAINT` statements covering everything in Task 2's schema edits. The codegen will typically NOT include:
- Index drops before column drops.
- Triggers.
- Partial unique indexes.
- CHECK constraints for the waterfall (Drizzle doesn't emit table-level CHECK).

This is fine — we're about to hand-edit.

- [ ] **Step 3.3: Hand-edit the migration to ensure correct ordering and add missing constructs**

**Assembly approach:** the simplest reliable strategy is to **replace the entire generated file contents** with the structured Phase 1 → Phase 15 sequence below. This file is the source of truth; the Drizzle baseline that `db:generate` produced was just a starting reference. Phases below include every operation the baseline would have emitted (ADD COLUMN, DROP COLUMN, DROP NOT NULL, DROP CONSTRAINT, CREATE TABLE) PLUS the operations Drizzle can't express (trigger, partial indexes, CHECK, data UPDATEs, ordering guards). Because Postgres `DROP NOT NULL` and `DROP CONSTRAINT IF EXISTS` are idempotent, accidental duplication is harmless — but the explicit phase structure removes any ambiguity about ordering.

Open `drizzle/0030_flx_239_tenancy_waterfall.sql` and replace its contents with the structured file below. The full structure of the file after hand-editing:

```sql
-- FLX-239 Stage 1: tenancy + waterfall scope columns.
-- Spec: docs/superpowers/specs/2026-05-18-tenancy-waterfall-design.md
-- Plan: docs/superpowers/plans/2026-05-18-flx-239-stage-1-schema.md
--
-- Rip-and-replace migration. No backfill of old rows. CLAUDE.md `## Environments`
-- override authorizes this — no production, no real users.

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1: Drop old indexes that reference columns being dropped (must precede
-- DROP COLUMN — Drizzle codegen does NOT emit CASCADE by default).
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS "project_user_slug_idx";
DROP INDEX IF EXISTS "provider_org_id_name_idx";

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2: Drop the old tenancy tables. They will be recreated below with a
-- different shape.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS "team_member";
DROP TABLE IF EXISTS "team";

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3: Create customer (placeholder).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "customer" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "external_billing_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 4: Add organization.customer_id (placeholder; no FK, nullable).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "organization" ADD COLUMN "customer_id" uuid;

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 5: Create new team (humans-only).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "team" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organization"("id"),
  "name" text NOT NULL,
  "description" text,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 6: Create team_member (humans; PK user_id+team_id).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "team_member" (
  "user_id" uuid NOT NULL REFERENCES "user"("id"),
  "team_id" uuid NOT NULL REFERENCES "team"("id"),
  "role" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("user_id", "team_id")
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 7: Create project_member (PK user_id+project_id).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "project_member" (
  "user_id" uuid NOT NULL REFERENCES "user"("id"),
  "project_id" uuid NOT NULL REFERENCES "project"("id"),
  "role" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("user_id", "project_id")
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 8: Project — drop user_id FK, add team_id FK.
-- Note: project.user_id is dropped AFTER project_user_slug_idx (Phase 1).
-- Guard: `team_id NOT NULL` with no DEFAULT requires every existing row to
-- supply a value. Migration assumes nuke ran first. Fail fast with a clear
-- message if project has rows, rather than a cryptic "not-null violation".
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "project" LIMIT 1) THEN
    RAISE EXCEPTION 'FLX-239 Phase 8: project table must be empty before adding team_id NOT NULL. Run `tsx src/scripts/db/nuke.ts` first.';
  END IF;
END $$;
ALTER TABLE "project" DROP COLUMN "user_id";
ALTER TABLE "project" ADD COLUMN "team_id" uuid NOT NULL REFERENCES "team"("id");

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 9: Denormalization trigger — project.org_id always mirrors team.org_id.
-- Postgres CHECK can't cross rows; this trigger enforces the invariant.
--
-- IMPORTANT: trigger fires on ANY UPDATE (no `OF team_id` clause). Without
-- this, application code that does `UPDATE project SET org_id = X` would
-- silently bypass the invariant. The slightly higher overhead of re-reading
-- team.org_id on every project write is the correct trade.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION flx239_project_set_org_id_from_team()
RETURNS TRIGGER AS $$
BEGIN
  SELECT t.org_id INTO NEW.org_id FROM team t WHERE t.id = NEW.team_id;
  IF NEW.org_id IS NULL THEN
    RAISE EXCEPTION 'FLX-239: team % not found or has null org_id', NEW.team_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_set_org_id_from_team
  BEFORE INSERT OR UPDATE ON "project"
  FOR EACH ROW
  EXECUTE FUNCTION flx239_project_set_org_id_from_team();

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 10: Drop pre-existing collision columns on feature tables. Must precede
-- ADD COLUMN of new waterfall columns with the SAME name.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "persona" DROP COLUMN "scope";
ALTER TABLE "persona" DROP COLUMN "project_id";
ALTER TABLE "skill" DROP COLUMN "scope";
ALTER TABLE "skill" DROP COLUMN "project_id";
ALTER TABLE "brand" DROP COLUMN "project_id";

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 11: Add waterfall scope columns to feature tables. All four scope
-- columns are nullable; the CHECK constraint (Phase 13) enforces the invariant.
-- Existing rows get `kind = 'catalog'` by virtue of the default.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "persona" ADD COLUMN "org_id" uuid;
ALTER TABLE "persona" ADD COLUMN "team_id" uuid;
ALTER TABLE "persona" ADD COLUMN "user_id" uuid;
ALTER TABLE "persona" ADD COLUMN "project_id" uuid;
ALTER TABLE "persona" ADD COLUMN "kind" text NOT NULL DEFAULT 'catalog';

ALTER TABLE "skill" ADD COLUMN "org_id" uuid;
ALTER TABLE "skill" ADD COLUMN "team_id" uuid;
ALTER TABLE "skill" ADD COLUMN "user_id" uuid;
ALTER TABLE "skill" ADD COLUMN "project_id" uuid;
ALTER TABLE "skill" ADD COLUMN "kind" text NOT NULL DEFAULT 'catalog';

-- brand.org_id, provider.org_id, routing_profile.org_id all pre-exist (each
-- was NOT NULL FK to organization pre-FLX-239). Do NOT ADD COLUMN for those
-- — would error "column org_id already exists".
--
-- The DROP NOT NULL and DROP CONSTRAINT for those three columns are written
-- HERE (in Phase 11) explicitly rather than relying on Drizzle's db:generate
-- baseline emission ordering. Phase 12's UPDATE statements set org_id = NULL,
-- which requires the NOT NULL constraint to already be gone. Doing this
-- explicitly removes any dependency on where Drizzle places the generated
-- ALTER COLUMN relative to our hand-edited UPDATEs.
ALTER TABLE "brand" ALTER COLUMN "org_id" DROP NOT NULL;
ALTER TABLE "brand" DROP CONSTRAINT IF EXISTS "brand_org_id_organization_id_fk";
ALTER TABLE "provider" ALTER COLUMN "org_id" DROP NOT NULL;
ALTER TABLE "provider" DROP CONSTRAINT IF EXISTS "provider_org_id_organization_id_fk";
ALTER TABLE "routing_profile" ALTER COLUMN "org_id" DROP NOT NULL;
ALTER TABLE "routing_profile" DROP CONSTRAINT IF EXISTS "routing_profile_org_id_organization_id_fk";

ALTER TABLE "brand" ADD COLUMN "team_id" uuid;
ALTER TABLE "brand" ADD COLUMN "user_id" uuid;
ALTER TABLE "brand" ADD COLUMN "project_id" uuid;
ALTER TABLE "brand" ADD COLUMN "kind" text NOT NULL DEFAULT 'catalog';

ALTER TABLE "provider" ADD COLUMN "team_id" uuid;
ALTER TABLE "provider" ADD COLUMN "user_id" uuid;
ALTER TABLE "provider" ADD COLUMN "project_id" uuid;
ALTER TABLE "provider" ADD COLUMN "kind" text NOT NULL DEFAULT 'catalog';

ALTER TABLE "driver" ADD COLUMN "org_id" uuid;
ALTER TABLE "driver" ADD COLUMN "team_id" uuid;
ALTER TABLE "driver" ADD COLUMN "user_id" uuid;
ALTER TABLE "driver" ADD COLUMN "project_id" uuid;
ALTER TABLE "driver" ADD COLUMN "kind" text NOT NULL DEFAULT 'catalog';

ALTER TABLE "routing_profile" ADD COLUMN "team_id" uuid;
ALTER TABLE "routing_profile" ADD COLUMN "user_id" uuid;
ALTER TABLE "routing_profile" ADD COLUMN "project_id" uuid;
ALTER TABLE "routing_profile" ADD COLUMN "kind" text NOT NULL DEFAULT 'catalog';

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 12: Reset existing rows to catalog kind.
--
-- The DROP NOT NULL + DROP CONSTRAINT statements for org_id on brand,
-- provider, routing_profile were moved UP into Phase 11 (so they precede
-- the UPDATEs below — UPDATE org_id=NULL needs the NOT NULL to be gone).
-- Drizzle's db:generate baseline will also emit those ALTER statements
-- from the schema.ts changes; in Postgres `ALTER COLUMN DROP NOT NULL` is
-- idempotent and `DROP CONSTRAINT IF EXISTS` is safe, so the double-emission
-- is harmless.
--
-- The UPDATE statements below ARE needed (Drizzle doesn't emit data DML):
-- after the migration, existing rows that previously had `org_id` set must
-- be reset to all-null + kind='catalog' so the new CHECK constraint
-- (Phase 13) accepts them. Rip-and-replace authorized — these rows are
-- seed/dev/UAT data only.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "persona" SET kind = 'catalog', org_id = NULL, team_id = NULL, user_id = NULL, project_id = NULL;
UPDATE "skill" SET kind = 'catalog', org_id = NULL, team_id = NULL, user_id = NULL, project_id = NULL;
UPDATE "brand" SET kind = 'catalog', org_id = NULL, team_id = NULL, user_id = NULL, project_id = NULL;
UPDATE "provider" SET kind = 'catalog', org_id = NULL, team_id = NULL, user_id = NULL, project_id = NULL;
UPDATE "driver" SET kind = 'catalog', org_id = NULL, team_id = NULL, user_id = NULL, project_id = NULL;
UPDATE "routing_profile" SET kind = 'catalog', org_id = NULL, team_id = NULL, user_id = NULL, project_id = NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 13: CHECK constraints — exactly one of (org_id, team_id, user_id,
-- project_id) is non-null AND kind matches, OR all four null AND kind=catalog.
-- ─────────────────────────────────────────────────────────────────────────────
-- A small helper: a CASE that returns the kind implied by which column is set.
-- Implemented as one constraint per table.

ALTER TABLE "persona" ADD CONSTRAINT "persona_scope_check" CHECK (
  (org_id IS NOT NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'org')
  OR (org_id IS NULL AND team_id IS NOT NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'team')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NOT NULL AND project_id IS NULL AND kind = 'user')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NOT NULL AND kind = 'project')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'catalog')
);

ALTER TABLE "skill" ADD CONSTRAINT "skill_scope_check" CHECK (
  (org_id IS NOT NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'org')
  OR (org_id IS NULL AND team_id IS NOT NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'team')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NOT NULL AND project_id IS NULL AND kind = 'user')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NOT NULL AND kind = 'project')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'catalog')
);

ALTER TABLE "brand" ADD CONSTRAINT "brand_scope_check" CHECK (
  (org_id IS NOT NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'org')
  OR (org_id IS NULL AND team_id IS NOT NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'team')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NOT NULL AND project_id IS NULL AND kind = 'user')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NOT NULL AND kind = 'project')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'catalog')
);

ALTER TABLE "provider" ADD CONSTRAINT "provider_scope_check" CHECK (
  (org_id IS NOT NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'org')
  OR (org_id IS NULL AND team_id IS NOT NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'team')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NOT NULL AND project_id IS NULL AND kind = 'user')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NOT NULL AND kind = 'project')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'catalog')
);

ALTER TABLE "driver" ADD CONSTRAINT "driver_scope_check" CHECK (
  (org_id IS NOT NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'org')
  OR (org_id IS NULL AND team_id IS NOT NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'team')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NOT NULL AND project_id IS NULL AND kind = 'user')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NOT NULL AND kind = 'project')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'catalog')
);

ALTER TABLE "routing_profile" ADD CONSTRAINT "routing_profile_scope_check" CHECK (
  (org_id IS NOT NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'org')
  OR (org_id IS NULL AND team_id IS NOT NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'team')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NOT NULL AND project_id IS NULL AND kind = 'user')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NOT NULL AND kind = 'project')
  OR (org_id IS NULL AND team_id IS NULL AND user_id IS NULL AND project_id IS NULL AND kind = 'catalog')
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 14: Partial unique indexes. Standard UNIQUE doesn't enforce uniqueness
-- when columns are NULL, so we need FIVE partials per feature table — one per
-- scope layer (org, team, user, project) plus catalog — so that:
--   * Two catalog personas with the same name collide.
--   * Two org-scoped personas with the same (org_id, name) collide.
--   * Two team-scoped personas with the same (team_id, name) collide.
--   * ... and so on for user and project scopes.
-- This matches the assumption baked into resolveScopedAll's dedupeKey='name':
-- the helper uses DISTINCT ON (name) within a scope; without intra-scope
-- uniqueness, DISTINCT ON would pick one duplicate arbitrarily.
--
-- Audit confirmed: grep 'uniqueIndex.*org_id.*name' against schema.ts at
-- plan-write time returned ONLY 'provider_org_id_name_idx' (provider only;
-- routingProfile and brand have no such index). The replacement below
-- applies the pattern uniformly to all six waterfall feature tables.
-- ─────────────────────────────────────────────────────────────────────────────

-- Provider
CREATE UNIQUE INDEX "provider_org_name_uq" ON "provider" ("org_id", "name") WHERE org_id IS NOT NULL;
CREATE UNIQUE INDEX "provider_team_name_uq" ON "provider" ("team_id", "name") WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX "provider_user_name_uq" ON "provider" ("user_id", "name") WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX "provider_project_name_uq" ON "provider" ("project_id", "name") WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX "provider_catalog_name_uq" ON "provider" ("name") WHERE kind = 'catalog';

-- Persona
CREATE UNIQUE INDEX "persona_org_name_uq" ON "persona" ("org_id", "name") WHERE org_id IS NOT NULL;
CREATE UNIQUE INDEX "persona_team_name_uq" ON "persona" ("team_id", "name") WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX "persona_user_name_uq" ON "persona" ("user_id", "name") WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX "persona_project_name_uq" ON "persona" ("project_id", "name") WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX "persona_catalog_name_uq" ON "persona" ("name") WHERE kind = 'catalog';

-- Skill
CREATE UNIQUE INDEX "skill_org_name_uq" ON "skill" ("org_id", "name") WHERE org_id IS NOT NULL;
CREATE UNIQUE INDEX "skill_team_name_uq" ON "skill" ("team_id", "name") WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX "skill_user_name_uq" ON "skill" ("user_id", "name") WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX "skill_project_name_uq" ON "skill" ("project_id", "name") WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX "skill_catalog_name_uq" ON "skill" ("name") WHERE kind = 'catalog';

-- Brand
CREATE UNIQUE INDEX "brand_org_name_uq" ON "brand" ("org_id", "name") WHERE org_id IS NOT NULL;
CREATE UNIQUE INDEX "brand_team_name_uq" ON "brand" ("team_id", "name") WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX "brand_user_name_uq" ON "brand" ("user_id", "name") WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX "brand_project_name_uq" ON "brand" ("project_id", "name") WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX "brand_catalog_name_uq" ON "brand" ("name") WHERE kind = 'catalog';

-- Driver
CREATE UNIQUE INDEX "driver_org_name_uq" ON "driver" ("org_id", "name") WHERE org_id IS NOT NULL;
CREATE UNIQUE INDEX "driver_team_name_uq" ON "driver" ("team_id", "name") WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX "driver_user_name_uq" ON "driver" ("user_id", "name") WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX "driver_project_name_uq" ON "driver" ("project_id", "name") WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX "driver_catalog_name_uq" ON "driver" ("name") WHERE kind = 'catalog';

-- Routing Profile
CREATE UNIQUE INDEX "routing_profile_org_name_uq" ON "routing_profile" ("org_id", "name") WHERE org_id IS NOT NULL;
CREATE UNIQUE INDEX "routing_profile_team_name_uq" ON "routing_profile" ("team_id", "name") WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX "routing_profile_user_name_uq" ON "routing_profile" ("user_id", "name") WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX "routing_profile_project_name_uq" ON "routing_profile" ("project_id", "name") WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX "routing_profile_catalog_name_uq" ON "routing_profile" ("name") WHERE kind = 'catalog';

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 15: RLS policies (if any were found in Task 1).
-- ─────────────────────────────────────────────────────────────────────────────
-- If Task 1's audit found policies referencing team/team_member on tables that
-- are NOT being dropped, drop them here:
-- DROP POLICY "<policy_name>" ON "<table_name>";
-- (Audit log: docs/superpowers/audits/2026-05-18-flx-239-stage-1-rls.txt)
```

If Task 1's RLS audit was empty, the Phase 15 comment stays as documentation but no DROP POLICY statements are needed. If it was non-empty, add the exact statements from the audit log.

- [ ] **Step 3.4: Verify Drizzle journal is consistent**

Run: `cat drizzle/meta/_journal.json | tail -10`
Expected: the last entry has `"tag": "0030_flx_239_tenancy_waterfall"`. If not, fix the tag manually to match the filename.

- [ ] **Step 3.5: Verify the Drizzle snapshot reflects the schema**

Before committing, confirm `drizzle/meta/0030_snapshot.json` (created by Step 3.1's `db:generate`) is internally consistent with `schema.ts`. Spot-check:

```bash
jq '.tables.persona.columns | keys' drizzle/meta/0030_snapshot.json
# Expected: includes "id", "org_id", "team_id", "user_id", "project_id", "kind", "name"
# Does NOT include the old "scope" or old "project_id"-as-FK columns (those were dropped).

jq '.tables.provider.columns.org_id.notNull' drizzle/meta/0030_snapshot.json
# Expected: false (org_id is nullable after the migration).

jq '.tables.customer' drizzle/meta/0030_snapshot.json
# Expected: a non-null object (the customer table was added).
```

If any check fails, `db:generate` didn't run correctly. Re-run `npm run db:generate` and re-inspect. If the snapshot is wrong, Step 4.4's drift check will fail.

Note: Drizzle's snapshot does NOT track triggers, partial indexes, CHECK constraints, or hand-written `DO $$ ... $$` blocks. Those live only in the migration SQL file and are intentionally invisible to drift detection. This is the desired behavior.

- [ ] **Step 3.6: Commit the migration**

```bash
git add drizzle/0030_flx_239_tenancy_waterfall.sql drizzle/meta/_journal.json drizzle/meta/0030_snapshot.json
git commit -m "migration(flx-239): tenancy + waterfall schema migration

Hand-edited beyond Drizzle codegen baseline:
- DROP INDEX before DROP COLUMN (Drizzle doesn't emit CASCADE).
- DROP TABLE team/team_member before re-CREATE with new shape.
- Trigger: project.org_id mirrors team.org_id on every insert/update of team_id.
- Partial unique indexes replacing provider_org_id_name_idx and adding
  uniqueness for catalog-scope rows on every waterfall feature table.
- CHECK constraints enforcing the waterfall scope invariant (exactly
  one scope FK non-null + kind matches, OR all null + kind = catalog).

Refs FLX-239"
```

---

## Task 4: Test migration applies cleanly from scratch

The verification gate is: `tsx src/scripts/db/nuke.ts && npm run db:migrate` runs cleanly. Run it and capture output.

**Files:**
- No files modified (this is a verification task).

- [ ] **Step 4.1: Run nuke + migrate on dev DB**

Run: `npx tsx src/scripts/db/nuke.ts 2>&1 | tail -20`
Expected: every table reports "deleted N row(s)" or "skipped (table does not exist)". Exit code 0.

Then: `npm run db:migrate 2>&1 | tail -30`
Expected: every migration up to `0030_flx_239_tenancy_waterfall` reported as applied. Exit code 0.

If `db:migrate` fails:
- Read the error carefully. Common failures:
  - Phase 8 fails ("column user_id does not exist") → an earlier DROP COLUMN already happened in a prior incomplete run. Re-run nuke + migrate.
  - Phase 11 fails ("column kind already exists") → Phase 10 didn't drop a collision column correctly. Check the ALTER TABLE DROP COLUMN list.
  - Phase 13 CHECK fails ("constraint persona_scope_check is violated") → Phase 12's UPDATE didn't run, leaving rows with old scope values. The UPDATE statements must precede the ADD CONSTRAINT statements.
  - Phase 9 trigger fails ("function flx239_project_set_org_id_from_team already exists") → the migration is being re-run; use `CREATE OR REPLACE FUNCTION` (already in the SQL).
- Fix the SQL, commit a `fixup` to the migration file, retry.

- [ ] **Step 4.2: Verify the trigger works**

Run via psql or `npx tsx -e`. Wrap in a transaction so any failure rolls back cleanly without leaving audit rows behind:

```sql
BEGIN;
INSERT INTO organization (id, name, slug) VALUES ('00000000-0000-0000-0000-000000000001', 'audit', 'audit') RETURNING id;
INSERT INTO team (id, org_id, name) VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'audit team') RETURNING id;
INSERT INTO "user" (id, org_id, email, name, slug) VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'a@a', 'a', 'a');
-- Insert a project WITHOUT setting org_id (trigger should fill it):
INSERT INTO project (team_id, name, slug) VALUES ('00000000-0000-0000-0000-000000000002', 'audit', 'audit') RETURNING org_id, team_id;
-- Expected: org_id matches the team's org_id (00000000-0000-0000-0000-000000000001).
ROLLBACK;
```

Expected: the SELECT after the project INSERT shows `org_id` populated by the trigger (matching the team's `org_id`). The `ROLLBACK` cleans up regardless of pass/fail. If `org_id` is NULL or doesn't match, the trigger is broken; fix the migration SQL and re-run from Step 4.1.

- [ ] **Step 4.3: Verify CHECK constraint rejects bad rows**

Run, wrapped in a transaction so a successful (but wrong) INSERT can be rolled back:

```sql
BEGIN;
-- A row with conflicting scope (org_id set AND kind = 'project') must fail.
INSERT INTO persona (org_id, kind, name) VALUES ('00000000-0000-0000-0000-000000000099', 'project', 'bad');
-- Expected: ERROR: violates check constraint "persona_scope_check"
ROLLBACK;
```

If this INSERT succeeds, the CHECK constraint is wrong. The `ROLLBACK` is reached only on success (which is the bug case); on the expected failure, psql aborts the transaction automatically.

- [ ] **Step 4.4: Verify db:generate produces no drift**

Run: `npm run db:generate 2>&1 | tail -10`
Expected: "No schema changes detected" (or equivalent) — no new SQL file produced. If a new file IS produced:

1. Open the new file. It will contain `ALTER TABLE` statements describing the drift.
2. For each statement, identify whether the drift is:
   - **Schema-only drift**: `schema.ts` has a column or table the snapshot didn't capture. Re-run `db:generate` fresh: `rm drizzle/0031_*.sql && rm drizzle/meta/0031_snapshot.json 2>/dev/null; npm run db:generate`.
   - **Snapshot drift**: snapshot lacks something the migration SQL added by hand (triggers, partial indexes, CHECK). This is expected — those are invisible to Drizzle. The new "drift" file in this case should only re-emit COLUMN changes, NOT trigger/index/CHECK changes. If it does re-emit those, the migration file's column-level changes don't match `schema.ts`.

If the drift is real (column mismatch between `schema.ts` and the 0030 migration), fix the migration SQL or `schema.ts` to reconcile, then re-run `db:generate`. Delete any spurious `0031_*` file produced during diagnosis.

- [ ] **Step 4.5: Verify schema.ts type-checks (focused)**

Run: `npx tsc --noEmit src/core/db/schema.ts 2>&1 | grep -c "error TS"`
Expected: `0`. If non-zero, the schema relations or column definitions are inconsistent; fix and retry.

---

## Task 5: Update the nuke script

The new table list needs `customer` and `project_member`. The existing `team_member`/`team` entries are reused (table names match) but apply to the new schema.

**Files:**
- Modify: `src/scripts/db/nuke.ts:42-77` (the `tables` array).

- [ ] **Step 5.1: Add `customer` and `project_member` to the deletion list, in FK-safe order**

Edit `src/scripts/db/nuke.ts`. The `tables` array currently ends with `'organization'` as the parent. Add `customer` AFTER organization (children before parents in DELETE order — wait, this is delete order which is leaves first, so customer should be AFTER organization because organization depends on customer via customer_id, but customer_id has no FK constraint so the order is purely logical, not enforced):

Find the line:
```typescript
const tables = [
  'issue_event',
  ...
  'organization',
];
```

Insert `'project_member',` after `'team_member',` (around line 65), and insert `'customer',` as the LAST entry (after `'organization',`):

```typescript
const tables = [
  'issue_event',
  'issue_comment',
  'issue_branch',
  'issue_pull_request',
  'issue_commit',
  'stage_gate_result',
  'event',
  'stage_run',
  'isolation_environment',
  'pipeline_run',
  'issue',
  'issue_transition',
  'issue_type',
  'issue_state',
  'issue_status',
  'issue_priority',
  'issue_label',
  'pipeline_stage',
  'pipeline',
  'config_entry',
  'driver',
  'persona_skill',
  'project_member', // FLX-239
  'team_member',
  'memory',
  'skill',
  'persona',
  'team',
  'brand',
  'routing_rule',
  'routing_profile',
  'model',
  'provider',
  'project',
  'user',
  'organization',
  'customer', // FLX-239 — last because organization references it via nullable customer_id.
];
```

- [ ] **Step 5.2: Test the nuke script against the migrated DB**

Run: `npx tsx src/scripts/db/nuke.ts 2>&1 | tail -10`
Expected: every table reports either "deleted N row(s)" or "skipped (table does not exist)". Exit code 0. The new `customer` and `project_member` lines appear in the output.

- [ ] **Step 5.3: Confirm idempotency — run again**

Run: `npx tsx src/scripts/db/nuke.ts 2>&1 | tail -10`
Expected: every table reports "deleted 0 row(s)". Exit code 0.

- [ ] **Step 5.4: Commit the nuke update**

```bash
git add src/scripts/db/nuke.ts
git commit -m "nuke(flx-239): add customer and project_member tables

Customer last in deletion order (organization references it via
nullable customer_id). project_member alongside team_member.

Refs FLX-239"
```

---

## Task 6: Mark known-affected e2e specs as test.skip

Three specs reference dropped columns / old behavior and will fail after the schema lands. Mark them `test.skip(...)` with an explicit FLX-239 reference so the suite stays green through Stages 1-6 and the skip can be lifted in Stage 7.

**Files:**
- Modify: `e2e/team-crud.spec.ts` (top-level describe → skip)
- Modify: `e2e/flx-252-create-entity-form.spec.ts` (top-level describe → skip)
- Modify: `e2e/settings-url-context.spec.ts` (top-level describe → skip)

- [ ] **Step 6.1: Skip team-crud**

Open `e2e/team-crud.spec.ts`. Find the top-level `test.describe(...)`. Replace `test.describe(` with `test.describe.skip(` and add a comment ABOVE the describe:

```typescript
// FLX-239 Stage 1: this spec tests the OLD project-scoped team / persona-
// member model. The schema migration dropped that team table. This spec
// is scheduled for semantic rewrite in Stage 7 (E2E spec updates) when
// the new Settings → Teams UI lands.
test.describe.skip('team CRUD', () => {
```

If the spec uses bare `test(...)` calls at the file root (not inside a `describe`), wrap each in `test.skip(...)` or change `test(` to `test.skip(`. Read the file first to determine which.

- [ ] **Step 6.2: Skip the Skills AND Teams tests in flx-252-create-entity-form**

Open `e2e/flx-252-create-entity-form.spec.ts`. The file has one `test.describe(...)` with four `test(...)` blocks inside (Routing Profiles, Teams, Skills, Providers). TWO of them must be skipped:

1. **Skills test** — asserts `getByLabel('Scope')`. The schema migration dropped `skill.scope`.
2. **Teams test** — exercises the OLD project-scoped `team` table via `team.create`. Stage 1 drops and replaces the team table; the old shape (with `project_id`) is gone. Until Stage 5 rewrites the team router and Stage 7 rewrites this spec, the Teams test will fail with a server error on `team.create`.

Find each line and add `.skip`:

```typescript
// FLX-239 Stage 1: the schema migration dropped skill.scope. Scheduled for
// rewrite in Stage 7 when the new entity-create form drops the scope field.
test.skip('Skills: CreateEntityForm creates a new skill with scope select', async ({

// FLX-239 Stage 1: the schema migration replaced the old project-scoped
// team table with a humans-only org-scoped team. team.create router still
// reads the old shape until Stage 5. Scheduled for rewrite in Stage 7.
test.skip('Teams: CreateEntityForm creates a new team', async ({ page }) => {
```

Do NOT skip the top-level `test.describe(...)`. Do NOT skip Routing Profiles or Providers tests — they exercise forms that don't depend on dropped columns.

- [ ] **Step 6.3: Skip settings-url-context**

Open `e2e/settings-url-context.spec.ts`. Same treatment:

```typescript
// FLX-239 Stage 1: this spec creates a project via project.create with a
// userId field (dropped in the schema migration) and navigates to the
// old /{org}/{user}/{project} URL tree. Scheduled for rewrite in Stage 7.
test.describe.skip('settings URL context', () => {
```

- [ ] **Step 6.4: Verify no other specs were missed**

Run: `grep -lE "settings/teams|teamMember|persona.*team|getByLabel\\('Scope'\\)|userId:.*project\\.create|orgId:.*provider\\.create" e2e/*.spec.ts`
Expected: only the three specs you already skipped. If more appear, skip them with the same pattern and add to the list above.

- [ ] **Step 6.5: Commit the spec skips**

```bash
git add e2e/team-crud.spec.ts e2e/flx-252-create-entity-form.spec.ts e2e/settings-url-context.spec.ts
git commit -m "e2e(flx-239): skip 3 specs that test dropped-column behavior

team-crud: tests OLD project-scoped team / persona-member model
  (whole file skipped — every test depends on the dropped shape).
flx-252-create-entity-form: 'Skills' test skipped (asserts a dropped
  Scope label) AND 'Teams' test skipped (exercises old team.create
  which reads the dropped shape). Routing Profiles / Providers tests
  keep running.
settings-url-context: tests project.create with userId + old URL tree
  (whole file skipped).

Each carries a FLX-239 comment referencing Stage 7 rewrite.

Refs FLX-239"
```

---

## Task 7: Final verification + pre-PR audit

**Files:**
- No files modified. Final smoke checks.

- [ ] **Step 7.1: Re-run the full migration cycle from scratch one more time**

```bash
npx tsx src/scripts/db/nuke.ts && npm run db:migrate
```

Expected: clean, no errors, exit 0.

- [ ] **Step 7.2: Re-run db:generate (no-drift check)**

```bash
npm run db:generate
```

Expected: "No schema changes detected" or equivalent. If a new file is produced, the schema is out of sync — fix and recommit.

- [ ] **Step 7.3: Verify schema.ts type-checks**

```bash
npx tsc --noEmit src/core/db/schema.ts
```

Expected: zero errors.

- [ ] **Step 7.4: Capture the wider tsc error count for the PR description**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
```

Expected: a non-zero number (Stages 5-6 will repair these). Note the count.

- [ ] **Step 7.5: Confirm dev server still boots**

```bash
npm run dev -- -H 0.0.0.0 -p 3004 &
sleep 5
curl -s -o /dev/null -w "%{http_code}" http://localhost:3004/ || true
kill %1
```

Expected: HTTP code 200 OR 500 (either is acceptable — the server boots, but most routes 500 because consumers haven't been updated yet). NOT acceptable: connection refused (server crashed to start).

- [ ] **Step 7.6: Run session audit**

```bash
bash ops/git-hooks/session-audit.sh report
```

Expected: ACTIVE shows your branch; no orphan stashes or branches.

- [ ] **Step 7.7: Push the branch**

```bash
git push -u origin flx-239-stage-1-schema
```

Expected: push succeeds. If the pre-push hook fails on the journey-test gate (Gate 3), confirm: this PR touches `schema.ts` only — no `src/components/**` or `src/app/**/*.tsx`. Gate 3 should not fire. If it does fire incorrectly, investigate before bypassing.

- [ ] **Step 7.8: Open the PR**

```bash
gh pr create --title "feat(schema): FLX-239 Stage 1 — tenancy + waterfall schema migration" --body "$(cat <<'EOF'
## Summary

First stage of FLX-239 (tenancy + waterfall config redesign). Lands the new schema only — no app code changes consume the new shape yet.

Per the epic plan, this PR's verification gate is:
- `npm run db:migrate` applies clean from a freshly-nuked dev DB.
- `npm run db:generate` produces no drift.
- `schema.ts` type-checks clean.
- The 3 known-affected e2e specs are marked `test.skip(...)` with FLX-239 reference.

**Expected downstream brokenness:** `npx tsc --noEmit` will report ~<N> errors (replace with the captured count from Step 7.4). These are in `src/server/routers/*` and `src/app/*` and consume the OLD shape (e.g., `persona.scope`, `project.userId`, `team.projectId`). Stages 5-6 repair them. Stage 1 does not need a green wider build.

## Schema changes

### New tables
- `customer` — placeholder. Nullable `external_billing_id`; no routers/UI/auth depend on it.
- new `team` — humans-only permission group. `org_id NOT NULL`. `version` for RecordEditor.
- new `team_member` — `(user_id, team_id, role)`. PK on `(user_id, team_id)`.
- `project_member` — `(user_id, project_id, role)`. PK on `(user_id, project_id)`.

### Dropped tables
- old `team` — was project-scoped + held persona members.
- old `team_member` — was `(team_id, persona_id, role)`.

### Modified tables
- `organization` — added `customer_id uuid` (nullable, no FK).
- `project` — added `team_id NOT NULL FK`; dropped `user_id` FK; dropped `project_user_slug_idx`. New `BEFORE INSERT OR UPDATE` trigger on `project` overwrites `org_id` from `team.org_id` on every write (no column-list filter so direct `UPDATE project SET org_id = X` can't bypass).
- `persona` — dropped `scope` and `project_id`; added 4 waterfall scope columns + `kind`.
- `skill` — same shape as persona.
- `brand` — dropped `project_id` (vestigial); added waterfall columns; dropped `org_id NOT NULL`.
- `provider` — added waterfall columns; dropped `org_id NOT NULL`; dropped `provider_org_id_name_idx`.
- `driver` — added waterfall columns.
- `routing_profile` — added waterfall columns; dropped `org_id NOT NULL`.

### New constraints
- Per-table `*_scope_check` CHECK constraint: exactly one scope FK non-null + kind matches, OR all null + kind = 'catalog'.
- Partial unique indexes: `<table>_org_name_uq` (org-scope rows) + `<table>_catalog_name_uq` (catalog rows) per waterfall feature table.

### New trigger
- `flx239_project_set_org_id_from_team` — fires `BEFORE INSERT OR UPDATE ON project` (every write, not column-filtered); sets `NEW.org_id = team.org_id`; raises if team has null org_id.

## Out of scope (deferred to later stages)

- Slug column drops — Stage 8.
- Seed rewrite — Stage 2.
- Waterfall helper (`resolveScoped`) — Stage 3.
- Routing migration (`/p/{uuid}/...`) — Stage 4.
- Router scope changes (`assertProjectAccess`) — Stage 5.
- Feature-table consumer migration — Stage 6.
- E2E spec rewrites for the 3 skipped specs — Stage 7.

## Verification

- ✅ `tsx src/scripts/db/nuke.ts && npm run db:migrate` — clean.
- ✅ `npm run db:generate` — no drift.
- ✅ `npx tsc --noEmit src/core/db/schema.ts` — 0 errors.
- ✅ Trigger smoke test (manual psql; results in PR comments if needed).
- ✅ CHECK constraint smoke test (manual psql).
- ✅ Nuke script handles `customer` + `project_member`.
- ✅ 3 e2e specs marked `test.skip(...)`.
- ✅ Dev server boots.
- 📋 Wider `tsc` error count: <N> errors expected, to be cleared by Stages 5-6.

## Epic

Refs FLX-239 (epic). Spec: `docs/superpowers/specs/2026-05-18-tenancy-waterfall-design.md`. Epic plan: `docs/superpowers/plans/2026-05-18-tenancy-waterfall-epic.md`. Slice plan: `docs/superpowers/plans/2026-05-18-flx-239-stage-1-schema.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7.9: Update Linear**

```bash
# Via MCP from the parent session, attach PR link to FLX-239:
# mcp__plugin_linear_linear__save_issue(id: "FLX-239", links: [{url: "<PR URL>", title: "PR #<N> — FLX-239 Stage 1 schema"}])
```

- [ ] **Step 7.10: Wait for CI green; squash-merge**

```bash
until [ "$(gh pr view --json statusCheckRollup --jq '[.statusCheckRollup[] | select(.name=="check")][0].status')" = "COMPLETED" ]; do sleep 15; done
gh pr view --json mergeStateStatus
# When CLEAN:
gh pr merge --squash --delete-branch
```

---

## Post-merge cleanup

- [ ] **PM1: Sync main, remove worktree**

```bash
cd /mnt/dev/fluxaos
git fetch origin --prune
git pull --ff-only origin main
git worktree remove /mnt/dev/_worktrees/fluxaos-flx-239-stage-1-schema
git branch -D flx-239-stage-1-schema 2>/dev/null || true
bash ops/git-hooks/session-audit.sh report
```

Expected: audit clean.

- [ ] **PM2: Verify the merged migration is in main**

```bash
ls drizzle/0030_flx_239_tenancy_waterfall.sql
git log --oneline -3
```

Expected: file exists; recent log shows the squash-merge commit.

- [ ] **PM3: UAT deploy (operator-driven, not part of the merged PR)**

The UAT Docker image must NOT be deployed until UAT's DB has been nuked + migrated. The deploy sequence is:

1. UAT operator runs `tsx src/scripts/db/nuke.ts && npm run db:migrate` against the UAT Supabase project. The dev/UAT URL guard in nuke.ts permits UAT only when the operator explicitly targets it (set DIRECT_URL to UAT in a local one-off shell; do NOT update `.env.local` or `/mnt/stacks/docker/fluxaos/fluxaos.env`).
2. UAT operator builds and deploys the new Docker image: `./flux server uat build`.

Order matters: the new image expects the new schema. If the image deploys against the old UAT schema, every page 500s on first hit. If the schema migrates against an unchanged old image, the running container's app code immediately starts failing on missing `team.project_id` etc.

The plan does not automate this — UAT cadence is operator-controlled per the project's `## Environments` rules. Just document the sequence so the operator can plan it.

- [ ] **PM4: Hand off to Stage 2**

When ready for Stage 2 (seed rewrite), invoke `superpowers:writing-plans` for stage-2 with the spec + epic plan as input. The Stage 2 plan filename is `docs/superpowers/plans/YYYY-MM-DD-flx-239-stage-2-seed.md`.

---

## Self-review notes

- **Spec coverage:** every Stage 1 bullet in the epic plan maps to a task above:
  - Tenancy table changes → Task 2 + Task 3.
  - Feature-table waterfall columns → Task 2 + Task 3.
  - Pre-existing column collisions → Task 2 (schema) + Task 3 Phase 10 (migration).
  - NOT NULL drops → Task 3 Phase 12.
  - Partial unique indexes → Task 3 Phase 14.
  - `project.org_id` trigger → Task 3 Phase 9.
  - Drizzle relation updates → Task 2.
  - Nuke script → Task 5.
  - 3 e2e spec skips → Task 6.
  - RLS audit → Task 1.
  - Triggers are hand-written SQL → noted in Task 3.
  - Hand-edit after db:generate → noted in Task 3.

- **Placeholder scan:** no "TBD" / "TODO" / "fill in details". Phrases like "the slice-plan author (you) decided at implementation time" appear in Task 3 Phase 14 — that's a deliberate decision-point note, not a placeholder. The decision is documented inline (apply uniqueness to all six tables) so the implementer doesn't have to invent.

- **Type consistency:** column names in `schema.ts` (Task 2) and the migration SQL (Task 3) match exactly. The trigger function name `flx239_project_set_org_id_from_team` is used in both Phase 9 (create) and step 4.2 (verify).

- **Scope check:** one PR; ~7 tasks; estimated 30 commits; single coherent change set.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-18-flx-239-stage-1-schema.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task with two-stage review between. Per-task context isolation keeps the main session clean; mid-stage decisions surface as review prompts to the user rather than getting buried.

**2. Inline Execution** — execute tasks in this session via `superpowers:executing-plans`. Faster end-to-end but the main session accumulates ~30 commits worth of context; mid-stage decisions are inline.

Recommend Subagent-Driven for this stage given the schema migration's irreversibility and the number of hand-edited SQL phases that benefit from a fresh eye.

**Which approach?**

---

## Revisions from plan-review round 3 (2026-05-19)

Round-3 fresh-eyes review caught one CRITICAL ordering bug:

- **CRITICAL** Phase 12's `UPDATE brand SET ... org_id = NULL` would have failed with a NOT NULL violation if Drizzle's baseline `ALTER COLUMN org_id DROP NOT NULL` happened to be emitted after Phase 12 in the assembled file. Same hazard for `provider` and `routing_profile`. Fix: the three `DROP NOT NULL` + `DROP CONSTRAINT IF EXISTS` pairs are now hand-written explicitly into **Phase 11**, before Phase 12's UPDATEs. Drizzle's baseline may emit them again — that's fine because `DROP NOT NULL` is idempotent and `DROP CONSTRAINT IF EXISTS` is safe.

- **Assembly clarification:** Step 3.3 now explicitly states that the structured Phase 1 → Phase 15 sequence replaces the entire generated file contents, removing any ambiguity about where Drizzle's baseline statements would slot in.

## Revisions from plan-review round 2 (2026-05-19)

Round-2 fresh-eyes review caught two more migration-blocking issues:

- **HIGH-1** Phase 11 `ALTER TABLE brand ADD COLUMN org_id` would crash — `brand.org_id` already exists in the live schema (pre-FLX-239 it was `NOT NULL` FK to organization). Drizzle's `db:generate` baseline handles the NOT NULL drop from the schema.ts edit in Step 2.8; the hand-edit only adds the OTHER waterfall columns to brand. Phase 12's `ALTER COLUMN DROP NOT NULL` statements (also redundant with Drizzle's baseline for brand/provider/routing_profile) removed; Phase 12 now only contains the UPDATE statements (which Drizzle doesn't emit).
- **HIGH-2** The Teams test in flx-252 was incorrectly left un-skipped. It exercises the old `team.create` router with the old shape; will fail with a server error until Stage 5/7. Step 6.2 now skips both Skills and Teams tests in flx-252; Routing Profiles and Providers tests keep running.
- **MEDIUM-1** Step 7.8's PR body template still said `BEFORE INSERT OR UPDATE OF team_id` (contradicting round-1's removal of `OF team_id`). Both occurrences fixed.

## Revisions from plan-review round 1 (2026-05-19)

Fresh-eyes review caught two critical issues + multiple high/medium:

**Critical:**
- (C1) Trigger fired `BEFORE INSERT OR UPDATE OF team_id` — column-list filter allowed `UPDATE project SET org_id = X` to silently bypass the denormalization. Removed `OF team_id` clause; trigger now fires on every project write.
- (C2) Phase 8 ADD COLUMN `team_id NOT NULL` would fail with cryptic "column contains null values" if the project table wasn't empty. Added a DO-block guard that fails fast with an actionable error message.
- (C3) `flx-252-create-entity-form.spec.ts` skip was too coarse — only the Skills test depends on dropped `skill.scope`. Routing Profiles / Teams / Providers tests should keep running. Skip is now per-test, not per-describe.

**High:**
- (H1) `personaRelations.teamMemberships` removal made explicit (was buried in a comment inside the replacement block).
- (H2) Audit-doc gap on the `uniqueIndex.*org_id.*name` grep result — documented in Phase 14 comment.
- (H3) Partial unique indexes were only org+catalog; `resolveScopedAll` assumes intra-scope uniqueness for all four scope columns. Added team/user/project partial indexes per table (5 partials per table × 6 tables = 30 indexes).
- (H4) Snapshot-vs-schema consistency: added Step 3.5 spot-check using `jq` against `drizzle/meta/0030_snapshot.json`. Step 4.4 expanded with concrete drift-diagnosis guidance.

**Medium / Low:**
- (M2) Trigger + CHECK smoke tests wrapped in BEGIN/ROLLBACK transactions for clean rollback on failure.
- (M4) `driver` table edit now shows the complete replacement block (17 columns + 5 new) rather than "preserve every other column" shorthand.
- (L1) Added Step 2.13b: the `user.id` auth-identity invariant comment that the epic plan required but the original slice plan missed.
- (OQ3) Added PM3: UAT operator deploy sequence (nuke + migrate THEN deploy image, not the reverse).
