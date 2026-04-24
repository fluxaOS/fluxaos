# R-ARTIFACTS — Stage-to-stage data flow design

**Date:** 2026-04-23
**Status:** Draft
**Phase:** Alpha / Next (after R-RUNTIME)
**Author:** Claude Opus 4.7 (autonomous per AGENT_BEHAVIOR.md)

---

## Prior art

Pattern borrowed from [Archon](https://github.com/coleam00/Archon) (MIT-licensed, Cole Medin). Specifically the `$ARTIFACTS_DIR` convention from `.archon/workflows/dark-factory-fix-github-issue.yaml`, catalogued in [`../research/2026-04-22-archon-prior-art.md` §7](../research/2026-04-22-archon-prior-art.md). Borrow is shape-only — fluxaOS writes its own TypeScript, Archon's Bun/YAML implementation is not copied.

---

## Problem

Today every pipeline stage runs in the same worktree under the same prompt template. The only state handed between stages is the contents of the worktree itself — i.e., whatever the previous stage committed. That is fine when each stage produces source code, but it doesn't work for stages that produce *intermediate artifacts* that aren't code:

- A Research stage that investigates a codebase and writes a findings report.
- A Plan stage that reads the findings and writes an implementation plan.
- An Implement stage that reads the plan and writes code.
- A Review stage that reads the plan + the diff and emits a verdict.

Without a durable, stage-addressable place to write these intermediates, later stages either (a) re-derive them, (b) don't use them, or (c) hack them into the worktree and commit them accidentally.

R-RUNTIME's deploy bridge assumes the worktree's git state *is* the pipeline's output, because `commitAll → push → PR` reads from the worktree. That invariant must stay: artifacts live somewhere *other than* the worktree so they never get committed to the target repo.

## Goal

Each pipeline run gets an `artifacts_dir` — a durable directory distinct from its worktree — that:

1. Is created when the pipeline's first stage acquires its isolation env.
2. Is passed to every subsequent stage of that run as a template variable (`{{artifacts_path}}`).
3. Survives stage boundaries within a run (stage N writes, stage N+1 reads).
4. Outlives the worktree so diagnostics are recoverable after the worktree is released.
5. Is reaped by the cleanup service on the same schedule as worktrees (but on a separate retention window — `FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS`).
6. Never gets committed to the target repo (kept outside the worktree, not in `.gitignore`-bound paths).

Out of scope: any prescription of *what* stages should write to the artifacts dir. R-ARTIFACTS provides the mechanism; individual stage prompts decide what to produce and consume.

## Non-goals

- **Typed artifact schema.** Stages write and read whatever files they agree on. No enum of artifact names, no JSON schema validation, no DB rows per artifact. If structure is needed, a later phase can layer it.
- **Cross-run artifact sharing.** Artifacts belong to one pipeline run. No "give me last week's research" mechanism. That's a different feature.
- **Artifact browsing UI.** The Mission Control dashboard (R-MISSION-CONTROL) may surface artifact paths post-hoc; R-ARTIFACTS doesn't build it.
- **Encryption / access control.** Alpha single-user; filesystem permissions are sufficient.
- **Rehydrating an artifacts_dir after cleanup.** Once reaped, it's gone. If an operator wants to inspect, they do it before retention expires.

---

## Design

### Filesystem layout

```
<workspace_root>/
  .fluxaos-artifacts/
    <run_id>/
      stage-01-research/
        findings.md
        notes.md
      stage-02-implement/
        plan.md
      …whatever the stages produce…
```

- `workspace_root` resolution mirrors `FLUXAOS_WORKSPACE_ROOT` logic from R-RUNTIME: env override > in-project default (`<repoPath>/.fluxaos-artifacts/`). **Same root as worktrees**, different top-level directory. Keeps NFS/Docker friendly.
- Auto-gitignore: on first `acquire()` that creates `.fluxaos-artifacts/`, append to target repo's `.gitignore` if not already present. Same mechanism R-RUNTIME already uses for `.fluxaos-worktrees/`.
- Stage-level subdirectories are **convention, not enforcement**. Stage prompts receive the run-scoped path and may create subdirs. Default recommendation: `<stage-index>-<stage-name>/`. Stages that write to the run root are fine too.

### Schema change

One migration (`drizzle/0008_r_artifacts.sql`, hand-written per DEF-019):

```sql
ALTER TABLE "pipeline_run"
  ADD COLUMN "artifacts_path" text;
```

- Nullable (backfill for existing rows stays NULL; they predate R-ARTIFACTS).
- Populated by the orchestrator at pipeline-run creation time.
- Stored for observability (Mission Control, post-hoc inspection) AND for cleanup (cleanup service needs a path to reap).

No new table. Artifacts are filesystem-only; the DB holds only the path.

### Port / provider changes

**`AcquireEnvironmentParams` gains one field:**

```typescript
export interface AcquireEnvironmentParams {
  projectId: string;
  runId: string;
  repoPath: string;
  repoIdentity: { owner: string; repo: string };
  branchName: string;
  baseBranch?: string;
  copyFiles?: string[];
  /**
   * Absolute path to an existing artifacts dir to bind to this env. If
   * omitted, the provider may create one at <workspace_root>/.fluxaos-
   * artifacts/<runId>/ and return it on the resulting IsolationEnvironment.
   */
  artifactsPath?: string;
}
```

**`IsolationEnvironment` gains one field:**

```typescript
export interface IsolationEnvironment {
  // …existing fields…
  artifactsPath: string | null;
}
```

Reasoning: the isolation provider already knows `workspace_root` and `runId`. Making it responsible for the artifacts dir lifecycle keeps filesystem logic in one adapter, not spread across stage-runner-env + orchestrator. The provider:
- Creates the dir on first `acquire()` for a run.
- Records the path on the `isolation_environment` row (new column `artifacts_path text`).
- Leaves it alone on subsequent `acquire()` calls for the same run (stages 2..N).
- On `release()`, does *not* remove the artifacts dir — that's cleanup-service scope.

**Cleanup service gains one trigger + one threshold:**

- New env var `FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS` (separate from worktree retention; artifacts typically want a longer window so post-hoc debug is possible).
- `runScheduledSweep()` gains a second pass that lists `<workspace_root>/.fluxaos-artifacts/*` directories, joins against `pipeline_run` by `run_id` (the directory name), and reaps dirs whose run is terminal AND older than the retention threshold.
- Reap order: worktrees first (already safe — merged branches), artifacts second (independent gate on terminal status + age).

### Orchestrator / stage-runner wiring

**Pipeline-scoped artifacts_path lives on `pipeline_run`:**

At pipeline-run creation (manual-run.ts and event-orchestrator.ts), compute the artifacts_path by calling a new helper `deriveArtifactsPath(runId)` and write it to `pipeline_run.artifacts_path`. The helper uses the same resolution logic as the isolation provider, so both code paths agree on the directory without duplicating env-var reads.

**Stage-runner threads it into materialize:**

`stage-runner.ts` (line 206 area) already calls `materialize({...})`. Add `artifactsPath: env.artifactsPath` to the options, and extend `renderTemplate` with `artifacts_path: env.artifactsPath`.

**Prompt template:**

```typescript
const prompt = renderTemplate(template, {
  issue_number: issueRow?.number,
  issue_title: issueRow?.title ?? '',
  issue_description: issueRow?.bodyMd ?? '',
  skill_name: skillRow?.name ?? stage.name,
  workspace_path: workspacePath,
  artifacts_path: env.artifactsPath,   // ← new
});
```

Seeded `driver.issuePromptTemplate` stays silent about artifacts by default; seeded `skill.promptTemplate` values get an opt-in mention for skills that need to hand off artifacts. See "Seed data changes" below.

**Per-stage subdirectory convention (optional, in-prompt):**

If a skill's prompt chooses to isolate its outputs to a per-stage subdir, it computes `${artifacts_path}/${stage_index}-${skill_name}/` itself. Stage-runner does NOT pre-create subdirs; that would force structure into the mechanism. Skills own their file layout.

### What stages will actually do (example, not enforcement)

Research skill prompt:

```
Skill: research
…
Artifacts directory: {{artifacts_path}}

When you finish, write a findings report to
{{artifacts_path}}/research-findings.md summarising what you found.
Later stages will read this file.
```

Implement skill prompt:

```
Skill: implement
…
Artifacts directory: {{artifacts_path}}

Before you start writing code, read
{{artifacts_path}}/research-findings.md if it exists — the Research stage
may have recorded constraints you need to honour. Then plan your changes
into {{artifacts_path}}/plan.md before editing the worktree.
```

Both of these are **seed-data changes** to `skill.promptTemplate`. See "Seed data changes."

### Seed data changes

Amend `src/scripts/db/seed.ts`:

- Research skill `promptTemplate`: append "Artifacts dir: `{{artifacts_path}}`. Write findings to `{{artifacts_path}}/research-findings.md`."
- Implement skill `promptTemplate`: append "Artifacts dir: `{{artifacts_path}}`. Read `{{artifacts_path}}/research-findings.md` if present; write a plan to `{{artifacts_path}}/plan.md` before editing."
- Review skill `promptTemplate`: append "Artifacts dir: `{{artifacts_path}}`. Read `{{artifacts_path}}/plan.md` if present to see what was intended, then diff against the actual worktree."
- Deploy skill `promptTemplate`: leave silent — deploy stage doesn't typically need artifacts.
- Rework skill `promptTemplate`: append "Artifacts dir: `{{artifacts_path}}`. Read `{{artifacts_path}}/review-findings.md` if present."

These seed-data changes are part of R-ARTIFACTS because the mechanism is worthless without at least one skill that uses it. They also serve as the self-test: the E2E journey asserts that a Research → Implement pipeline produces the research findings file and that the Implement stage can read it.

### Cleanup service changes

File: `src/core/cleanup/cleanup-service.ts`.

- Extend `CleanupGitHelpers` DI bag with an `artifactsFs` interface: `listArtifactDirs(root)`, `removeArtifactDir(path)`, `getArtifactDirAge(path)`. Keeps invariant 7 (no adapter imports from core).
- `runScheduledSweep()` gains a second pass after worktrees: list artifact dirs, for each dir look up `pipeline_run` by `run_id` (dir name), reap if terminal + age > `FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS`.
- `onPrClosed()` does *not* reap artifacts — they're retention-window based, not PR-state based. A PR being closed doesn't mean the operator is done looking at the artifacts.
- `cleanupToMakeRoom()` treats artifacts as a second-tier reap target: only reap if worktree-side cleanup didn't free enough.
- `removeEnvironment(envId, { force: true })` removes the artifacts dir too, because the operator asked for a full tear-down.

### Scheduler changes

File: `src/core/cleanup/cleanup-scheduler.ts`.

- Add `FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS` to the required-env list. Scheduler still refuses to start if any are unset (warning, no crash, per R-RUNTIME behaviour).

### E2E journey changes

File: `e2e/r-runtime-deploy-journey.spec.ts` becomes the baseline `e2e/r-artifacts-chain.spec.ts` (or the deploy journey is extended — decide in plan phase). Additional assertions:

1. After pipeline completes, `<workspace_root>/.fluxaos-artifacts/<runId>/` exists.
2. `research-findings.md` exists and is non-empty (Research stage wrote to it).
3. Implement stage's run transcript contains a `Read` tool call against `research-findings.md` (proves stage 2 consumed stage 1's output).
4. After release, the worktree dir is gone but the artifacts dir persists.
5. Cleanup sweep with artificially-aged timestamps reaps the artifacts dir.

Points 3 and 5 are new; 1, 2, 4 are reachable extensions of the existing journey.

---

## Risk & mitigations

| Risk | Mitigation |
|---|---|
| Skills accidentally write outputs *into* the worktree instead of the artifacts dir, then the deploy bridge commits them. | Keep worktree + artifacts *root* distinct (`.fluxaos-worktrees/` vs `.fluxaos-artifacts/`). Stage prompts explicitly name `{{artifacts_path}}`. No seed template ever mentions the worktree as a place to write intermediate notes. |
| `.fluxaos-artifacts/` gets committed to the target repo because operator didn't re-check `.gitignore`. | Provider auto-appends to `.gitignore` on first acquire — same mechanism R-RUNTIME proved out for worktrees. Journey test asserts the `.gitignore` line is present. |
| Cleanup reaps an artifacts dir while an operator is still reading it. | Retention window is operator-configured via env var. Default (to seed): 30 days (Archon uses similar — confirm in plan phase). If that's too short, operator raises it. |
| Artifacts dir fills the disk because runs are frequent and retention is long. | `cleanupToMakeRoom()` treats artifacts as a reap target when worktree reap isn't enough. Disk-pressure signal is out of scope for alpha; operator sets retention shorter if they see growth. |
| Two parallel pipeline runs for the same `run_id` race on dir creation. | `run_id` is UUID; can't collide. `mkdir -p` is idempotent. No concurrency concern. |
| Artifacts_path on `isolation_environment` row goes out of sync with the on-disk dir (repair path). | Provider `acquire()` is upsert/repair-aware (R-RUNTIME already). If the row exists but the dir doesn't, recreate. Same pattern as worktree repair. |
| Re-runs of the same pipeline (rework loop) — do they share artifacts or each get a fresh dir? | Share. Artifacts_dir is scoped to `run_id`, and R-RUNTIME already reuses a worktree for the same runId via the repair path. Rework creates a new stage_run under the existing pipeline_run, not a new pipeline_run, so artifacts persist across rework. |

---

## Open questions to resolve in the plan phase

1. **Retention default.** What's the seed value for `FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS`? Archon reference suggests ~30 days. Plan-phase research confirms.
2. **Where to compute `artifacts_path` first — orchestrator or provider?** This spec says the provider does it and the orchestrator stores it on `pipeline_run` from the provider's return. An alternative: orchestrator computes and passes in. Provider-owned is cleaner; plan phase nails down call order.
3. **Journey test — extend the existing R-RUNTIME journey or add a new one?** Leaning new (`e2e/r-artifacts-chain.spec.ts`) so the R-RUNTIME journey stays focused on the git+forge part. Plan phase confirms.
4. **Seed data scope.** All five seeded skills get prompt amendments in R-ARTIFACTS, OR only Research + Implement for alpha and the rest are deferred? Plan phase decides.
5. **DEF-020.** R-ARTIFACTS extends the journey in ways that affect its poll loop. Fix DEF-020 as part of this phase or keep it independent? Leaning fix-together since the new assertions require a reliable terminal signal anyway.

---

## Verification bar (copied from AGENT_BEHAVIOR.md)

- Playwright journey test exercises Research → Implement with real Claude against live sandbox, asserts Research produced `research-findings.md`, asserts Implement read it (tool-call transcript evidence), asserts the artifacts dir persists after worktree release, asserts cleanup sweep reaps it once aged.
- Operator signs off via browser after the journey passes.

No invented numeric thresholds in this spec. Any number (retention days, sweep interval) gets pulled from user-set env vars or plan-phase research against Archon.
