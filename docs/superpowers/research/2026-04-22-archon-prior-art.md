# Archon Prior Art — Pattern Reference for fluxaOS Alpha

**Date:** 2026-04-22
**Status:** Active reference
**License note:** Archon is MIT-licensed. We borrow patterns and architectural shapes. Where we lift code or near-code, attribution is required in the specific spec/plan that does the lifting.

---

## Why this document exists

Tonight's brainstorm session (2026-04-22) uncovered that Cole Medin's Archon project (`github.com/coleam00/Archon`) has already solved most of the plumbing-layer problems fluxaOS needs for alpha: workspace isolation, worktree lifecycle, cleanup, forge adapters, headless worker runtime, stage-to-stage data handoff. Archon is MIT-licensed, actively maintained, ~19k stars, and its code is readable.

The strategic direction: **continue building fluxaOS (its product thesis — rich issue model, DB-driven config, web-UI authoring — differs from Archon), but borrow Archon's proven plumbing patterns rather than reinvent them.**

This document captures what we borrow, what we deliberately don't, and exact file pointers into a local clone of Archon for reference.

---

## Local clone location

Both repos are cloned (shallow) to `/mnt/dev/.forge/` on the dev machine. That directory is outside any git tree and not synced anywhere.

- `/mnt/dev/.forge/Archon/` — the main Archon codebase
- `/mnt/dev/.forge/dark-factory-experiment/` — Cole's reference project that uses Archon as its dev harness (a RAG chat app, unrelated to Archon's product domain but useful for seeing Archon-in-practice)

If you need to re-clone:

```bash
mkdir -p /mnt/dev/.forge
cd /mnt/dev/.forge
git clone --depth 1 https://github.com/coleam00/Archon.git
git clone --depth 1 https://github.com/coleam00/dark-factory-experiment.git
```

---

## Patterns fluxaOS intends to borrow

### 1. Worktree-per-run as the workspace model

**Archon files:**
- `packages/git/src/worktree.ts` (393 lines) — canonical worktree helpers: `getWorktreeBase`, `worktreeExists`, `listWorktrees`, `findWorktreeByBranch`, `isWorktreePath`, `removeWorktree`, `getCanonicalRepoPath`, `verifyWorktreeOwnership`, `extractOwnerRepo`
- `packages/isolation/src/providers/worktree.ts` (1,227 lines) — the isolation provider built on top of those helpers

**What to borrow:**
- One worktree per workflow run, on a namespaced branch (Archon uses `archon/task-<slug>`; fluxaOS will use `fluxaos/issue-<number>` or similar)
- Stable workspace-scoped layout: `~/.fluxaos/workspaces/<owner>/<repo>/worktrees/<branch>` (Archon's equivalent is `~/.archon/workspaces/<owner>/<repo>/worktrees/<branch>`)
- Opt-in `repo-local` layout where worktrees can alternatively live inside the repo at a configurable subdir — this is a per-repo config, not a system-wide setting
- Owner/repo identity resolution with three-level precedence: explicit `codebaseName` → workspace path match → fallback from basename/parent-basename. This lets non-cloned / locally-registered repos still land in a stable layout
- `git worktree list` treated as source of truth; DB mirrors it

**What NOT to borrow:**
- Archon's specific path constants (`getArchonWorkspacesPath`, `getProjectWorktreesPath`) — fluxaOS has its own naming
- Direct use of `@archon/paths` logger — fluxaOS has its own logging

### 2. Isolation-environments DB table

**Archon files:**
- `packages/core/src/db/isolation-environments.ts` (296 lines)

**What to borrow — the schema shape:**

Archon's `remote_agent_isolation_environments` table tracks:

- `id` (UUID)
- `codebase_id` (FK to the repo being worked on)
- `workflow_type` (e.g. the type of workflow consuming the environment)
- `workflow_id` (the specific run)
- `provider` (which isolation provider — they have multiple)
- `working_path` (the worktree directory)
- `branch_name` (the branch the worktree is on)
- `created_by_platform` (which platform initiated the run)
- `metadata` (JSONB for flexible extension)
- `status` (`'active'` | `'inactive'`)
- timestamps

**Critical design detail:** the unique constraint is `(codebase_id, workflow_type, workflow_id) WHERE status = 'active'`. This means running the same workflow for the same issue reuses the same worktree via upsert rather than creating duplicates. Inactive rows are allowed to accumulate (they're historical).

**For fluxaOS:** a new Drizzle table, probably named `isolation_environment`, with the same shape adapted to fluxaOS's conventions (`project_id` instead of `codebase_id`, `run_id` for the workflow identity). Drizzle partial-unique-index syntax covers the `WHERE status = 'active'` constraint.

### 3. Worktree-copy for gitignored files

**Archon files:**
- `packages/isolation/src/worktree-copy.ts` — copies git-ignored files (`.env`, fixtures, secrets) from the canonical repo into new worktrees based on config in `.archon/config.yaml`

**Why this matters:** `git worktree add` does NOT include gitignored files. A freshly-created worktree has no `.env`, no `node_modules`, no fixtures. For the worker to do useful work (build, test, run the app), these often need to be present.

**What to borrow:**
- The pattern of reading a config list of paths to copy (fluxaOS equivalent would live in a project config, likely in the DB not in a `.fluxaos/config.yaml`)
- Path-traversal safety check before copying (Archon has explicit `isPathWithinRoot`)
- Silent `ENOENT` handling (a missing `.env` isn't an error, it's expected for some setups)
- Logging on partial failures but not aborting the run

### 4. Cleanup service

**Archon files:**
- `packages/core/src/services/cleanup-service.ts` (697 lines)

**What to borrow — the full cleanup strategy:**

Four cleanup triggers:

1. **Event-driven** — `onConversationClosed(platformType, conversationId, { merged })` — when the PR merges or issue closes, clean up the associated isolation environment if no other conversations still use it
2. **Scheduled** — `runScheduledCleanup()` runs on an interval (default every 6 hours via `CLEANUP_INTERVAL_HOURS` env var). Finds stale environments (no activity for 14 days default via `STALE_THRESHOLD_DAYS`) and reaps them
3. **On-demand: disk pressure** — `cleanupToMakeRoom(codebaseId, mainRepoPath)` when space runs short
4. **User commands** — `/worktree cleanup merged|stale|orphans`, plus `/worktree remove [--force]`

**Safety checks before removal:**

- `hasUncommittedChanges` — skip (don't destroy unshipped work)
- `isBranchMerged` — confirm the branch actually merged upstream
- `isPatchEquivalent` — detect squash-merged or rebased branches that effectively shipped
- `getLastCommitDate` — age check for staleness
- `getPrState` — skip worktrees whose PR is still open

**Reporting:** every cleanup cycle produces a structured `CleanupReport` with `removed`, `skipped` (with reason), `errors`, and `sessionsDeleted`. This is logged and persisted.

**For fluxaOS:** port this pattern, using fluxaOS's logger and DB. Configurable thresholds via env vars. User-facing worktree commands in the CLI (if we build one) or UI. The discipline of "check before reap" is more important than matching Archon's API exactly.

### 5. Forge adapter structure

**Archon files:**
- `packages/adapters/src/forge/github/` — official GitHub adapter: `adapter.ts`, `auth.ts`, `types.ts`, `index.ts`
- `packages/adapters/src/community/forge/gitlab/` — community-contributed GitLab adapter (same file structure)
- `packages/adapters/src/community/forge/gitea/` — community-contributed Gitea adapter (same file structure)
- `packages/adapters/src/community/forge/README.md` — contributor guide explaining the `IPlatformAdapter` interface contract

**What to borrow:**
- The **shape** of a forge adapter: one directory per provider, conventional file names (`adapter.ts`, `auth.ts`, `types.ts`, `index.ts`), one implementation behind one port
- The **split between official and community** adapters — Archon uses `adapters/src/forge/` for maintained adapters and `adapters/src/community/forge/` for contributed ones. fluxaOS can adopt the same convention when/if multi-forge support matters
- The use of "forge" as vocabulary — more accurate than "git" for the broader class of code-hosting platforms (GitHub, GitLab, Gitea, Forgejo, Bitbucket)

**What NOT to borrow:**
- Archon's `IPlatformAdapter` interface surface — it includes messaging methods (`sendMessage`, `ensureThread`, `handleWebhook`) because Archon treats the forge as the conversation venue. fluxaOS doesn't need those. fluxaOS's forge adapter only needs the repo operations: `createBranch`, `createPullRequest`, and later possibly `getPullRequest` / `listPullRequests` / `mergePullRequest`. The existing `src/core/ports/git.ts` already declares these — keep that port, implement it for GitHub.

### 6. Headless worker runtime

**Archon files:**
- `packages/workflows/src/dag-executor.ts` — the DAG executor that spawns subprocess nodes for each workflow step
- `packages/providers/src/community/pi/ui-context-stub.ts` — stub that mocks out interactive UI context when running headless (*"interactive prompts resolve to undefined/false; TUI setters no-op"*)

**What to borrow — the discipline:**
- Workers run as subprocesses (via `execFileAsync`) with `stdin: 'ignore'`, no TTY, no UI context attached
- The prompt template explicitly tells the agent not to ask questions — *"No interactive questions — make informed decisions autonomously"* appears throughout Archon's command files
- Interactive skills that fire in this environment simply no-op or hit stub handlers. There is no channel for them to reach a human, so they can't block.

**fluxaOS already does this.** The existing `src/adapters/subprocess/executor.ts` uses `stdin: 'ignore'`. The existing `PIPELINE_PROMPT` in `src/scripts/db/seed.ts` says "Do not ask questions." This pattern is confirmed compatible; just document it.

**Why this resolves a concern from tonight's session:** the question "won't the worker see the user's `.claude/skills/brainstorming/` and try to ask a question?" — answer: even if it tries, there's no channel for the question to reach anyone. Interactive skills in a headless runtime degrade to no-ops. Archon relies on this; fluxaOS already does too.

### 7. Stage-to-stage artifact handoff

**Archon files:**
- `.archon/workflows/dark-factory-fix-github-issue.yaml` — concrete workflow that uses `$ARTIFACTS_DIR` to pass state between nodes

**The pattern:**

Each workflow run has an associated artifacts directory (separate from the worktree). Nodes write intermediate findings there: `$ARTIFACTS_DIR/investigation.md`, `$ARTIFACTS_DIR/plan.md`, etc. A later node reads what an earlier node produced. Explicit "bridge" nodes copy/rename between conventions (e.g., `plan.md → investigation.md` when the plan path was taken instead of the investigate path).

**What to borrow:**
- The concept of an artifacts directory *separate from the worktree source tree*
- Handoff via files at known paths, not via in-memory data structures or DB round-trips
- Bridge nodes are fine — explicit adaption between stages beats implicit magic

**For fluxaOS:** each pipeline run gets an `artifacts_dir` (path stored on the `pipeline_run` row or derived from `run_id`). Stage prompts get `{{artifacts_path}}` interpolation, same way they already get `{{workspace_path}}` per spec v2.

---

## Patterns fluxaOS deliberately does NOT borrow

### YAML workflow engine

Archon's entire orchestration model is YAML workflows (`packages/workflows/`, `.archon/workflows/*.yaml`). Nodes, DAGs, DAG executor, loop nodes, conditional nodes. It's Archon's product.

**fluxaOS does NOT adopt this.** The product thesis is DB-driven configuration with a web UI, not YAML-authored workflows. The DB tables fluxaOS already has (`pipeline`, `pipeline_stage`, `skill`, `driver`, `routing_profile`) ARE the workflow definition. The UI (Settings tabs, pipeline builder) is the authoring surface.

### Platform adapters for conversations

Archon treats forges as conversation venues — agents comment on GitHub issues as their UI surface. That's why `IPlatformAdapter` has `sendMessage`, `ensureThread`, `handleWebhook`.

**fluxaOS does NOT adopt this.** fluxaOS has its own UI (web app, Realtime-updated). Agents don't talk back through GitHub — they emit `flux:signal` verdicts which the orchestrator persists to the DB and the UI renders. No webhook listening, no comment posting.

### Bun runtime / monorepo packaging

Archon is Bun-native with a monorepo structure (10+ packages: `core`, `git`, `isolation`, `adapters`, `providers`, `workflows`, `server`, `web`, `cli`, `paths`). fluxaOS is Node + Next.js single-app.

**fluxaOS does NOT restructure for this.** We borrow specific files' logic, not the packaging.

### Multi-platform chat adapters (Telegram, Slack, Discord)

Archon ships adapters for multiple chat platforms. fluxaOS's web UI is the only surface.

---

## Attribution policy

Any spec or plan that borrows from Archon MUST include:

1. **A "Prior art" section** at the top, naming Archon and linking to its repo (`github.com/coleam00/Archon`) with the MIT license note.
2. **Specific file pointers** into the Archon codebase for the borrowed patterns — use paths of the form `packages/<pkg>/src/<file>.ts` so future readers can look up the exact reference.
3. **A note on whether the borrow is shape-only (we wrote our own code matching their design) or code-adapted (we lifted and adapted their source)** — code-adapted requires retaining their copyright header and noting MIT license in ours.

Commit messages that introduce borrowed patterns should reference Archon in the body so git archaeology surfaces the lineage.

---

## Maintaining this reference

When fluxaOS borrows a new pattern from Archon:
- Add a section here with file pointers
- Note what was borrowed vs. rejected

When Archon evolves upstream:
- We don't track changes automatically (we're not forking)
- If a pattern we borrowed gets reshaped upstream, we evaluate whether to update ours or stay with the version we borrowed
- Re-clone periodically if we need to reference newer code

When a borrowed pattern turns out to be wrong for fluxaOS:
- Document the divergence here, with the reason
- The pattern in fluxaOS's code stays; the change is just that we no longer consider Archon the canonical reference for that specific concern
