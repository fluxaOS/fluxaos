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

**Linear hygiene.** When working an FLX-tagged issue, update Linear at every state transition. Don't batch, don't defer:

- **Status:** Backlog → In Progress when work starts. → In Review when PR opens. → Done when PR merges.
- **PR links:** attach every material PR (implementation, verification, docs) via `save_issue` `links:` (append-only).
- **Description:** when the original framing is stale (question got answered, slice got picked, blocker got unblocked), edit the description to reflect current truth. Preserve the original framing as a `## History` section at the bottom.
- **Sibling tickets:** when a finding spins off a new issue (mid-verification bugs, follow-on work), file the new Linear issue immediately and link it from the originating issue.

Linear is the source of truth (per CLAUDE.md). Stale Linear is a bug.

**Definition of done:** PRs merged to main, working tree clean, on main in sync with origin, merged branches deleted (locally + origin), worktrees pruned, Linear issue marked Done with PR links attached. Open PRs don't count as done; merged PRs without a Linear status update don't count either.
