# R-RUNTIME — Workspace Isolation + Forge Adapter + Deploy Bridge (Design)

**Date:** 2026-04-22
**Status:** Design proposed; plan pending
**Phase:** R-RUNTIME (alpha-critical; nothing downstream works without this)
**Consumes:** [`research/2026-04-22-archon-prior-art.md`](../research/2026-04-22-archon-prior-art.md), [`specs/2026-04-07-fluxaos-spec-v2.md`](2026-04-07-fluxaos-spec-v2.md), [roadmap](../roadmap.md) "Phases — Alpha" row R-RUNTIME, [roadmap](../roadmap.md) "Phases — Done" row R-REM-W3-a (PR #50), `src/core/ports/git.ts` (already exists with the target port shape).
**Supersedes:** the "GitHub adapter" slice scope in [`specs/2026-04-20-r-ui-2-disposition-and-w3-decomposition-design.md`](2026-04-20-r-ui-2-disposition-and-w3-decomposition-design.md) §"Phase 4 — R-REM-W3 remainder" (already marked superseded by PR #67).

---

## Prior Art

This phase borrows patterns from [Archon](https://github.com/coleam00/Archon) (Cole Medin, MIT). Specific references:

| fluxaOS concern | Archon reference |
|---|---|
| Worktree lifecycle helpers | `packages/git/src/worktree.ts` |
| Isolation provider (create/tear-down a worktree-per-run) | `packages/isolation/src/providers/worktree.ts` |
| Isolation-environments DB shape | `packages/core/src/db/isolation-environments.ts` |
| Gitignored-file copy into new worktrees | `packages/isolation/src/worktree-copy.ts` |
| Cleanup service (events + scheduler + disk-pressure + user command) | `packages/core/src/services/cleanup-service.ts` |
| Forge adapter directory structure (official + community) | `packages/adapters/src/forge/github/`, `packages/adapters/src/community/forge/{gitlab,gitea}/` |

Borrows are **shape-only** — fluxaOS writes its own code matching these designs. No file-level code lift. If a future phase needs a code-adapted lift, the MIT copyright header must be retained and the specific spec must call out the file-level attribution.

All file pointers are against the clone at `/mnt/dev/.forge/Archon/`. That directory is outside any git tree.

---

## Why This Phase

The existing `materialize()` in `src/core/skills/materializer.ts` writes an instructions file plus an issue-context file into a tmp directory and passes that path to the driver as `cwd`. That's the **persona-context staging area** — not a checkout of the target repo. The worker today has **no direct access to the target repo's source tree** during a run.

This gap was not called out in prior specs. R-REM-W3-a's live-Claude journey worked because the Research stage is a read-only reasoning task that produces transcript output, not code changes. The moment a stage needs to read or modify target-repo source, today's model breaks — the worker either has no files to reason about, or (worse) wanders into the fluxaOS source tree itself (which R5.5 testing actually observed when the Hold stage found real fluxaOS `/api/health/route.ts` code while evaluating seed issue #2).

R-RUNTIME closes this gap: every pipeline run executes inside an isolated git worktree of the target repo, on a per-run branch. When the pipeline completes successfully the orchestrator commits, pushes, and opens a PR. When the run is done with the worktree (success or failure), it gets cleaned up.

**Alpha definition of done requires this.** "File an issue → get a PR" cannot close without a target-repo checkout and a deploy step.

---

## Scope

### In

1. **Workspace isolation primitive** — worktree-per-run, on a namespaced branch, at a stable `~/.fluxaos/workspaces/<owner>/<repo>/worktrees/<branch>` layout. Accessible from orchestrator via an `IsolationProvider` port with one implementation (worktree-based).
2. **`isolation_environment` DB table** — mirrors the filesystem state, scoped by `project_id` + `run_id`, with a partial-unique-index on `(project_id, run_id) WHERE status = 'active'`.
3. **Gitignored-file copy** — on worktree creation, copy a configured list of gitignored paths from the canonical repo into the new worktree. Path-traversal safe. Silent-ENOENT. Logs partial failures without aborting.
4. **Cleanup service** — four cleanup triggers (event on PR merge/close, scheduled sweep, disk-pressure on-demand, user command). Safety checks before any removal.
5. **GitHub adapter** — `src/adapters/github/` implementing `GitProvider` at minimum for `createBranch` and `createPullRequest`. The other three port methods (`getPullRequest`, `listPullRequests`, `mergePullRequest`) ship only if they fall out naturally during implementation.
6. **Deploy bridge** — after the pipeline's terminal stage signals success, the orchestrator commits any uncommitted worktree state, pushes the branch to origin, calls `GitProvider.createPullRequest(...)`, records the resulting PR URL + number on the issue, and advances the issue state.
7. **Retire `IssueProvider` port** — delete `src/core/ports/issue.ts` and any exports/re-exports. No runtime consumers per R-REM-W3-a precedent.
8. **Integration test coverage** — Vitest integration tests for the isolation primitive + cleanup service against the real filesystem + real Supabase; one Playwright journey that runs a pipeline end-to-end against a disposable throwaway target repo, asserts a PR was opened, asserts the issue advanced, asserts the worktree was cleaned up.

### Out (deferred or post-alpha)

- **Non-GitHub forges.** GitLab / Gitea / Forgejo / Bitbucket follow the same `GitProvider` port; community-contributable post-alpha.
- **`repo-local` worktree layout.** Archon supports opt-in `<repoRoot>/.worktrees/` layout; fluxaOS alpha ships workspace-scoped only. Config flag can be added later without schema change.
- **Platform-adapter messaging surface.** Archon's `sendMessage`/`ensureThread`/`handleWebhook` methods are not ported — fluxaOS's UI is native, not GitHub-comments-based.
- **Archon's `resolver.ts` / `pr-state.ts`.** Useful long-term but not alpha-critical. Revisit in R-POLISH if cleanup surfaces a need.
- **Merge-back-to-local filesystem mutation.** Decided explicitly in the 2026-04-22 session: PRs open remotely, the user pulls when they choose. The deploy bridge never touches the user's local checkout.
- **GitHub App / OAuth flow.** Alpha uses a single Personal Access Token from an env var. GitHub App and per-user auth flow is post-alpha.
- **Webhook-driven `onConversationClosed`.** Alpha cleans up on PR merge/close via **scheduled sweep**, not a live webhook. Webhooks are post-alpha; the scheduled sweep with PR-state check is functionally equivalent for alpha.
- **User-commands surface.** Archon exposes `/worktree cleanup merged|stale|orphans`; fluxaOS exposes the equivalent as tRPC mutations that Mission Control or a future admin tab can call. Not a chat-command interface.

---

## Architecture

### Ports and Adapters

Two new port files; one port-file modification; one port-file deletion.

**New:**

```
src/core/ports/isolation.ts   // IsolationProvider
```

**Exists, unchanged:**

```
src/core/ports/git.ts         // GitProvider — shape is already right for alpha
```

**Delete:**

```
src/core/ports/issue.ts       // IssueProvider — retired per R-REM-W3-a precedent
```

**New adapters:**

```
src/adapters/git/
  worktree-isolation-provider.ts   // IsolationProvider implementation
  worktree.ts                      // low-level git worktree helpers (thin shell-out wrappers)
  worktree-copy.ts                 // gitignored-file copier
  path-resolver.ts                 // owner/repo resolution, workspace-root path helpers
  index.ts                         // exports
src/adapters/github/
  adapter.ts                       // GitProvider implementation
  auth.ts                          // PAT-based auth (env var)
  types.ts                         // internal types (Octokit response shapes etc.)
  index.ts                         // exports
```

**Core services (DI factories, no vendor imports):**

```
src/core/isolation/
  isolation-service.ts             // thin service over the IsolationProvider port
src/core/cleanup/
  cleanup-service.ts               // the four-trigger cleanup logic
  cleanup-scheduler.ts             // setInterval harness for the scheduled sweep
src/core/deploy/
  deploy-bridge.ts                 // commits + pushes + createPullRequest + records on issue
```

The registry (`src/config/registry.ts`) gains one new slot: `isolation`. The existing `git` slot (currently unfilled) gets populated by the GitHub adapter.

### The `IsolationProvider` port

```ts
// src/core/ports/isolation.ts
export interface IsolationEnvironment {
  id: string;
  projectId: string;
  runId: string;              // pipeline_run.id — the workflow identity
  provider: string;           // 'worktree' for alpha
  workingPath: string;        // absolute path to the worktree dir
  branchName: string;
  status: 'active' | 'inactive';
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AcquireEnvironmentParams {
  projectId: string;
  runId: string;
  repoPath: string;           // canonical checkout the worktree attaches to
  repoIdentity: { owner: string; repo: string };  // for workspace layout
  branchName: string;         // e.g. 'fluxaos/issue-42' — caller-derived
  baseBranch?: string;        // default 'main'
  copyFiles?: string[];       // gitignored paths to copy — default []
}

export interface IsolationProvider {
  /**
   * Acquire a worktree for a run. Upserts on (projectId, runId) — re-entrant.
   * If the DB row and worktree both exist, returns the existing one.
   * If the row exists but the worktree is gone, repairs it.
   * If neither exists, creates both atomically.
   */
  acquire(params: AcquireEnvironmentParams): Promise<IsolationEnvironment>;

  /**
   * Release a worktree. Marks DB row inactive and removes the worktree from disk.
   * Safe to call repeatedly (idempotent). Does NOT delete the branch — that's
   * deploy-bridge and cleanup-service territory.
   */
  release(envId: string, options?: { force?: boolean }): Promise<void>;

  /** DB-only lookup; does not touch filesystem. */
  findActiveByRun(projectId: string, runId: string): Promise<IsolationEnvironment | null>;

  /** DB-only lookup; does not touch filesystem. */
  listActiveByProject(projectId: string): Promise<IsolationEnvironment[]>;
}
```

Shape notes:

- `acquire` is **upsert-based and repair-aware**, matching Archon's shape. Re-running the same (project, run) reuses the same environment. This is the critical property that lets R-DAEMON crash-recover: after a restart, the daemon can re-acquire the environment for any still-running `pipeline_run` without duplicating state.
- `release` does not delete the branch. Branch deletion happens either when the PR merges (handled by the cleanup service's event trigger) or when a stale cleanup reaps the whole environment. Keeping these concerns separated lets the deploy bridge push a branch and immediately release the worktree without losing the branch.
- `workflowType` from Archon's schema is **omitted from fluxaOS's port**. Archon has multiple workflow types (chat, agent, etc.); fluxaOS has one — a pipeline run. The `pipeline_run.pipelineId` already distinguishes pipeline kinds. Adding `workflowType` would be YAGNI.

### The `isolation_environment` DB table

```ts
// additions to src/core/db/schema.ts
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
    status: text('status').notNull().default('active'),  // 'active' | 'inactive'
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt,
    updatedAt,
  },
  (t) => [
    // Exactly one active environment per (project, run). Inactive rows may accumulate.
    uniqueIndex('isolation_env_active_idx')
      .on(t.projectId, t.runId)
      .where(sql`status = 'active'`),
    // Listing active environments by project (cleanup service + UI)
    index('isolation_env_project_status_idx').on(t.projectId, t.status),
  ]
);
```

**Rationale for the partial unique index:** matches Archon's `ON CONFLICT … WHERE status = 'active'` semantics. Exactly one active env per run enforces at the DB level what the port's `acquire` upsert assumes. Inactive rows are allowed to accumulate for historical/audit traceability; the scheduled sweep prunes them after the session-retention threshold.

**Why `runId` instead of Archon's `workflow_type + workflow_id` tuple:** fluxaOS has one workflow kind (a pipeline run), and `pipeline_run.id` is the natural key. Collapsing the tuple to a single FK is both simpler and schema-correct.

**Why `metadata` is jsonb:** matches Archon; leaves room for fields we don't know we need yet (e.g., `copied_files: [...]` for audit).

### The `git` adapter (worktree helpers)

Thin shell-outs to `git` CLI. Not exposed through a port — the isolation provider is the port. These are internal helpers for the adapter.

```
src/adapters/git/worktree.ts
  - createWorktree(repoPath, worktreePath, branchName, baseBranch)
  - removeWorktree(repoPath, worktreePath, { force })
  - listWorktrees(repoPath) → WorktreeInfo[]
  - worktreeExists(worktreePath) → boolean
  - getCanonicalRepoPath(anyPath) → string  (resolves worktree → canonical)
  - hasUncommittedChanges(worktreePath) → boolean
  - isBranchMerged(repoPath, branchName, baseBranch) → boolean
  - getLastCommitDate(worktreePath) → Date | null
  - commitAll(worktreePath, message) → { commitSha } | { noChanges: true }
  - push(worktreePath, branchName, { setUpstream }) → void

src/adapters/git/path-resolver.ts
  - resolveRepoIdentity({ repoPath, repoUrl, override? }) → { owner, repo }
  - getWorkspaceRoot() → string  (e.g. ~/.fluxaos/workspaces)
  - getWorktreeBase({ owner, repo }) → string
  - getWorktreePath({ owner, repo, branchName }) → string
```

`resolveRepoIdentity` precedence (borrowed from Archon's `resolveOwnerRepo`):
1. Explicit override — the project row's `repoUrl` parsed as `owner/repo`
2. Workspace-path match — if the repo is already under the fluxaOS workspace root
3. Filesystem fallback — last two path segments of `repoPath`

All three fall back cleanly for the alpha single-project case; #1 is what the seeded project will actually hit.

### The `worktree-copy` helper

```
src/adapters/git/worktree-copy.ts
  - parseCopyFileEntry(entry: string) → { source, destination }
  - isPathWithinRoot(root, filePath) → boolean  (path-traversal safe)
  - copyWorktreeFile(sourceRoot, destRoot, entry) → boolean
  - copyConfiguredFiles(sourceRoot, destRoot, entries: string[]) → CopyReport
```

Where the list of files to copy comes from: the `project` row gets a new `worktreeCopyFiles jsonb` column — an array of strings. Default: `[]`. The Settings → Projects form (R-SETTINGS-ALPHA) surfaces this as a multi-line paths field. For alpha the seed project is fluxaOS's own repo and the default is fine; a project targeting a repo with env-sensitive fixtures will set `[".env", "fixtures/"]` or similar.

**Why on `project`, not a separate config table:** simplest place. Archon uses a YAML file; fluxaOS is DB-driven. Projects already have `repoUrl`, `defaultPipelineId`, `brandId`. One more nullable-jsonb column is fine.

### The GitHub adapter

```
src/adapters/github/auth.ts
  - getAuthenticatedOctokit() → Octokit
    - Reads FLUXAOS_GITHUB_TOKEN env var
    - Throws a typed error if missing — fail-fast per project principles

src/adapters/github/adapter.ts
  - export class GitHubAdapter implements GitProvider
    - createBranch(repo, branch, fromRef?)
    - createPullRequest(params: CreatePRParams): Promise<PullRequest>
    // Not required for alpha but cheap-if-they-fall-out:
    - getPullRequest(repo, number)
    - listPullRequests(repo, state?)
    - mergePullRequest(repo, number, method?)

src/adapters/github/types.ts
  // Internal types only. The port shape (GitProvider, CreatePRParams, PullRequest)
  // is the public surface; this file wraps Octokit response shapes for the adapter's
  // internal use.
```

**Auth model.** Single Personal Access Token from `FLUXAOS_GITHUB_TOKEN` env var. Fails fast on startup if unset AND any registered project's `repoUrl` is a GitHub URL. GitHub App + per-user OAuth is explicitly post-alpha.

**Library:** `@octokit/rest`. Adding one dep to an already-present ecosystem — this is a schema-adjacent change and falls under the "roadmap / deps" user-escalation category. This spec documents the intended addition; plan execution will surface it for approval before install.

**Error handling.** Octokit errors get wrapped in typed errors so `GitProvider` callers don't leak vendor-specific shapes. The wrapper preserves the underlying `status` code and `message` so the orchestrator can make structured retry decisions later (not alpha-scoped, but the shape shouldn't preclude it).

### The deploy bridge

Called by the orchestrator when a pipeline_run reaches a terminal-success state. Sequential:

```
// src/core/deploy/deploy-bridge.ts — pseudocode, not final API
async function deploy(runId, { logger, db, registry }) {
  const env = await isolation.findActiveByRun(projectId, runId);
  if (!env) throw new Error('no active isolation env for run ' + runId);

  // 1. Commit any uncommitted state. The worker may have committed
  //    along the way; we still pick up anything dangling.
  const commit = await git.commitAll(env.workingPath,
    buildCommitMessage({ run, issue, persona }));

  // 2. Push the branch.
  await git.push(env.workingPath, env.branchName, { setUpstream: true });

  // 3. Open the PR through the port.
  const pr = await registry.get('git').createPullRequest({
    repo: project.repoUrl,                    // 'owner/repo' format
    title: buildPRTitle(issue),
    body: buildPRBody(issue, run, commit),    // includes run URL + issue link
    headBranch: env.branchName,
    baseBranch: project.defaultBranch ?? 'main',
    draft: false,
  });

  // 4. Record the PR on the issue.
  await issueService.updateWithPR(issueId, {
    externalPrNumber: pr.number,
    externalPrUrl: pr.url,
    state: 'awaiting_review',                 // issue lifecycle advance
  });

  // 5. Release the isolation environment. Branch stays — the PR owns it now.
  await isolation.release(env.id);

  return { pr };
}
```

**Commit-message and PR-body template.** Generated from structured fields (persona, issue, run). Specific format is UI-visible text, so it belongs in the plan phase rather than the spec — captured as an open item below.

**Issue state advance.** The issue lifecycle already has states defined in `src/core/services/issueService.ts`. R-RUNTIME adds the transition `research → implementation → review → awaiting_review` (or whatever the actual current states are — the plan phase will reconcile). The state the deploy bridge advances to on PR-open is **`awaiting_review`** (matching roadmap alpha definition of done: "advance the issue to an awaiting-review state"). The existing `issue.external_pr_number` column — if it doesn't exist — gets added as part of this phase (cheap; nullable int + nullable text URL).

**Failure modes and the orchestrator's response.**

- Commit fails (disk/permissions) → the run goes to `failed`, worktree is NOT released (left for diagnosis); cleanup service reaps it as stale eventually.
- Push fails (auth, network, pushed-non-fast-forward) → same; orchestrator marks the run `failed` with an error message, leaves the worktree for debugging.
- `createPullRequest` fails (403, repo not accessible, rate-limit) → same. This is where R-POLISH would add retry logic if we see it matter.
- `updateWithPR` fails (shouldn't — it's a local DB write) → the PR exists but the issue doesn't know. Recoverable manually, but log loudly.
- `release` fails (filesystem) → log, continue. The cleanup service will retry.

### The cleanup service

Four triggers. Shared safety-check logic.

```
src/core/cleanup/cleanup-service.ts
  - async onPrClosed(prNumber, { merged }): Promise<void>
  - async runScheduledSweep(): Promise<CleanupReport>
  - async cleanupToMakeRoom({ requiredBytes? }): Promise<CleanupReport>
  - async removeEnvironment(envId, { force }): Promise<RemoveEnvironmentResult>
  - async listBreakdown({ projectId }): Promise<BreakdownReport>

  // Internal:
  - isSafeToRemove(env): Promise<{ safe: boolean; reason?: string }>
    - hasUncommittedChanges → NOT safe (skip)
    - isBranchMerged upstream → safe (merged, can reap)
    - getPrState(env.branchName) → 'open' → NOT safe (still in review)
    - getLastCommitDate → age beyond threshold → safe (stale)
```

**Triggers in detail:**

1. **`onPrClosed`** — called by the orchestrator (or, post-alpha, a webhook). When a PR closes (merged or not), reap the isolation environment for its branch if no other active runs need it. For alpha this is called from the **scheduled sweep** — we check PR state for any env whose branch is `awaiting_review` and invoke `onPrClosed` if the PR has closed.

2. **`runScheduledSweep`** — called on an interval. Finds candidates: active envs whose runs are terminal (completed/failed/cancelled) OR whose age exceeds the stale threshold. Applies safety checks. Produces a `CleanupReport` with removed, skipped-with-reason, errors arrays. Logged and persisted.

3. **`cleanupToMakeRoom`** — on-demand call, e.g. from a disk-pressure monitor or an admin UI button. Reaps the oldest safe candidates until the required byte quota is satisfied.

4. **`removeEnvironment`** — direct removal by env ID. Exposed as a tRPC mutation. Requires `force: true` to bypass safety checks.

**Thresholds and intervals.** Configurable via env vars. Default values are **NOT set in this spec** per the no-invented-thresholds rule — they belong in the plan's config table with user confirmation. Archon's defaults (14 days stale, 6-hour sweep interval) are referenced as precedent, not adopted. The plan phase will include a "thresholds to decide" row and the user picks. Until then the variables are declared with no defaults and the scheduler refuses to start until they're set.

**`CleanupReport` shape:**

```ts
interface CleanupReport {
  removed: { envId: string; branchName: string; reason: string }[];
  skipped: { envId: string; reason: string }[];
  errors: { envId: string; error: string }[];
  startedAt: Date;
  completedAt: Date;
}
```

Reports are logged (structured) and optionally persisted to a new `cleanup_run` table. **Persistence is out of alpha scope** — if Mission Control wants to show cleanup history, R-MISSION-CONTROL adds the table. For alpha the logs are enough.

### The scheduler

`src/core/cleanup/cleanup-scheduler.ts` provides `start()` / `stop()` / `isRunning()`. Wired up by the orchestrator-daemon startup path (R-DAEMON). For alpha's pre-daemon manual-trigger model, the scheduler is also started by `npm run dev` via a bootstrap hook if a `FLUXAOS_RUN_CLEANUP_SCHEDULER=1` env var is set. This lets the scheduled sweep exercise in dev without requiring the systemd daemon to be up.

### Wiring into the orchestrator

Changes to the orchestrator in `src/core/orchestrator/`:

1. **`stage-runner.ts`** — replace the current `materialize()`-only path with: acquire isolation env → materialize persona/skill/context files **into the worktree, not a tmp dir** → invoke driver with `cwd: env.workingPath` → on terminal stage of the last pipeline stage, call the deploy bridge → release env (or leave for diagnosis on failure).

2. **`manual-run.ts`** — adopts the same model. Manual triggering of a pipeline against an issue spins up an isolation env the same way the daemon would.

3. **`event-orchestrator.ts`** — the reaction handler gets an `onPipelineRunCompleted` branch that invokes the deploy bridge on success.

The `materialize()` function stays — it still writes the persona + context files — but it gets a new `workspacePath` parameter from the caller instead of minting its own tmp dir. Its interface becomes `materialize({ ...existing, into: workspacePath })`.

### Testing strategy

1. **Integration tests** (vitest, real Supabase, real filesystem): `src/__tests__/integration/isolation.test.ts` covers acquire-repair-release lifecycle, upsert semantics, concurrent-acquire races, path-traversal safety in worktree-copy, cleanup safety checks.
2. **Integration tests**: `src/__tests__/integration/cleanup.test.ts` covers each of the four triggers against seeded DB state.
3. **Integration tests**: `src/__tests__/integration/github-adapter.test.ts` — skipped without `FLUXAOS_GITHUB_TOKEN`; with it, creates + deletes a disposable branch in a throwaway test repo. Same skip-without-creds pattern as `real-anthropic-stage-run.spec.ts`.
4. **Playwright journey**: `e2e/r-runtime-deploy-journey.spec.ts` — triggers a pipeline run end-to-end, asserts worktree appeared, pipeline ran, PR got opened, issue advanced to `awaiting_review`, worktree got released. Skip without GitHub credentials + throwaway-repo env vars. With them, cleans up the branch + PR it creates.
5. **No unit tests.** Per feedback memory.

---

## Schema Changes Summary

One new table, one new column. All delivered in a single migration.

| Change | Table | Column | Type | Nullable | Default |
|---|---|---|---|---|---|
| New table | `isolation_environment` | (full shape above) | | | |
| New column | `project` | `worktree_copy_files` | `jsonb` | Yes | `'[]'::jsonb` |
| New column | `project` | `default_branch` | `text` | Yes | `'main'` |
| New column | `issue` | `external_pr_number` | `integer` | Yes | null |
| New column | `issue` | `external_pr_url` | `text` | Yes | null |

**`issue.external_pr_*`** — these may already exist. The plan phase will check and drop redundant rows from this list.

**`project.default_branch`** — not all target repos default to `main`; the deploy bridge needs to know what base branch to open the PR against.

**Schema addition escalation.** Per user preference, schema changes need approval. This spec flags them; the plan phase will present the migration for approval before running.

---

## File Inventory

**Created:**

```
src/core/ports/isolation.ts
src/core/isolation/isolation-service.ts
src/core/cleanup/cleanup-service.ts
src/core/cleanup/cleanup-scheduler.ts
src/core/deploy/deploy-bridge.ts
src/adapters/git/index.ts
src/adapters/git/worktree.ts
src/adapters/git/worktree-copy.ts
src/adapters/git/path-resolver.ts
src/adapters/git/worktree-isolation-provider.ts
src/adapters/github/index.ts
src/adapters/github/auth.ts
src/adapters/github/adapter.ts
src/adapters/github/types.ts
src/__tests__/integration/isolation.test.ts
src/__tests__/integration/cleanup.test.ts
src/__tests__/integration/github-adapter.test.ts
e2e/r-runtime-deploy-journey.spec.ts
src/core/db/migrations/000X_r_runtime.sql    // concrete number set at plan time
```

**Modified:**

```
src/core/db/schema.ts                  // +isolation_environment table, +project/issue columns
src/core/ports/index.ts                // +isolation export, -issue export
src/config/registry.ts                 // +isolation slot, populate git slot
src/config/bootstrap.ts                // +isolation adapter registration, +github adapter registration
src/core/orchestrator/stage-runner.ts  // call isolation.acquire around materialize+driver
src/core/orchestrator/manual-run.ts    // same
src/core/orchestrator/event-orchestrator.ts  // onPipelineRunCompleted → deploy
src/core/skills/materializer.ts        // accept `into` path parameter, don't mint tmp dir
src/core/services/issueService.ts      // updateWithPR helper
```

**Deleted:**

```
src/core/ports/issue.ts
(and any consumers — grep pass during execution)
```

---

## Alignment with Existing Patterns

- **No vendor imports in `src/core/`.** Worktree helpers and Octokit live in `src/adapters/`; core consumes them through the `IsolationProvider` and `GitProvider` ports.
- **DI factory pattern.** `isolation-service`, `cleanup-service`, `deploy-bridge` are factories receiving `Database` + registry, matching `issueService`, `pipelineRunService`, etc.
- **Fail-fast on missing config.** Missing `FLUXAOS_GITHUB_TOKEN` → typed error at `GitHubAdapter` construction, not silent fallback.
- **Edit, never write.** Existing files get edited (orchestrator, materializer, schema); new concerns go in new files.
- **No unit tests.** Integration tests against real filesystem + real Supabase.
- **Roadmap alignment.** Phase scope matches R-RUNTIME row verbatim: isolation, isolation-environments table, worktree-copy, cleanup, GitProvider implementation, deploy bridge.
- **Agnostic engine.** No stage/provider/driver names in core code. Deploy-bridge triggers on pipeline terminal state regardless of what stages ran.

---

## Open Items (resolve during plan phase)

1. **Cleanup thresholds.** Stale threshold (days), sweep interval, session retention. User sets values; spec refuses to invent defaults.
2. **Commit-message format / PR-body template.** Content is UI-visible; needs a concrete template. Archon's templates are reference.
3. **Existing `issue` columns for PR reference.** Check whether `external_pr_number` / `external_pr_url` already exist in schema; drop from migration if so.
4. **Existing `issue` lifecycle states.** Check current enum/text values; the deploy bridge advances to `awaiting_review`, so that state must exist or be added.
5. **Branch-name convention.** This spec uses `fluxaos/issue-<number>`. Alternatives: `flu/issue-<number>`, `fluxaos/run-<run-slug>`, or whatever the user prefers. Picked at plan time.
6. **Default `baseBranch`.** Column `project.default_branch` defaults to `'main'`. Post-alpha: detect via `gh repo view --json defaultBranchRef`. Alpha: explicit.
7. **Octokit version.** Latest vs. the version other adapter code in the project might already pull in. Verify there isn't already a transitive Octokit.
8. **Node.js version floor.** Worktree tests exercise git CLI which varies across host environments. Document the minimum git version in plan or README.

---

## Risks

**R1 — Git CLI behavior differs across hosts.** The worktree shell-outs assume a recent-enough git (2.30+, which supports `git worktree add --no-track` cleanly). On the dev homelab this is fine; for future contributors not necessarily. **Mitigation:** document minimum version in R-POLISH; detect + fail fast at startup.

**R2 — Disk pressure blows up isolated workloads.** Each worktree is a full checkout; a repo with a 2GB working tree × N concurrent runs is a lot of disk. **Mitigation:** the cleanup service's `cleanupToMakeRoom` trigger exists specifically for this. Alpha pattern is "one project, low concurrency" so the risk is bounded; post-alpha revisits with a shallow-clone or blob-filter option.

**R3 — Branches accumulating on the remote if `onPrClosed` events are missed.** The scheduled sweep's PR-state check is the backstop — any env whose branch corresponds to a closed PR gets reaped on the next sweep. **Mitigation:** the sweep is designed to be idempotent and safe; running it more often is only a rate-limit concern.

**R4 — Concurrent `acquire` for the same (project, run) tuple.** The partial unique index prevents DB-level duplicates, but the caller could get a spurious failure on conflict. **Mitigation:** `acquire` catches the uniqueness violation, re-selects, and returns the existing row (upsert semantics). Covered by integration test.

**R5 — GitHub token rate limits.** The alpha deploy bridge calls GitHub once per successful run (one `createPullRequest`). Rate limits don't bite at alpha's expected volume. **No mitigation needed.**

**R6 — Running the worker inside the fluxaOS repo itself (dogfooding).** Out of scope — dogfooding is post-alpha. The spec assumes a separate target repo configured in the `project` row. Running against fluxaOS's own tree would work mechanically (it's just a git repo) but bootstrap-fragility is real and not worth alpha scope.

**R7 — Secrets in copied gitignored files.** Copying `.env` into a worktree means the worker sees real secrets. For alpha this is fine — the worker is a subprocess running on the same host as the orchestrator, with the same privileges. Post-alpha considerations around remote worker runtimes change this calculus. **No alpha mitigation; flagged for post-alpha security pass.**

---

## Acceptance Criteria

The phase is done when all of these hold:

1. **Isolation primitive works.** A pipeline run spawned against a seeded target project creates a worktree at the documented path, runs the driver with `cwd` pointing at it, and releases it cleanly on success.
2. **DB table populated correctly.** After a successful run, `isolation_environment` has one row for that run with `status='inactive'`; during execution it has one with `status='active'`.
3. **GitHub adapter shipped.** A pipeline run that terminates successfully results in a real PR against the configured target repo. PR body links back to the fluxaOS issue and the run.
4. **Deploy bridge closes the loop.** Issue state advances to `awaiting_review`; `issue.external_pr_number` + `external_pr_url` record the PR.
5. **Cleanup service verified.** Scheduled sweep runs, reaps stale environments, respects safety checks (uncommitted changes, open PR, unmerged branch). Integration test exercises each skip condition.
6. **Worktree-copy works.** Projects with configured `worktreeCopyFiles` get those files into the worktree. Missing files are silently skipped. Path-traversal attempts are rejected with a logged error.
7. **`IssueProvider` port is gone.** `src/core/ports/issue.ts` does not exist; all re-exports removed.
8. **End-to-end journey passes.** `e2e/r-runtime-deploy-journey.spec.ts` runs against a disposable target repo with credentials set and closes the full file-issue → PR loop. Without credentials it skips cleanly.
9. **Standard verification gates hold.** `npm run verify` 10/10, `npm run lint` baseline unchanged, `npx vitest` all green, tsc clean, existing Playwright smokes still pass, existing `real-anthropic-stage-run.spec.ts` still passes.
10. **User personally verifies in the browser.** End-to-end loop observed once from UI sign-off per AGENT_BEHAVIOR.md.

---

## What This Unblocks

- **R-DAEMON** — the daemon consumes queue items; each item becomes a pipeline run that needs an isolation env. R-RUNTIME is the primitive it consumes.
- **R-ARTIFACTS** — artifact directory lives alongside (not inside) the worktree; R-RUNTIME's `acquire` can trivially extend to also mint an `artifacts_dir` path.
- **R-SMOKE** — the acceptance-test journey depends on deploy-bridge existing.

R-EPIC, R-SETTINGS-ALPHA, and R-MISSION-CONTROL are independent of R-RUNTIME and can run in parallel.

---

## Attribution

The workspace-isolation, worktree-copy, cleanup-service, and forge-adapter structure patterns in this spec are shape-only borrows from Archon (`github.com/coleam00/Archon`, MIT) per the attribution policy in [`research/2026-04-22-archon-prior-art.md`](../research/2026-04-22-archon-prior-art.md). fluxaOS writes its own implementation. If the plan or execution phase ends up lifting code from Archon source files (not shape-only), the MIT header must be retained and the specific file-level lift documented in the consuming plan's Prior Art section.
