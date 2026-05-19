<!-- Manually mirrored from /mnt/dev/fh-commons/templates/reference-docs/AGENT_BEHAVIOR.md.
     fluxaOS is decoupled from fhc sync (not in projects.json), so this file does NOT
     auto-update when the fh-commons template changes. When the template is updated in
     fh-commons, copy it here manually and re-substitute {{PROJECT}} -> fluxaOS. -->
# Agent Behavior for fluxaOS

AI does every step from brainstorm to shipped. **Once a spec or plan is approved, no questions during execution.** User is involved only for:

1. **Brainstorming, plan review, and design checkpoints.** Refining an idea into a spec or a spec into a plan is collaborative by design — questions are the work product. The `superpowers:brainstorming`, `superpowers:writing-plans`, and `plan-review` skills run their normal Q&A flow; the no-questions rule does not apply during these phases. Once the artifact is user-approved, execution is unattended.
2. **Verifying finished work via web UI.** Journey test must pass 100% (no warnings, no skips, no "it's fine-ish"), then user personally signs off in the browser. Both required — test + sign-off. No code review from the user.
3. **Resetting direction** when things go off the rails (hallucination, stuck loop, obvious drift).

**Verification:** journey test simulates a user end-to-end — Playwright for web, XCUITest for iOS, integration test for services, molecule/integration for infra. No human review substitutes for a passing test; no passing test substitutes for the user's UI sign-off; no shipped PR substitutes for a written test.

**UI-touching PRs require a new or extended journey test in the same PR. No exceptions.** The journey test is the *first* gate; the user's browser sign-off is the *second* gate, never the first. Asking the user to verify a UI change without first writing and running a green Playwright spec is a contract violation. The pre-push hook (`ops/git-hooks/pre-push` Gate 3) enforces the "test exists in the same PR" half mechanically; running the spec green before requesting sign-off is on you.

**No invented numeric thresholds** (budgets, retry counts, line limits) in durable artifacts unless the user set them.

**No cost or time estimates** — once a direction is approved, just do the work and report progress.

**No fallbacks ever.** *"If the primary mechanism doesn't work, that's a bug to fix — not a scenario to code around."* Never write `?? 'default'`-style silent defaults, `value || fallback` chains (try A, then B, then C), polling fallbacks, or degraded-mode / graceful-degradation alternatives. If the primary path fails, surface the error clearly and stop — do not silently substitute another path. Canonical rule lives in [`ARCHITECTURAL_STANDARDS.md` §2](../ARCHITECTURAL_STANDARDS.md#2-no-fallbacks---fail-fast) and is restated as Invariant 9 in [`docs/invariants.md`](../docs/invariants.md).

**Linear hygiene.** When working an FLX-tagged issue, update Linear at every state transition. Don't batch, don't defer:

- **Status:** Backlog → In Progress when work starts. → In Review when PR opens. → Done when PR merges.
- **PR links:** attach every material PR (implementation, verification, docs) via `save_issue` `links:` (append-only).
- **Description:** when the original framing is stale (question got answered, slice got picked, blocker got unblocked), edit the description to reflect current truth. Preserve the original framing as a `## History` section at the bottom.
- **Sibling tickets:** when a finding spins off a new issue (mid-verification bugs, follow-on work), file the new Linear issue immediately and link it from the originating issue.

Linear is the source of truth (per CLAUDE.md). Stale Linear is a bug.

**No `git stash` from agents.** `git stash` writes to the shared repo `refs/stash`, not the worktree — agent B can pop agent A's stash silently and mix unrelated WIP. Agents must not use stash; use temp commits instead. Commit-based recipes for pull-while-dirty, inspect-main, and recoverable-abandon are in [CLAUDE.md](../CLAUDE.md#worktrees--hooks). The pre-push hook blocks pushes when any non-`PROTECTED:`-prefixed stash is present.

**Definition of done:** PRs merged to main, working tree clean, on main in sync with origin, merged branches deleted (locally + origin), worktrees pruned, Linear issue marked Done with PR links attached. Open PRs don't count as done; merged PRs without a Linear status update don't count either.

**Isolation environment.** When "isolation" or "the isolation environment" comes up in fluxaOS discussion, it means a git worktree inside the target repo at `<repo>/.fluxaos-worktrees/<slug>/`, created per stage run and cleaned up by the cleanup scheduler. Stage runners acquire one via `isolationProvider.acquire(...)` — `<repo>` resolves from the project's `target_repo_path` (or `runtime.workspace_root` when set), and the cleanup scheduler reaps it under the `cleanup.stale_days` threshold. This is also the default pattern for parallel agent work per CLAUDE.md ("Worktrees & Hooks"): each agent runs in its own worktree so the four-command branch audit stays clean and "working tree clean" / "worktrees pruned" in the definition of done above is reachable.
