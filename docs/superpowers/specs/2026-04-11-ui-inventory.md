# fluxaOS UI Inventory — 2026-04-11

**Purpose:** Page-by-page inventory of every UI element. The next session's agent MUST NOT remove any element listed here without explicit user approval. This is the reference that prevents the rewrite regression pattern documented in `docs/rca/2026-04-11-ui-regression-rca.md`.

---

## Application Shell

### Root Layout (`src/app/layout.tsx`)
- Dark theme (bg-neutral-950), Geist Sans + Geist Mono fonts

### Dashboard Layout (`src/app/[org]/[user]/[project]/layout.tsx`)
- TRPCProvider wrapper, left sidebar (250px) + main content area (max-w-7xl, p-6 lg:p-8)

### Navigation Sidebar (`src/components/nav.tsx`)
- **WORK section:** Dashboard, Issues, Pipelines, KPIs
- **SETTINGS section:** Pipelines, Personas, Skills, Routing, Providers
- Active state: gradient bg (electric-violet), glow shadow
- Version display (v0.1.0-alpha) at bottom

### Root Redirect (`src/app/page.tsx`)
- Queries DB for first org/user/project, redirects to `/{org}/{user}/{project}`

### Login (`src/app/login/page.tsx`)
- Email + password form, Supabase auth, error display

---

## Dashboard (`src/app/[org]/[user]/[project]/page.tsx`)

**Queries:** issueCatalog.states.list, issueCatalog.priorities.list, issue.list, pipeline.runs.kpis, pipeline.runs.listByProject, organization.list, provider.list

1. **Stat Cards (4):** Open Issues, In Progress, Total Runs, Running Now
2. **Just Do It Hero Card:** input + "Go" button (pipeline.justDoIt not yet implemented)
3. **Pipeline Health Card:** success rate %, mini bar chart (7 recent runs)
4. **Recent Pipeline Runs Table:** Pipeline, Status, Started, Cost — links to `/pipelines/{id}`
5. **Cost Summary Card:** total spend, avg/run, sparkline
6. **Open Issues Card:** top 5 by priority, colored bars, links to issue detail
7. **Issues by State Breakdown:** horizontal progress bars per state with CatalogBadges
8. **Providers Bar:** provider name, health dot (green/red), status text

---

## Issues List (`src/app/[org]/[user]/[project]/issues/page.tsx`)

**Queries:** issueCatalog.types/states/priorities.list, issue.list (filtered)

1. **Header:** "Issues" + "New Issue" button
2. **Stat Cards (4):** Total, Open, Closed, Filtered count
3. **Filter Bar:** Lifecycle dropdown, State dropdown, Type dropdown, Priority dropdown, Search input
4. **Issues Table:** #, Title, Type (CatalogBadge), State (CatalogBadge), Priority (CatalogBadge), Created — rows link to detail

---

## New Issue (`src/app/[org]/[user]/[project]/issues/new/page.tsx`)

**Mutations:** issue.create → redirects to `/issues/{number}`

1. **Form:** Title*, Description (textarea/markdown), Type* (dropdown), Priority* (dropdown), Assignee (text)
2. **Buttons:** "Create Issue" (disabled until valid), Cancel → `/issues`

---

## Issue Detail (`src/app/[org]/[user]/[project]/issues/[number]/client.tsx`)

**Queries:** issue.getByNumber, issueCatalog.types/states/priorities.list, issue.transitions, issue.event.list, issue.comment.list, pipeline.listByProject, pipeline.stages.listByPipeline, pipeline.runs.issueState

**Mutations:** issue.updateFields, issue.transition, issue.comment.create/update/delete, issue.delete, pipeline.runs.trigger, pipeline.runs.executeStage

1. **Issue Header:** number (mono) + EditableTitle + state/priority badges
2. **Meta Strip:** Type selector, Priority selector, Assignee (inline edit), Created timestamp
3. **EditableBody:** click-to-edit markdown body
4. **State Transitions:** CatalogSelect dropdown for state changes
5. **Pipeline Stages Card:** horizontal stage pills (color-coded by status), gate mode labels, **"Run Stage" button** (triggers run or executes pending stage), run status + cost display
6. **Delete Issue Button:** red, with confirmation dialog
7. **Activity Feed:** tabs (All/Comments/State), timeline layout with events
8. **Comment Box:** textarea + "Post Comment" button
9. **Comments List:** CommentCards with edit/delete, version tracking

---

## Pipelines List (`src/app/[org]/[user]/[project]/pipelines/page.tsx`)

**Queries:** organization.list, project.listByOrg, pipeline.listByProject, pipeline.runs.listByProject
**Mutations:** pipeline.runs.trigger

1. **Header:** "Pipeline runs" + "Start Run" button
2. **Runs Table:** Run ID, Pipeline, Status (StatusBadge), Started, Completed, Cost — links to `/pipelines/{id}`

---

## Pipeline Run Detail (`src/app/[org]/[user]/[project]/pipelines/[id]/page.tsx`)

**Queries:** pipeline.runs.get (auto-refetch every 2s when running)
**Mutations:** pipeline.runs.cancel, pipeline.runs.approveStage, pipeline.runs.rejectStage

1. **Run Header:** "Pipeline run" + ID (mono) + StatusBadge + Cancel button (if active)
2. **Metadata:** Started, Completed, Cost
3. **Stages Timeline:** StageRunCards with:
   - Step circle (CheckCircle if done, number if pending)
   - Stage name + StatusBadge + VerdictBadge (if gate checked)
   - Provider/Model/Driver info, Cost, Token counts
   - **Gate Approval UI** (if pending): Approve/Rework/Abort buttons
   - **Events/Transcript:** scrollable event list (timestamp, type, payload)

---

## KPIs (`src/app/[org]/[user]/[project]/kpis/page.tsx`)

**Queries:** organization.list, project.listByOrg, pipeline.runs.kpis

1. **Pipeline Runs:** Total Runs, Success Rate, Running
2. **Status Breakdown:** Completed, Failed, Cancelled, Running
3. **Cost:** Total Cost, Avg Cost/Run

---

## Settings — Pipelines (`src/app/[org]/[user]/[project]/settings/page.tsx`)

**Queries:** organization.list, project.listByOrg, pipeline.listByProject, pipeline.stages.listByPipeline
**Mutations:** pipeline.create, pipeline.stages.create

1. **Header:** "Pipeline settings" + "New Pipeline" button
2. **Create Pipeline Form:** Name, Description, Create button
3. **Pipelines List:** name + default badge + description + "Stages" expand button
4. **StageEditor (per pipeline):** stages table (#, Name, Gate, Timeout, Retries), "Add Stage" form with gate mode dropdown, **RuleBuilder** (when mode=rules), **RuleTestPanel** (when mode=rules)

---

## Settings — Providers (`src/app/[org]/[user]/[project]/settings/providers/page.tsx`)

**Mutations:** provider.create, provider.createModel, provider.deleteModel

1. **Header:** "Providers" + "New Provider"
2. **Create Provider Form:** Name, Type, Base URL, API Key Reference
3. **Providers List:** name + type badge + health status + "Models" expand
4. **ModelsEditor:** models table (Name, Identifier, Cost, Delete), "Add Model" form

---

## Settings — Skills (`src/app/[org]/[user]/[project]/settings/skills/page.tsx`)

**Mutations:** skill.create

1. **Header:** "Skills" + "New Skill"
2. **Create Skill Form:** Name, Tags (comma-sep), Description, Prompt Template (textarea)
3. **Skills List:** name + version + scope badges, description, tags, "Details" expand with prompt template display

---

## Settings — Personas (`src/app/[org]/[user]/[project]/settings/personas/page.tsx`)

**Mutations:** persona.create, persona.attachSkill, persona.detachSkill

1. **Header:** "Personas" + "New Persona"
2. **Create Persona Form:** Name, Scope (project/global), Soul (textarea)
3. **Personas List:** name + scope badge, soul snippet, "Details" expand with identity JSON + attached skills (with detach ×) + attach skill buttons

---

## Settings — Routing (`src/app/[org]/[user]/[project]/settings/routing/page.tsx`)

**Mutations:** routing.createProfile, routing.createRule, routing.deleteRule

1. **Header:** "Routing Profiles" + "New Profile"
2. **Create Profile Form:** Name, Description
3. **Profiles List:** name + default badge + description + "Rules" expand
4. **RulesEditor:** rules table (Stage, Models, Driver, Sort, Delete), "Add Rule" form

---

## Shared Components

| Component | File | Purpose |
|-----------|------|---------|
| Card | `src/components/card.tsx` | Container with glass effect, optional hover |
| PageHeader | `src/components/page-header.tsx` | Title + optional description + action button |
| StatCard | `src/components/stat-card.tsx` | Metric display with icon, value, trend |
| StatusBadge | `src/components/status-badge.tsx` | Color-coded status pill with dot |
| CatalogBadge | `src/components/catalog-badge.tsx` | DB-driven color badge for types/states/priorities |
| EmptyState | `src/components/empty-state.tsx` | Empty data placeholder with icon |
| Skeleton* | `src/components/skeleton.tsx` | Loading placeholders (line, card, table) |
| VerdictBadge | `src/components/gates/VerdictBadge.tsx` | Gate verdict pill (proceed/hold/rework/abort) |
| RuleBuilder | `src/components/gates/RuleBuilder.tsx` | Visual gate rule editor with AND/OR groups |
| RuleTestPanel | `src/components/gates/RuleTestPanel.tsx` | Test rules against mock context JSON |
| Navigation | `src/components/nav.tsx` | Sidebar with WORK + SETTINGS sections |
