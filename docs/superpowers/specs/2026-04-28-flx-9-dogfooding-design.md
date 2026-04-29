# FLX-9 — Dogfood fluxaOS on its own development

**Status:** Design (this doc)
**Linear:** [FLX-9](https://linear.app/rebos/issue/FLX-9)
**Date:** 2026-04-28
**Author:** Claude Opus 4.7 (with operator)

---

## Summary

Adopt fluxaOS-the-tool as the day-to-day driver for fluxaOS-the-project's own development work. No new code. The mechanism already works — this spec codifies the operating procedure and names the conditions under which the loop can be trusted.

The original FLX-9 ticket framed dogfooding as "philosophically attractive, bootstrap-fragility risk; pick a safe first slice." That framing was correct in 2026-04-26 when it was filed. By 2026-04-28 the two structural blockers it implied (FLX-82 materializer collision, FLX-92 worker-doesn't-commit) have shipped fixes and are end-to-end verified, so the safe first slice is already running.

---

## Background

**What dogfooding means here.** The fluxaOS engine takes an issue, runs a configured pipeline of skill-driven stages against the issue's repo (in an isolated worktree), and the deploy bridge opens a PR. Pre-2026-04-28 the engine pointed at a disposable sandbox repo (`jdpierce21/fluxaos-alpha-e2e-sandbox`) so journey tests could open + close PRs without polluting fluxaOS itself. Dogfooding means flipping the target so fluxaOS opens PRs against fluxaOS.

**What got fixed before this spec.**

- **FLX-82** (Linear, Done 2026-04-28). Skill materializer overwrote the target's `CLAUDE.md` because driver config wrote `instructionsFile` to the worktree root. Self-target = fluxaOS's own CLAUDE.md gets overwritten on every run; commit-msg hook then refuses the deploy commit because no `claude-md-score` trailer is present. Fix moves the materialized workspace to `<artifactsPath>/stage-runs/<id>/workspace/` and passes both paths via `--add-dir`. Worktree CLAUDE.md is preserved.
- **FLX-92** (Linear, Done 2026-04-28). Implement skill prompt expected the worker subprocess to `git add` + `git commit` its own changes. Worker wrote files but didn't commit; review held with "uncommitted work in worktree"; deploy never fired. Fix adds engine-managed auto-commit in stage-runner on `proceed` verdicts (vendor-agnostic, hold/rework/abort still leave the tree dirty), and updates deploy-bridge to push when the branch is ahead of base even if its own `commitAll` is a no-op.
- **Sandbox retirement** (PR #172, 2026-04-28). `FLUXAOS_TEST_TARGET_REPO` description rewritten; destructive journey specs now refuse to run when `FLUXAOS_TARGET_REPO_PATH` resolves to the fluxaOS source root. The disposable sandbox repo is no longer load-bearing.

**End-to-end verification.** 2026-04-28 with `FLUXAOS_TARGET_REPO_PATH=/mnt/dev/fluxaos`, `FLUXAOS_TEST_TARGET_REPO=fluxaOS/fluxaos`, daemon spawned, journey `e2e/r-runtime-deploy-journey.spec.ts` ran an issue end-to-end (research → implement → review → deploy) against real fluxaOS source code via live Claude. Pipeline opened PR https://github.com/fluxaOS/fluxaos/pull/170 (auto-closed by spec teardown ~2s later). 1/1 in 2 min. **First time the deploy contract has been verified self-targeting fluxaOS.**

---

## Goals

1. **Document the operating procedure** for using fluxaOS to ship fluxaOS work.
2. **Name the trust boundary** — when to trust the AI's PR vs when to override.
3. **Keep the engine vendor-agnostic.** No new stage names, skill names, or driver names hard-coded in `src/core/`. All pipeline shape stays DB-driven.
4. **Match Linear's transition plan.** Linear is the human roadmap source-of-truth until fluxaOS-native issue management is feature-complete; this spec works inside that constraint.

## Non-goals

1. **Not a new product feature.** No new pipelines, skills, drivers, UI surfaces, or CLI commands.
2. **Not a Linear ↔ fluxaOS sync.** Native fluxaOS issues are the only thing the engine reads. When operators want to dogfood a Linear-tracked task, they hand-create the corresponding native issue.
3. **Not a "Just Do It" autonomous mode.** Every dogfood run is operator-triggered (file the issue, click Run Stage, or queue it via daemon). FLX-7 is the separate ticket that may add autonomous queueing later.
4. **Not retiring journey tests against the sandbox-shaped flow.** The journey specs that target a disposable repo continue to work — operators just point them at any disposable target they control. fluxaOS itself is non-destructive-only (deploy-touching journeys are the safe set; r-smoke and manual-stage-chain refuse to run with `TARGET_REPO_PATH=/mnt/dev/fluxaos`).

---

## Operating Procedure

### Setup (one-time, per operator workstation)

`.env.local`:

```
FLUXAOS_TARGET_REPO_PATH=/mnt/dev/fluxaos       # the fluxaOS source root
FLUXAOS_TEST_TARGET_REPO=fluxaOS/fluxaos        # the GitHub repo for PRs
FLUXAOS_GITHUB_TOKEN=<PAT with repo scope>
ANTHROPIC_API_KEY=<sk-ant-...>
FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS=30
FLUXAOS_CLEANUP_*=...                            # cleanup-scheduler thresholds
```

Confirm setup is good:

```bash
npm run db:migrate     # applies any pending schema
npm run db:seed        # idempotent
npm run verify:seed    # asserts seed state
```

### Filing a dogfood issue

1. **Open the fluxaOS UI** at `http://192.168.54.101:3003` (or wherever the dev server runs).
2. Navigate to `/default/admin/fluxaos/issues/new`.
3. Title: a clear one-line ask. Body: substantive enough that the implement skill has something to do — acceptance criteria, file paths if known, constraints. Vague issues `hold` with `no actionable content`.
4. Save. The issue lands in the native `issue` table; daemon does not pick it up automatically (operator-triggered, see next).

### Running the pipeline

Two paths, depending on the operator's preference for ceremony.

**Manual (one stage at a time):**

1. Open the issue. Set state → `Implement` (or whichever stage matches the configured pipeline's first non-research stage). The "Run Stage" button appears.
2. Click. Daemon picks up the new `pipeline_run`. Monitor progress in the run modal or in `/default/admin/fluxaos/mission-control`.
3. After deploy, the PR opens against `fluxaOS/fluxaos`. Issue state advances to `review`.

**Daemon-driven (file-and-forget):** today identical to the manual path because the seeded pipeline starts at research and `state=research` is the issue's initial state. A future "auto-pickup" would be FLX-7 / FLX-9 follow-on, not this spec.

### Reviewing the PR

The PR opens against `fluxaOS/fluxaos`. Standard review applies:

1. **CI must pass.** No bypass. Pre-existing GitHub branch protections continue to gate.
2. **Operator reads the diff.** Do not blind-merge. The agent's PR is a starting point, not an artifact of trust.
3. **Manual fixups are normal.** If the agent got 80% there, push commits to the same branch — the journey-test gate (pre-push hook Gate 3) does NOT fire on agent-authored branches because the journey contract attaches to UI-touching PRs only when an operator pushes from `main`. Validate per existing rules.
4. **Merge via the standard `gh pr merge --squash --delete-branch` flow** (or web UI). Post-merge hook auto-prunes.

### When NOT to dogfood

- **Schema/migration work.** Hand-written SQL is the documented path until FLX-16 (drizzle-kit TTY) is fixed. Letting the agent generate migrations risks drift in `_journal.json`.
- **Anything touching the daemon, orchestrator, or stage-runner itself.** A bad change there could break the loop mid-run. Use a worktree + manual implementation; let dogfooding resume after the change ships.
- **Anything touching `CLAUDE.md`.** The commit-msg hook requires a manual `claude-md-score` trailer; the agent doesn't run the improver skill, so its commit gets rejected. Hand-edit + score, then commit.
- **Branch-protected files: `ops/git-hooks/*`, `.claude/AGENT_BEHAVIOR.md`, `.env*`.** Same reasoning — guard rails on these are operator-only.
- **Long-cycle research / design tickets.** Brainstorming + spec writing are operator-driven (per AGENT_BEHAVIOR carve-out). Don't queue an "investigate X and propose a design" issue and expect a useful PR.

A short list of things that ARE good dogfood candidates:
- Bug fixes with a clear repro.
- Adding a missing test against existing code.
- Documentation: new explainers, README updates, missing docstrings.
- Small UI tweaks behind an existing feature flag or settings field.
- Routine refactors (rename, extract function) where scope is mechanical.

### Operator overrides

The fluxaOS UI lets the operator override state at any point and re-run any stage independently of what the orchestrator thinks should happen next (per Alpha Scope in `docs/superpowers/roadmap.md`). Use this freely:

- Stage held? Click into the run, read the metadata, re-trigger or push it past hold manually.
- Worker drifted? `state=cancelled` + close the PR + delete the branch via standard `gh` commands.
- Daemon hung? `pkill -SIGTERM -f daemon`, restart. Recovery sweep reaps stale runs.

---

## Trust Boundary

The dogfood loop is trusted to:

- Open a PR with a coherent commit and a clear description.
- Pass CI on the surface area the diff touches.
- Get the easy 80% of mechanical work right.

The loop is **not** trusted to:

- Self-merge. Operator review is the merge gate.
- Edit load-bearing project memory (`CLAUDE.md`, `AGENT_BEHAVIOR.md`, `ops/git-hooks/`).
- Touch its own engine code (orchestrator, stage-runner, deploy-bridge) without operator-led review.
- Make non-mechanical design decisions. Spec/plan-driven phases stay collaborative.

This boundary is an operator habit, not a code-enforced rule. The PR review is the enforcement point.

---

## Vendor-agnostic / DB-driven invariants (preserved)

This spec adds zero literals to `src/core/`. The pipeline shape, stage names, skill names, driver bindings, and provider config all remain DB-driven (seeded in `src/scripts/db/seed.ts`, mutable from Settings). Specifically:

- The seeded pipeline today is `research → implement → review` (3 stages), bound to the `claude-code` driver. Operators flip stage count, names, drivers, or skills entirely from Settings UI without code change.
- FLX-6 already shipped the `openai-codex` driver (disabled by default). When the operator enables it and reroutes a stage to it, the same dogfood loop runs — engine doesn't care which driver edited the worktree.
- The `triage` / `summarize` / etc. skills hypothesized in earlier brainstorm drafts are NOT being added by this spec. Operators can add any skill they want from Settings → Skills; the engine will execute it.

---

## Risks

1. **Bootstrap fragility.** Original Linear ticket warning. Mitigation: the "When NOT to dogfood" list above; the engine fix-loop stays operator-driven.
2. **PR noise on fluxaOS.** Closed/abandoned dogfood PRs accumulate. Mitigation: standard PR cleanup hygiene; aggressively close failed runs.
3. **Cost.** Live Claude calls aren't free. Mitigation: each issue's run is bounded by the existing cost cap gate rule (`gate:cost` defaults to <$10/stage in seed). Operators tune in Settings → Pipelines.
4. **Worker hallucination editing the wrong files.** The worker is sandboxed in a worktree at `<repo>/.fluxaos-worktrees/<branch>`; even if it writes garbage, main is unaffected until merge. Worst-case is a noisy PR.
5. **Concurrent operator + agent edits.** Operator working in main while a dogfood pipeline is running: two worktrees, two branches, no conflict. Standard git merge-conflict resolution at PR time if scope overlaps.

---

## Success Criteria

This spec is "done" when:

1. The operator has shipped at least one PR via the dogfood loop and merged it into `fluxaOS/fluxaos`. (PR #170 was opened+closed for verification, not merged — counts as proof-of-mechanism but not proof-of-routine.)
2. The "When NOT to dogfood" list above is referenced, not relitigated, when the operator picks the next dogfood candidate.
3. No new structural blocker on the order of FLX-82 or FLX-92 surfaces in the first 5 dogfood runs. (One or two skill-prompt-tweak findings is normal and expected; structural means "the engine can't deliver a working PR without a code change.")

If a structural blocker does surface, file it as its own Linear issue (Bug Backlog), pause dogfooding for the affected scope, fix the blocker, resume.

---

## Open questions

None requiring an answer before adoption. Two worth noting for the operator's awareness:

- **The seeded issue body in `src/scripts/db/seed.ts` references `/api/health`** — work fluxaOS has already shipped. First dogfood run after `db:nuke && db:seed` will short-circuit on `already_complete`. Either edit the seed to a fresh task or file a new issue manually for verification runs.
- **Cost gate threshold.** Default `<$10/stage` is a wide net. Worth tightening per operator preference once ~5 dogfood runs are in the books and we have actual cost data.

---

## Out of scope (sibling tickets, not this spec)

- **Linear → fluxaOS issue sync** (FLX-9 follow-on). When the project moves off Linear entirely, fluxaOS's native issue model becomes the source of truth and the question evaporates.
- **Auto-pickup** ("daemon picks up `state=research` issues without a Run Stage click"). FLX-7 / FLX-9 follow-on. Today operator clicks Run Stage; tomorrow daemon may sweep the queue.
- **Dogfood mode flag** (read-only / write / full). Considered + dropped. The trust boundary is an operator habit, not an engine setting.
- **Native UI to file/manage Linear-tracked dogfood issues.** Out of scope; manual native-issue creation is fine while Linear is still the roadmap source.

---

## References

- Linear: [FLX-9](https://linear.app/rebos/issue/FLX-9), [FLX-82](https://linear.app/rebos/issue/FLX-82), [FLX-92](https://linear.app/rebos/issue/FLX-92), [FLX-16](https://linear.app/rebos/issue/FLX-16) (drizzle-kit TTY), [FLX-7](https://linear.app/rebos/issue/FLX-7) (Just Do It mode).
- Verification PR: [#170](https://github.com/fluxaOS/fluxaos/pull/170) (auto-closed; mechanism proven).
- Sandbox retirement: PR #172.
- Engine fixes: PR #171 (FLX-92), PR #143 (FLX-82, commit `2f4a900`).
- Living docs: `CLAUDE.md` (env var description), `docs/session-quick-start.md`, `docs/superpowers/roadmap.md` (Alpha Scope).
