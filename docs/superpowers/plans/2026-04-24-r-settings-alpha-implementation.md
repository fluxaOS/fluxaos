# R-SETTINGS-ALPHA Implementation Plan

> **Historical / superseded note (FLX-257):** This alpha settings plan reflects the pre-FLX-221 world where `FLUXAOS_TARGET_REPO_PATH` was env-backed and surfaced read-only. Current code stores the target clone path on `project.target_repo_path` and edits it through Settings → Projects. Treat the env-var instructions below as historical context only.

**Date:** 2026-04-24
**Spec:** [`../specs/2026-04-24-r-settings-alpha-design.md`](../specs/2026-04-24-r-settings-alpha-design.md)

---

## Plan-phase reconciliation

1. **No `repo_path` column on `project` today.** ✅ Confirmed `src/core/db/schema.ts` lines 55–77 — columns are `id, orgId, userId, name, slug, repoUrl, defaultBranch, worktreeCopyFiles, defaultPipelineId, brandId, createdAt, updatedAt`. Spec's "don't add repo_path" stance holds.
2. **Stage-runner-env resolves repo path from `FLUXAOS_TARGET_REPO_PATH` env.** ✅ Confirmed `src/core/orchestrator/stage-runner-env.ts` line 140. Switching to DB-backed per-project repoPath is a cross-cutting refactor — out of scope.
3. **Pipelines settings page already exists at `/settings/page.tsx` with create + stage editor.** ✅ Inspected during spec phase.
4. **RecordEditor pattern + descriptor.ts used by skills + drivers settings.** ✅ Inspected. `src/components/record-editor/RecordEditor.tsx` is the primitive; descriptor.ts files define the field shape.
5. **`trpc.project.update` already accepts the CRUD factory's generic update, but the tRPC input validator only lists `name`, `slug`, `repoUrl`.** ✅ `src/server/routers/project.ts` lines 34–44. Widening the input is a one-diff change.
6. **No `settings/layout.tsx` exists.** ✅ `ls` confirms. Creating one is additive; existing sub-pages still render inside the new wrapper.
7. **No `system` tRPC router exists.** ✅ `grep` for `systemRouter` in `src/server/` → no hits. Creating one is additive.
8. **`project.setDefaultPipeline` cross-project validation can use existing pipeline.getById + service method.** ✅ `createPipelineService(db).getById(id)` returns the row including `projectId`; router can enforce.
9. **Project table has no `version` column.** ✅ Schema check. RecordEditor can be configured without optimistic locking per-descriptor.

**Plan-phase decisions on open questions (defaulted per AGENT_BEHAVIOR.md — no questions during a session):**

- **Settings nav layout:** horizontal tab bar at the top of the settings layout, not a left sidebar. Keeps it consistent with the existing dashboard page header.
- **Order of tabs in nav:** Pipelines | Projects | Skills | Drivers | Providers | Routing | Personas. Alpha tabs first; less-touched catalogs last.
- **`system.env.getPublic` allowlist shape:** a module-level `const ALLOWED_ENV_VARS = ['FLUXAOS_TARGET_REPO_PATH'] as const;` in `src/server/routers/system.ts`. Router returns `Record<string, string | null>`. Don't log requests — just return.
- **Missing env display:** muted red, "(not set)". Post-alpha: a link to the ops/README.md with the fix.
- **`defaultPipelineId` RecordEditor field shape:** use a `select` field type with options derived from `pipeline.listByProject(currentProjectId)` run-time. RecordEditor's `select` support exists today per drivers descriptor (e.g. `outputFormat` is a text field — check if select exists; if not, use a text field and validate on save). **Inspect during T1.**
- **Set-as-default button placement:** right-aligned on each pipeline row, next to the existing "Stages" toggle. Hidden for the currently-default pipeline.
- **Optimistic locking on project:** skip. RecordEditor accepts a `version: null` descriptor flag (or falls back when the record has no version field — inspect). If RecordEditor requires version, pass `0` and ignore conflicts. **Inspect during T2.**
- **No journey in this plan is a showstopper.** Playwright still runs even if dev server conflict persists from R-DAEMON. If the shared dev server issue blocks it, ship the journey file for a later run, same as R-DAEMON W6.

---

## Task breakdown

### Wave 1 — Router + service extensions

**T1.** RecordEditor FieldType is limited to `text | textarea | textarea-large | tags | boolean | readonly` — no `select`. Decision: drop `defaultPipelineId` from the Projects RecordEditor fields. Show it as a `readonly` field rendering the pipeline's name. Operator changes it via the Pipelines tab's "Set as default" button (W4).

**T2.** RecordEditor requires `RecordWithVersion = { id, version: number }`. Project table has no `version` column. Decision: wrap projects in the page as `{ ...p, version: 1 }` so the type fits. Router `update` never looks at version (no optimistic-lock column to check). Alpha-acceptable per spec §5. Adding `project.version` as a column is scope creep and cross-cuts any CRUD-factory optimistic-lock assumption — post-alpha.

**T3.** In `src/server/routers/project.ts`:
- Extend `update` input zod to accept `defaultBranch: z.string().min(1).optional()` and `defaultPipelineId: z.string().uuid().nullable().optional()`. Keep existing fields unchanged.
- Add new mutation `setDefaultPipeline` with input `{ projectId: string, pipelineId: z.string().uuid().nullable() }`. If `pipelineId` is non-null, fetch the pipeline via `createPipelineService(ctx.db).getById(pipelineId)` and assert `pipeline.projectId === input.projectId`; throw `TRPCError({ code: 'BAD_REQUEST', message: 'PIPELINE_NOT_IN_PROJECT' })` on mismatch. Internally call `projectService.update(input.projectId, { defaultPipelineId: input.pipelineId })`.

**T4.** Create `src/server/routers/system.ts`:
- Export `systemRouter = router({ env: router({ getPublic: publicProcedure.query(...) }) })`.
- Inside the query, iterate over an `ALLOWED_ENV_VARS = ['FLUXAOS_TARGET_REPO_PATH'] as const` array; return `{ [key]: process.env[key] ?? null }`.
- Register in `src/server/root.ts` under key `system`.

**T5.** Integration test `src/__tests__/integration/project-settings.test.ts`:
- Uses an isolated org/user/project/pipeline fixture (same pattern as `daemon.test.ts` W4 case).
- Case A: update happy-path — pass `name`, `slug`, `repoUrl`, `defaultBranch`, `defaultPipelineId`; assert all fields updated.
- Case B: `setDefaultPipeline` with a pipeline belonging to the project — assert `defaultPipelineId` moved and `pipeline.getById` reflects it.
- Case C: `setDefaultPipeline` with a pipeline from a DIFFERENT project — asserts throws with message matching `PIPELINE_NOT_IN_PROJECT`.
- Case D: `setDefaultPipeline({ pipelineId: null })` — asserts cleared.

**Commit:** `R-SETTINGS-ALPHA W1: project router extensions + system.env router + tests`.

### Wave 2 — Projects settings page

**T6.** Create `src/app/[org]/[user]/[project]/settings/projects/descriptor.ts`:
- `entityName: 'project'`.
- `title: (p) => p.name`, `subtitle: (p) => p.slug`.
- Fields: `name` (text, required), `slug` (text, required), `repoUrl` (text, optional), `defaultBranch` (text, required), `defaultPipelineName` (readonly — derived field showing the pipeline's name), `targetRepoPath` (readonly — derived from env via system.env.getPublic). Derived fields are hydrated in page.tsx before handing records to the RecordEditor.

**T7.** Create `src/app/[org]/[user]/[project]/settings/projects/page.tsx`:
- `'use client'`; import `RecordEditor`, `trpc`, `projectDescriptor`.
- Lists projects via `trpc.project.list.useQuery()`.
- Renders one RecordEditor per project row.
- Wires update via `trpc.project.update.useMutation()` with `utils.project.list.invalidate()` on success.
- Below `repoUrl` field, render the env-backed `FLUXAOS_TARGET_REPO_PATH` readonly via `trpc.system.env.getPublic.useQuery()` — "Target repo path: `<value>`" or "(not set)" in muted red.
- If `defaultPipelineId` uses the select field type, fetch pipelines via `trpc.pipeline.listByProject.useQuery({ projectId: currentProject.id })` to populate options.

**Commit:** `R-SETTINGS-ALPHA W2: Projects settings page + env-surface`.

### Wave 3 — Settings layout + nav

**T8.** Create `src/app/[org]/[user]/[project]/settings/layout.tsx`:
- `'use client'`; consume `children` + render a horizontal tab bar.
- Tabs: `Pipelines` → `/settings`, `Projects` → `/settings/projects`, then `Skills`, `Drivers`, `Providers`, `Routing`, `Personas` with their existing paths.
- Active-tab highlight via `usePathname()` — simple segment-prefix match.
- Body wraps `{children}` in a container div.

**T9.** Sanity-check that existing pages under `/settings/drivers`, `/settings/skills`, etc. still render (Next.js pierces layouts through nested routes automatically; they should just work). Run dev briefly + smoke through browser.

**Commit:** `R-SETTINGS-ALPHA W3: settings layout + nav tabs`.

### Wave 4 — Set-as-default button on Pipelines tab

**T10.** Edit `src/app/[org]/[user]/[project]/settings/page.tsx`:
- Import the new `setDefaultPipeline` mutation.
- In each pipeline row, conditionally render a "Set as default" button when `!p.isDefault`.
- On click, call `setDefaultPipeline.mutate({ projectId, pipelineId: p.id })` with `onSuccess` → invalidate pipelines + project queries.
- Update the existing `isDefault` flag source: the current row uses `p.isDefault` (from the pipeline row). The new source of truth is `project.default_pipeline_id`. Either (a) leave `pipeline.is_default` as a legacy column and mirror it via setDefaultPipeline (requires update on both records), or (b) change the UI to derive the badge from the project's default. **Option (b) preferred**: in the page, compute `const defaultPipelineId = project.defaultPipelineId`; render the pill when `p.id === defaultPipelineId`. Leaves the legacy `pipeline.is_default` column alone but correct alpha behaviour. Document in the commit.

**Commit:** `R-SETTINGS-ALPHA W4: set-as-default button + default derives from project.defaultPipelineId`.

### Wave 5 — Integration + journey tests

**T11.** Integration tests from T5 already ran in W1. Re-verify they still pass after UI changes (they shouldn't be affected, but sanity check).

**T12.** Playwright journey `e2e/r-settings-alpha.spec.ts`:
- Navigate to `/settings/projects`, edit `repoUrl` to a fresh value, save, assert `trpc.project.list` via DB round-trip shows the new value (or reload page + read input field value).
- Navigate to `/settings`, find a non-default pipeline, click "Set as default", assert the "default" pill moves to it.
- Navigate back to `/settings/projects`, assert the Projects RecordEditor shows the new `defaultPipelineId`.
- No ANTHROPIC_API_KEY gating — this journey doesn't hit Claude.

**T13.** Run the full verification matrix:
- `npx tsc --noEmit` → clean.
- `npx vitest run` → all green including new cases.
- `npx playwright test e2e/r-settings-alpha.spec.ts` → PASS *if dev server available; otherwise defer to next session per R-DAEMON W6 precedent*.
- `npm run build` → clean.
- Pre-commit size cap → no files over.
- Biome/eslint on changed files → clean.

**Commit:** `R-SETTINGS-ALPHA W5: journey test`.

### Wave 6 — Docs + roadmap

**T14.** Update `docs/superpowers/roadmap.md`:
- Move R-SETTINGS-ALPHA to Done with plan + spec links.
- "Next" becomes R-MISSION-CONTROL.
- Dependency-ordering sentence: R-SETTINGS-ALPHA done; R-MISSION-CONTROL next; R-SMOKE depends on everything.

**T15.** Update `CLAUDE.md` if the Settings section location materially changed (it didn't — links still valid).

**T16.** Open PR. Squash-merge on green.

**T17.** After merge: prune branch, write handoff `docs/superpowers/handoffs/2026-04-24-r-settings-alpha-session-handoff.md`.

---

## Verification Matrix (filled during execution)

| Gate | Expected | Actual |
|---|---|---|
| `npx tsc --noEmit` | clean | _pending_ |
| `npx vitest run` | new cases green | _pending_ |
| `npx playwright test e2e/r-settings-alpha.spec.ts` | PASS (or deferred if dev server conflict) | _pending_ |
| `npm run build` | clean | _pending_ |
| Pre-commit size cap | no new file over 500 LoC | _pending_ |

---

## Goal-backward check

1. Operator opens `/settings/projects`. ✓ T7.
2. Operator edits repoUrl or defaultBranch, saves. ✓ T6/T7 + T3 router update.
3. Operator sees the env-backed target-repo-path readonly. ✓ T7 + T4 system router.
4. Operator switches to `/settings` (Pipelines), clicks "Set as default" on a pipeline. ✓ T10.
5. Default pill moves. ✓ T10 option (b).
6. Operator navigates tabs via the nav bar. ✓ T8.
7. Operator's changes persist. ✓ T3 router writes DB, T5 integration proves round-trip.

---

## Risks / pitfalls

- **Pipeline.isDefault vs project.defaultPipelineId divergence.** Legacy `pipeline.is_default` column stays populated from seed; new UI derives from `project.defaultPipelineId`. Two sources of truth. Alpha-accepted; post-alpha dedup.
- **Settings layout.tsx wrapping ALL settings sub-routes.** Includes drivers/skills/etc. If they currently have their own headers/padding, double-padding may show. T9 smoke-tests. If ugly, the layout renders the nav only and drops the container padding; sub-pages provide their own layout.
- **`system.env.getPublic` returning null when env is unset** — the UI must handle `null` vs `undefined` distinct from "key not requested". Contract: null means the key is in the allowlist but unset. Absent key = not in allowlist (shouldn't happen for whitelisted).
- **Cross-project setDefaultPipeline check** uses `createPipelineService(db).getById(pipelineId).projectId === input.projectId`. If someone passes a random UUID that doesn't exist, `getById` returns null; treat as not-found error.

---

## Out of scope reminders (spec §3)

- No `project.repo_path` column.
- No Teams/Users/System/Cron Jobs tabs.
- No project create/delete UI.
- No optimistic locking on project.
- No brand/theming UI.
