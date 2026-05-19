# R-SETTINGS-ALPHA — Minimum Config Surface

> **Historical / superseded note (FLX-257):** This design predates FLX-221. It intentionally left the target repo path in `FLUXAOS_TARGET_REPO_PATH`; current code moved that value to `project.target_repo_path` and makes it editable in Settings → Projects. Keep the env-backed sections below as audit history, not current guidance.

**Phase:** R-SETTINGS-ALPHA
**Status:** SPEC
**Created:** 2026-04-24
**Author:** Claude Opus 4.7 (1M)
**Depends on:** R-UI-1 (Done) — reuses RecordEditor + CRUD factory pattern.

---

## 1. Problem

The alpha loop needs operators to configure one project (the target repo + default pipeline) and see the pipeline that gets executed against it. Today the settings tree has pages for drivers, providers, routing, personas, skills, and pipelines — but no Projects page, and the Pipelines page doesn't surface "this is the default pipeline" prominently. Operators set `FLUXAOS_TARGET_REPO_PATH` via env and set `project.repo_url` via SQL or db:studio, which is fine for us but a blocker for any first-run operator following the README.

Roadmap-stated scope: "Two Settings tabs only: **Projects** (set `repoPath` + `repoUrl`, assign default pipeline) and **Pipelines** (view seeded pipeline, see attached skills/drivers). Uses the R-UI-1 CRUD factory."

## 2. Goals

- Add a **Projects** settings page under `/[org]/[user]/[project]/settings/projects` using the existing RecordEditor pattern.
- Editable fields: `name`, `slug`, `repoUrl`, `defaultBranch`. `defaultPipelineId` is NOT edited in this tab (RecordEditor doesn't support `select` field type and adding it is scope creep). Instead, Projects tab shows the current default as a readonly "Default pipeline: `<name>`" line, and operator changes the default from the Pipelines tab via "Set as default" button (R3).
- Readonly-surface the env-backed `FLUXAOS_TARGET_REPO_PATH` as a hint below `repoUrl`, with a one-line explanation that this is set via env for alpha (R-SETTINGS-ALPHA Post-alpha note).
- Ensure the existing **Pipelines** page (`/settings`) indicates which pipeline is the default and lets the operator change it (by setting `project.default_pipeline_id`).
- Keep the existing settings routes (drivers, providers, routing, personas, skills) untouched.
- Add a Settings nav sidebar/header linking the two alpha tabs plus the existing dedicated catalog pages.

## 3. Non-goals

- **Adding a `project.repo_path` column.** The roadmap mentions "set repoPath" but the stage-runner resolves it from `FLUXAOS_TARGET_REPO_PATH` env in the alpha-single-operator shape. Migrating runtime state from env → DB is a cross-cutting change (stage-runner-env, cleanup service, deploy bridge all read from env today). Out of scope for this phase; leave in env, surface it readonly in the UI, file a post-alpha follow-up when multi-project configuration becomes real.
- **Teams / Users / System / Cron Jobs tabs.** Explicitly out per roadmap. Drop.
- **Editing pipelines in the Projects tab.** Pipelines remain edited via the existing `/settings` page and its stage editor.
- **Editing `orgId` / `userId` on a project.** Alpha assumes one of each; the fields stay read-only.
- **Creating a project from the UI.** Alpha seeds the default project via `npm run db:seed`. Create flow is post-alpha when the "new project" journey exists.
- **Deleting a project from the UI.** Safety: would cascade-delete pipelines + runs + issues. If an operator truly wants to delete, they can do it via db:studio. Out of scope.
- **Per-project env-var management UI.** Post-alpha.
- **Brand / theming configuration.** `project.brand_id` stays DB-only for alpha.

## 4. Requirements

### R-SETTINGS-ALPHA.R1 — Projects settings page

- Path: `src/app/[org]/[user]/[project]/settings/projects/page.tsx` + `descriptor.ts`.
- Lists all projects the current user has access to (in practice one, but the shape supports many). Uses `trpc.project.list` (already exists).
- Each project rendered as a RecordEditor with fields per §2.
- Save uses `trpc.project.update` — router input needs to accept the new fields (see R4).
- Descriptor shape mirrors `skills/descriptor.ts` and `drivers/descriptor.ts` — `entityName: 'project'`, `title: (p) => p.name`, `subtitle: (p) => p.slug`, `fields: [...]`.

### R-SETTINGS-ALPHA.R2 — Settings nav

- A Settings sidebar or horizontal tab bar lives at `src/app/[org]/[user]/[project]/settings/layout.tsx` (NEW) and renders consistent navigation across all settings sub-pages.
- Alpha tabs listed in this order: Pipelines (the existing `/settings` page, linked from here), Projects (new), Skills, Drivers, Providers, Routing, Personas.
- Highlights the active route.

### R-SETTINGS-ALPHA.R3 — Default-pipeline affordance in Pipelines tab

- The existing Pipelines list at `/settings` surfaces the `isDefault` pipeline with a "default" pill (already does — verified). Add a "Set as default" button next to each non-default pipeline row. Clicking it calls a new mutation `project.setDefaultPipeline({ projectId, pipelineId })` and refetches the list.
- The mutation writes `project.default_pipeline_id = pipelineId`. If `pipelineId` is null-ish (blank), clears the default.
- This keeps the two tabs coordinated: operator sees pipelines in the Pipelines tab, chooses a default with one click, and the Projects tab's `defaultPipelineId` field shows the same value via RecordEditor.

### R-SETTINGS-ALPHA.R4 — Project router extensions

- `trpc.project.update` input: add optional `defaultBranch: z.string().min(1).optional()`, `defaultPipelineId: z.string().uuid().nullable().optional()`. Existing fields (`name`, `slug`, `repoUrl`) already accepted. Service uses the CRUD factory's generic update and accepts arbitrary known columns — no service change needed.
- Add mutation `trpc.project.setDefaultPipeline(input: { projectId: string, pipelineId: string | null })`. Validates that the pipeline belongs to the project when not null. Internally calls `project.update({ id, defaultPipelineId: pipelineId })`.

### R-SETTINGS-ALPHA.R5 — Env-var read-only surface

- The Projects RecordEditor includes a readonly informational row between `repoUrl` and `defaultBranch`: "Target repo path: `<FLUXAOS_TARGET_REPO_PATH>`" pulled from a small tRPC query `system.env.getPublic()` that returns a whitelisted set of env var values (just this one for alpha — do not leak others).
- If the env var is unset, render "(not set — daemon will refuse to acquire an isolation env)" in muted red.
- Do NOT make this field editable. Surface only.
- Post-alpha follow-up: replace with `project.repo_path` column when multi-project lands.

### R-SETTINGS-ALPHA.R6 — No schema change

Schema is untouched. Project table has every column we need (`name`, `slug`, `repo_url`, `default_branch`, `default_pipeline_id`). `repo_path` stays env-only.

### R-SETTINGS-ALPHA.R7 — Verification

- Integration test `src/__tests__/integration/project-settings.test.ts` (NEW): exercises `project.update` with the new fields, `project.setDefaultPipeline` happy path, and the cross-project-pipeline validation ("setting a pipeline from another project as default throws").
- Playwright journey `e2e/r-settings-alpha.spec.ts` (NEW): navigate to `/settings/projects`, edit `repoUrl`, save, assert the DB value updated via a round-trip read; navigate to `/settings`, click "Set as default" on a pipeline, assert the badge moves.
- `npx vitest run`: all green.
- `npm run build`: clean.

## 5. Non-obvious risks

- **Settings layout.tsx breaks existing pages if they rely on the root settings/page.tsx being at `/settings` root.** The existing Pipelines page IS the `/settings/page.tsx`. Adding a `settings/layout.tsx` is fine — it wraps all sub-routes. But re-pathing it as `/settings/pipelines` vs keeping `/settings` as the pipelines page is a UX choice. Chosen: keep `/settings` = Pipelines (no breaking link changes), the nav bar treats it as "Pipelines." All other tabs live at `/settings/<tab>`.
- **`trpc.system.env.getPublic()` requires an env-whitelist.** Returning arbitrary env to the client is a leak. Implement with an explicit allow-list constant (just `FLUXAOS_TARGET_REPO_PATH` for alpha), not a prefix match.
- **Race between setDefaultPipeline and project.update.** Both write `default_pipeline_id`. If two operators do both at once, last writer wins. Alpha-acceptable — one operator.
- **Optimistic concurrency.** Other settings descriptors carry a `version` field and RecordEditor passes `expectedVersion` through. The project table does NOT have a `version` column today. Either add one (schema change, exceeds scope), or skip optimistic locking for project updates in alpha and accept last-writer-wins. Chosen: skip for alpha (document in non-goals), add `project.version` post-alpha alongside the multi-project migration.

## 6. Schema changes

None.

## 7. File plan

New:

- `src/app/[org]/[user]/[project]/settings/layout.tsx` — settings nav wrapper.
- `src/app/[org]/[user]/[project]/settings/projects/page.tsx` — Projects RecordEditor page.
- `src/app/[org]/[user]/[project]/settings/projects/descriptor.ts` — field definitions.
- `src/server/routers/system.ts` — NEW tRPC router exposing `env.getPublic` (whitelisted envs only).
- `src/__tests__/integration/project-settings.test.ts` — integration cases.
- `e2e/r-settings-alpha.spec.ts` — journey.

Edited:

- `src/server/routers/project.ts` — extend update input; add setDefaultPipeline.
- `src/core/services/project.ts` — accept extra update fields.
- `src/server/routers/root.ts` (or wherever routers are combined) — register `system` router.
- `src/app/[org]/[user]/[project]/settings/page.tsx` — add "Set as default" button.
- `docs/superpowers/roadmap.md` — R-SETTINGS-ALPHA → Done.
- `CLAUDE.md` — note Settings sections location if helpful.

## 8. Wave decomposition

Details to plan.

1. **W1** — Router + service extensions (update fields, setDefaultPipeline, system.env.getPublic).
2. **W2** — Projects descriptor + page.
3. **W3** — Settings layout + nav.
4. **W4** — "Set as default" button on existing Pipelines page.
5. **W5** — Integration test + journey test.
6. **W6** — Docs + roadmap close-out.

## 9. Out of scope confirmations

- `repo_path` column: NO.
- Teams/Users/System/Cron Jobs tabs: NO.
- Project create/delete UI: NO.
- Optimistic locking on project: NO.
- Brand/theming UI: NO.
